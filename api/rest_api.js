const express = require('express');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const crypto = require('crypto');
const { logger } = require('../utils/helpers');

const router = express.Router();

// Rate limiting per tier di servizio
const createRateLimiter = (windowMs, max, message) => rateLimit({
    windowMs,
    max,
    message: { success: false, error: message },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.apiKey || req.ip
});

// Rate limiters per diversi tier
const rateLimiters = {
    free: createRateLimiter(60 * 1000, 10, 'Rate limit free tier superato'),
    basic: createRateLimiter(60 * 1000, 50, 'Rate limit basic tier superato'),
    pro: createRateLimiter(60 * 1000, 200, 'Rate limit pro tier superato'),
    enterprise: createRateLimiter(60 * 1000, 1000, 'Rate limit enterprise tier superato')
};

// Middleware per autenticazione API Key
const authenticateApiKey = async (req, res, next) => {
    try {
        const apiKey = req.header('Authorization')?.replace('Bearer ', '');
        
        if (!apiKey) {
            return res.status(401).json({
                success: false,
                error: 'API Key richiesta'
            });
        }

        // Verifica API Key nel database
        const db = req.app.get('db');
        const keyData = await db.get('SELECT * FROM api_keys WHERE key_hash = ? AND active = 1', [
            crypto.createHash('sha256').update(apiKey).digest('hex')
        ]);

        if (!keyData) {
            await db.run('INSERT INTO api_logs (api_key, endpoint, method, status, error) VALUES (?, ?, ?, ?, ?)',
                [apiKey.substring(0, 8) + '...', req.path, req.method, 401, 'API Key non valida']);
            
            return res.status(401).json({
                success: false,
                error: 'API Key non valida'
            });
        }

        // Controlla scadenza
        if (keyData.expires_at && new Date(keyData.expires_at) < new Date()) {
            return res.status(401).json({
                success: false,
                error: 'API Key scaduta'
            });
        }

        // Applica rate limiting per tier
        const rateLimiter = rateLimiters[keyData.tier] || rateLimiters.free;
        req.apiKey = apiKey;
        req.apiKeyData = keyData;
        
        rateLimiter(req, res, next);
        
    } catch (error) {
        logger.error('Errore autenticazione API Key:', error);
        res.status(500).json({
            success: false,
            error: 'Errore interno del server'
        });
    }
};

// Middleware per verifica permessi
const checkPermission = (permission) => {
    return (req, res, next) => {
        const permissions = req.apiKeyData.permissions?.split(',') || [];
        
        if (!permissions.includes(permission)) {
            return res.status(403).json({
                success: false,
                error: `Permesso ${permission} richiesto`
            });
        }
        
        next();
    };
};

// Middleware per logging API
const logApiCall = async (req, res, next) => {
    const startTime = Date.now();
    
    res.on('finish', async () => {
        const duration = Date.now() - startTime;
        const db = req.app.get('db');
        
        try {
            await db.run(`
                INSERT INTO api_logs (api_key, endpoint, method, status, duration, ip, user_agent, request_body, response_size) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                req.apiKey?.substring(0, 8) + '...',
                req.path,
                req.method,
                res.statusCode,
                duration,
                req.ip,
                req.get('User-Agent'),
                JSON.stringify(req.body),
                res.get('Content-Length') || 0
            ]);

            // Aggiorna statistiche API Key
            await db.run(`
                UPDATE api_keys 
                SET last_used = CURRENT_TIMESTAMP, 
                    requests_count = requests_count + 1,
                    requests_today = requests_today + 1
                WHERE key_hash = ?
            `, [crypto.createHash('sha256').update(req.apiKey).digest('hex')]);
            
        } catch (error) {
            logger.error('Errore logging API:', error);
        }
    });
    
    next();
};

// Validazioni
const messageValidation = [
    body('phone').matches(/^\+[1-9]\d{1,14}$/).withMessage('Numero di telefono non valido'),
    body('message').isLength({ min: 1, max: 4000 }).withMessage('Messaggio deve essere tra 1 e 4000 caratteri'),
    body('delay').optional().isInt({ min: 0 }).withMessage('Delay deve essere un numero positivo')
];

const bulkMessageValidation = [
    body('messages').isArray({ min: 1, max: 100 }).withMessage('Massimo 100 messaggi per richiesta'),
    body('messages.*.phone').matches(/^\+[1-9]\d{1,14}$/).withMessage('Numero di telefono non valido'),
    body('messages.*.message').isLength({ min: 1, max: 4000 }).withMessage('Messaggio deve essere tra 1 e 4000 caratteri')
];

const webhookValidation = [
    body('url').isURL().withMessage('URL webhook non valido'),
    body('events').isArray({ min: 1 }).withMessage('Almeno un evento richiesto'),
    body('secret').optional().isLength({ min: 8 }).withMessage('Secret deve essere almeno 8 caratteri')
];

// Gestione errori di validazione
const handleValidationErrors = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({
            success: false,
            error: 'Dati non validi',
            details: errors.array()
        });
    }
    next();
};

// API Routes

// 1. Invio messaggio singolo
router.post('/v1/messages', 
    authenticateApiKey,
    logApiCall,
    checkPermission('send_message'),
    messageValidation,
    handleValidationErrors,
    async (req, res) => {
        try {
            const { phone, message, delay = 0 } = req.body;
            const whatsappService = req.app.get('whatsappService');
            
            // Verifica stato WhatsApp
            const whatsappStatus = await whatsappService.getStatus();
            if (!whatsappStatus.connected) {
                return res.status(503).json({
                    success: false,
                    error: 'WhatsApp non connesso'
                });
            }

            // Programma invio (se delay specificato)
            if (delay > 0) {
                setTimeout(async () => {
                    const result = await whatsappService.sendMessage(phone, message);
                    await req.app.get('db').run(
                        'INSERT INTO messages (phone, message, status, api_key, scheduled_at) VALUES (?, ?, ?, ?, ?)',
                        [phone, message, result.success ? 'sent' : 'failed', req.apiKey, new Date(Date.now() + delay)]
                    );
                }, delay);
                
                return res.json({
                    success: true,
                    message: 'Messaggio programmato',
                    scheduledAt: new Date(Date.now() + delay).toISOString()
                });
            }

            // Invio immediato
            const result = await whatsappService.sendMessage(phone, message);
            
            // Log nel database
            await req.app.get('db').run(
                'INSERT INTO messages (phone, message, status, api_key, error) VALUES (?, ?, ?, ?, ?)',
                [phone, message, result.success ? 'sent' : 'failed', req.apiKey, result.error || null]
            );

            if (result.success) {
                // Trigger webhook
                await triggerWebhook(req.app, req.apiKeyData.user_id, 'message_sent', {
                    phone,
                    message,
                    messageId: result.messageId,
                    timestamp: new Date().toISOString()
                });

                res.json({
                    success: true,
                    message: 'Messaggio inviato con successo',
                    messageId: result.messageId
                });
            } else {
                await triggerWebhook(req.app, req.apiKeyData.user_id, 'message_failed', {
                    phone,
                    message,
                    error: result.error,
                    timestamp: new Date().toISOString()
                });

                res.status(500).json({
                    success: false,
                    error: result.error
                });
            }
            
        } catch (error) {
            logger.error('Errore invio messaggio API:', error);
            res.status(500).json({
                success: false,
                error: 'Errore interno del server'
            });
        }
    }
);

// 2. Invio messaggi bulk
router.post('/v1/messages/bulk',
    authenticateApiKey,
    logApiCall,
    checkPermission('send_bulk'),
    bulkMessageValidation,
    handleValidationErrors,
    async (req, res) => {
        try {
            const { messages } = req.body;
            const whatsappService = req.app.get('whatsappService');
            const db = req.app.get('db');
            
            const results = [];
            let successCount = 0;
            let failureCount = 0;

            for (const msg of messages) {
                try {
                    const result = await whatsappService.sendMessage(msg.phone, msg.message);
                    
                    await db.run(
                        'INSERT INTO messages (phone, message, status, api_key, error) VALUES (?, ?, ?, ?, ?)',
                        [msg.phone, msg.message, result.success ? 'sent' : 'failed', req.apiKey, result.error || null]
                    );

                    results.push({
                        phone: msg.phone,
                        success: result.success,
                        messageId: result.messageId,
                        error: result.error
                    });

                    if (result.success) {
                        successCount++;
                    } else {
                        failureCount++;
                    }

                    // Piccolo delay tra messaggi per evitare spam
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    
                } catch (error) {
                    logger.error(`Errore invio messaggio bulk ${msg.phone}:`, error);
                    results.push({
                        phone: msg.phone,
                        success: false,
                        error: error.message
                    });
                    failureCount++;
                }
            }

            // Trigger webhook per bulk
            await triggerWebhook(req.app, req.apiKeyData.user_id, 'bulk_completed', {
                totalMessages: messages.length,
                successCount,
                failureCount,
                results,
                timestamp: new Date().toISOString()
            });

            res.json({
                success: true,
                message: `Bulk completato: ${successCount} inviati, ${failureCount} falliti`,
                results,
                summary: {
                    total: messages.length,
                    success: successCount,
                    failed: failureCount
                }
            });
            
        } catch (error) {
            logger.error('Errore invio bulk API:', error);
            res.status(500).json({
                success: false,
                error: 'Errore interno del server'
            });
        }
    }
);

// 3. Lista messaggi
router.get('/v1/messages',
    authenticateApiKey,
    logApiCall,
    checkPermission('read_messages'),
    async (req, res) => {
        try {
            const { limit = 50, offset = 0, status, phone, from_date, to_date } = req.query;
            const db = req.app.get('db');
            
            let query = 'SELECT * FROM messages WHERE api_key = ?';
            let params = [req.apiKey];
            
            if (status) {
                query += ' AND status = ?';
                params.push(status);
            }
            
            if (phone) {
                query += ' AND phone = ?';
                params.push(phone);
            }
            
            if (from_date) {
                query += ' AND created_at >= ?';
                params.push(from_date);
            }
            
            if (to_date) {
                query += ' AND created_at <= ?';
                params.push(to_date);
            }
            
            query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
            params.push(parseInt(limit), parseInt(offset));
            
            const messages = await db.all(query, params);
            
            // Count totale
            let countQuery = 'SELECT COUNT(*) as total FROM messages WHERE api_key = ?';
            let countParams = [req.apiKey];
            
            if (status) {
                countQuery += ' AND status = ?';
                countParams.push(status);
            }
            
            const total = await db.get(countQuery, countParams);
            
            res.json({
                success: true,
                messages,
                pagination: {
                    total: total.total,
                    limit: parseInt(limit),
                    offset: parseInt(offset),
                    hasMore: total.total > parseInt(offset) + parseInt(limit)
                }
            });
            
        } catch (error) {
            logger.error('Errore recupero messaggi API:', error);
            res.status(500).json({
                success: false,
                error: 'Errore interno del server'
            });
        }
    }
);

// 4. Statistiche
router.get('/v1/stats',
    authenticateApiKey,
    logApiCall,
    checkPermission('read_stats'),
    async (req, res) => {
        try {
            const { range = 7 } = req.query;
            const db = req.app.get('db');
            
            const stats = await db.get(`
                SELECT 
                    COUNT(*) as total_messages,
                    SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) as sent_messages,
                    SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed_messages,
                    ROUND(AVG(CASE WHEN status = 'sent' THEN 1.0 ELSE 0.0 END) * 100, 2) as success_rate
                FROM messages 
                WHERE api_key = ? AND created_at >= datetime('now', '-${range} days')
            `, [req.apiKey]);
            
            const dailyStats = await db.all(`
                SELECT 
                    DATE(created_at) as date,
                    COUNT(*) as total,
                    SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) as sent,
                    SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
                FROM messages 
                WHERE api_key = ? AND created_at >= datetime('now', '-${range} days')
                GROUP BY DATE(created_at)
                ORDER BY date
            `, [req.apiKey]);
            
            const topPhones = await db.all(`
                SELECT 
                    phone,
                    COUNT(*) as message_count,
                    SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) as sent_count
                FROM messages 
                WHERE api_key = ? AND created_at >= datetime('now', '-${range} days')
                GROUP BY phone
                ORDER BY message_count DESC
                LIMIT 10
            `, [req.apiKey]);
            
            res.json({
                success: true,
                stats: {
                    summary: stats,
                    daily: dailyStats,
                    topPhones,
                    range: parseInt(range)
                }
            });
            
        } catch (error) {
            logger.error('Errore recupero statistiche API:', error);
            res.status(500).json({
                success: false,
                error: 'Errore interno del server'
            });
        }
    }
);

// 5. Gestione webhook
router.post('/v1/webhooks',
    authenticateApiKey,
    logApiCall,
    checkPermission('manage_webhooks'),
    webhookValidation,
    handleValidationErrors,
    async (req, res) => {
        try {
            const { url, events, secret } = req.body;
            const db = req.app.get('db');
            
            // Verifica se webhook già esiste
            const existing = await db.get('SELECT id FROM webhooks WHERE user_id = ? AND url = ?', 
                [req.apiKeyData.user_id, url]);
            
            if (existing) {
                return res.status(409).json({
                    success: false,
                    error: 'Webhook già configurato per questa URL'
                });
            }
            
            const webhookId = await db.run(`
                INSERT INTO webhooks (user_id, url, events, secret, active) 
                VALUES (?, ?, ?, ?, 1)
            `, [req.apiKeyData.user_id, url, events.join(','), secret]);
            
            res.json({
                success: true,
                message: 'Webhook configurato con successo',
                webhookId: webhookId.lastID
            });
            
        } catch (error) {
            logger.error('Errore configurazione webhook:', error);
            res.status(500).json({
                success: false,
                error: 'Errore interno del server'
            });
        }
    }
);

// 6. Lista webhook
router.get('/v1/webhooks',
    authenticateApiKey,
    logApiCall,
    checkPermission('manage_webhooks'),
    async (req, res) => {
        try {
            const db = req.app.get('db');
            const webhooks = await db.all(`
                SELECT id, url, events, active, created_at, last_triggered
                FROM webhooks 
                WHERE user_id = ?
                ORDER BY created_at DESC
            `, [req.apiKeyData.user_id]);
            
            res.json({
                success: true,
                webhooks: webhooks.map(webhook => ({
                    ...webhook,
                    events: webhook.events.split(',')
                }))
            });
            
        } catch (error) {
            logger.error('Errore recupero webhook:', error);
            res.status(500).json({
                success: false,
                error: 'Errore interno del server'
            });
        }
    }
);

// 7. Test webhook
router.post('/v1/webhooks/:id/test',
    authenticateApiKey,
    logApiCall,
    checkPermission('manage_webhooks'),
    async (req, res) => {
        try {
            const db = req.app.get('db');
            const webhook = await db.get('SELECT * FROM webhooks WHERE id = ? AND user_id = ?', 
                [req.params.id, req.apiKeyData.user_id]);
            
            if (!webhook) {
                return res.status(404).json({
                    success: false,
                    error: 'Webhook non trovato'
                });
            }
            
            const testData = {
                event: 'webhook_test',
                data: {
                    message: 'Test webhook da WAPower',
                    timestamp: new Date().toISOString()
                }
            };
            
            const result = await sendWebhook(webhook, testData);
            
            res.json({
                success: true,
                message: 'Test webhook inviato',
                result
            });
            
        } catch (error) {
            logger.error('Errore test webhook:', error);
            res.status(500).json({
                success: false,
                error: 'Errore interno del server'
            });
        }
    }
);

// 8. Eventi webhook disponibili
router.get('/v1/webhooks/events',
    authenticateApiKey,
    logApiCall,
    async (req, res) => {
        const events = [
            {
                name: 'message_sent',
                description: 'Messaggio inviato con successo',
                data: { phone: 'string', message: 'string', messageId: 'string' }
            },
            {
                name: 'message_failed',
                description: 'Invio messaggio fallito',
                data: { phone: 'string', message: 'string', error: 'string' }
            },
            {
                name: 'bulk_completed',
                description: 'Invio bulk completato',
                data: { totalMessages: 'number', successCount: 'number', failureCount: 'number' }
            },
            {
                name: 'whatsapp_ready',
                description: 'WhatsApp connesso',
                data: { status: 'string' }
            },
            {
                name: 'whatsapp_disconnected',
                description: 'WhatsApp disconnesso',
                data: { reason: 'string' }
            },
            {
                name: 'email_processed',
                description: 'Email processata',
                data: { from: 'string', subject: 'string', phone: 'string' }
            }
        ];
        
        res.json({
            success: true,
            events
        });
    }
);

// Funzioni di supporto per webhook
async function triggerWebhook(app, userId, eventName, data) {
    try {
        const db = app.get('db');
        const webhooks = await db.all(`
            SELECT * FROM webhooks 
            WHERE user_id = ? AND active = 1 AND events LIKE ?
        `, [userId, `%${eventName}%`]);
        
        for (const webhook of webhooks) {
            await sendWebhook(webhook, {
                event: eventName,
                data,
                timestamp: new Date().toISOString()
            });
        }
    } catch (error) {
        logger.error('Errore trigger webhook:', error);
    }
}

async function sendWebhook(webhook, payload) {
    const axios = require('axios');
    const maxRetries = 3;
    let attempt = 0;
    
    while (attempt < maxRetries) {
        try {
            const headers = {
                'Content-Type': 'application/json',
                'User-Agent': 'WAPower-Webhook/1.0'
            };
            
            // Aggiungi firma HMAC se secret presente
            if (webhook.secret) {
                const signature = crypto
                    .createHmac('sha256', webhook.secret)
                    .update(JSON.stringify(payload))
                    .digest('hex');
                headers['X-WAPower-Signature'] = `sha256=${signature}`;
            }
            
            const response = await axios.post(webhook.url, payload, {
                headers,
                timeout: 10000
            });
            
            // Log successo
            await logWebhookDelivery(webhook.id, 'success', response.status, null);
            
            return {
                success: true,
                status: response.status,
                attempt: attempt + 1
            };
            
        } catch (error) {
            attempt++;
            
            if (attempt >= maxRetries) {
                await logWebhookDelivery(webhook.id, 'failed', 
                    error.response?.status || 0, error.message);
                
                return {
                    success: false,
                    error: error.message,
                    attempts: attempt
                };
            }
            
            // Backoff esponenziale
            await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
        }
    }
}

async function logWebhookDelivery(webhookId, status, httpStatus, error) {
    try {
        const db = require('../services/database');
        await db.run(`
            INSERT INTO webhook_logs (webhook_id, status, http_status, error, delivered_at)
            VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
        `, [webhookId, status, httpStatus, error]);
        
        // Aggiorna last_triggered nel webhook
        await db.run('UPDATE webhooks SET last_triggered = CURRENT_TIMESTAMP WHERE id = ?', 
            [webhookId]);
    } catch (logError) {
        logger.error('Errore logging webhook:', logError);
    }
}

module.exports = router;