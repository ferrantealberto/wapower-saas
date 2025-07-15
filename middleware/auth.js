const bcrypt = require('bcrypt');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const { logger } = require('../utils/helpers');

class AuthMiddleware {
    constructor() {
        this.loginAttempts = new Map();
        this.maxAttempts = 5;
        this.lockoutTime = 15 * 60 * 1000; // 15 minutes
    }

    // Rate limiting configurations
    static createRateLimit = (windowMs = 15 * 60 * 1000, max = 100, message = 'Too many requests') => {
        return rateLimit({
            windowMs,
            max,
            message: { success: false, error: message },
            standardHeaders: true,
            legacyHeaders: false,
            skip: (req) => {
                // Skip rate limiting for localhost in development
                if (process.env.NODE_ENV === 'development' && req.ip === '127.0.0.1') {
                    return true;
                }
                return false;
            }
        });
    };

    // Authentication check middleware
    static requireAuth = (req, res, next) => {
        // Skip auth for login page and public assets
        const publicPaths = ['/login.html', '/api/auth/login', '/health', '/css/', '/js/', '/images/'];
        
        if (publicPaths.some(path => req.path.startsWith(path))) {
            return next();
        }

        // Check session authentication
        if (req.session && req.session.authenticated) {
            return next();
        }

        // If API request, return JSON error
        if (req.path.startsWith('/api/')) {
            return res.status(401).json({
                success: false,
                error: 'Authentication required'
            });
        }

        // Redirect to login page
        res.redirect('/login.html');
    };

    // IP filtering middleware
    static ipFilter = (req, res, next) => {
        const allowedIPs = process.env.ALLOWED_IPS;
        
        if (!allowedIPs) {
            return next();
        }

        const clientIP = req.ip || req.connection.remoteAddress;
        const allowedIPList = allowedIPs.split(',').map(ip => ip.trim());
        
        // Check if IP is in allowed list (supports CIDR notation)
        const isAllowed = allowedIPList.some(allowedIP => {
            if (allowedIP.includes('/')) {
                // CIDR notation check (simplified)
                const [network, mask] = allowedIP.split('/');
                return clientIP.startsWith(network.split('.').slice(0, parseInt(mask) / 8).join('.'));
            }
            return clientIP === allowedIP;
        });

        if (!isAllowed) {
            logger.warn(`Access denied for IP: ${clientIP}`);
            return res.status(403).json({
                success: false,
                error: 'Access denied from this IP address'
            });
        }

        next();
    };

    // Login validation middleware
    static loginValidation = [
        body('username')
            .trim()
            .isLength({ min: 3, max: 50 })
            .withMessage('Username must be between 3 and 50 characters')
            .matches(/^[a-zA-Z0-9_-]+$/)
            .withMessage('Username can only contain letters, numbers, underscores and hyphens'),
        
        body('password')
            .isLength({ min: 8, max: 128 })
            .withMessage('Password must be between 8 and 128 characters')
            .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
            .withMessage('Password must contain at least one lowercase letter, one uppercase letter, one number and one special character')
    ];

    // Message validation middleware
    static messageValidation = [
        body('phone')
            .trim()
            .matches(/^\+[1-9]\d{1,14}$/)
            .withMessage('Invalid phone number format. Use international format (+39123456789)'),
        
        body('message')
            .trim()
            .isLength({ min: 1, max: parseInt(process.env.MAX_MESSAGE_LENGTH) || 4000 })
            .withMessage(`Message must be between 1 and ${process.env.MAX_MESSAGE_LENGTH || 4000} characters`)
            .custom((value) => {
                // Check for potentially harmful content
                const harmfulPatterns = [
                    /)<[^<]*)*<\/script>/gi,
                    /javascript:/gi,
                    /on\w+\s*=/gi
                ];
                
                if (harmfulPatterns.some(pattern => pattern.test(value))) {
                    throw new Error('Message contains potentially harmful content');
                }
                return true;
            })
    ];

    // Bulk message validation
    static bulkMessageValidation = [
        body('messages')
            .isArray({ min: 1, max: 100 })
            .withMessage('Messages array must contain between 1 and 100 items'),
        
        body('messages.*.phone')
            .trim()
            .matches(/^\+[1-9]\d{1,14}$/)
            .withMessage('Invalid phone number format in bulk messages'),
        
        body('messages.*.message')
            .trim()
            .isLength({ min: 1, max: parseInt(process.env.MAX_MESSAGE_LENGTH) || 4000 })
            .withMessage('Invalid message length in bulk messages')
    ];

    // Handle validation errors
    static handleValidationErrors = (req, res, next) => {
        const errors = validationResult(req);
        
        if (!errors.isEmpty()) {
            logger.warn('Validation errors:', {
                errors: errors.array(),
                ip: req.ip,
                userAgent: req.get('User-Agent')
            });
            
            return res.status(400).json({
                success: false,
                error: 'Validation failed',
                details: errors.array()
            });
        }
        
        next();
    };

    // Brute force protection
    checkBruteForce = (req, res, next) => {
        const clientIP = req.ip;
        const now = Date.now();
        
        if (this.loginAttempts.has(clientIP)) {
            const attempts = this.loginAttempts.get(clientIP);
            
            // Check if still in lockout period
            if (attempts.lockedUntil && now < attempts.lockedUntil) {
                const remainingTime = Math.ceil((attempts.lockedUntil - now) / 1000 / 60);
                return res.status(429).json({
                    success: false,
                    error: `Too many login attempts. Try again in ${remainingTime} minutes.`
                });
            }
            
            // Reset if lockout period expired
            if (attempts.lockedUntil && now >= attempts.lockedUntil) {
                this.loginAttempts.delete(clientIP);
            }
        }
        
        next();
    };

    // Record login attempt
    recordLoginAttempt = (req, success = false) => {
        const clientIP = req.ip;
        const now = Date.now();
        
        if (!this.loginAttempts.has(clientIP)) {
            this.loginAttempts.set(clientIP, { count: 0, firstAttempt: now });
        }
        
        const attempts = this.loginAttempts.get(clientIP);
        
        if (success) {
            // Reset attempts on successful login
            this.loginAttempts.delete(clientIP);
            logger.info(`Successful login from IP: ${clientIP}`);
        } else {
            attempts.count++;
            attempts.lastAttempt = now;
            
            if (attempts.count >= this.maxAttempts) {
                attempts.lockedUntil = now + this.lockoutTime;
                logger.warn(`IP ${clientIP} locked out after ${this.maxAttempts} failed attempts`);
            }
            
            logger.warn(`Failed login attempt ${attempts.count}/${this.maxAttempts} from IP: ${clientIP}`);
        }
    };

    // Session security middleware
    static sessionSecurity = (req, res, next) => {
        // Set secure session headers
        if (req.session) {
            // Update session activity
            req.session.lastActivity = new Date();
            
            // Check session timeout (24 hours)
            const sessionTimeout = 24 * 60 * 60 * 1000; // 24 hours
            if (req.session.lastActivity && (Date.now() - new Date(req.session.lastActivity).getTime()) > sessionTimeout) {
                req.session.destroy();
                return res.status(401).json({
                    success: false,
                    error: 'Session expired'
                });
            }
        }
        
        next();
    };

    // API Key validation (for REST API)
    static validateApiKey = async (req, res, next) => {
        const apiKey = req.header('Authorization')?.replace('Bearer ', '');
        
        if (!apiKey) {
            return res.status(401).json({
                success: false,
                error: 'API key required'
            });
        }
        
        // Validate API key format
        const apiKeyRegex = /^wapower_[a-zA-Z0-9]{32}$/;
        if (!apiKeyRegex.test(apiKey)) {
            return res.status(401).json({
                success: false,
                error: 'Invalid API key format'
            });
        }
        
        try {
            // Here you would typically validate against database
            // For now, we'll use environment variable for simplicity
            const validApiKey = process.env.API_KEY;
            
            if (apiKey !== validApiKey) {
                logger.warn(`Invalid API key attempt: ${apiKey.substring(0, 10)}...`);
                return res.status(401).json({
                    success: false,
                    error: 'Invalid API key'
                });
            }
            
            // Set API key info for logging
            req.apiKey = apiKey;
            next();
        } catch (error) {
            logger.error('API key validation error:', error);
            res.status(500).json({
                success: false,
                error: 'Internal server error'
            });
        }
    };

    // Password hashing utility
    static async hashPassword(password) {
        const saltRounds = 12;
        return await bcrypt.hash(password, saltRounds);
    }

    // Password verification utility
    static async verifyPassword(password, hash) {
        return await bcrypt.compare(password, hash);
    }

    // Sanitize user input
    static sanitizeInput = (req, res, next) => {
        const sanitize = (obj) => {
            for (let key in obj) {
                if (typeof obj[key] === 'string') {
                    // Remove potential XSS content
                    obj[key] = obj[key]
                        .replace(/)<[^<]*)*<\/script>/gi, '')
                        .replace(/javascript:/gi, '')
                        .replace(/on\w+\s*=/gi, '')
                        .trim();
                } else if (typeof obj[key] === 'object' && obj[key] !== null) {
                    sanitize(obj[key]);
                }
            }
        };
        
        if (req.body) sanitize(req.body);
        if (req.query) sanitize(req.query);
        if (req.params) sanitize(req.params);
        
        next();
    };

    // Error handling middleware
    static errorHandler = (err, req, res, next) => {
        logger.error('Middleware error:', {
            error: err.message,
            stack: err.stack,
            ip: req.ip,
            method: req.method,
            url: req.url,
            userAgent: req.get('User-Agent')
        });

        // Don't leak error details in production
        const errorMessage = process.env.NODE_ENV === 'production' 
            ? 'Internal server error' 
            : err.message;

        res.status(err.status || 500).json({
            success: false,
            error: errorMessage
        });
    };

    // CORS middleware
    static corsHandler = (req, res, next) => {
        const allowedOrigins = process.env.ALLOWED_ORIGINS 
            ? process.env.ALLOWED_ORIGINS.split(',') 
            : [`https://${process.env.DOMAIN}`, `http://localhost:${process.env.PORT || 3000}`];

        const origin = req.headers.origin;
        if (allowedOrigins.includes(origin)) {
            res.header('Access-Control-Allow-Origin', origin);
        }

        res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
        res.header('Access-Control-Allow-Credentials', true);

        if (req.method === 'OPTIONS') {
            return res.sendStatus(200);
        }

        next();
    };
}

module.exports = AuthMiddleware;