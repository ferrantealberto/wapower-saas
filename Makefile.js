make help</code> to see all available commands.</p>
                        </div>
                    </div>
                </div>

                <div class="makefile-code">
<span class="comment"># WAPower SAAS - Complete Makefile for Build and Deploy Automation</span>

<span class="variable">.PHONY:</span> help setup deploy start stop restart logs status backup ssl clean test

<span class="comment"># Variables</span>
<span class="variable">DOMAIN</span> := $(shell grep DOMAIN ./config/.env 2>/dev/null | cut -d '=' -f2 || echo "wapower.localhost")
<span class="variable">USER</span> := $(shell whoami)

<span class="comment"># Colors</span>
<span class="variable">GREEN</span> := \033[0;32m
<span class="variable">YELLOW</span> := \033[1;33m
<span class="variable">BLUE</span> := \033[0;34m
<span class="variable">NC</span> := \033[0m

<span class="command">help:</span> <span class="comment">## Mostra questo help</span>
	@echo "<span class="string">$(BLUE) WAPower - Comandi disponibili:$(NC)</span>"
	@echo "<span class="string">===================================</span>"
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z_-]+:.*?## / {printf "<span class="string">$(GREEN)%-15s$(NC) %s\\n</span>", $$1, $$2}' $(MAKEFILE_LIST)

<span class="command">setup:</span> <span class="comment">## Setup iniziale del progetto</span>
	@echo "<span class="string">$(BLUE) Setup WAPower...$(NC)</span>"
	@node scripts/setup.js

<span class="command">deploy:</span> <span class="comment">## Deploy completo dell'applicazione</span>
	@echo "<span class="string">$(BLUE) Deploy WAPower...$(NC)</span>"
	@chmod +x scripts/deploy.sh
	@./scripts/deploy.sh

<span class="command">start:</span> <span class="comment">## Avvia i servizi</span>
	@echo "<span class="string">$(BLUE) Avvio servizi...$(NC)</span>"
	@docker-compose up -d

<span class="command">stop:</span> <span class="comment">## Ferma i servizi</span>
	@echo "<span class="string">$(BLUE) Arresto servizi...$(NC)</span>"
	@docker-compose down

<span class="command">restart:</span> <span class="comment">## Riavvia i servizi</span>
	@echo "<span class="string">$(BLUE) Riavvio servizi...$(NC)</span>"
	@docker-compose restart

<span class="command">logs:</span> <span class="comment">## Visualizza logs in tempo reale</span>
	@echo "<span class="string">$(BLUE) Logs WAPower...$(NC)</span>"
	@docker-compose logs -f --tail=100

<span class="command">status:</span> <span class="comment">## Stato dei servizi</span>
	@echo "<span class="string">$(BLUE) Stato servizi:$(NC)</span>"
	@docker-compose ps

<span class="command">backup:</span> <span class="comment">## Esegui backup manuale</span>
	@echo "<span class="string">$(BLUE) Backup in corso...$(NC)</span>"
	@chmod +x scripts/backup.sh
	@./scripts/backup.sh

<span class="command">ssl:</span> <span class="comment">## Configura certificati SSL</span>
	@echo "<span class="string">$(BLUE) Configurazione SSL...$(NC)</span>"
	@if [ -z "$(DOMAIN)" ] || [ "$(DOMAIN)" = "wapower.localhost" ]; then \
		echo "<span class="string">$(YELLOW) Configura prima il dominio nel file .env$(NC)</span>"; \
		exit 1; \
	fi
	@sudo apt update && sudo apt install -y certbot
	@sudo certbot certonly --standalone -d $(DOMAIN) -d www.$(DOMAIN) --email admin@$(DOMAIN) --agree-tos --no-eff-email
	@sudo cp /etc/letsencrypt/live/$(DOMAIN)/fullchain.pem ./ssl/
	@sudo cp /etc/letsencrypt/live/$(DOMAIN)/privkey.pem ./ssl/
	@sudo chown $(USER):$(USER) ./ssl/*.pem
	@echo "<span class="string">$(GREEN) SSL configurato per $(DOMAIN)$(NC)</span>"

<span class="command">test:</span> <span class="comment">## Test API WAPower</span>
	@echo "<span class="string">$(BLUE) Test WAPower...$(NC)</span>"
	@echo "Test API locale..."
	@curl -s http://localhost:3000/api/status | jq . || echo "<span class="string">$(YELLOW) API locale non raggiungibile$(NC)</span>"
	@echo "Test API esterna..."
	@curl -s http://$(shell curl -s ifconfig.me):3000/api/status | jq . || echo "<span class="string">$(YELLOW) API esterna non raggiungibile$(NC)</span>"

<span class="command">clean:</span> <span class="comment">## Pulizia completa</span>
	@echo "<span class="string">$(BLUE) Pulizia sistema...$(NC)</span>"
	@docker-compose down -v
	@docker system prune -f
	@docker volume prune -f
	@echo "<span class="string">$(GREEN) Pulizia completata$(NC)</span>"

<span class="command">install:</span> <span class="comment">## Installazione completa automatica</span>
	@echo "<span class="string">$(BLUE) Installazione WAPower...$(NC)</span>"
	@make setup
	@make deploy
	@make ssl
	@make test
	@echo "<span class="string">$(GREEN) Installazione completata!$(NC)</span>"
	@echo "<span class="string">$(GREEN) Apri: https://$(DOMAIN)$(NC)</span>"

<span class="command">update:</span> <span class="comment">## Aggiornamento applicazione</span>
	@echo "<span class="string">$(BLUE) Aggiornamento WAPower...$(NC)</span>"
	@make backup
	@git pull origin main || echo "<span class="string">$(YELLOW) Git pull non riuscito$(NC)</span>"
	@make deploy
	@echo "<span class="string">$(GREEN) Aggiornamento completato$(NC)</span>"

<span class="command">monitor:</span> <span class="comment">## Monitoraggio servizi</span>
	@echo "<span class="string">$(BLUE) Monitoraggio WAPower...$(NC)</span>"
	@watch -n 2 'docker-compose ps && echo "\\n--- Logs ---" && docker-compose logs --tail=10'

<span class="command">dev:</span> <span class="comment">## Modalità sviluppo</span>
	@echo "<span class="string">$(BLUE) Modalità sviluppo...$(NC)</span>"
	@docker-compose -f docker-compose.yml -f docker-compose.dev.yml up

<span class="command">build:</span> <span class="comment">## Build immagini Docker</span>
	@echo "<span class="string">$(BLUE) Build immagini...$(NC)</span>"
	@docker-compose build --no-cache

<span class="command">shell:</span> <span class="comment">## Shell nel container</span>
	@echo "<span class="string">$(BLUE) Shell WAPower...$(NC)</span>"
	@docker-compose exec wapower sh

<span class="command">db:</span> <span class="comment">## Backup database</span>
	@echo "<span class="string">$(BLUE) Backup database...$(NC)</span>"
	@docker-compose exec wapower sqlite3 /app/wapower_database.sqlite .dump > backups/db_backup_$(shell date +%Y%m%d_%H%M%S).sql
	@echo "<span class="string">$(GREEN) Database backup completato$(NC)</span>"

<span class="command">restore:</span> <span class="comment">## Ripristino da backup</span>
	@echo "<span class="string">$(BLUE) Ripristino da backup...$(NC)</span>"
	@ls -la backups/
	@read -p "Inserisci nome backup: " backup; \
	if [ -f "backups/$$backup" ]; then \
		tar -xzf "backups/$$backup" -C backups/; \
		cp backups/backup_*/wapower_database.sqlite ./; \
		cp -r backups/backup_*/wapower_session ./; \
		make restart; \
		echo "<span class="string">$(GREEN) Ripristino completato$(NC)</span>"; \
	else \
		echo "<span class="string">$(YELLOW) Backup non trovato$(NC)</span>"; \
	fi

<span class="command">health:</span> <span class="comment">## Controllo salute sistema</span>
	@echo "<span class="string">$(BLUE) Controllo salute...$(NC)</span>"
	@curl -s http://localhost:3000/api/status | jq '.status' || echo "<span class="string">$(YELLOW) Servizio non raggiungibile$(NC)</span>"
	@docker-compose exec wapower ps aux
	@docker-compose exec wapower df -h
	@docker-compose exec wapower free -h

<span class="command">info:</span> <span class="comment">## Informazioni sistema</span>
	@echo "<span class="string">$(BLUE) Informazioni WAPower:$(NC)</span>"
	@echo "========================="
	@echo "Dominio: $(DOMAIN)"
	@echo "User: $(USER)"
	@echo "Versione: $(shell grep APP_VERSION ./config/.env 2>/dev/null | cut -d '=' -f2 || echo 'N/A')"
	@echo "Uptime: $(shell docker-compose exec wapower uptime 2>/dev/null || echo 'N/A')"
	@echo "Stato: $(shell docker-compose ps wapower --format 'table {{.Status}}' | tail -1)"
	@echo "URL: https://$(DOMAIN)"

<span class="command">check-updates:</span> <span class="comment">## Controlla aggiornamenti disponibili</span>
	@echo "<span class="string">$(BLUE) Controllo aggiornamenti...$(NC)</span>"
	@npm run check-updates

<span class="command">update-system:</span> <span class="comment">## Aggiorna sistema con backup automatico</span>
	@echo "<span class="string">$(BLUE) Aggiornamento sistema...$(NC)</span>"
	@echo "<span class="string">$(YELLOW) Creazione backup automatico...$(NC)</span>"
	@make backup
	@npm update
	@echo "<span class="string">$(GREEN) Sistema aggiornato$(NC)</span>"

<span class="command">security-audit:</span> <span class="comment">## Audit sicurezza dipendenze</span>
	@echo "<span class="string">$(BLUE) Audit sicurezza...$(NC)</span>"
	@npm audit
	@npm audit fix --audit-level moderate

<span class="command">update-check-auto:</span> <span class="comment">## Controllo automatico per cron</span>
	@echo "<span class="string">$(BLUE) Controllo automatico aggiornamenti...$(NC)</span>"
	@node -e "require('./services/update').checkForUpdates().then(r => console.log('Aggiornamenti:', r.hasUpdates ? r.totalUpdates + ' disponibili' : 'Nessuno'))"

<span class="command">update-critical:</span> <span class="comment">## Aggiorna solo dipendenze critiche di sicurezza</span>
	@echo "<span class="string">$(BLUE) Aggiornamento dipendenze critiche...$(NC)</span>"
	@make backup
	@npm audit fix --force
	@echo "<span class="string">$(GREEN) Dipendenze critiche aggiornate$(NC)</span>"
                </div>

                <div class="mt-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    <div class="bg-green-50 border border-green-200 rounded-lg p-4">
                        <h4 class="font-semibold text-green-800 flex items-center">
                            <i class="fas fa-rocket mr-2"></i>
                            Quick Start
                        </h4>
                        <div class="text-sm text-green-700 mt-2">
                            <code class="bg-green-100 px-2 py-1 rounded">make setup