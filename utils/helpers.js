const fs = require('fs');
const path = require('path');
const winston = require('winston');
const crypto = require('crypto');

// Logger configuration
const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
    ),
    defaultMeta: { service: 'wapower-saas' },
    transports: [
        new winston.transports.File({ 
            filename: 'logs/error.log', 
            level: 'error' 
        }),
        new winston.transports.File({ 
            filename: 'logs/combined.log' 
        }),
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),
                winston.format.simple()
            )
        })
    ]
});

// Phone number validation and formatting
function validatePhoneNumber(phone) {
    if (!phone || typeof phone !== 'string') {
        return null;
    }
    
    // Remove all non-digit characters
    let cleaned = phone.replace(/\D/g, '');
    
    // Add country code if missing
    if (cleaned.length === 10 && !cleaned.startsWith('39')) {
        cleaned = '39' + cleaned;
    }
    
    // Validate format
    const phoneRegex = /^(\+|00)?[1-9]\d{1,14}$/;
    if (phoneRegex.test(cleaned)) {
        return '+' + cleaned;
    }
    
    return null;
}

// Email extraction from text
function extractEmailFromText(text) {
    if (!text || typeof text !== 'string') {
        return null;
    }
    
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    const matches = text.match(emailRegex);
    return matches ? matches[0] : null;
}

// Phone extraction from text
function extractPhoneFromText(text) {
    if (!text || typeof text !== 'string') {
        return null;
    }
    
    // Multiple phone patterns
    const patterns = [
        /(\+39|0039)[\s\-]?3\d{2}[\s\-]?\d{3}[\s\-]?\d{4}/g,
        /3\d{2}[\s\-]?\d{3}[\s\-]?\d{4}/g,
        /(\+\d{1,3}[\s\-]?)?\d{10,14}/g
    ];
    
    for (const pattern of patterns) {
        const matches = text.match(pattern);
        if (matches) {
            return validatePhoneNumber(matches[0]);
        }
    }
    
    return null;
}

// HTML sanitization
function sanitizeHtml(html) {
    if (!html || typeof html !== 'string') {
        return '';
    }
    
    return html
        .replace(/</g, '<')
        .replace(/>/g, '>')
        .replace(/&/g, '&')
        .replace(/"/g, '"')
        .replace(/'/g, ''')
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]*>/g, '')
        .trim();
}

// Message formatting for WhatsApp
function formatMessage(message, type = 'plain') {
    if (!message || typeof message !== 'string') {
        return '';
    }
    
    let formatted = message.trim();
    
    switch (type) {
        case 'bold':
            formatted = `*${formatted}*`;
            break;
        case 'italic':
            formatted = `_${formatted}_`;
            break;
        case 'code':
            formatted = `\`\`\`${formatted}\`\`\``;
            break;
        default:
            // Auto-format basic markdown
            formatted = formatted
                .replace(/\*\*(.*?)\*\*/g, '*$1*')
                .replace(/__(.*?)__/g, '_$1_')
                .replace(/`(.*?)`/g, '```$1```');
    }
    
    return formatted;
}

// File size formatting
function formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Date formatting
function formatDate(date) {
    if (!date) return 'N/A';
    
    const d = new Date(date);
    return d.toLocaleDateString('it-IT', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
}

// System information
function getSystemInfo() {
    const os = require('os');
    
    return {
        platform: os.platform(),
        arch: os.arch(),
        nodeVersion: process.version,
        uptime: process.uptime(),
        memory: {
            total: os.totalmem(),
            free: os.freemem(),
            used: os.totalmem() - os.freemem()
        },
        cpu: os.cpus().length,
        hostname: os.hostname()
    };
}

// Backup helpers
function createBackupDirectory() {
    const backupDir = path.join(__dirname, '..', 'backups');
    if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
    }
    return backupDir;
}

function generateBackupFileName(prefix = 'backup') {
    const timestamp = new Date().toISOString().replace(/[:\.]/g, '-');
    return `${prefix}_${timestamp}.tar.gz`;
}

// Encryption helpers
function encrypt(text, secret) {
    const algorithm = 'aes-256-cbc';
    const key = crypto.scryptSync(secret, 'salt', 32);
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipher(algorithm, key);
    
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    return iv.toString('hex') + ':' + encrypted;
}

function decrypt(encryptedText, secret) {
    const algorithm = 'aes-256-cbc';
    const key = crypto.scryptSync(secret, 'salt', 32);
    const textParts = encryptedText.split(':');
    const iv = Buffer.from(textParts.shift(), 'hex');
    const encrypted = textParts.join(':');
    const decipher = crypto.createDecipher(algorithm, key);
    
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
}

// Rate limiting helpers
function createRateLimiter(windowMs = 15 * 60 * 1000, max = 100) {
    const requests = new Map();
    
    return (req, res, next) => {
        const key = req.ip;
        const now = Date.now();
        
        if (!requests.has(key)) {
            requests.set(key, { count: 1, resetTime: now + windowMs });
            return next();
        }
        
        const limit = requests.get(key);
        
        if (now > limit.resetTime) {
            requests.set(key, { count: 1, resetTime: now + windowMs });
            return next();
        }
        
        if (limit.count >= max) {
            return res.status(429).json({
                success: false,
                error: 'Rate limit exceeded'
            });
        }
        
        limit.count++;
        next();
    };
}

// Error handling
function handleError(error, context = '') {
    logger.error(`Error in ${context}:`, {
        message: error.message,
        stack: error.stack,
        context: context
    });
    
    return {
        success: false,
        error: process.env.NODE_ENV === 'production' ? 
               'Internal server error' : 
               error.message
    };
}

// Health check
function healthCheck() {
    const info = getSystemInfo();
    const dbPath = path.join(__dirname, '..', 'wapower_database.sqlite');
    
    return {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: info.uptime,
        memory: info.memory,
        database: fs.existsSync(dbPath) ? 'connected' : 'disconnected',
        version: require('../package.json').version
    };
}

// API Key validation
function validateApiKey(apiKey) {
    if (!apiKey || typeof apiKey !== 'string') {
        return false;
    }
    
    // Check format: wapower_[32 chars]
    const apiKeyRegex = /^wapower_[a-zA-Z0-9]{32}$/;
    return apiKeyRegex.test(apiKey);
}

// HMAC signature validation
function validateHmacSignature(payload, signature, secret) {
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(payload);
    const expectedSignature = 'sha256=' + hmac.digest('hex');
    
    return crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expectedSignature)
    );
}

// Throttling function
function throttle(func, limit) {
    let lastFunc;
    let lastRan;
    
    return function(...args) {
        const context = this;
        if (!lastRan) {
            func.apply(context, args);
            lastRan = Date.now();
        } else {
            clearTimeout(lastFunc);
            lastFunc = setTimeout(() => {
                if ((Date.now() - lastRan) >= limit) {
                    func.apply(context, args);
                    lastRan = Date.now();
                }
            }, limit - (Date.now() - lastRan));
        }
    };
}

// Debounce function
function debounce(func, wait) {
    let timeout;
    
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

module.exports = {
    logger,
    validatePhoneNumber,
    extractEmailFromText,
    extractPhoneFromText,
    sanitizeHtml,
    formatMessage,
    formatFileSize,
    formatDate,
    getSystemInfo,
    createBackupDirectory,
    generateBackupFileName,
    encrypt,
    decrypt,
    createRateLimiter,
    handleError,
    healthCheck,
    validateApiKey,
    validateHmacSignature,
    throttle,
    debounce
};