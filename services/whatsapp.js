const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');
const { logger, validatePhoneNumber } = require('../utils/helpers');

class WhatsAppService extends EventEmitter {
    constructor(io) {
        super();
        this.io = io;
        this.client = null;
        this.isConnected = false;
        this.isInitializing = false;
        this.messageQueue = [];
        this.isProcessingQueue = false;
        this.qrCode = null;
        this.connectionRetries = 0;
        this.maxRetries = 3;
        this.retryDelay = 30000; // 30 secondi
        this.sessionPath = process.env.WHATSAPP_SESSION_PATH || './wapower_session';
        this.clientId = process.env.WHATSAPP_CLIENT_ID || 'wapower-main';
        
        this.ensureSessionDir();
    }

    ensureSessionDir() {
        if (!fs.existsSync(this.sessionPath)) {
            fs.mkdirSync(this.sessionPath, { recursive: true });
        }
    }

    async initialize() {
        if (this.isInitializing) return;

        try {
            this.isInitializing = true;
            logger.info('Inizializzazione WhatsApp client...');

            this.client = new Client({
                authStrategy: new LocalAuth({
                    clientId: this.clientId,
                    dataPath: this.sessionPath
                }),
                puppeteer: {
                    headless: true,
                    args: [
                        '--no-sandbox',
                        '--disable-setuid-sandbox',
                        '--disable-dev-shm-usage',
                        '--disable-accelerated-2d-canvas',
                        '--no-first-run',
                        '--no-zygote',
                        '--single-process',
                        '--disable-gpu'
                    ]
                }
            });

            this.setupEventHandlers();
            await this.client.initialize();

        } catch (error) {
            logger.error('Errore inizializzazione WhatsApp:', error);
            this.isInitializing = false;
            this.emit('error', error);

            // Retry automatico
            if (this.connectionRetries < this.maxRetries) {
                this.connectionRetries++;
                logger.info(`Tentativo riconnessione ${this.connectionRetries}/${this.maxRetries} tra ${this.retryDelay/1000}s`);
                setTimeout(() => this.initialize(), this.retryDelay);
            }
        }
    }

    setupEventHandlers() {
        this.client.on('qr', (qr) => {
            logger.info('QR Code generato');
            this.generateQRCode(qr);
        });

        this.client.on('authenticated', () => {
            logger.info('WhatsApp autenticato');
            this.connectionRetries = 0;
        });

        this.client.on('auth_failure', (msg) => {
            logger.error('Errore autenticazione WhatsApp:', msg);
            this.emit('auth_failure', msg);
        });

        this.client.on('ready', async () => {
            logger.info('WhatsApp client pronto');
            this.isConnected = true;
            this.isInitializing = false;
            this.qrCode = null;
            this.connectionRetries = 0;

            // Avvia elaborazione coda
            this.processQueue();

            // Ottieni info utente
            const info = this.client.info;
            logger.info(`WhatsApp connesso come: ${info.pushname} (${info.wid.user})`);
            
            this.emit('ready', {
                pushname: info.pushname,
                number: info.wid.user,
                platform: info.platform
            });
        });

        this.client.on('message', async (message) => {
            // Log messaggi ricevuti per debug
            logger.debug('Messaggio ricevuto:', {
                from: message.from,
                body: message.body,
                type: message.type
            });
        });

        this.client.on('disconnected', (reason) => {
            logger.warn('WhatsApp disconnesso:', reason);
            this.isConnected = false;
            this.emit('disconnected', reason);

            // Tentativo riconnessione automatica
            if (reason !== 'LOGOUT' && this.connectionRetries < this.maxRetries) {
                this.connectionRetries++;
                logger.info(`Tentativo riconnessione automatica ${this.connectionRetries}/${this.maxRetries}`);
                setTimeout(() => this.initialize(), this.retryDelay);
            }
        });

        this.client.on('error', (error) => {
            logger.error('Errore WhatsApp client:', error);
            this.emit('error', error);
        });
    }

    async generateQRCode(qr) {
        try {
            const qrCodeDataUrl = await qrcode.toDataURL(qr);
            this.qrCode = qrCodeDataUrl;
            this.emit('qr', qrCodeDataUrl);

            // Invia QR via socket
            if (this.io) {
                this.io.emit('qr', qrCodeDataUrl);
            }
        } catch (error) {
            logger.error('Errore generazione QR Code:', error);
        }
    }

    async sendMessage(phone, message) {
        try {
            if (!this.isConnected) {
                return { success: false, error: 'WhatsApp non connesso' };
            }

            // Valida numero telefono
            const validPhone = validatePhoneNumber(phone);
            if (!validPhone) {
                return { success: false, error: 'Numero di telefono non valido' };
            }

            // Formatta numero per WhatsApp
            const chatId = `${validPhone.replace('+', '')}@c.us`;

            // Verifica se numero esiste
            const isRegistered = await this.client.isRegisteredUser(chatId);
            if (!isRegistered) {
                return { success: false, error: 'Numero non registrato su WhatsApp' };
            }

            // Invia messaggio
            await this.client.sendMessage(chatId, message);

            logger.info(`Messaggio inviato a ${phone}: ${message.substring(0, 50)}...`);
            return { success: true, messageId: Date.now().toString() };

        } catch (error) {
            logger.error('Errore invio messaggio:', error);
            return { success: false, error: error.message };
        }
    }

    async sendMedia(phone, mediaPath, caption = '') {
        try {
            if (!this.isConnected) {
                return { success: false, error: 'WhatsApp non connesso' };
            }

            const validPhone = validatePhoneNumber(phone);
            if (!validPhone) {
                return { success: false, error: 'Numero di telefono non valido' };
            }

            const chatId = `${validPhone.replace('+', '')}@c.us`;

            // Verifica file
            if (!fs.existsSync(mediaPath)) {
                return { success: false, error: 'File non trovato' };
            }

            // Crea media
            const media = MessageMedia.fromFilePath(mediaPath);

            // Invia media
            await this.client.sendMessage(chatId, media, { caption });

            logger.info(`Media inviato a ${phone}: ${path.basename(mediaPath)}`);
            return { success: true, messageId: Date.now().toString() };

        } catch (error) {
            logger.error('Errore invio media:', error);
            return { success: false, error: error.message };
        }
    }

    async queueMessage(phone, message, priority = 'normal') {
        const messageItem = {
            id: Date.now().toString(),
            phone,
            message,
            priority,
            timestamp: new Date(),
            attempts: 0,
            maxAttempts: 3
        };

        if (priority === 'high') {
            this.messageQueue.unshift(messageItem);
        } else {
            this.messageQueue.push(messageItem);
        }

        logger.info(`Messaggio aggiunto alla coda: ${phone} (${priority})`);

        // Avvia elaborazione se non già in corso
        if (!this.isProcessingQueue) {
            this.processQueue();
        }

        return messageItem.id;
    }

    async processQueue() {
        if (this.isProcessingQueue || !this.isConnected) return;

        this.isProcessingQueue = true;

        while (this.messageQueue.length > 0) {
            const messageItem = this.messageQueue.shift();

            try {
                const result = await this.sendMessage(messageItem.phone, messageItem.message);

                if (!result.success) {
                    messageItem.attempts++;
                    if (messageItem.attempts < messageItem.maxAttempts) {
                        // Rimetti in coda con delay
                        setTimeout(() => {
                            this.messageQueue.unshift(messageItem);
                        }, 5000);
                        logger.warn(`Messaggio fallito, tentativo ${messageItem.attempts}/${messageItem.maxAttempts}: ${messageItem.phone}`);
                    } else {
                        logger.error(`Messaggio definitivamente fallito dopo ${messageItem.maxAttempts} tentativi: ${messageItem.phone}`);
                    }
                } else {
                    logger.info(`Messaggio dalla coda inviato con successo: ${messageItem.phone}`);
                }

                // Delay tra messaggi per evitare rate limiting
                await new Promise(resolve => setTimeout(resolve, 1000));

            } catch (error) {
                logger.error('Errore elaborazione coda messaggi:', error);
                
                // Rimetti messaggio in coda se possibile
                if (messageItem.attempts < messageItem.maxAttempts) {
                    messageItem.attempts++;
                    this.messageQueue.unshift(messageItem);
                }
            }
        }

        this.isProcessingQueue = false;
    }

    async getChats() {
        try {
            if (!this.isConnected) {
                return { success: false, error: 'WhatsApp non connesso' };
            }

            const chats = await this.client.getChats();
            const chatList = chats.slice(0, 20).map(chat => ({
                id: chat.id._serialized,
                name: chat.name,
                isGroup: chat.isGroup,
                unreadCount: chat.unreadCount,
                lastMessage: chat.lastMessage ? {
                    body: chat.lastMessage.body,
                    timestamp: chat.lastMessage.timestamp
                } : null
            }));

            return { success: true, chats: chatList };

        } catch (error) {
            logger.error('Errore recupero chat:', error);
            return { success: false, error: error.message };
        }
    }

    async getContacts() {
        try {
            if (!this.isConnected) {
                return { success: false, error: 'WhatsApp non connesso' };
            }

            const contacts = await this.client.getContacts();
            const contactList = contacts.slice(0, 50).map(contact => ({
                id: contact.id._serialized,
                name: contact.name || contact.pushname,
                number: contact.number,
                isMe: contact.isMe,
                isUser: contact.isUser,
                isGroup: contact.isGroup,
                isWAContact: contact.isWAContact
            }));

            return { success: true, contacts: contactList };

        } catch (error) {
            logger.error('Errore recupero contatti:', error);
            return { success: false, error: error.message };
        }
    }

    async getStatus() {
        try {
            const status = {
                connected: this.isConnected,
                initializing: this.isInitializing,
                queueLength: this.messageQueue.length,
                retries: this.connectionRetries,
                hasQR: !!this.qrCode
            };

            if (this.isConnected && this.client) {
                const info = this.client.info;
                status.userInfo = {
                    pushname: info.pushname,
                    number: info.wid.user,
                    platform: info.platform
                };
            }

            return status;

        } catch (error) {
            logger.error('Errore recupero status:', error);
            return {
                connected: false,
                initializing: false,
                queueLength: 0,
                retries: this.connectionRetries,
                error: error.message
            };
        }
    }

    async reconnect() {
        try {
            logger.info('Avvio riconnessione WhatsApp...');

            if (this.client) {
                await this.client.destroy();
            }

            this.isConnected = false;
            this.isInitializing = false;
            this.connectionRetries = 0;
            this.qrCode = null;

            // Attendi un po' prima di reinizializzare
            await new Promise(resolve => setTimeout(resolve, 5000));

            await this.initialize();

            return { success: true };

        } catch (error) {
            logger.error('Errore riconnessione:', error);
            return { success: false, error: error.message };
        }
    }

    async logout() {
        try {
            if (this.client) {
                await this.client.logout();
            }

            // Rimuovi dati sessione
            if (fs.existsSync(this.sessionPath)) {
                fs.rmSync(this.sessionPath, { recursive: true, force: true });
            }

            this.isConnected = false;
            this.qrCode = null;
            this.messageQueue = [];

            logger.info('Logout WhatsApp completato');
            return { success: true };

        } catch (error) {
            logger.error('Errore logout:', error);
            return { success: false, error: error.message };
        }
    }

    async destroy() {
        try {
            if (this.client) {
                await this.client.destroy();
            }

            this.isConnected = false;
            this.isInitializing = false;
            this.messageQueue = [];

            logger.info('WhatsApp service terminato');

        } catch (error) {
            logger.error('Errore terminazione WhatsApp service:', error);
        }
    }
}

module.exports = WhatsAppService;