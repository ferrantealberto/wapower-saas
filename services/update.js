const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const semver = require('semver');
const EventEmitter = require('events');
const { logger, formatFileSize } = require('../utils/helpers');

class UpdateService extends EventEmitter {
    constructor(databaseService) {
        super();
        this.db = databaseService;
        this.updateInProgress = false;
        this.currentVersion = this.getCurrentVersion();
        this.backupPath = path.join(__dirname, '..', 'backups', 'updates');
        this.lockFile = path.join(__dirname, '..', 'update.lock');
        this.ensureBackupDir();
    }

    ensureBackupDir() {
        if (!fs.existsSync(this.backupPath)) {
            fs.mkdirSync(this.backupPath, { recursive: true });
        }
    }

    getCurrentVersion() {
        try {
            const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
            return packageJson.version;
        } catch (error) {
            logger.error('Errore lettura versione corrente:', error);
            return '1.0.0';
        }
    }

    async initialize() {
        try {
            logger.info('Inizializzazione Update Service...');
            
            // Crea tabelle database per aggiornamenti
            await this.createUpdateTables();
            
            // Rimuovi lock file se presente (crash recovery)
            if (fs.existsSync(this.lockFile)) {
                fs.unlinkSync(this.lockFile);
                logger.warn('Rimosso lock file di aggiornamento da crash precedente');
            }
            
            logger.info('Update Service inizializzato con successo');
        } catch (error) {
            logger.error('Errore inizializzazione Update Service:', error);
            throw error;
        }
    }

    async createUpdateTables() {
        try {
            await this.db.run(`
                CREATE TABLE IF NOT EXISTS update_history (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    version_from TEXT NOT NULL,
                    version_to TEXT NOT NULL,
                    update_type TEXT NOT NULL,
                    status TEXT NOT NULL,
                    error TEXT,
                    backup_path TEXT,
                    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    completed_at DATETIME,
                    rollback_available BOOLEAN DEFAULT 1
                )
            `);

            await this.db.run(`
                CREATE TABLE IF NOT EXISTS update_packages (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    update_id INTEGER NOT NULL,
                    package_name TEXT NOT NULL,
                    version_from TEXT NOT NULL,
                    version_to TEXT NOT NULL,
                    status TEXT NOT NULL,
                    FOREIGN KEY (update_id) REFERENCES update_history(id)
                )
            `);

            await this.db.run(`
                CREATE INDEX IF NOT EXISTS idx_update_history_date ON update_history(started_at)
            `);
        } catch (error) {
            logger.error('Errore creazione tabelle aggiornamenti:', error);
            throw error;
        }
    }

    async checkForUpdates() {
        try {
            logger.info('🔍 Controllo aggiornamenti disponibili...');
            
            const [npmUpdates, appUpdates, systemUpdates] = await Promise.all([
                this.checkNpmUpdates(),
                this.checkAppUpdates(),
                this.checkSystemUpdates()
            ]);

            const updateSummary = {
                npm: npmUpdates,
                app: appUpdates,
                system: systemUpdates,
                hasUpdates: npmUpdates.length > 0 || appUpdates.length > 0 || systemUpdates.length > 0,
                totalUpdates: npmUpdates.length + appUpdates.length + systemUpdates.length,
                securityUpdates: [...npmUpdates, ...appUpdates, ...systemUpdates]
                    .filter(u => u.security?.hasVulnerabilities).length,
                lastCheck: new Date().toISOString()
            };

            await this.db.setConfig('last_update_check', JSON.stringify(updateSummary));
            
            logger.info(`✅ Controllo completato: ${updateSummary.totalUpdates} aggiornamenti disponibili (${updateSummary.securityUpdates} sicurezza)`);
            
            return updateSummary;
        } catch (error) {
            logger.error('❌ Errore controllo aggiornamenti:', error);
            throw error;
        }
    }

    async checkNpmUpdates() {
        try {
            const outdatedOutput = execSync('npm outdated --json', { 
                encoding: 'utf8', 
                cwd: path.join(__dirname, '..'),
                timeout: 30000 
            });
            const outdated = JSON.parse(outdatedOutput || '{}');
            const updates = [];

            for (const [packageName, info] of Object.entries(outdated)) {
                const severity = this.getUpdateSeverity(info.current, info.latest);
                const securityInfo = await this.checkSecurityVulnerabilities(packageName);
                
                updates.push({
                    name: packageName,
                    type: 'npm',
                    currentVersion: info.current,
                    latestVersion: info.latest,
                    wantedVersion: info.wanted,
                    severity: severity,
                    security: securityInfo,
                    description: `Aggiornamento ${packageName} da ${info.current} a ${info.latest}`,
                    changelog: await this.getChangelogUrl(packageName, info.current, info.latest),
                    size: await this.getPackageSize(packageName, info.latest)
                });
            }

            return updates;
        } catch (error) {
            if (error.status === 1 && error.stdout) {
                // npm outdated restituisce status 1 quando ci sono aggiornamenti
                try {
                    const outdated = JSON.parse(error.stdout.toString() || '{}');
                    const updates = [];
                    
                    for (const [packageName, info] of Object.entries(outdated)) {
                        const severity = this.getUpdateSeverity(info.current, info.latest);
                        
                        updates.push({
                            name: packageName,
                            type: 'npm',
                            currentVersion: info.current,
                            latestVersion: info.latest,
                            wantedVersion: info.wanted,
                            severity: severity,
                            description: `Aggiornamento ${packageName} da ${info.current} a ${info.latest}`,
                            changelog: await this.getChangelogUrl(packageName, info.current, info.latest)
                        });
                    }
                    
                    return updates;
                } catch (parseError) {
                    logger.warn('⚠️ Errore parsing npm outdated:', parseError);
                    return [];
                }
            }
            
            logger.error('❌ Errore controllo npm updates:', error);
            return [];
        }
    }

    async checkAppUpdates() {
        try {
            // Controlla aggiornamenti dal repository Git
            const gitRemote = await this.getGitRemote();
            if (!gitRemote) {
                return [];
            }

            execSync('git fetch origin', { encoding: 'utf8', timeout: 10000 });
            
            const currentCommit = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
            const latestCommit = execSync('git rev-parse origin/main', { encoding: 'utf8' }).trim();

            if (currentCommit !== latestCommit) {
                const commitDiff = execSync(`git rev-list --count ${currentCommit}..${latestCommit}`, { 
                    encoding: 'utf8' 
                }).trim();
                
                const commitLog = execSync(`git log --oneline ${currentCommit}..${latestCommit}`, { 
                    encoding: 'utf8' 
                }).trim();

                return [{
                    name: 'wapower-saas',
                    type: 'app',
                    currentVersion: this.currentVersion,
                    latestVersion: 'latest',
                    severity: 'minor',
                    description: `${commitDiff} nuovi commit disponibili`,
                    changelog: commitLog,
                    commits: parseInt(commitDiff)
                }];
            }

            return [];
        } catch (error) {
            logger.warn('⚠️ Impossibile controllare aggiornamenti app:', error.message);
            return [];
        }
    }

    async checkSystemUpdates() {
        const updates = [];
        
        try {
            // Controlla aggiornamenti Node.js
            const nodeUpdate = await this.checkNodeUpdate();
            if (nodeUpdate) updates.push(nodeUpdate);

            // Controlla aggiornamenti sistema operativo
            const osUpdates = await this.checkOSUpdates();
            updates.push(...osUpdates);

            return updates;
        } catch (error) {
            logger.error('❌ Errore controllo aggiornamenti sistema:', error);
            return [];
        }
    }

    async applyUpdates(selectedUpdates, createBackup = true) {
        if (this.updateInProgress) {
            throw new Error('Aggiornamento già in corso');
        }

        this.updateInProgress = true;
        
        try {
            // Crea lock file
            fs.writeFileSync(this.lockFile, JSON.stringify({
                startTime: new Date().toISOString(),
                updates: selectedUpdates
            }));

            logger.info(`🚀 Inizio applicazione ${selectedUpdates.length} aggiornamenti...`);
            
            let backupPath = null;
            
            // Crea backup se richiesto
            if (createBackup) {
                backupPath = await this.createPreUpdateBackup();
                logger.info(`💾 Backup creato: ${backupPath}`);
            }

            // Registra inizio aggiornamento
            const updateId = await this.logUpdateStart(selectedUpdates, backupPath);

            try {
                // Applica aggiornamenti npm
                const npmUpdates = selectedUpdates.filter(u => u.type === 'npm');
                if (npmUpdates.length > 0) {
                    await this.applyNpmUpdates(npmUpdates, updateId);
                }

                // Applica aggiornamenti app
                const appUpdates = selectedUpdates.filter(u => u.type === 'app');
                if (appUpdates.length > 0) {
                    await this.applyAppUpdates(appUpdates, updateId);
                }

                // Applica aggiornamenti sistema
                const systemUpdates = selectedUpdates.filter(u => u.type === 'system');
                if (systemUpdates.length > 0) {
                    await this.applySystemUpdates(systemUpdates, updateId);
                }

                // Completa aggiornamento
                await this.logUpdateComplete(updateId, 'success');
                
                this.emit('updateCompleted', {
                    updateId,
                    updatesApplied: selectedUpdates.length,
                    backupPath
                });

                logger.info('✅ Aggiornamenti applicati con successo!');

                return {
                    success: true,
                    updateId,
                    backupPath,
                    updatesApplied: selectedUpdates.length
                };

            } catch (updateError) {
                logger.error('❌ Errore durante aggiornamento:', updateError);
                
                // Registra errore
                await this.logUpdateComplete(updateId, 'failed', updateError.message);

                // Tentativo rollback automatico se disponibile backup
                if (backupPath && createBackup) {
                    logger.info('🔄 Tentativo rollback automatico...');
                    try {
                        await this.performRollback(backupPath);
                        logger.info('✅ Rollback completato con successo');
                    } catch (rollbackError) {
                        logger.error('❌ Errore durante rollback:', rollbackError);
                        throw new Error(`Aggiornamento fallito e rollback impossibile: ${rollbackError.message}`);
                    }
                }

                this.emit('updateFailed', {
                    updateId,
                    error: updateError.message,
                    rollbackPerformed: !!backupPath
                });

                throw updateError;
            }

        } finally {
            // Rimuovi lock file
            if (fs.existsSync(this.lockFile)) {
                fs.unlinkSync(this.lockFile);
            }
            
            this.updateInProgress = false;
        }
    }

    async createPreUpdateBackup() {
        try {
            const timestamp = new Date().toISOString().replace(/[:\.]/g, '-');
            const backupDir = path.join(this.backupPath, `backup_${timestamp}`);
            
            fs.mkdirSync(backupDir, { recursive: true });

            // Lista file e directory da includere nel backup
            const itemsToBackup = [
                'package.json',
                'package-lock.json',
                'server.js',
                'services/',
                'middleware/',
                'utils/',
                'api/',
                'public/',
                'config/',
                'wapower_database.sqlite',
                'wapower_session/'
            ];

            for (const item of itemsToBackup) {
                const sourcePath = path.join(__dirname, '..', item);
                const destPath = path.join(backupDir, item);
                
                if (fs.existsSync(sourcePath)) {
                    if (fs.statSync(sourcePath).isDirectory()) {
                        await this.copyDirectory(sourcePath, destPath);
                    } else {
                        fs.copyFileSync(sourcePath, destPath);
                    }
                }
            }

            // Crea archivio tar.gz
            const tarPath = `${backupDir}.tar.gz`;
            execSync(`tar -czf "${tarPath}" -C "${this.backupPath}" "${path.basename(backupDir)}"`, {
                timeout: 60000
            });

            // Rimuovi directory temporanea
            fs.rmSync(backupDir, { recursive: true, force: true });

            logger.info(`📦 Backup creato: ${tarPath}`);
            
            return tarPath;
        } catch (error) {
            logger.error('❌ Errore creazione backup:', error);
            throw error;
        }
    }

    async copyDirectory(source, destination) {
        fs.mkdirSync(destination, { recursive: true });
        
        const items = fs.readdirSync(source);
        
        for (const item of items) {
            const sourcePath = path.join(source, item);
            const destPath = path.join(destination, item);
            
            if (fs.statSync(sourcePath).isDirectory()) {
                await this.copyDirectory(sourcePath, destPath);
            } else {
                fs.copyFileSync(sourcePath, destPath);
            }
        }
    }

    getUpdateSeverity(currentVersion, latestVersion) {
        try {
            const diff = semver.diff(currentVersion, latestVersion);
            
            switch (diff) {
                case 'major':
                    return 'major';
                case 'minor':
                    return 'minor';
                case 'patch':
                    return 'patch';
                default:
                    return 'patch';
            }
        } catch (error) {
            return 'unknown';
        }
    }

    async checkSecurityVulnerabilities(packageName) {
        try {
            const auditOutput = execSync('npm audit --json', { 
                encoding: 'utf8',
                timeout: 30000 
            });
            
            const audit = JSON.parse(auditOutput);
            const vulnerabilities = audit.vulnerabilities || {};
            
            if (vulnerabilities[packageName]) {
                const vuln = vulnerabilities[packageName];
                return {
                    hasVulnerabilities: true,
                    severity: vuln.severity,
                    via: vuln.via,
                    range: vuln.range
                };
            }
            
            return { hasVulnerabilities: false };
        } catch (error) {
            return { hasVulnerabilities: false, error: error.message };
        }
    }

    async getChangelogUrl(packageName, fromVersion, toVersion) {
        try {
            // Costruisci URL changelog generico
            return `https://www.npmjs.com/package/${packageName}?activeTab=versions`;
        } catch (error) {
            return null;
        }
    }

    async getPackageSize(packageName, version) {
        try {
            const infoOutput = execSync(`npm view ${packageName}@${version} dist.unpackedSize`, {
                encoding: 'utf8',
                timeout: 10000
            });
            
            return parseInt(infoOutput.trim()) || 0;
        } catch (error) {
            return 0;
        }
    }

    async getGitRemote() {
        try {
            const remote = execSync('git remote -v', { encoding: 'utf8' });
            return remote.includes('origin') ? 'origin' : null;
        } catch (error) {
            return null;
        }
    }

    async logUpdateStart(updates, backupPath) {
        try {
            const result = await this.db.run(`
                INSERT INTO update_history (
                    version_from, version_to, update_type, status, backup_path
                ) VALUES (?, ?, ?, ?, ?)
            `, [
                this.currentVersion,
                'pending',
                updates.map(u => u.type).join(','),
                'started',
                backupPath
            ]);

            return result.lastID;
        } catch (error) {
            logger.error('Errore logging inizio aggiornamento:', error);
            throw error;
        }
    }

    async logUpdateComplete(updateId, status, error = null) {
        try {
            await this.db.run(`
                UPDATE update_history 
                SET status = ?, error = ?, completed_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `, [status, error, updateId]);
        } catch (dbError) {
            logger.error('Errore logging completamento aggiornamento:', dbError);
        }
    }

    async getUpdateStatus() {
        try {
            const lastUpdate = await this.db.get(`
                SELECT * FROM update_history 
                ORDER BY started_at DESC 
                LIMIT 1
            `);

            return {
                updateInProgress: this.updateInProgress,
                lastUpdate: lastUpdate,
                currentVersion: this.currentVersion,
                lockFileExists: fs.existsSync(this.lockFile)
            };
        } catch (error) {
            logger.error('Errore recupero status aggiornamenti:', error);
            throw error;
        }
    }

    async getUpdateHistory(limit = 50) {
        try {
            const history = await this.db.all(`
                SELECT * FROM update_history 
                ORDER BY started_at DESC 
                LIMIT ?
            `, [limit]);

            return history;
        } catch (error) {
            logger.error('Errore recupero cronologia aggiornamenti:', error);
            throw error;
        }
    }

    async stop() {
        try {
            // Cleanup attività in corso
            if (this.updateInProgress) {
                logger.warn('Arresto servizio durante aggiornamento in corso');
            }
            
            logger.info('Update Service fermato');
        } catch (error) {
            logger.error('Errore arresto Update Service:', error);
        }
    }
}

module.exports = UpdateService;