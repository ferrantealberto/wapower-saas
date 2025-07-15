const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const bodyParser = require('body-parser');
const compression = require('compression');
const bcrypt = require('bcrypt');
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: './config/.env' });

const WhatsAppService = require('./services/whatsapp');
const GmailService = require('./services/gmail');
const DatabaseService = require('./services/database');
const UpdateService = require('./services/update');
const AuthMiddleware = require('./middleware/auth');
const { logger, formatMessage, validatePhoneNumber, getSystemInfo } = require('./utils/helpers');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: process.env.DOMAIN ? `https://${process.env.DOMAIN}` : "http://localhost:3000",
        methods: ["GET", "POST"],
        credentials: true
    }
});

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

// Compression middleware
app.use(compression());

// Security middleware
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdn.jsdelivr.net"],
            scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
            imgSrc: ["'self'", "data:", "https:"],
            connectSrc: ["'self'", "ws:", "wss:"],
            fontSrc: ["'self'", "https://fonts.gstatic.com"],
            objectSrc: ["'none'"],
            baseUri: ["'self'"],
            formAction: ["'self'"]
        }
    }
}));

app.use(cors({
    origin: process.env.DOMAIN ? `https://${process.env.DOMAIN}` : "http://localhost:3000",
    credentials: true
}));

// Rate limiting
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100,
    message: { success: false, error: 'Troppe richieste, riprova più tardi' }
});

const strictApiLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 10,
    message: { success: false, error: 'Troppe richieste per questa API' }
});

app.use('/api/', apiLimiter);
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));

// Session configuration
app.use(session({
    store: new SQLiteStore({
        db: 'wapower_sessions.db',
        table: 'sessions'
    }),
    secret: process.env.SESSION_SECRET || 'wapower-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
}));

// Auth middleware
app.use(AuthMiddleware);
app.use(express.static(path.join(__dirname, 'public')));

// Initialize services
const db = new DatabaseService();
const whatsappService = new WhatsAppService(io);
const gmailService = new GmailService(whatsappService, db);
const updateService = new UpdateService(db);

let systemStatus = {
    whatsapp: { connected: false, qr: null, queueLength: 0 },
    gmail: { connected: false, lastCheck: null },
    database: { connected: false, size: 0 },
    messages: { sent: 0, failed: 0 },
    uptime: process.uptime(),
    version: process.env.APP_VERSION || '1.0.0',
    updates: { available: 0, lastCheck: null }
};

// Socket.IO handling
io.on('connection', (socket) => {
    logger.info('Client connesso alla dashboard');
    socket.emit('status', systemStatus);
    
    socket.on('disconnect', () => {
        logger.info('Client disconnesso dalla dashboard');
    });
});

function updateSystemStatus(service, data) {
    systemStatus[service] = { ...systemStatus[service], ...data };
    io.emit('status', systemStatus);
}

// API Routes
app.get('/api/status', (req, res) => {
    systemStatus.uptime = process.uptime();
    res.json({
        success: true,
        status: systemStatus,
        uptime: systemStatus.uptime,
        version: systemStatus.version
    });
});

app.post('/api/send-message', AuthMiddleware.messageValidation, AuthMiddleware.handleValidationErrors, async (req, res) => {
    try {
        const { phone, message } = req.body;
        
        const validPhone = validatePhoneNumber(phone);
        if (!validPhone) {
            return res.status(400).json({
                success: false,
                error: 'Numero di telefono non valido'
            });
        }
        
        const result = await whatsappService.sendMessage(validPhone, message);
        
        if (result.success) {
            systemStatus.messages.sent++;
            await db.logMessage('manual', validPhone, message, 'sent');
            res.json({
                success: true,
                message: 'Messaggio inviato con successo'
            });
        } else {
            systemStatus.messages.failed++;
            await db.logMessage('manual', validPhone, message, 'failed', result.error);
            res.status(500).json({
                success: false,
                error: result.error
            });
        }
        
        updateSystemStatus('messages', systemStatus.messages);
    } catch (error) {
        logger.error('Errore invio messaggio:', error);
        res.status(500).json({
            success: false,
            error: 'Errore interno del server'
        });
    }
});

app.get('/api/logs', async (req, res) => {
    try {
        const { limit = 50, offset = 0, type, status, search } = req.query;
        const logs = await db.getLogs(parseInt(limit), parseInt(offset), type, status, search);
        const total = await db.getLogsCount(type, status, search);
        
        res.json({
            success: true,
            logs: logs,
            total: total
        });
    } catch (error) {
        logger.error('Errore recupero logs:', error);
        res.status(500).json({
            success: false,
            error: 'Errore recupero logs'
        });
    }
});

app.get('/api/stats', async (req, res) => {
    try {
        const { range = 7 } = req.query;
        const stats = await db.getStats(parseInt(range));
        
        res.json({
            success: true,
            stats: stats
        });
    } catch (error) {
        logger.error('Errore recupero statistiche:', error);
        res.status(500).json({
            success: false,
            error: 'Errore recupero statistiche'
        });
    }
});

app.get('/api/whatsapp/qr', (req, res) => {
    if (systemStatus.whatsapp.qr) {
        res.json({
            success: true,
            qr: systemStatus.whatsapp.qr
        });
    } else {
        res.json({
            success: false,
            message: 'QR Code non disponibile'
        });
    }
});

app.post('/api/whatsapp/reconnect', strictApiLimiter, async (req, res) => {
    try {
        await whatsappService.reconnect();
        res.json({
            success: true,
            message: 'Riconnessione avviata'
        });
    } catch (error) {
        logger.error('Errore riconnessione WhatsApp:', error);
        res.status(500).json({
            success: false,
            error: 'Errore riconnessione WhatsApp'
        });
    }
});

app.post('/api/gmail/test', async (req, res) => {
    try {
        const result = await gmailService.testEmailProcessing();
        if (result.success) {
            res.json({
                success: true,
                message: `Test Gmail completato. Email processata: ${result.messageId}`
            });
        } else {
            res.status(500).json({
                success: false,
                error: result.error || 'Errore durante il test Gmail'
            });
        }
    } catch (error) {
        logger.error('Errore test Gmail:', error);
        res.status(500).json({
            success: false,
            error: 'Errore interno durante il test Gmail'
        });
    }
});

app.post('/api/backup', strictApiLimiter, async (req, res) => {
    try {
        const backupPath = await db.backup();
        updateSystemStatus('database', { lastBackup: new Date() });
        res.json({
            success: true,
            message: 'Backup creato con successo',
            path: backupPath
        });
    } catch (error) {
        logger.error('Errore creazione backup:', error);
        res.status(500).json({
            success: false,
            error: 'Errore durante la creazione del backup'
        });
    }
});

app.get('/api/system/info', async (req, res) => {
    try {
        const info = getSystemInfo();
        const dbStatus = await db.getConnectionStatus();
        info.database = dbStatus;
        
        res.json({ success: true, info: info });
    } catch (error) {
        logger.error('Errore recupero info sistema:', error);
        res.status(500).json({
            success: false,
            error: 'Errore recupero informazioni di sistema'
        });
    }
});

// Update API endpoints
app.get('/api/updates/check', async (req, res) => {
    try {
        const updates = await updateService.checkForUpdates();
        updateSystemStatus('updates', {
            available: updates.totalUpdates,
            lastCheck: new Date()
        });
        res.json({
            success: true,
            updates: updates
        });
    } catch (error) {
        logger.error('Errore controllo aggiornamenti:', error);
        res.status(500).json({
            success: false,
            error: 'Errore durante il controllo aggiornamenti'
        });
    }
});

app.get('/api/updates/status', async (req, res) => {
    try {
        const status = await updateService.getUpdateStatus();
        res.json({
            success: true,
            status: status
        });
    } catch (error) {
        logger.error('Errore status aggiornamenti:', error);
        res.status(500).json({
            success: false,
            error: 'Errore recupero status aggiornamenti'
        });
    }
});

app.post('/api/updates/apply', strictApiLimiter, async (req, res) => {
    try {
        const { updates, createBackup = true } = req.body;
        
        if (!updates || updates.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Nessun aggiornamento selezionato'
            });
        }
        
        const result = await updateService.applyUpdates(updates, createBackup);
        res.json({
            success: true,
            result: result
        });
    } catch (error) {
        logger.error('Errore applicazione aggiornamenti:', error);
        res.status(500).json({
            success: false,
            error: 'Errore durante l\'applicazione aggiornamenti'
        });
    }
});

app.get('/api/updates/history', async (req, res) => {
    try {
        const history = await updateService.getUpdateHistory();
        res.json({
            success: true,
            history: history
        });
    } catch (error) {
        logger.error('Errore recupero cronologia aggiornamenti:', error);
        res.status(500).json({
            success: false,
            error: 'Errore recupero cronologia aggiornamenti'
        });
    }
});

app.post('/api/updates/backup', strictApiLimiter, async (req, res) => {
    try {
        const backupPath = await updateService.createPreUpdateBackup();
        res.json({
            success: true,
            message: 'Backup pre-aggiornamento creato',
            path: backupPath
        });
    } catch (error) {
        logger.error('Errore creazione backup pre-aggiornamento:', error);
        res.status(500).json({
            success: false,
            error: 'Errore durante la creazione del backup'
        });
    }
});

// Authentication routes
app.post('/api/auth/login', AuthMiddleware.loginValidation, AuthMiddleware.handleValidationErrors, async (req, res) => {
    try {
        const { username, password } = req.body;
        
        if (username === process.env.DASHBOARD_USERNAME) {
            // Usa bcrypt per verificare la password hashata
            if (process.env.DASHBOARD_PASSWORD_HASH) {
                const isValid = await bcrypt.compare(password, process.env.DASHBOARD_PASSWORD_HASH);
                if (isValid) {
                    req.session.authenticated = true;
                    req.session.user = username;
                    logger.info(`Login riuscito per utente: ${username}`);
                    return res.json({
                        success: true,
                        message: 'Login effettuato con successo'
                    });
                }
            } else if (password === process.env.DASHBOARD_PASSWORD) {
                // Fallback per compatibilità (da rimuovere dopo la migrazione)
                req.session.authenticated = true;
                req.session.user = username;
                logger.warn('Login con password plaintext - AGGIORNA A HASH!');
                return res.json({
                    success: true,
                    message: 'Login effettuato con successo'
                });
            }
        }
        
        logger.warn(`Tentativo di login fallito per utente: ${username}`);
        res.status(401).json({
            success: false,
            error: 'Credenziali non valide'
        });
    } catch (error) {
        logger.error('Errore durante il login:', error);
        res.status(500).json({
            success: false,
            error: 'Errore interno del server'
        });
    }
});

app.post('/api/auth/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            logger.error('Errore durante il logout:', err);
            return res.status(500).json({
                success: false,
                error: 'Errore durante il logout'
            });
        }
        logger.info('Logout effettuato con successo');
        res.json({
            success: true,
            message: 'Logout effettuato con successo'
        });
    });
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        version: systemStatus.version
    });
});

// Error handling middleware
app.use(AuthMiddleware.errorHandler);

// IMPORTANTE: Questa route deve essere l'ultima, dopo tutte le API
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Service initialization
async function initializeServices() {
    try {
        logger.info('Inizializzazione WAPower...');
        
        // Initialize database
        await db.init();
        const dbStatus = await db.getConnectionStatus();
        updateSystemStatus('database', {
            connected: true,
            size: dbStatus.size
        });
        logger.info('Database inizializzato');
        
        // Initialize update service
        await updateService.initialize();
        logger.info('Update service inizializzato');
        
        // WhatsApp event handlers
        whatsappService.on('qr', (qr) => {
            updateSystemStatus('whatsapp', { qr: qr });
            logger.info('QR Code generato');
        });
        
        whatsappService.on('ready', async () => {
            const status = await whatsappService.getStatus();
            updateSystemStatus('whatsapp', {
                connected: true,
                qr: null,
                queueLength: status.queueLength
            });
            logger.info('WhatsApp connesso');
        });
        
        whatsappService.on('disconnected', (reason) => {
            updateSystemStatus('whatsapp', { connected: false });
            logger.warn('WhatsApp disconnesso:', reason);
        });
        
        await whatsappService.initialize();
        
        // Gmail event handlers
        gmailService.on('connected', () => {
            updateSystemStatus('gmail', { connected: true });
            logger.info('Gmail connesso');
        });
        
        gmailService.on('error', (error) => {
            updateSystemStatus('gmail', { connected: false });
            logger.error('Errore Gmail:', error);
        });
        
        gmailService.on('emailProcessed', (data) => {
            updateSystemStatus('gmail', { lastCheck: new Date() });
            logger.info(`Email processata: ${data.from} -> ${data.phone}`);
        });
        
        await gmailService.initialize();
        
        // Update service event handlers
        updateService.on('updateProgress', (progress) => {
            io.emit('updateProgress', progress);
        });
        
        updateService.on('updateCompleted', (result) => {
            io.emit('updateCompleted', result);
            updateSystemStatus('updates', {
                available: 0,
                lastCheck: new Date()
            });
        });
        
        updateService.on('updateFailed', (error) => {
            io.emit('updateFailed', error);
        });
        
        // Start automatic update checks
        setInterval(async () => {
            try {
                const updates = await updateService.checkForUpdates();
                updateSystemStatus('updates', {
                    available: updates.totalUpdates,
                    lastCheck: new Date()
                });
            } catch (error) {
                logger.error('Errore controllo automatico aggiornamenti:', error);
            }
        }, 24 * 60 * 60 * 1000); // Check every 24 hours
        
        logger.info('Tutti i servizi inizializzati con successo');
    } catch (error) {
        logger.error('Errore durante l\'inizializzazione:', error);
        process.exit(1);
    }
}

// Graceful shutdown
const shutdown = async (signal) => {
    logger.info(`Ricevuto ${signal}, chiusura in corso...`);
    try {
        if (whatsappService) await whatsappService.destroy();
        if (gmailService) await gmailService.stop();
        if (updateService) await updateService.stop();
        if (db) await db.close();
        logger.info('Servizi chiusi correttamente');
        process.exit(0);
    } catch (error) {
        logger.error('Errore durante lo shutdown:', error);
        process.exit(1);
    }
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Start server
server.listen(PORT, HOST, () => {
    logger.info(`WAPower avviato su http://${HOST}:${PORT}`);
    initializeServices();
});

module.exports = app;