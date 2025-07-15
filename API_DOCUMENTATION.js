https://your-domain.com/api/v1</code>
                        </div>
                    </div>
                </section>

                <!-- Authentication -->
                <section id="authentication" class="mb-12">
                    <div class="bg-white rounded-lg shadow p-6">
                        <h2 class="text-2xl font-bold text-gray-900 mb-4">
                            <i class="fas fa-key text-blue-600 mr-2"></i>Autenticazione
                        </h2>
                        <p class="text-gray-600 mb-4">
                            Tutte le richieste API richiedono autenticazione tramite API Key nell'header Authorization.
                        </p>
                        
                        <div class="code-block mb-4">
Authorization: Bearer wapower_your_api_key_here
Content-Type: application/json
                        </div>

                        <div class="bg-yellow-50 border-l-4 border-yellow-400 p-4 mb-4">
                            <div class="flex">
                                <i class="fas fa-exclamation-triangle text-yellow-400 mr-2 mt-1"></i>
                                <div>
                                    <p class="text-yellow-700">
                                        <strong>Importante:</strong> Mantieni la tua API Key sicura e non condividerla mai pubblicamente.
                                        Usa variabili d'ambiente per memorizzarla nelle tue applicazioni.
                                    </p>
                                </div>
                            </div>
                        </div>

                        <h3 class="font-semibold mb-2">Come ottenere una API Key</h3>
                        <ol class="list-decimal list-inside space-y-1 text-gray-600">
                            <li>Accedi alla dashboard WAPower</li>
                            <li>Vai nella sezione "API Keys"</li>
                            <li>Clicca "Genera Nuova API Key"</li>
                            <li>Configura i permessi necessari</li>
                            <li>Copia la chiave generata (verrà mostrata solo una volta)</li>
                        </ol>
                    </div>
                </section>

                <!-- Rate Limiting -->
                <section id="rate-limiting" class="mb-12">
                    <div class="bg-white rounded-lg shadow p-6">
                        <h2 class="text-2xl font-bold text-gray-900 mb-4">
                            <i class="fas fa-tachometer-alt text-green-600 mr-2"></i>Rate Limiting
                        </h2>
                        <p class="text-gray-600 mb-4">
                            I limiti di velocità sono applicati per API Key e variano in base al tier di servizio.
                        </p>

                        <div class="overflow-x-auto mb-4">
                            <table class="min-w-full bg-white border border-gray-200">
                                <thead class="bg-gray-50">
                                    <tr>
                                        <th class="px-4 py-2 text-left text-gray-700">Tier</th>
                                        <th class="px-4 py-2 text-left text-gray-700">Richieste/Ora</th>
                                        <th class="px-4 py-2 text-left text-gray-700">Messaggi/Giorno</th>
                                        <th class="px-4 py-2 text-left text-gray-700">Webhook</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr class="border-t">
                                        <td class="px-4 py-2 font-medium">Free</td>
                                        <td class="px-4 py-2">100</td>
                                        <td class="px-4 py-2">10</td>
                                        <td class="px-4 py-2">1</td>
                                    </tr>
                                    <tr class="border-t">
                                        <td class="px-4 py-2 font-medium">Basic</td>
                                        <td class="px-4 py-2">1,000</td>
                                        <td class="px-4 py-2">100</td>
                                        <td class="px-4 py-2">5</td>
                                    </tr>
                                    <tr class="border-t">
                                        <td class="px-4 py-2 font-medium">Pro</td>
                                        <td class="px-4 py-2">10,000</td>
                                        <td class="px-4 py-2">1,000</td>
                                        <td class="px-4 py-2">20</td>
                                    </tr>
                                    <tr class="border-t">
                                        <td class="px-4 py-2 font-medium">Enterprise</td>
                                        <td class="px-4 py-2">Illimitato</td>
                                        <td class="px-4 py-2">Illimitato</td>
                                        <td class="px-4 py-2">Illimitato</td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>

                        <div class="bg-blue-50 p-4 rounded-lg">
                            <h4 class="font-semibold text-blue-900 mb-2">Headers di Risposta</h4>
                            <ul class="text-blue-800 text-sm space-y-1">
                                <li><code>X-RateLimit-Limit