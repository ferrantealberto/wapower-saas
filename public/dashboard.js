<!DOCTYPE html>
<html lang="it">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>WAPower Dashboard - Monitoring e Controllo</title>
    
    <!-- PWA Meta Tags -->
    <meta name="theme-color" content="#3B82F6">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="default">
    <meta name="apple-mobile-web-app-title" content="WAPower">
    <link rel="manifest" href="/manifest.json">
    
    <!-- CSS Libraries -->
    <link href="https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css" rel="stylesheet">
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css">
    
    <!-- Custom Styles -->
    <style>
        .status-indicator {
            display: flex;
            align-items: center;
            gap: 0.5rem;
            padding: 0.5rem 1rem;
            border-radius: 0.5rem;
            font-weight: 600;
        }
        .status-indicator.connected {
            background-color: #DEF7EC;
            color: #047857;
        }
        .status-indicator.disconnected {
            background-color: #FEE2E2;
            color: #DC2626;
        }
        .status-indicator::before {
            content: '';
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background-color: currentColor;
        }
        .toast {
            position: fixed;
            top: 1rem;
            right: 1rem;
            z-index: 1000;
            background: white;
            border-radius: 0.5rem;
            box-shadow: 0 10px 25px rgba(0, 0, 0, 0.1);
            padding: 1rem;
            margin-bottom: 0.5rem;
            display: flex;
            align-items: center;
            gap: 0.75rem;
            max-width: 400px;
            animation: slideIn 0.3s ease-out;
        }
        .toast-success { border-left: 4px solid #10B981; }
        .toast-error { border-left: 4px solid #EF4444; }
        .toast-warning { border-left: 4px solid #F59E0B; }
        .toast-info { border-left: 4px solid #3B82F6; }
        
        @keyframes slideIn {
            from { transform: translateX(100%); opacity: 0; }
            to { transform: translateX(0); opacity: 1; }
        }
        
        .modal {
            display: none;
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.5);
            z-index: 1000;
            align-items: center;
            justify-content: center;
        }
        .modal.active { display: flex; }
        
        .card {
            background: white;
            border-radius: 0.75rem;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05);
            border: 1px solid #E5E7EB;
        }
        
        .chart-container {
            position: relative;
            height: 300px;
            width: 100%;
        }
        
        .connection-status {
            position: fixed;
            top: 1rem;
            left: 1rem;
            z-index: 100;
            padding: 0.5rem 1rem;
            border-radius: 0.5rem;
            font-size: 0.875rem;
            font-weight: 600;
        }
        .connection-status.connected {
            background-color: #DEF7EC;
            color: #047857;
        }
        .connection-status.disconnected {
            background-color: #FEE2E2;
            color: #DC2626;
        }
        
        .log-item {
            border-bottom: 1px solid #E5E7EB;
            padding: 1rem;
            transition: background-color 0.2s;
        }
        .log-item:hover {
            background-color: #F9FAFB;
        }
        .log-item:last-child {
            border-bottom: none;
        }
        
        .update-item {
            border: 1px solid #E5E7EB;
            border-radius: 0.5rem;
            padding: 1rem;
            margin-bottom: 1rem;
        }
        
        .severity-minor { color: #059669; }
        .severity-major { color: #DC2626; }
        .severity-patch { color: #6B7280; }
    </style>
</head>
<body class="bg-gray-50">
    <!-- Connection Status -->
    <div id="connectionStatus" class="connection-status connected">
        <i class="fas fa-wifi mr-2"></i>
        <span class="text">Connesso</span>
    </div>

    <!-- Toast Container -->
    <div id="toastContainer"></div>

    <!-- Header -->
    <header class="bg-white shadow-sm border-b">
        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div class="flex justify-between h-16">
                <div class="flex items-center">
                    <div class="flex-shrink-0">
                        <i class="fas fa-comments text-blue-600 text-2xl"></i>
                        <span class="ml-2 text-xl font-bold text-gray-900">WAPower</span>
                    </div>
                    <div class="ml-6">
                        <span id="appVersion" class="text-sm text-gray-500">v1.0.0</span>
                    </div>
                </div>
                
                <div class="flex items-center space-x-4">
                    <button id="refreshBtn" class="text-gray-600 hover:text-gray-900">
                        <i class="fas fa-sync-alt"></i>
                    </button>
                    <button id="settingsBtn" class="text-gray-600 hover:text-gray-900">
                        <i class="fas fa-cog"></i>
                    </button>
                    <button id="logoutBtn" class="bg-red-600 text-white px-4 py-2 rounded-md hover:bg-red-700">
                        <i class="fas fa-sign-out-alt mr-2"></i>Logout
                    </button>
                </div>
            </div>
        </div>
    </header>

    <!-- Main Content -->
    <main class="max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
        <!-- Status Cards -->
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
            <!-- WhatsApp Status -->
            <div class="card p-6">
                <div class="flex items-center justify-between">
                    <div>
                        <h3 class="text-lg font-medium text-gray-900">WhatsApp</h3>
                        <div id="whatsappIndicator" class="status-indicator disconnected mt-2">
                            <span class="text">Disconnesso</span>
                        </div>
                        <p id="whatsappInfo" class="text-sm text-gray-500 mt-1">In attesa di connessione</p>
                    </div>
                    <i class="fab fa-whatsapp text-green-500 text-3xl"></i>
                </div>
                <button id="whatsappReconnect" class="mt-4 bg-green-600 text-white px-4 py-2 rounded-md hover:bg-green-700 text-sm">
                    <i class="fas fa-sync mr-2"></i>Riconnetti
                </button>
            </div>

            <!-- Gmail Status -->
            <div class="card p-6">
                <div class="flex items-center justify-between">
                    <div>
                        <h3 class="text-lg font-medium text-gray-900">Gmail</h3>
                        <div id="gmailIndicator" class="status-indicator disconnected mt-2">
                            <span class="text">Disconnesso</span>
                        </div>
                        <p id="gmailInfo" class="text-sm text-gray-500 mt-1">Configurazione richiesta</p>
                    </div>
                    <i class="fas fa-envelope text-red-500 text-3xl"></i>
                </div>
                <button id="gmailTest" class="mt-4 bg-red-600 text-white px-4 py-2 rounded-md hover:bg-red-700 text-sm">
                    <i class="fas fa-test-tube mr-2"></i>Test
                </button>
            </div>

            <!-- Database Status -->
            <div class="card p-6">
                <div class="flex items-center justify-between">
                    <div>
                        <h3 class="text-lg font-medium text-gray-900">Database</h3>
                        <div id="databaseIndicator" class="status-indicator connected mt-2">
                            <span class="text">Connesso</span>
                        </div>
                        <p id="databaseInfo" class="text-sm text-gray-500 mt-1">SQLite attivo</p>
                    </div>
                    <i class="fas fa-database text-blue-500 text-3xl"></i>
                </div>
                <button id="backupBtn" class="mt-4 bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 text-sm">
                    <i class="fas fa-backup mr-2"></i>Backup
                </button>
            </div>

            <!-- Uptime -->
            <div class="card p-6">
                <div class="flex items-center justify-between">
                    <div>
                        <h3 class="text-lg font-medium text-gray-900">Uptime</h3>
                        <div id="uptime" class="mt-2">
                            <span class="value text-2xl font-bold text-green-600">0m</span>
                        </div>
                        <p class="text-sm text-gray-500 mt-1">Sistema attivo</p>
                    </div>
                    <i class="fas fa-clock text-purple-500 text-3xl"></i>
                </div>
            </div>
        </div>

        <!-- QR Code Section -->
        <div id="qrSection" class="card p-6 mb-8" style="display: none;">
            <h3 class="text-lg font-medium text-gray-900 mb-4">
                <i class="fas fa-qrcode mr-2"></i>Scansiona QR Code WhatsApp
            </h3>
            <div class="flex justify-center">
                <div id="qrCode" class="border-2 border-gray-300 rounded-lg p-4"></div>
            </div>
            <p class="text-sm text-gray-600 text-center mt-4">
                Apri WhatsApp sul tuo telefono e scansiona questo QR code per connettere il bot.
            </p>
        </div>

        <!-- Statistics and Test Message -->
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
            <!-- Statistics Chart -->
            <div class="card">
                <div class="p-6 border-b">
                    <div class="flex items-center justify-between">
                        <h3 class="text-lg font-medium text-gray-900">Statistiche Messaggi</h3>
                        <button id="statsRefresh" class="text-blue-600 hover:text-blue-800">
                            <i class="fas fa-sync text-sm"></i>
                        </button>
                    </div>
                </div>
                <div class="p-6">
                    <div class="grid grid-cols-3 gap-4 mb-6">
                        <div class="text-center">
                            <div id="messagesSent" class="text-2xl font-bold text-green-600">0</div>
                            <div class="text-sm text-gray-500">Inviati</div>
                        </div>
                        <div class="text-center">
                            <div id="messagesFailed" class="text-2xl font-bold text-red-600">0</div>
                            <div class="text-sm text-gray-500">Falliti</div>
                        </div>
                        <div class="text-center">
                            <div id="successRate" class="text-2xl font-bold text-blue-600">0%</div>
                            <div class="text-sm text-gray-500">Successo</div>
                        </div>
                    </div>
                    <div class="chart-container">
                        <canvas id="messagesChart"></canvas>
                    </div>
                </div>
            </div>

            <!-- Test Message -->
            <div class="card">
                <div class="p-6 border-b">
                    <h3 class="text-lg font-medium text-gray-900">
                        <i class="fas fa-paper-plane mr-2"></i>Invia Messaggio Test
                    </h3>
                </div>
                <div class="p-6">
                    <form id="testMessageForm" class="space-y-4">
                        <div>
                            <label for="testPhone" class="block text-sm font-medium text-gray-700">Numero di telefono</label>
                            <input type="text" id="testPhone" class="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500" placeholder="+39123456789" required>
                        </div>
                        <div>
                            <label for="testMessage" class="block text-sm font-medium text-gray-700">Messaggio</label>
                            <textarea id="testMessage" rows="3" class="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500" placeholder="Inserisci il tuo messaggio..." required></textarea>
                        </div>
                        <button type="submit" class="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2">
                            <span id="testBtnText">
                                <i class="fas fa-paper-plane mr-2"></i>Invia Test
                            </span>
                            <span id="testSpinner" class="hidden">
                                <i class="fas fa-spinner fa-spin mr-2"></i>Invio...
                            </span>
                        </button>
                    </form>
                </div>
            </div>
        </div>

        <!-- Logs and Updates -->
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <!-- Activity Logs -->
            <div class="card">
                <div class="p-6 border-b">
                    <div class="flex items-center justify-between">
                        <h3 class="text-lg font-medium text-gray-900">
                            <i class="fas fa-list mr-2"></i>Log Attività
                        </h3>
                        <div class="flex space-x-2">
                            <button id="exportLogs" class="text-blue-600 hover:text-blue-800 text-sm">
                                <i class="fas fa-download mr-1"></i>Esporta
                            </button>
                            <button id="clearLogsBtn" class="text-red-600 hover:text-red-800 text-sm">
                                <i class="fas fa-trash mr-1"></i>Pulisci
                            </button>
                        </div>
                    </div>
                </div>
                <div class="p-6">
                    <div class="flex space-x-4 mb-4">
                        <select id="logTypeFilter" class="border-gray-300 rounded-md text-sm">
                            <option value="all">Tutti i tipi</option>
                            <option value="email">Email</option>
                            <option value="manual">Manuale</option>
                            <option value="system">Sistema</option>
                        </select>
                        <input type="text" id="logSearch" placeholder="Cerca nei log..." class="flex-1 border-gray-300 rounded-md text-sm">
                    </div>
                    <div id="logsList" class="max-h-96 overflow-y-auto border rounded-md">
                        <div class="text-center text-gray-500 py-8">Caricamento log...</div>
                    </div>
                </div>
            </div>

            <!-- Updates -->
            <div class="card">
                <div class="p-6 border-b">
                    <div class="flex items-center justify-between">
                        <h3 class="text-lg font-medium text-gray-900">
                            <i class="fas fa-sync mr-2"></i>Aggiornamenti
                        </h3>
                        <div class="flex space-x-2">
                            <button id="checkUpdatesBtn" class="bg-blue-600 text-white px-3 py-1 rounded text-sm hover:bg-blue-700">
                                <i class="fas fa-sync mr-1"></i>Controlla
                            </button>
                            <button id="updateHistoryBtn" class="text-blue-600 hover:text-blue-800 text-sm">
                                <i class="fas fa-history mr-1"></i>Cronologia
                            </button>
                        </div>
                    </div>
                </div>
                <div class="p-6">
                    <div id="updatesStatus" class="mb-4">
                        ✅ Controllo aggiornamenti in corso...
                    </div>
                    <div id="updatesList" style="display: none;" class="space-y-4">
                        <!-- Updates will be populated here -->
                    </div>
                    <div class="mt-4 space-y-2" style="display: none;" id="updateActions">
                        <button id="selectAllUpdates" class="text-blue-600 hover:text-blue-800 text-sm">
                            <i class="fas fa-check-square mr-1"></i>Seleziona tutti
                        </button>
                        <button id="backupBeforeUpdate" class="w-full bg-green-600 text-white py-2 px-4 rounded-md hover:bg-green-700">
                            <i class="fas fa-backup mr-2"></i>Backup e Aggiorna
                        </button>
                    </div>
                </div>
            </div>
        </div>
    </main>

    <!-- Settings Modal -->
    <div id="settingsModal" class="modal">
        <div class="bg-white rounded-lg p-6 w-full max-w-md">
            <div class="flex items-center justify-between mb-4">
                <h3 class="text-lg font-medium">Impostazioni</h3>
                <button class="modal-close text-gray-400 hover:text-gray-600">
                    <i class="fas fa-times"></i>
                </button>
            </div>
            <div class="space-y-4">
                <div class="flex items-center justify-between">
                    <label class="text-sm font-medium text-gray-700">Notifiche</label>
                    <input type="checkbox" id="notificationsEnabled" class="rounded">
                </div>
                <div class="flex items-center justify-between">
                    <label class="text-sm font-medium text-gray-700">Aggiornamento automatico</label>
                    <input type="checkbox" id="autoRefreshEnabled" class="rounded">
                </div>
                <div class="flex space-x-3 pt-4">
                    <button class="modal-close flex-1 bg-gray-200 text-gray-800 py-2 px-4 rounded-md hover:bg-gray-300">
                        Annulla
                    </button>
                    <button class="modal-close flex-1 bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700">
                        Salva
                    </button>
                </div>
            </div>
        </div>
    </div>

    <!-- JavaScript Libraries -->
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <script src="https://cdn.socket.io/4.7.4/socket.io.min.js"></script>

    <!-- WAPower Dashboard Script -->
    <script>
        // WAPower Dashboard - Complete Frontend Logic
        // Enhanced with real-time updates, PWA support, and advanced features

        class WAPowerDashboard {
            constructor() {
                this.socket = null;
                this.isConnected = false;
                this.autoRefresh = true;
                this.refreshInterval = 30000; // 30 seconds
                this.chart = null;
                this.updates = [];
                this.logs = [];
                this.currentPage = 1;
                this.logsPerPage = 20;
                
                this.init();
            }

            init() {
                this.setupSocket();
                this.setupEventListeners();
                this.setupCharts();
                this.registerServiceWorker();
                this.loadInitialData();
                this.startAutoRefresh();
            }

            setupSocket() {
                this.socket = io({
                    transports: ['websocket', 'polling'],
                    upgrade: true,
                    rememberUpgrade: true
                });

                this.socket.on('connect', () => {
                    console.log('Connected to WAPower server');
                    this.isConnected = true;
                    this.updateConnectionStatus(true);
                });

                this.socket.on('disconnect', () => {
                    console.log('Disconnected from WAPower server');
                    this.isConnected = false;
                    this.updateConnectionStatus(false);
                });

                this.socket.on('status', (data) => {
                    this.updateStatus(data);
                });

                this.socket.on('qr', (qr) => {
                    this.showQRCode(qr);
                });

                this.socket.on('updateProgress', (data) => {
                    this.updateProgress(data);
                });

                this.socket.on('newLog', (log) => {
                    this.addNewLog(log);
                });
            }

            setupEventListeners() {
                // Header actions
                document.getElementById('refreshBtn').addEventListener('click', () => {
                    this.refreshData();
                });

                document.getElementById('settingsBtn').addEventListener('click', () => {
                    this.showSettingsModal();
                });

                document.getElementById('logoutBtn').addEventListener('click', () => {
                    this.logout();
                });

                // Status actions
                document.getElementById('whatsappReconnect').addEventListener('click', () => {
                    this.reconnectWhatsApp();
                });

                document.getElementById('gmailTest').addEventListener('click', () => {
                    this.testGmail();
                });

                document.getElementById('statsRefresh').addEventListener('click', () => {
                    this.refreshStats();
                });

                document.getElementById('checkUpdatesBtn').addEventListener('click', () => {
                    this.checkUpdates();
                });

                // Test message form
                document.getElementById('testMessageForm').addEventListener('submit', (e) => {
                    e.preventDefault();
                    this.sendTestMessage();
                });

                // Logs actions
                document.getElementById('exportLogs').addEventListener('click', () => {
                    this.exportLogs();
                });

                document.getElementById('clearLogsBtn').addEventListener('click', () => {
                    this.clearLogs();
                });

                document.getElementById('logTypeFilter').addEventListener('change', () => {
                    this.filterLogs();
                });

                document.getElementById('logSearch').addEventListener('input', () => {
                    this.filterLogs();
                });

                // Modal handling
                document.querySelectorAll('.modal-close').forEach(btn => {
                    btn.addEventListener('click', (e) => {
                        e.target.closest('.modal').style.display = 'none';
                    });
                });

                // Settings
                document.getElementById('notificationsEnabled').addEventListener('change', (e) => {
                    this.toggleNotifications(e.target.checked);
                });

                document.getElementById('autoRefreshEnabled').addEventListener('change', (e) => {
                    this.toggleAutoRefresh(e.target.checked);
                });

                // Keyboard shortcuts
                document.addEventListener('keydown', (e) => {
                    if (e.ctrlKey || e.metaKey) {
                        switch (e.key) {
                            case 'r':
                                e.preventDefault();
                                this.refreshData();
                                break;
                            case 'u':
                                e.preventDefault();
                                this.checkUpdates();
                                break;
                            case 'l':
                                e.preventDefault();
                                this.showLogs();
                                break;
                        }
                    }
                });
            }

            setupCharts() {
                const ctx = document.getElementById('messagesChart').getContext('2d');
                this.chart = new Chart(ctx, {
                    type: 'line',
                    data: {
                        labels: [],
                        datasets: [{
                            label: 'Messaggi Inviati',
                            data: [],
                            borderColor: '#10B981',
                            backgroundColor: 'rgba(16, 185, 129, 0.1)',
                            tension: 0.4
                        }, {
                            label: 'Messaggi Falliti',
                            data: [],
                            borderColor: '#EF4444',
                            backgroundColor: 'rgba(239, 68, 68, 0.1)',
                            tension: 0.4
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        scales: {
                            y: {
                                beginAtZero: true,
                                ticks: {
                                    precision: 0
                                }
                            }
                        },
                        plugins: {
                            legend: {
                                display: true,
                                position: 'top'
                            }
                        }
                    }
                });
            }

            registerServiceWorker() {
                if ('serviceWorker' in navigator) {
                    navigator.serviceWorker.register('/sw.js')
                        .then(registration => {
                            console.log('ServiceWorker registered: ', registration);
                        })
                        .catch(registrationError => {
                            console.log('ServiceWorker registration failed: ', registrationError);
                        });
                }
            }

            async loadInitialData() {
                try {
                    await Promise.all([
                        this.fetchStatus(),
                        this.fetchLogs(),
                        this.fetchStats()
                    ]);
                } catch (error) {
                    console.error('Error loading initial data:', error);
                    this.showToast('Errore nel caricamento dei dati iniziali', 'error');
                }
            }

            async fetchStatus() {
                try {
                    const response = await fetch('/api/status');
                    const data = await response.json();
                    
                    if (data.success) {
                        this.updateStatus(data.status);
                    }
                } catch (error) {
                    console.error('Error fetching status:', error);
                }
            }

            async fetchLogs() {
                try {
                    const response = await fetch('/api/logs?limit=50');
                    const data = await response.json();
                    
                    if (data.success) {
                        this.logs = data.logs;
                        this.renderLogs();
                    }
                } catch (error) {
                    console.error('Error fetching logs:', error);
                }
            }

            async fetchStats() {
                try {
                    const response = await fetch('/api/stats');
                    const data = await response.json();
                    
                    if (data.success) {
                        this.updateChart(data.stats);
                    }
                } catch (error) {
                    console.error('Error fetching stats:', error);
                }
            }

            updateStatus(status) {
                // Update WhatsApp status
                const whatsappIndicator = document.getElementById('whatsappIndicator');
                const whatsappInfo = document.getElementById('whatsappInfo');
                
                if (status.whatsapp) {
                    const connected = status.whatsapp.connected;
                    whatsappIndicator.className = `status-indicator ${connected ? 'connected' : 'disconnected'}`;
                    whatsappIndicator.querySelector('.text').textContent = connected ? 'Connesso' : 'Disconnesso';
                    whatsappInfo.textContent = connected ? 'WhatsApp Web attivo' : 'In attesa di connessione';
                    
                    if (status.whatsapp.qr && !connected) {
                        this.showQRCode(status.whatsapp.qr);
                    } else {
                        this.hideQRCode();
                    }
                }

                // Update Gmail status
                const gmailIndicator = document.getElementById('gmailIndicator');
                const gmailInfo = document.getElementById('gmailInfo');
                
                if (status.gmail) {
                    const connected = status.gmail.connected;
                    gmailIndicator.className = `status-indicator ${connected ? 'connected' : 'disconnected'}`;
                    gmailIndicator.querySelector('.text').textContent = connected ? 'Connesso' : 'Disconnesso';
                    gmailInfo.textContent = connected ? 'Gmail API attiva' : 'Configurazione richiesta';
                }

                // Update message stats
                if (status.messages) {
                    document.getElementById('messagesSent').textContent = status.messages.sent || 0;
                    document.getElementById('messagesFailed').textContent = status.messages.failed || 0;
                    
                    const total = (status.messages.sent || 0) + (status.messages.failed || 0);
                    const successRate = total > 0 ? Math.round((status.messages.sent / total) * 100) : 0;
                    document.getElementById('successRate').textContent = successRate + '%';
                }

                // Update uptime
                if (status.uptime) {
                    document.getElementById('uptime').querySelector('.value').textContent = 
                        this.formatUptime(status.uptime);
                }

                // Update version
                if (status.version) {
                    document.getElementById('appVersion').textContent = 'v' + status.version;
                }
            }

            updateConnectionStatus(connected) {
                const connectionStatus = document.getElementById('connectionStatus');
                connectionStatus.className = `connection-status ${connected ? 'connected' : 'disconnected'}`;
                connectionStatus.querySelector('.text').textContent = connected ? 'Connesso' : 'Disconnesso';
            }

            showQRCode(qr) {
                const qrSection = document.getElementById('qrSection');
                const qrCode = document.getElementById('qrCode');
                
                qrCode.innerHTML = `<img src="${qr}" alt="QR Code WhatsApp" class="max-w-full h-auto">`;
                qrSection.style.display = 'block';
            }

            hideQRCode() {
                const qrSection = document.getElementById('qrSection');
                qrSection.style.display = 'none';
            }

            async sendTestMessage() {
                const phone = document.getElementById('testPhone').value;
                const message = document.getElementById('testMessage').value;
                const submitBtn = document.querySelector('#testMessageForm button[type="submit"]');
                const btnText = document.getElementById('testBtnText');
                const spinner = document.getElementById('testSpinner');
                
                if (!phone || !message) {
                    this.showToast('Inserisci telefono e messaggio', 'warning');
                    return;
                }

                // Show loading state
                submitBtn.disabled = true;
                btnText.style.display = 'none';
                spinner.style.display = 'inline-block';
                
                try {
                    const response = await fetch('/api/send-message', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({ phone, message })
                    });
                    
                    const data = await response.json();
                    
                    if (data.success) {
                        this.showToast('Messaggio inviato con successo!', 'success');
                        document.getElementById('testMessageForm').reset();
                        this.fetchLogs(); // Refresh logs
                    } else {
                        this.showToast(data.error || 'Errore durante l\'invio', 'error');
                    }
                } catch (error) {
                    this.showToast('Errore di connessione', 'error');
                } finally {
                    // Reset button state
                    submitBtn.disabled = false;
                    btnText.style.display = 'inline';
                    spinner.style.display = 'none';
                }
            }

            async reconnectWhatsApp() {
                try {
                    const response = await fetch('/api/whatsapp/reconnect', {
                        method: 'POST'
                    });
                    
                    const data = await response.json();
                    
                    if (data.success) {
                        this.showToast('Riconnessione WhatsApp avviata', 'success');
                    } else {
                        this.showToast(data.error || 'Errore durante la riconnessione', 'error');
                    }
                } catch (error) {
                    this.showToast('Errore di connessione', 'error');
                }
            }

            async testGmail() {
                try {
                    const response = await fetch('/api/gmail/test', {
                        method: 'POST'
                    });
                    
                    const data = await response.json();
                    
                    if (data.success) {
                        this.showToast('Test Gmail completato con successo', 'success');
                    } else {
                        this.showToast(data.error || 'Errore durante il test Gmail', 'error');
                    }
                } catch (error) {
                    this.showToast('Errore di connessione', 'error');
                }
            }

            async checkUpdates() {
                const checkBtn = document.getElementById('checkUpdatesBtn');
                const originalText = checkBtn.textContent;
                
                checkBtn.disabled = true;
                checkBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i>Controllando...';
                
                try {
                    const response = await fetch('/api/updates/check', {
                        method: 'POST'
                    });
                    
                    const data = await response.json();
                    
                    if (data.success) {
                        this.updates = data.updates;
                        this.renderUpdates();
                        
                        if (data.updates.length > 0) {
                            this.showToast(`${data.updates.length} aggiornamenti disponibili`, 'info');
                        } else {
                            this.showToast('Nessun aggiornamento disponibile', 'success');
                        }
                    } else {
                        this.showToast(data.error || 'Errore durante il controllo', 'error');
                    }
                } catch (error) {
                    this.showToast('Errore di connessione', 'error');
                } finally {
                    checkBtn.disabled = false;
                    checkBtn.innerHTML = originalText;
                }
            }

            renderUpdates() {
                const updatesStatus = document.getElementById('updatesStatus');
                const updatesList = document.getElementById('updatesList');
                
                if (this.updates.length === 0) {
                    updatesStatus.innerHTML = '✅ Tutti i componenti sono aggiornati';
                    updatesList.style.display = 'none';
                    return;
                }
                
                updatesStatus.innerHTML = `
                    <div class="flex items-center">
                        📦 ${this.updates.length} aggiornamenti disponibili
                        <span class="ml-2 text-sm bg-blue-100 text-blue-800 px-2 py-1 rounded-full">
                            Nuovo
                        </span>
                    </div>
                `;
                
                updatesList.innerHTML = this.updates.map(update => `
                    <div class="update-item">
                        <div class="flex items-start justify-between">
                            <div class="flex-1">
                                <h4 class="font-medium">${update.name}</h4>
                                <div class="text-sm text-gray-600">
                                    ${update.currentVersion} → ${update.latestVersion}
                                    <span class="severity-${update.severity}">${update.severity}</span>
                                    ${update.security ? '🔒 Sicurezza' : ''}
                                </div>
                            </div>
                            <input type="checkbox" class="update-checkbox" value="${update.name}">
                        </div>
                        <p class="text-sm text-gray-600 mt-2">${update.description}</p>
                    </div>
                `).join('');
                
                updatesList.style.display = 'block';
                document.getElementById('updateActions').style.display = 'block';
                
                // Add event listeners
                document.getElementById('selectAllUpdates').addEventListener('click', () => {
                    document.querySelectorAll('.update-checkbox').forEach(cb => cb.checked = true);
                });
                
                document.getElementById('backupBeforeUpdate').addEventListener('click', () => {
                    this.applyUpdates();
                });
            }

            renderLogs() {
                const logsList = document.getElementById('logsList');
                
                if (this.logs.length === 0) {
                    logsList.innerHTML = '<div class="text-center text-gray-500 py-8">Nessun log disponibile</div>';
                    return;
                }
                
                logsList.innerHTML = this.logs.map(log => `
                    <div class="log-item">
                        <div class="flex items-center justify-between">
                            <div class="flex items-center space-x-2">
                                ${this.getLogTypeIcon(log.type)} 
                                <span class="font-medium">${log.type}</span>
                                <span class="status-badge status-${log.status}">${log.status}</span>
                            </div>
                            <span class="text-sm text-gray-500">${this.formatDate(log.created_at)}</span>
                        </div>
                        <div class="mt-2 text-sm">
                            <div class="grid grid-cols-2 gap-4">
                                <div><strong>Telefono:</strong> ${log.phone || 'N/A'}</div>
                                <div><strong>Messaggio:</strong> ${log.message ? log.message.substring(0, 50) + '...' : 'N/A'}</div>
                            </div>
                            ${log.error ? `<div class="mt-1 text-red-600">❌ ${log.error}</div>` : ''}
                        </div>
                    </div>
                `).join('');
            }

            getLogTypeIcon(type) {
                const icons = {
                    'email': '📧',
                    'manual': '👤',
                    'system': '⚙️',
                    'update': '🔄'
                };
                return icons[type] || '📋';
            }

            showSettingsModal() {
                const modal = document.getElementById('settingsModal');
                modal.style.display = 'flex';
                
                // Load current settings
                const notificationsEnabled = localStorage.getItem('notificationsEnabled') !== 'false';
                const autoRefreshEnabled = localStorage.getItem('autoRefreshEnabled') !== 'false';
                
                document.getElementById('notificationsEnabled').checked = notificationsEnabled;
                document.getElementById('autoRefreshEnabled').checked = autoRefreshEnabled;
            }

            toggleNotifications(enabled) {
                localStorage.setItem('notificationsEnabled', enabled);
                
                if (enabled && 'Notification' in window) {
                    Notification.requestPermission();
                }
                
                this.showToast(`Notifiche ${enabled ? 'attivate' : 'disattivate'}`, 'info');
            }

            toggleAutoRefresh(enabled) {
                localStorage.setItem('autoRefreshEnabled', enabled);
                this.autoRefresh = enabled;
                
                if (enabled) {
                    this.startAutoRefresh();
                } else {
                    this.stopAutoRefresh();
                }
                
                this.showToast(`Aggiornamento automatico ${enabled ? 'attivato' : 'disattivato'}`, 'info');
            }

            startAutoRefresh() {
                if (this.autoRefresh) {
                    this.refreshInterval = setInterval(() => {
                        this.refreshData();
                    }, 30000);
                }
            }

            stopAutoRefresh() {
                if (this.refreshInterval) {
                    clearInterval(this.refreshInterval);
                }
            }

            async refreshData() {
                try {
                    await Promise.all([
                        this.fetchStatus(),
                        this.fetchLogs(),
                        this.fetchStats()
                    ]);
                    
                    this.showToast('Dati aggiornati', 'success');
                } catch (error) {
                    this.showToast('Errore durante l\'aggiornamento', 'error');
                }
            }

            async logout() {
                try {
                    const response = await fetch('/api/auth/logout', {
                        method: 'POST'
                    });
                    
                    const data = await response.json();
                    
                    if (data.success) {
                        this.showToast('Logout effettuato con successo', 'success');
                        setTimeout(() => {
                            window.location.href = '/login.html';
                        }, 1000);
                    } else {
                        this.showToast(data.error || 'Errore durante il logout', 'error');
                    }
                } catch (error) {
                    this.showToast('Errore di connessione', 'error');
                }
            }

            showToast(message, type = 'info') {
                const toastContainer = document.getElementById('toastContainer');
                const toast = document.createElement('div');
                toast.className = `toast toast-${type}`;
                
                const icons = {
                    'success': '✅',
                    'error': '❌',
                    'warning': '⚠️',
                    'info': 'ℹ️'
                };
                
                toast.innerHTML = `
                    ${icons[type] || 'ℹ️'}
                    <div class="flex-1">
                        ${message}
                    </div>
                    <button class="toast-close text-gray-400 hover:text-gray-600">
                        <i class="fas fa-times"></i>
                    </button>
                `;
                
                toastContainer.appendChild(toast);
                
                // Auto remove after 5 seconds
                setTimeout(() => {
                    toast.remove();
                }, 5000);
                
                // Manual close
                toast.querySelector('.toast-close').addEventListener('click', () => {
                    toast.remove();
                });

                // Show notification if enabled
                if (localStorage.getItem('notificationsEnabled') !== 'false' && 
                    'Notification' in window && 
                    Notification.permission === 'granted') {
                    new Notification('WAPower', {
                        body: message,
                        icon: '/manifest.json',
                        tag: 'wapower-notification'
                    });
                }
            }

            formatDate(timestamp) {
                return new Date(timestamp).toLocaleString('it-IT', {
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                });
            }

            formatUptime(seconds) {
                const days = Math.floor(seconds / 86400);
                const hours = Math.floor((seconds % 86400) / 3600);
                const minutes = Math.floor((seconds % 3600) / 60);
                
                if (days > 0) {
                    return `${days}d ${hours}h ${minutes}m`;
                } else if (hours > 0) {
                    return `${hours}h ${minutes}m`;
                } else {
                    return `${minutes}m`;
                }
            }

            updateChart(stats) {
                if (!this.chart || !stats) return;
                
                const labels = stats.daily?.map(d => d.date) || [];
                const sentData = stats.daily?.map(d => d.sent) || [];
                const failedData = stats.daily?.map(d => d.failed) || [];
                
                this.chart.data.labels = labels;
                this.chart.data.datasets[0].data = sentData;
                this.chart.data.datasets[1].data = failedData;
                this.chart.update();
            }

            // Additional methods would be here for export logs, clear logs, etc.
        }

        // Initialize dashboard when DOM is loaded
        document.addEventListener('DOMContentLoaded', () => {
            window.dashboard = new WAPowerDashboard();
        });

        // Handle page visibility changes
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                // Page is hidden, reduce update frequency
                if (window.dashboard) {
                    window.dashboard.stopAutoRefresh();
                }
            } else {
                // Page is visible, resume normal operation
                if (window.dashboard && window.dashboard.autoRefresh) {
                    window.dashboard.startAutoRefresh();
                    window.dashboard.refreshData();
                }
            }
        });

        // Handle offline/online events
        window.addEventListener('online', () => {
            if (window.dashboard) {
                window.dashboard.showToast('Connessione ripristinata', 'success');
                window.dashboard.refreshData();
            }
        });

        window.addEventListener('offline', () => {
            if (window.dashboard) {
                window.dashboard.showToast('Connessione persa', 'warning');
            }
        });
    </script>
</body>
</html>
    <script id="html_badge_script1">
        window.__genspark_remove_badge_link = "https://www.genspark.ai/api/html_badge/" +
            "remove_badge?token=To%2FBnjzloZ3UfQdcSaYfDozF248MhEbELBpt7YtSkcJzLOKLRk8R8gIE%2BK7Bxa6X7DyWcbd4%2FZueJEbgd4H75yd5GtjfWLfjko%2B2P1d1lt9mCUSMeJhNW4ojBZKlCxbLEyR%2FNcz7vVFABMJbKHSYey%2BYITlaQKKxHSjBe1dJ58bzDz84aje8FwbGsxdsbnrr3bUo%2BYWk7%2B8By3lCUhr%2B2ZA10sm0sZexaA8AnjwRs2aOAD21NBBWvmF8rCelQKGeTJsmUF%2FL2Xnqtj94AIAGb%2FNEUHePwz2sfjYVlmMBs5h%2FDEOiyu4FdEHsXli1jrG7B287Z%2B%2FpV4a0NBxzr59CaYOzPXC7kdbfSwaWnlx%2FkXrSVuZq%2BBlU0zX8U01n71rul2%2BBs60wGHFy8mckA%2BxaHhJwdiuXWRkmHWuPbL67dEspMl0KSgjiV3f1jVnOaoTTwN8MJZ%2Bm2ggoFQNu4FmC%2F8h5xPgkML0NjcbIL3%2FJpSb36Ro%2FTwUSSNUuCb1oYW0uaDtZ%2F8lrX9xGoELeNZD%2FHw%3D%3D";
        window.__genspark_locale = "it-IT";
        window.__genspark_token = "To/BnjzloZ3UfQdcSaYfDozF248MhEbELBpt7YtSkcJzLOKLRk8R8gIE+K7Bxa6X7DyWcbd4/ZueJEbgd4H75yd5GtjfWLfjko+2P1d1lt9mCUSMeJhNW4ojBZKlCxbLEyR/Ncz7vVFABMJbKHSYey+YITlaQKKxHSjBe1dJ58bzDz84aje8FwbGsxdsbnrr3bUo+YWk7+8By3lCUhr+2ZA10sm0sZexaA8AnjwRs2aOAD21NBBWvmF8rCelQKGeTJsmUF/L2Xnqtj94AIAGb/NEUHePwz2sfjYVlmMBs5h/DEOiyu4FdEHsXli1jrG7B287Z+/pV4a0NBxzr59CaYOzPXC7kdbfSwaWnlx/kXrSVuZq+BlU0zX8U01n71rul2+Bs60wGHFy8mckA+xaHhJwdiuXWRkmHWuPbL67dEspMl0KSgjiV3f1jVnOaoTTwN8MJZ+m2ggoFQNu4FmC/8h5xPgkML0NjcbIL3/JpSb36Ro/TwUSSNUuCb1oYW0uaDtZ/8lrX9xGoELeNZD/Hw==";
    </script>
    
    <script id="html_notice_dialog_script" src="https://www.genspark.ai/notice_dialog.js"></script>
    