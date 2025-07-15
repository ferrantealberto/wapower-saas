const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');
const { logger, extractPhoneNumber, cleanHtml, formatFileSize } = require('../utils/helpers');

class GmailService extends EventEmitter {
    constructor(whatsappService, databaseService) {
        super();
        this.whatsapp = whatsappService;
        this.db = databaseService;
        this.gmail = null;
        this.isConnected = false;
        this.isPolling = false;
        this.pollingInterval = null;
        this.tempDir = path.join(__dirname, '..', 'temp');
        this.processedEmails = new Set();
        
        this.config = {
            clientId: process.env.GMAIL_CLIENT_ID,
            clientSecret: process.env.GMAIL_CLIENT_SECRET,
            redirectUri: process.env.GMAIL_REDIRECT_URI || 'https://developers.google.com/oauthplayground',
            refreshToken: process.env.GMAIL_REFRESH_TOKEN,
            pollingInterval: parseInt(process.env.POLLING_INTERVAL) || 30000,
            maxAttachmentSize: parseInt(process.env.MAX_ATTACHMENT_SIZE) || 25 * 1024 * 1024, // 25MB
            allowedAttachmentTypes: (process.env.ALLOWED_ATTACHMENT_TYPES || 'jpg,jpeg,png,gif,pdf,doc,docx,txt').split(',')
        };
        
        this.ensureTempDir();
    }

    ensureTempDir() {
        if (!fs.existsSync(this.tempDir)) {
            fs.mkdirSync(this.tempDir, { recursive: true });
        }
    }

    async initialize() {
        try {
            logger.info('Inizializzazione Gmail service...');
            
            if (!this.config.clientId || !this.config.clientSecret || !this.config.refreshToken) {
                throw new Error('Configurazione Gmail incompleta');
            }

            const oauth2Client = new google.auth.OAuth2(
                this.config.clientId,
                this.config.clientSecret,
                this.config.redirectUri
            );

            oauth2Client.setCredentials({
                refresh_token: this.config.refreshToken
            });

            this.gmail = google.gmail({ version: 'v1', auth: oauth2Client });

            // Test connessione
            await this.testConnection();
            this.isConnected = true;
            this.emit('connected');

            // Avvia polling
            this.startPolling();
            
            logger.info('Gmail service inizializzato con successo');
        } catch (error) {
            logger.error('Errore inizializzazione Gmail:', error);
            this.emit('error', error);
            throw error;
        }
    }

    async testConnection() {
        try {
            const response = await this.gmail.users.getProfile({ userId: 'me' });
            logger.info(`Gmail connesso per: ${response.data.emailAddress}`);
            return response.data;
        } catch (error) {
            logger.error('Errore test connessione Gmail:', error);
            throw error;
        }
    }

    startPolling() {
        if (this.isPolling) return;
        
        this.isPolling = true;
        logger.info(`Avvio polling Gmail ogni ${this.config.pollingInterval}ms`);
        
        this.pollingInterval = setInterval(async () => {
            try {
                await this.checkNewEmails();
            } catch (error) {
                logger.error('Errore durante polling Gmail:', error);
                this.emit('error', error);
            }
        }, this.config.pollingInterval);

        // Primo controllo immediato
        this.checkNewEmails();
    }

    stopPolling() {
        if (this.pollingInterval) {
            clearInterval(this.pollingInterval);
            this.pollingInterval = null;
        }
        this.isPolling = false;
        logger.info('Polling Gmail fermato');
    }

    async checkNewEmails() {
        try {
            const query = 'is:unread';
            const response = await this.gmail.users.messages.list({
                userId: 'me',
                q: query,
                maxResults: 10
            });

            const messages = response.data.messages || [];
            
            for (const message of messages) {
                if (!this.processedEmails.has(message.id)) {
                    await this.processEmail(message.id);
                    this.processedEmails.add(message.id);
                }
            }

            if (this.db) {
                await this.db.updateDailyStats('emails_processed', messages.length);
            }
        } catch (error) {
            logger.error('Errore controllo nuove email:', error);
            throw error;
        }
    }

    async processEmail(messageId) {
        try {
            const message = await this.gmail.users.messages.get({
                userId: 'me',
                id: messageId,
                format: 'full'
            });

            const email = this.parseEmail(message.data);

            // Estrai numero di telefono
            const phoneNumber = this.extractPhoneFromEmail(email);
            if (!phoneNumber) {
                logger.warn('Nessun numero di telefono trovato nell\'email:', email.subject);
                return;
            }

            // Prepara messaggio
            let messageText = this.prepareMessage(email);

            // Gestisci allegati
            const attachments = await this.processAttachments(message.data, messageId);

            // Invia messaggio WhatsApp
            const result = await this.whatsapp.sendMessage(phoneNumber, messageText);

            // Invia allegati se presenti
            if (attachments.length > 0) {
                for (const attachment of attachments) {
                    await this.whatsapp.sendMedia(phoneNumber, attachment.path, attachment.filename);
                }
            }

            // Log risultato
            if (this.db) {
                await this.db.logMessage(
                    'email',
                    phoneNumber,
                    messageText,
                    result.success ? 'sent' : 'failed',
                    result.error || null
                );
            }

            // Marca come letta
            await this.gmail.users.messages.modify({
                userId: 'me',
                id: messageId,
                resource: {
                    removeLabelIds: ['UNREAD']
                }
            });

            // Cleanup allegati temporanei
            this.cleanupAttachments(attachments);

            this.emit('emailProcessed', {
                messageId,
                from: email.from,
                subject: email.subject,
                phone: phoneNumber,
                success: result.success,
                attachments: attachments.length
            });

            logger.info(`Email processata: ${email.from} -> ${phoneNumber}`);
        } catch (error) {
            logger.error('Errore elaborazione email:', error);
            throw error;
        }
    }

    parseEmail(message) {
        const headers = message.payload.headers;
        const getHeader = (name) => {
            const header = headers.find(h => h.name.toLowerCase() === name.toLowerCase());
            return header ? header.value : '';
        };

        const email = {
            id: message.id,
            from: getHeader('from'),
            to: getHeader('to'),
            subject: getHeader('subject'),
            date: getHeader('date'),
            body: this.extractEmailBody(message.payload)
        };

        return email;
    }

    extractEmailBody(payload) {
        let body = '';
        
        if (payload.parts) {
            for (const part of payload.parts) {
                if (part.mimeType === 'text/plain' && part.body.data) {
                    body += Buffer.from(part.body.data, 'base64').toString();
                } else if (part.mimeType === 'text/html' && part.body.data) {
                    const htmlContent = Buffer.from(part.body.data, 'base64').toString();
                    body += cleanHtml(htmlContent);
                } else if (part.parts) {
                    body += this.extractEmailBody(part);
                }
            }
        } else if (payload.body && payload.body.data) {
            body = Buffer.from(payload.body.data, 'base64').toString();
            if (payload.mimeType === 'text/html') {
                body = cleanHtml(body);
            }
        }

        return body.trim();
    }

    extractPhoneFromEmail(email) {
        const searchText = `${email.subject} ${email.body} ${email.from}`;
        return extractPhoneNumber(searchText);
    }

    prepareMessage(email) {
        let message = `📧 *Nuova Email*\n\n`;
        message += `*Da:* ${email.from}\n`;
        message += `*Oggetto:* ${email.subject}\n`;
        message += `*Data:* ${new Date(email.date).toLocaleString('it-IT')}\n\n`;
        message += `*Messaggio:*\n${email.body}`;

        // Limita lunghezza messaggio
        const maxLength = parseInt(process.env.MAX_MESSAGE_LENGTH) || 4000;
        if (message.length > maxLength) {
            message = message.substring(0, maxLength - 50) + '\n\n...[messaggio troncato]';
        }

        return message;
    }

    async processAttachments(message, messageId) {
        const attachments = [];
        
        try {
            await this.findAttachments(message.payload, attachments, messageId);
            
            const processedAttachments = [];
            
            for (const attachment of attachments) {
                try {
                    // Verifica dimensione
                    if (attachment.size > this.config.maxAttachmentSize) {
                        logger.warn(`Allegato troppo grande ignorato: ${attachment.filename} (${formatFileSize(attachment.size)})`);
                        continue;
                    }

                    // Verifica tipo file
                    const extension = path.extname(attachment.filename).toLowerCase().slice(1);
                    if (!this.config.allowedAttachmentTypes.includes(extension)) {
                        logger.warn(`Tipo file non supportato ignorato: ${attachment.filename}`);
                        continue;
                    }

                    // Scarica allegato
                    const attachmentData = await this.gmail.users.messages.attachments.get({
                        userId: 'me',
                        messageId: messageId,
                        id: attachment.attachmentId
                    });

                    const data = Buffer.from(attachmentData.data.data, 'base64');
                    const tempPath = path.join(this.tempDir, `${Date.now()}_${attachment.filename}`);
                    
                    fs.writeFileSync(tempPath, data);

                    processedAttachments.push({
                        filename: attachment.filename,
                        path: tempPath,
                        size: attachment.size,
                        mimeType: attachment.mimeType
                    });

                    logger.info(`Allegato processato: ${attachment.filename} (${formatFileSize(attachment.size)})`);
                } catch (error) {
                    logger.error(`Errore elaborazione allegato ${attachment.filename}:`, error);
                }
            }

            return processedAttachments;
        } catch (error) {
            logger.error('Errore elaborazione allegati:', error);
            return [];
        }
    }

    async findAttachments(payload, attachments, messageId) {
        if (payload.parts) {
            for (const part of payload.parts) {
                if (part.filename && part.filename.length > 0 && part.body.attachmentId) {
                    attachments.push({
                        filename: part.filename,
                        mimeType: part.mimeType,
                        size: part.body.size,
                        attachmentId: part.body.attachmentId
                    });
                }
                
                if (part.parts) {
                    await this.findAttachments(part, attachments, messageId);
                }
            }
        }
    }

    cleanupAttachments(attachments) {
        for (const attachment of attachments) {
            try {
                if (fs.existsSync(attachment.path)) {
                    fs.unlinkSync(attachment.path);
                }
            } catch (error) {
                logger.error(`Errore rimozione allegato temporaneo ${attachment.path}:`, error);
            }
        }
    }

    async testEmailProcessing() {
        try {
            logger.info('Test elaborazione email...');
            
            // Ottieni ultima email
            const response = await this.gmail.users.messages.list({
                userId: 'me',
                maxResults: 1
            });

            if (!response.data.messages || response.data.messages.length === 0) {
                return { success: false, error: 'Nessuna email trovata' };
            }

            const messageId = response.data.messages[0].id;
            
            // Simula elaborazione
            await this.processEmail(messageId);
            
            return { success: true, messageId };
        } catch (error) {
            logger.error('Errore test elaborazione email:', error);
            return { success: false, error: error.message };
        }
    }

    async getStats() {
        try {
            const profile = await this.gmail.users.getProfile({ userId: 'me' });
            
            const unreadResponse = await this.gmail.users.messages.list({
                userId: 'me',
                q: 'is:unread',
                maxResults: 1
            });
            
            const totalResponse = await this.gmail.users.messages.list({
                userId: 'me',
                maxResults: 1
            });

            return {
                emailAddress: profile.data.emailAddress,
                unreadCount: unreadResponse.data.resultSizeEstimate || 0,
                totalMessages: totalResponse.data.resultSizeEstimate || 0,
                isConnected: this.isConnected,
                isPolling: this.isPolling,
                pollingInterval: this.config.pollingInterval
            };
        } catch (error) {
            logger.error('Errore recupero statistiche Gmail:', error);
            throw error;
        }
    }

    async stop() {
        try {
            this.stopPolling();
            this.isConnected = false;

            // Cleanup directory temporanea
            if (fs.existsSync(this.tempDir)) {
                const files = fs.readdirSync(this.tempDir);
                for (const file of files) {
                    fs.unlinkSync(path.join(this.tempDir, file));
                }
            }

            logger.info('Gmail service fermato');
        } catch (error) {
            logger.error('Errore arresto Gmail service:', error);
        }
    }
}

module.exports = GmailService;