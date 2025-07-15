make backup</code></td>
                                    <td class="px-4 py-2 border-b">Esegui backup manuale</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>

                <div class="bg-white rounded-lg shadow-lg p-8 mb-6">
                    <h3 class="text-xl font-bold mb-4 text-blue-600">Deployment Manuale</h3>
                    <div class="code-block">
# Build immagini
docker-compose build

# Avvio servizi
docker-compose up -d

# Verifica stato
docker-compose ps

# Visualizza logs
docker-compose logs -f
                    </div>
                </div>

                <div class="bg-white rounded-lg shadow-lg p-8">
                    <h3 class="text-xl font-bold mb-4 text-blue-600">Struttura Container</h3>
                    <div class="grid md:grid-cols-2 gap-6">
                        <div class="bg-gray-50 rounded-lg p-4">
                            <h4 class="font-bold mb-2 text-blue-600">wapower</h4>
                            <ul class="space-y-1 text-sm">
                                <li>• Applicazione Node.js principale</li>
                                <li>• Porta: 3000</li>
                                <li>• Volume: sessioni, database, logs, backup</li>
                            </ul>
                        </div>
                        <div class="bg-gray-50 rounded-lg p-4">
                            <h4 class="font-bold mb-2 text-green-600">wapower-nginx</h4>
                            <ul class="space-y-1 text-sm">
                                <li>• Reverse proxy con SSL</li>
                                <li>• Porte: 80, 443</li>
                                <li>• Rate limiting e security headers</li>
                            </ul>
                        </div>
                    </div>
                </div>
            </section>

            <!-- Sicurezza -->
            <section id="security" class="section-divider">
                <h2 class="text-3xl font-bold mb-6 text-gray-800">
                    <i class="fas fa-shield-alt mr-3 text-blue-600"></i>Sicurezza
                </h2>

                <div class="bg-white rounded-lg shadow-lg p-8 mb-6">
                    <h3 class="text-xl font-bold mb-4 text-blue-600">Funzionalità di Sicurezza</h3>
                    
                    <div class="grid md:grid-cols-2 gap-6">
                        <div>
                            <h4 class="font-bold mb-2 text-green-600">Autenticazione</h4>
                            <ul class="space-y-1 text-sm">
                                <li>• Password hashate con bcrypt (12 rounds)</li>
                                <li>• Sessioni sicure con SQLite store</li>
                                <li>• Cookie httpOnly e secure</li>
                                <li>• Session secret randomizzato</li>
                            </ul>
                        </div>
                        <div>
                            <h4 class="font-bold mb-2 text-orange-600">Rate Limiting</h4>
                            <ul class="space-y-1 text-sm">
                                <li>• Login: 5 tentativi/15 minuti</li>
                                <li>• API: 100 richieste/15 minuti</li>
                                <li>• Strict API: 10 richieste/minuto</li>
                                <li>• IP-based tracking</li>
                            </ul>
                        </div>
                        <div>
                            <h4 class="font-bold mb-2 text-purple-600">Headers Sicurezza</h4>
                            <ul class="space-y-1 text-sm">
                                <li>• X-Frame-Options: DENY</li>
                                <li>• X-Content-Type-Options: nosniff</li>
                                <li>• X-XSS-Protection: 1; mode=block</li>
                                <li>• Strict-Transport-Security</li>
                            </ul>
                        </div>
                        <div>
                            <h4 class="font-bold mb-2 text-red-600">Validazione Input</h4>
                            <ul class="space-y-1 text-sm">
                                <li>• Sanitizzazione automatica</li>
                                <li>• Validazione express-validator</li>
                                <li>• Lunghezza massima input</li>
                                <li>• Filtro caratteri dannosi</li>
                            </ul>
                        </div>
                    </div>
                </div>

                <div class="bg-white rounded-lg shadow-lg p-8">
                    <h3 class="text-xl font-bold mb-4 text-blue-600">Checklist Sicurezza</h3>
                    <div class="space-y-2">
                        <div class="flex items-center">
                            <input type="checkbox" checked disabled class="mr-3">
                            <span>Password dashboard hashata con bcrypt</span>
                        </div>
                        <div class="flex items-center">
                            <input type="checkbox" checked disabled class="mr-3">
                            <span>SSL/HTTPS configurato</span>
                        </div>
                        <div class="flex items-center">
                            <input type="checkbox" class="mr-3">
                            <span>Firewall server configurato</span>
                        </div>
                        <div class="flex items-center">
                            <input type="checkbox" checked disabled class="mr-3">
                            <span>Backup automatici attivati</span>
                        </div>
                        <div class="flex items-center">
                            <input type="checkbox" checked disabled class="mr-3">
                            <span>Logging audit attivato</span>
                        </div>
                        <div class="flex items-center">
                            <input type="checkbox" checked disabled class="mr-3">
                            <span>Aggiornamenti automatici configurati</span>
                        </div>
                    </div>
                </div>
            </section>

            <!-- API -->
            <section id="api" class="section-divider">
                <h2 class="text-3xl font-bold mb-6 text-gray-800">
                    <i class="fas fa-code mr-3 text-blue-600"></i>API REST
                </h2>

                <div class="bg-white rounded-lg shadow-lg p-8 mb-6">
                    <h3 class="text-xl font-bold mb-4 text-blue-600">Autenticazione API</h3>
                    <div class="code-block">
# Genera API Key dalla dashboard
POST /api/v1/auth/generate-key
Authorization: Bearer [session-token]

# Usa API Key per richieste
GET /api/v1/messages
Authorization: Bearer [api-key]
                    </div>
                </div>

                <div class="bg-white rounded-lg shadow-lg p-8 mb-6">
                    <h3 class="text-xl font-bold mb-4 text-blue-600">Endpoint Principali</h3>
                    
                    <h4 class="font-bold mb-2 text-green-600">Invio Messaggi</h4>
                    <div class="code-block">
# Messaggio singolo
POST /api/v1/messages
{
  "phone": "+39123456789",
  "message": "Ciao dal sistema WAPower!"
}

# Messaggio multiplo
POST /api/v1/messages/bulk
{
  "messages": [
    {"phone": "+39123456789", "message": "Messaggio 1"},
    {"phone": "+39987654321", "message": "Messaggio 2"}
  ]
}
                    </div>

                    <h4 class="font-bold mb-2 mt-6 text-purple-600">Statistiche</h4>
                    <div class="code-block">
# Statistiche generali
GET /api/v1/stats

# Statistiche per periodo
GET /api/v1/stats?range=7&type=daily

# Statistiche per API Key
GET /api/v1/stats/apikey
                    </div>

                    <h4 class="font-bold mb-2 mt-6 text-orange-600">Webhook</h4>
                    <div class="code-block">
# Registra webhook
POST /api/v1/webhooks
{
  "url": "https://tuodominio.it/webhook",
  "events": ["message_sent", "message_failed"],
  "secret": "your-secret-key"
}

# Lista webhook
GET /api/v1/webhooks
                    </div>
                </div>

                <div class="bg-white rounded-lg shadow-lg p-8">
                    <h3 class="text-xl font-bold mb-4 text-blue-600">Rate Limiting</h3>
                    <div class="overflow-x-auto">
                        <table class="min-w-full bg-gray-50 border border-gray-200">
                            <thead class="bg-gray-100">
                                <tr>
                                    <th class="px-4 py-2 border-b font-bold text-left">Tier</th>
                                    <th class="px-4 py-2 border-b font-bold text-left">Richieste/ora</th>
                                    <th class="px-4 py-2 border-b font-bold text-left">Messaggi/giorno</th>
                                    <th class="px-4 py-2 border-b font-bold text-left">Webhook</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr>
                                    <td class="px-4 py-2 border-b font-bold">Free</td>
                                    <td class="px-4 py-2 border-b">100</td>
                                    <td class="px-4 py-2 border-b">10</td>
                                    <td class="px-4 py-2 border-b">1</td>
                                </tr>
                                <tr>
                                    <td class="px-4 py-2 border-b font-bold">Basic</td>
                                    <td class="px-4 py-2 border-b">1000</td>
                                    <td class="px-4 py-2 border-b">100</td>
                                    <td class="px-4 py-2 border-b">5</td>
                                </tr>
                                <tr>
                                    <td class="px-4 py-2 border-b font-bold">Pro</td>
                                    <td class="px-4 py-2 border-b">10000</td>
                                    <td class="px-4 py-2 border-b">1000</td>
                                    <td class="px-4 py-2 border-b">20</td>
                                </tr>
                                <tr>
                                    <td class="px-4 py-2 border-b font-bold">Enterprise</td>
                                    <td class="px-4 py-2 border-b">Illimitato</td>
                                    <td class="px-4 py-2 border-b">Illimitato</td>
                                    <td class="px-4 py-2 border-b">Illimitato</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            </section>

            <!-- Integrazioni -->
            <section id="integrations" class="section-divider">
                <h2 class="text-3xl font-bold mb-6 text-gray-800">
                    <i class="fas fa-plug mr-3 text-blue-600"></i>Integrazioni
                </h2>

                <div class="grid md:grid-cols-2 gap-6">
                    <!-- N8N Integration -->
                    <div class="bg-white rounded-lg shadow-lg p-6">
                        <h3 class="text-xl font-bold mb-4 text-blue-600">
                            <i class="fas fa-sitemap mr-2"></i>N8N Integration
                        </h3>
                        
                        <h4 class="font-bold mb-2">Installazione Node Custom</h4>
                        <div class="code-block text-sm">
# Installa node WAPower per N8N
npm install n8n-nodes-wapower

# Configura N8N
export N8N_CUSTOM_EXTENSIONS=n8n-nodes-wapower
n8n start
                        </div>

                        <h4 class="font-bold mb-2 mt-4">Nodi Disponibili</h4>
                        <ul class="space-y-1 text-sm">
                            <li>• <strong>WAPower Send Message:</strong> Invio messaggi singoli</li>
                            <li>• <strong>WAPower Bulk Send:</strong> Invio messaggi multipli</li>
                            <li>• <strong>WAPower Trigger:</strong> Ricezione eventi webhook</li>
                            <li>• <strong>WAPower Analytics:</strong> Statistiche e report</li>
                        </ul>
                    </div>

                    <!-- WordPress Integration -->
                    <div class="bg-white rounded-lg shadow-lg p-6">
                        <h3 class="text-xl font-bold mb-4 text-orange-600">
                            <i class="fab fa-wordpress mr-2"></i>WordPress Integration
                        </h3>
                        
                        <h4 class="font-bold mb-2">Installazione Plugin</h4>
                        <div class="code-block text-sm">
# Download dalla dashboard WAPower
# Oppure da repository WordPress
wp plugin install wapower-integration-pro
wp plugin activate wapower-integration-pro
                        </div>

                        <h4 class="font-bold mb-2 mt-4">Shortcode Disponibili</h4>
                        <ul class="space-y-1 text-sm">
                            <li>• <code>[wapower_form]