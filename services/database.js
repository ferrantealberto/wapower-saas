const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const { logger } = require('../utils/helpers');

class DatabaseService {
    constructor() {
        this.db = null;
        this.dbPath = process.env.DB_PATH || './wapower_database.sqlite';
        this.backupPath = path.join(__dirname, '..', 'backups');
        this.isConnected = false;
        this.ensureBackupDir();
    }

    ensureBackupDir() {
        if (!fs.existsSync(this.backupPath)) {
            fs.mkdirSync(this.backupPath, { recursive: true });
        }
    }

    async init() {
        try {
            logger.info('Inizializzazione database...');
            this.db = new sqlite3.Database(this.dbPath, (err) => {
                if (err) {
                    logger.error('Errore apertura database:', err);
                    throw err;
                }
            });

            // Abilita foreign keys
            await this.run('PRAGMA foreign_keys = ON');
            
            // Configurazioni performance
            await this.run('PRAGMA journal_mode = WAL');
            await this.run('PRAGMA synchronous = NORMAL');
            await this.run('PRAGMA cache_size = -64000'); // 64MB cache
            await this.run('PRAGMA temp_store = MEMORY');

            await this.createTables();
            this.isConnected = true;
            logger.info('Database inizializzato con successo');

            // Cleanup automatico ogni 24h
            setInterval(() => {
                this.cleanup();
            }, 24 * 60 * 60 * 1000);

        } catch (error) {
            logger.error('Errore inizializzazione database:', error);
            throw error;
        }
    }

    async createTables() {
        const tables = [
            `CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                phone TEXT NOT NULL,
                message TEXT NOT NULL,
                type TEXT NOT NULL DEFAULT 'manual',
                status TEXT NOT NULL DEFAULT 'pending',
                error TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                api_key TEXT,
                webhook_delivered INTEGER DEFAULT 0,
                retry_count INTEGER DEFAULT 0
            )`,
            
            `CREATE TABLE IF NOT EXISTS daily_stats (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                date TEXT NOT NULL UNIQUE,
                messages_sent INTEGER DEFAULT 0,
                messages_failed INTEGER DEFAULT 0,
                emails_processed INTEGER DEFAULT 0,
                api_calls INTEGER DEFAULT 0,
                webhook_calls INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,
            
            `CREATE TABLE IF NOT EXISTS config (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,
            
            `CREATE TABLE IF NOT EXISTS logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                level TEXT NOT NULL,
                message TEXT NOT NULL,
                data TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                ip TEXT,
                user_agent TEXT,
                api_key TEXT
            )`,
            
            `CREATE TABLE IF NOT EXISTS user_sessions (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                data TEXT NOT NULL,
                expires_at DATETIME NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,
            
            `CREATE TABLE IF NOT EXISTS api_keys (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                key_hash TEXT NOT NULL UNIQUE,
                name TEXT NOT NULL,
                permissions TEXT NOT NULL,
                tier TEXT DEFAULT 'free',
                rate_limit INTEGER DEFAULT 100,
                is_active INTEGER DEFAULT 1,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                last_used DATETIME,
                usage_count INTEGER DEFAULT 0
            )`,
            
            `CREATE TABLE IF NOT EXISTS webhooks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                api_key TEXT NOT NULL,
                url TEXT NOT NULL,
                events TEXT NOT NULL,
                secret TEXT,
                is_active INTEGER DEFAULT 1,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                last_triggered DATETIME,
                success_count INTEGER DEFAULT 0,
                error_count INTEGER DEFAULT 0
            )`,
            
            `CREATE TABLE IF NOT EXISTS webhook_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                webhook_id INTEGER NOT NULL,
                event_type TEXT NOT NULL,
                payload TEXT NOT NULL,
                response_status INTEGER,
                response_body TEXT,
                attempts INTEGER DEFAULT 1,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (webhook_id) REFERENCES webhooks(id)
            )`
        ];

        const indexes = [
            'CREATE INDEX IF NOT EXISTS idx_messages_phone ON messages(phone)',
            'CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at)',
            'CREATE INDEX IF NOT EXISTS idx_messages_status ON messages(status)',
            'CREATE INDEX IF NOT EXISTS idx_messages_api_key ON messages(api_key)',
            'CREATE INDEX IF NOT EXISTS idx_logs_created_at ON logs(created_at)',
            'CREATE INDEX IF NOT EXISTS idx_logs_level ON logs(level)',
            'CREATE INDEX IF NOT EXISTS idx_daily_stats_date ON daily_stats(date)',
            'CREATE INDEX IF NOT EXISTS idx_sessions_expires ON user_sessions(expires_at)',
            'CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash)',
            'CREATE INDEX IF NOT EXISTS idx_webhooks_api_key ON webhooks(api_key)',
            'CREATE INDEX IF NOT EXISTS idx_webhook_logs_webhook_id ON webhook_logs(webhook_id)',
            'CREATE INDEX IF NOT EXISTS idx_webhook_logs_created_at ON webhook_logs(created_at)'
        ];

        for (const table of tables) {
            await this.run(table);
        }

        for (const index of indexes) {
            await this.run(index);
        }
    }

    async run(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.run(sql, params, function(err) {
                if (err) {
                    logger.error('Errore query database:', { sql, params, error: err.message });
                    reject(err);
                } else {
                    resolve({ id: this.lastID, changes: this.changes });
                }
            });
        });
    }

    async get(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.get(sql, params, (err, row) => {
                if (err) {
                    logger.error('Errore query database:', { sql, params, error: err.message });
                    reject(err);
                } else {
                    resolve(row);
                }
            });
        });
    }

    async all(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.all(sql, params, (err, rows) => {
                if (err) {
                    logger.error('Errore query database:', { sql, params, error: err.message });
                    reject(err);
                } else {
                    resolve(rows);
                }
            });
        });
    }

    async transaction(queries) {
        return new Promise((resolve, reject) => {
            this.db.serialize(() => {
                this.db.run('BEGIN TRANSACTION');
                const results = [];
                let error = null;

                const runQuery = (index) => {
                    if (index >= queries.length) {
                        if (error) {
                            this.db.run('ROLLBACK');
                            reject(error);
                        } else {
                            this.db.run('COMMIT');
                            resolve(results);
                        }
                        return;
                    }

                    const query = queries[index];
                    this.db.run(query.sql, query.params || [], function(err) {
                        if (err) {
                            error = err;
                        } else {
                            results.push({ id: this.lastID, changes: this.changes });
                        }
                        runQuery(index + 1);
                    });
                };

                runQuery(0);
            });
        });
    }

    async logMessage(type, phone, message, status, error = null, apiKey = null) {
        try {
            const result = await this.run(`
                INSERT INTO messages (phone, message, type, status, error, api_key)
                VALUES (?, ?, ?, ?, ?, ?)
            `, [phone, message, type, status, error, apiKey]);

            await this.updateDailyStats(status === 'sent' ? 'messages_sent' : 'messages_failed');
            return result;
        } catch (error) {
            logger.error('Errore log messaggio:', error);
            throw error;
        }
    }

    async logSystemEvent(level, message, data = null, ip = null, userAgent = null, apiKey = null) {
        try {
            return await this.run(`
                INSERT INTO logs (level, message, data, ip, user_agent, api_key)
                VALUES (?, ?, ?, ?, ?, ?)
            `, [level, message, JSON.stringify(data), ip, userAgent, apiKey]);
        } catch (error) {
            logger.error('Errore log sistema:', error);
            throw error;
        }
    }

    async updateDailyStats(field, increment = 1) {
        const today = new Date().toISOString().split('T')[0];

        try {
            await this.run(`
                INSERT OR IGNORE INTO daily_stats (date, ${field})
                VALUES (?, 0)
            `, [today]);

            await this.run(`
                UPDATE daily_stats 
                SET ${field} = ${field} + ?, updated_at = CURRENT_TIMESTAMP
                WHERE date = ?
            `, [increment, today]);
        } catch (error) {
            logger.error('Errore aggiornamento statistiche:', error);
            throw error;
        }
    }

    async getLogs(limit = 50, offset = 0, type = null, status = null, search = null) {
        try {
            let sql = `
                SELECT m.id, m.phone, m.message, m.type, m.status, m.error, 
                       m.created_at, m.api_key, m.webhook_delivered, m.retry_count
                FROM messages m
                WHERE 1=1
            `;
            const params = [];

            if (type) {
                sql += ' AND m.type = ?';
                params.push(type);
            }

            if (status) {
                sql += ' AND m.status = ?';
                params.push(status);
            }

            if (search) {
                sql += ' AND (m.phone LIKE ? OR m.message LIKE ?)';
                params.push(`%${search}%`, `%${search}%`);
            }

            sql += ' ORDER BY m.created_at DESC LIMIT ? OFFSET ?';
            params.push(limit, offset);

            return await this.all(sql, params);
        } catch (error) {
            logger.error('Errore recupero logs:', error);
            throw error;
        }
    }

    async getLogsCount(type = null, status = null, search = null) {
        try {
            let sql = 'SELECT COUNT(*) as count FROM messages WHERE 1=1';
            const params = [];

            if (type) {
                sql += ' AND type = ?';
                params.push(type);
            }

            if (status) {
                sql += ' AND status = ?';
                params.push(status);
            }

            if (search) {
                sql += ' AND (phone LIKE ? OR message LIKE ?)';
                params.push(`%${search}%`, `%${search}%`);
            }

            const result = await this.get(sql, params);
            return result ? result.count : 0;
        } catch (error) {
            logger.error('Errore conteggio logs:', error);
            throw error;
        }
    }

    async getStats(days = 7) {
        try {
            const stats = await this.all(`
                SELECT date, messages_sent, messages_failed, emails_processed, 
                       api_calls, webhook_calls
                FROM daily_stats 
                WHERE date >= date('now', '-${days} days')
                ORDER BY date DESC
            `);

            const totals = await this.get(`
                SELECT SUM(messages_sent) as total_sent,
                       SUM(messages_failed) as total_failed,
                       SUM(emails_processed) as total_emails,
                       SUM(api_calls) as total_api_calls,
                       SUM(webhook_calls) as total_webhooks
                FROM daily_stats 
                WHERE date >= date('now', '-${days} days')
            `);

            const topPhones = await this.all(`
                SELECT phone, COUNT(*) as count,
                       SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) as sent,
                       SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
                FROM messages 
                WHERE created_at >= datetime('now', '-${days} days')
                GROUP BY phone 
                ORDER BY count DESC 
                LIMIT 10
            `);

            return {
                daily: stats,
                totals: totals || {},
                topPhones: topPhones || []
            };
        } catch (error) {
            logger.error('Errore recupero statistiche:', error);
            throw error;
        }
    }

    async getConfig(key) {
        try {
            const result = await this.get('SELECT value FROM config WHERE key = ?', [key]);
            return result ? result.value : null;
        } catch (error) {
            logger.error('Errore recupero config:', error);
            throw error;
        }
    }

    async setConfig(key, value) {
        try {
            await this.run(`
                INSERT OR REPLACE INTO config (key, value, updated_at)
                VALUES (?, ?, CURRENT_TIMESTAMP)
            `, [key, value]);
        } catch (error) {
            logger.error('Errore salvataggio config:', error);
            throw error;
        }
    }

    async backup() {
        try {
            const timestamp = new Date().toISOString().replace(/[:.]g, '-');
            const backupFile = path.join(this.backupPath, `wapower_backup_${timestamp}.sqlite`);
            
            logger.info('Creazione backup database...');

            await new Promise((resolve, reject) => {
                const backup = this.db.backup(backupFile);
                backup.step(-1);
                backup.finish(err => {
                    if (err) reject(err);
                    else resolve();
                });
            });

            // Crea anche backup SQL
            const sqlBackupFile = path.join(this.backupPath, `wapower_backup_${timestamp}.sql`);
            const tables = ['messages', 'daily_stats', 'config', 'logs', 'api_keys', 'webhooks', 'webhook_logs'];
            
            let sqlDump = '-- WAPower Database Backup\n';
            sqlDump += `-- Generated: ${new Date().toISOString()}\n\n`;

            for (const table of tables) {
                const rows = await this.all(`SELECT * FROM ${table}`);
                if (rows.length > 0) {
                    sqlDump += `-- Table: ${table}\n`;
                    const columns = Object.keys(rows[0]).join(', ');
                    
                    for (const row of rows) {
                        const values = Object.values(row).map(val => 
                            val === null ? 'NULL' : `'${String(val).replace(/'/g, "''")}'`
                        ).join(', ');
                        sqlDump += `INSERT INTO ${table} (${columns}) VALUES (${values});\n`;
                    }
                    sqlDump += '\n';
                }
            }

            fs.writeFileSync(sqlBackupFile, sqlDump);
            logger.info(`Backup creato: ${backupFile}`);

            // Cleanup vecchi backup (mantieni solo ultimi 30)
            this.cleanupOldBackups();
            
            return backupFile;
        } catch (error) {
            logger.error('Errore creazione backup:', error);
            throw error;
        }
    }

    cleanupOldBackups() {
        try {
            const files = fs.readdirSync(this.backupPath)
                .filter(file => file.startsWith('wapower_backup_'))
                .map(file => ({
                    name: file,
                    path: path.join(this.backupPath, file),
                    stat: fs.statSync(path.join(this.backupPath, file))
                }))
                .sort((a, b) => b.stat.mtime - a.stat.mtime);

            if (files.length > 30) {
                const filesToDelete = files.slice(30);
                filesToDelete.forEach(file => {
                    fs.unlinkSync(file.path);
                    logger.info(`Backup eliminato: ${file.name}`);
                });
            }
        } catch (error) {
            logger.error('Errore cleanup backup:', error);
        }
    }

    async cleanup() {
        try {
            logger.info('Avvio cleanup database...');
            
            // Cancella logs vecchi (oltre 90 giorni)
            await this.run(`
                DELETE FROM logs 
                WHERE created_at < datetime('now', '-90 days')
            `);

            // Cancella messaggi vecchi (oltre 180 giorni)
            await this.run(`
                DELETE FROM messages 
                WHERE created_at < datetime('now', '-180 days')
            `);

            // Cancella sessioni scadute
            await this.run(`
                DELETE FROM user_sessions 
                WHERE expires_at < datetime('now')
            `);

            // Cancella webhook logs vecchi (oltre 30 giorni)
            await this.run(`
                DELETE FROM webhook_logs 
                WHERE created_at < datetime('now', '-30 days')
            `);

            // Cancella statistiche vecchie (oltre 1 anno)
            await this.run(`
                DELETE FROM daily_stats 
                WHERE date < date('now', '-365 days')
            `);

            // Ottimizza database
            await this.run('VACUUM');
            await this.run('ANALYZE');

            logger.info('Cleanup database completato');
        } catch (error) {
            logger.error('Errore cleanup database:', error);
        }
    }

    async getConnectionStatus() {
        try {
            const result = await this.get("SELECT name FROM sqlite_master WHERE type='table' LIMIT 1");
            const stats = fs.statSync(this.dbPath);
            
            return {
                connected: this.isConnected && result !== undefined,
                size: stats.size,
                path: this.dbPath,
                lastModified: stats.mtime
            };
        } catch (error) {
            return {
                connected: false,
                size: 0,
                path: this.dbPath,
                error: error.message
            };
        }
    }

    async close() {
        try {
            if (this.db) {
                await new Promise((resolve, reject) => {
                    this.db.close((err) => {
                        if (err) reject(err);
                        else resolve();
                    });
                });
                this.isConnected = false;
                logger.info('Database chiuso correttamente');
            }
        } catch (error) {
            logger.error('Errore chiusura database:', error);
        }
    }
}

module.exports = DatabaseService;