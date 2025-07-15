const EventEmitter = require('events');
const axios = require('axios');
const crypto = require('crypto');
const { logger } = require('../utils/helpers');

class WebhookService extends EventEmitter {
    constructor(databaseService) {
        super();
        this.db = databaseService;
        this.retryQueue = new Map();
        this.maxRetries = 3;
        this.retryDelay = 1000; // 1 secondo base
        this.maxRetryDelay = 30000; // 30 secondi max
        
        // Avvia il processo di retry
        this.startRetryProcessor();
    }

    async initializeDatabase() {
        try {
            // Crea tabelle se non esistono
            await this.db.run(`
                CREATE TABLE IF NOT EXISTS webhooks (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL,
                    url TEXT NOT NULL,
                    events TEXT NOT NULL,
                    secret TEXT,
                    active BOOLEAN DEFAULT 1,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    last_triggered DATETIME,
                    total_deliveries INTEGER DEFAULT 0,
                    successful_deliveries INTEGER DEFAULT 0,
                    failed_deliveries INTEGER DEFAULT 0
                )
            `);

            await this.db.run(`
                CREATE TABLE IF NOT EXISTS webhook_logs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    webhook_id INTEGER NOT NULL,
                    event_type TEXT NOT NULL,
                    payload TEXT NOT NULL,
                    status TEXT NOT NULL,
                    http_status INTEGER,
                    error TEXT,
                    attempt_number INTEGER DEFAULT 1,
                    delivered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (webhook_id) REFERENCES webhooks (id)
                )
            `);

            // Crea indici per performance
            await this.db.run(`CREATE INDEX IF NOT EXISTS idx_webhooks_user_id ON webhooks (user_id)`);
            await this.db.run(`CREATE INDEX IF NOT EXISTS idx_webhook_logs_webhook_id ON webhook_logs (webhook_id)`);
            await this.db.run(`CREATE INDEX IF NOT EXISTS idx_webhook_logs_delivered_at ON webhook_logs (delivered_at)`);

            logger.info('Database webhook inizializzato');
        } catch (error) {
            logger.error('Errore inizializzazione database webhook:', error);
            throw error;
        }
    }

    async registerWebhook(userId, url, events, secret = null) {
        try {
            // Verifica se webhook già esiste
            const existing = await this.db.get(`
                SELECT id FROM webhooks 
                WHERE user_id = ? AND url = ? AND active = 1
            `, [userId, url]);

            if (existing) {
                throw new Error('Webhook già registrato per questa URL');
            }

            // Valida URL
            if (!this.isValidUrl(url)) {
                throw new Error('URL webhook non valido');
            }

            // Valida eventi
            const validEvents = this.getValidEvents();
            const invalidEvents = events.filter(event => !validEvents.includes(event));
            if (invalidEvents.length > 0) {
                throw new Error(`Eventi non validi: ${invalidEvents.join(', ')}`);
            }

            // Registra webhook
            const result = await this.db.run(`
                INSERT INTO webhooks (user_id, url, events, secret, active)
                VALUES (?, ?, ?, ?, 1)
            `, [userId, url, events.join(','), secret]);

            logger.info(`Webhook registrato: ${url} per utente ${userId}`);
            
            return {
                success: true,
                webhookId: result.lastID,
                message: 'Webhook registrato con successo'
            };

        } catch (error) {
            logger.error('Errore registrazione webhook:', error);
            throw error;
        }
    }

    async triggerWebhook(userId, eventType, data) {
        try {
            // Trova webhook attivi per questo utente e evento
            const webhooks = await this.db.all(`
                SELECT * FROM webhooks 
                WHERE user_id = ? AND active = 1 AND events LIKE ?
            `, [userId, `%${eventType}%`]);

            if (webhooks.length === 0) {
                return;
            }

            const payload = {
                event: eventType,
                data: data,
                timestamp: new Date().toISOString(),
                user_id: userId
            };

            // Invia webhook per ciascun endpoint
            for (const webhook of webhooks) {
                await this.sendWebhook(webhook, payload);
            }

            this.emit('webhookTriggered', {
                userId,
                eventType,
                webhookCount: webhooks.length
            });

        } catch (error) {
            logger.error('Errore trigger webhook:', error);
            this.emit('webhookError', {
                userId,
                eventType,
                error: error.message
            });
        }
    }

    async sendWebhook(webhook, payload, attemptNumber = 1) {
        try {
            const headers = {
                'Content-Type': 'application/json',
                'User-Agent': 'WAPower-Webhook/1.0',
                'X-WAPower-Event': payload.event,
                'X-WAPower-Timestamp': payload.timestamp,
                'X-WAPower-Attempt': attemptNumber.toString()
            };

            // Aggiungi firma HMAC se secret presente
            if (webhook.secret) {
                const signature = this.generateSignature(payload, webhook.secret);
                headers['X-WAPower-Signature'] = signature;
            }

            const startTime = Date.now();
            
            const response = await axios.post(webhook.url, payload, {
                headers,
                timeout: 15000, // 15 secondi timeout
                maxRedirects: 3,
                validateStatus: (status) => status >= 200 && status < 300
            });

            const duration = Date.now() - startTime;

            // Log successo
            await this.logWebhookDelivery(webhook.id, payload.event, payload, 
                'success', response.status, null, attemptNumber, duration);

            // Aggiorna statistiche webhook
            await this.updateWebhookStats(webhook.id, true);

            logger.info(`Webhook inviato con successo: ${webhook.url} (${duration}ms)`);

            return {
                success: true,
                status: response.status,
                attempt: attemptNumber,
                duration
            };

        } catch (error) {
            const duration = Date.now() - startTime;
            const errorMessage = error.response?.data?.message || error.message;
            const httpStatus = error.response?.status || 0;

            // Log errore
            await this.logWebhookDelivery(webhook.id, payload.event, payload,
                'failed', httpStatus, errorMessage, attemptNumber, duration);

            // Se non è l'ultimo tentativo, aggiungi alla coda di retry
            if (attemptNumber < this.maxRetries) {
                await this.queueRetry(webhook, payload, attemptNumber + 1);
            } else {
                // Aggiorna statistiche webhook
                await this.updateWebhookStats(webhook.id, false);
                
                logger.error(`Webhook fallito definitivamente: ${webhook.url} dopo ${attemptNumber} tentativi`);
            }

            return {
                success: false,
                error: errorMessage,
                status: httpStatus,
                attempt: attemptNumber,
                duration
            };
        }
    }

    async queueRetry(webhook, payload, attemptNumber) {
        const retryDelay = Math.min(
            this.retryDelay * Math.pow(2, attemptNumber - 1),
            this.maxRetryDelay
        );

        const retryTime = Date.now() + retryDelay;
        
        if (!this.retryQueue.has(webhook.id)) {
            this.retryQueue.set(webhook.id, []);
        }

        this.retryQueue.get(webhook.id).push({
            webhook,
            payload,
            attemptNumber,
            retryTime
        });

        logger.info(`Webhook in coda per retry: ${webhook.url} (tentativo ${attemptNumber} in ${retryDelay}ms)`);
    }

    startRetryProcessor() {
        setInterval(() => {
            this.processRetryQueue();
        }, 5000); // Controlla ogni 5 secondi
    }

    async processRetryQueue() {
        const now = Date.now();
        
        for (const [webhookId, retries] of this.retryQueue.entries()) {
            const readyRetries = retries.filter(retry => retry.retryTime <= now);
            
            if (readyRetries.length > 0) {
                // Rimuovi retry processati dalla coda
                this.retryQueue.set(webhookId, retries.filter(retry => retry.retryTime > now));
                
                // Processa retry
                for (const retry of readyRetries) {
                    await this.sendWebhook(retry.webhook, retry.payload, retry.attemptNumber);
                }
            }
        }
    }

    generateSignature(payload, secret) {
        const payloadString = JSON.stringify(payload);
        const signature = crypto
            .createHmac('sha256', secret)
            .update(payloadString)
            .digest('hex');
        return `sha256=${signature}`;
    }

    verifySignature(payload, signature, secret) {
        const expectedSignature = this.generateSignature(payload, secret);
        return signature === expectedSignature;
    }

    getValidEvents() {
        return [
            'message_sent',
            'message_failed',
            'bulk_completed',
            'whatsapp_ready',
            'whatsapp_disconnected',
            'whatsapp_reconnected',
            'email_processed',
            'email_failed',
            'update_completed',
            'update_failed',
            'backup_completed',
            'backup_failed',
            'system_error',
            'api_key_created',
            'api_key_revoked'
        ];
    }

    isValidUrl(url) {
        try {
            const parsed = new URL(url);
            return parsed.protocol === 'https:' || parsed.protocol === 'http:';
        } catch (error) {
            return false;
        }
    }

    async logWebhookDelivery(webhookId, eventType, payload, status, httpStatus, error, attemptNumber, duration) {
        try {
            await this.db.run(`
                INSERT INTO webhook_logs (
                    webhook_id, event_type, payload, status, http_status, 
                    error, attempt_number, delivered_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            `, [
                webhookId,
                eventType,
                JSON.stringify(payload),
                status,
                httpStatus,
                error,
                attemptNumber
            ]);
        } catch (logError) {
            logger.error('Errore logging webhook delivery:', logError);
        }
    }

    async updateWebhookStats(webhookId, success) {
        try {
            await this.db.run(`
                UPDATE webhooks 
                SET 
                    total_deliveries = total_deliveries + 1,
                    successful_deliveries = successful_deliveries + ?,
                    failed_deliveries = failed_deliveries + ?,
                    last_triggered = CURRENT_TIMESTAMP
                WHERE id = ?
            `, [success ? 1 : 0, success ? 0 : 1, webhookId]);
        } catch (error) {
            logger.error('Errore aggiornamento statistiche webhook:', error);
        }
    }
}

module.exports = WebhookService;