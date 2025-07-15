<?php
/**
 * Plugin Name: WAPower Integration Pro
 * Plugin URI: https://wapower.it
 * Description: Integrazione completa WAPower per WordPress con shortcode, widget e automazioni
 * Version: 1.0.0
 * Author: Alby - WAPower Team
 * Author URI: https://wapower.it
 * License: MIT
 * Text Domain: wapower-integration
 * Domain Path: /languages
 * Requires at least: 5.0
 * Tested up to: 6.4
 * Requires PHP: 7.4
 */

// Prevent direct access
if (!defined('ABSPATH')) {
    exit;
}

// Plugin constants
define('WAPOWER_PLUGIN_VERSION', '1.0.0');
define('WAPOWER_PLUGIN_PATH', plugin_dir_path(__FILE__));
define('WAPOWER_PLUGIN_URL', plugin_dir_url(__FILE__));

/**
 * Main WAPower Integration Class
 */
class WAPower_Integration {
    
    private $api_url;
    private $api_key;
    
    public function __construct() {
        $this->loadSettings();
        $this->initHooks();
        $this->initShortcodes();
        $this->initWidgets();
        $this->initRestAPI();
        $this->initWooCommerce();
        $this->initContactForm7();
        $this->initElementor();
        $this->initGravityForms();
        
        // Admin
        if (is_admin()) {
            $this->initAdmin();
        }
    }
    
    private function loadSettings() {
        $this->api_url = get_option('wapower_api_url', '');
        $this->api_key = get_option('wapower_api_key', '');
    }
    
    private function initHooks() {
        add_action('wp_enqueue_scripts', array($this, 'enqueueScripts'));
        add_action('admin_enqueue_scripts', array($this, 'enqueueAdminScripts'));
        add_action('init', array($this, 'initRewriteRules'));
        add_action('wp_ajax_wapower_send_message', array($this, 'ajaxSendMessage'));
        add_action('wp_ajax_nopriv_wapower_send_message', array($this, 'ajaxSendMessage'));
        add_action('wp_ajax_wapower_get_stats', array($this, 'ajaxGetStats'));
        
        // Cron jobs
        add_action('wapower_cleanup_logs', array($this, 'cleanupLogs'));
        add_action('wapower_update_stats', array($this, 'updateStats'));
        
        // Webhook handler
        add_action('init', array($this, 'handleWebhook'));
    }
    
    private function initShortcodes() {
        add_shortcode('wapower_form', array($this, 'shortcodeForm'));
        add_shortcode('wapower_button', array($this, 'shortcodeButton'));
        add_shortcode('wapower_floating', array($this, 'shortcodeFloating'));
        add_shortcode('wapower_stats', array($this, 'shortcodeStats'));
    }
    
    private function initWidgets() {
        add_action('widgets_init', function() {
            register_widget('WAPower_Contact_Widget');
            register_widget('WAPower_Stats_Widget');
            register_widget('WAPower_Button_Widget');
        });
    }
    
    private function initRestAPI() {
        add_action('rest_api_init', array($this, 'registerRestRoutes'));
    }
    
    private function initWooCommerce() {
        if (class_exists('WooCommerce')) {
            add_action('woocommerce_new_order', array($this, 'wooNewOrder'));
            add_action('woocommerce_order_status_changed', array($this, 'wooOrderStatusChanged'), 10, 3);
            add_action('woocommerce_low_stock_notification', array($this, 'wooLowStock'));
        }
    }
    
    private function initContactForm7() {
        if (class_exists('WPCF7')) {
            add_action('wpcf7_mail_sent', array($this, 'cf7MailSent'));
        }
    }
    
    private function initElementor() {
        if (defined('ELEMENTOR_VERSION')) {
            add_action('elementor/widgets/widgets_registered', array($this, 'registerElementorWidgets'));
        }
    }
    
    private function initGravityForms() {
        if (class_exists('GFForms')) {
            add_action('gform_after_submission', array($this, 'gravityFormSubmission'), 10, 2);
        }
    }
    
    private function initAdmin() {
        add_action('admin_menu', array($this, 'adminMenu'));
        add_action('admin_init', array($this, 'adminInit'));
        add_action('admin_notices', array($this, 'adminNotices'));
    }
    
    public function enqueueScripts() {
        wp_enqueue_script('wapower-frontend', WAPOWER_PLUGIN_URL . 'assets/js/frontend.js', array('jquery'), WAPOWER_PLUGIN_VERSION, true);
        wp_enqueue_style('wapower-frontend', WAPOWER_PLUGIN_URL . 'assets/css/frontend.css', array(), WAPOWER_PLUGIN_VERSION);
        
        // Localize script
        wp_localize_script('wapower-frontend', 'wapower_ajax', array(
            'ajax_url' => admin_url('admin-ajax.php'),
            'nonce' => wp_create_nonce('wapower_nonce'),
            'messages' => array(
                'sending' => __('Invio in corso...', 'wapower-integration'),
                'success' => __('Messaggio inviato con successo!', 'wapower-integration'),
                'error' => __('Errore nell\'invio del messaggio.', 'wapower-integration'),
            )
        ));
    }
    
    public function enqueueAdminScripts($hook) {
        if (strpos($hook, 'wapower') !== false) {
            wp_enqueue_script('wapower-admin', WAPOWER_PLUGIN_URL . 'assets/js/admin.js', array('jquery'), WAPOWER_PLUGIN_VERSION, true);
            wp_enqueue_style('wapower-admin', WAPOWER_PLUGIN_URL . 'assets/css/admin.css', array(), WAPOWER_PLUGIN_VERSION);
            
            wp_localize_script('wapower-admin', 'wapower_admin', array(
                'ajax_url' => admin_url('admin-ajax.php'),
                'nonce' => wp_create_nonce('wapower_admin_nonce'),
            ));
        }
    }
    
    public function initRewriteRules() {
        add_rewrite_rule('^wapower-webhook/?$', 'index.php?wapower_webhook=1', 'top');
        add_rewrite_tag('%wapower_webhook%', '([^&]+)');
    }
    
    // Shortcode: Form di contatto
    public function shortcodeForm($atts) {
        $atts = shortcode_atts(array(
            'title' => __('Invia messaggio WhatsApp', 'wapower-integration'),
            'phone_label' => __('Numero di telefono', 'wapower-integration'),
            'message_label' => __('Messaggio', 'wapower-integration'),
            'button_text' => __('Invia', 'wapower-integration'),
            'phone_placeholder' => __('Inserisci il tuo numero...', 'wapower-integration'),
            'message_placeholder' => __('Scrivi il tuo messaggio...', 'wapower-integration'),
            'show_phone' => 'true',
            'required_phone' => 'true',
            'max_length' => '4000',
            'success_message' => __('Messaggio inviato con successo!', 'wapower-integration'),
            'error_message' => __('Errore nell\'invio del messaggio.', 'wapower-integration'),
        ), $atts);
        
        ob_start();
        ?>
        <div class="wapower-form-container">
            <h3><?php echo esc_html($atts['title']); ?></h3>
            <form class="wapower-contact-form" data-success="<?php echo esc_attr($atts['success_message']); ?>" data-error="<?php echo esc_attr($atts['error_message']); ?>">
                <?php if ($atts['show_phone'] === 'true'): ?>
                <div class="wapower-field">
                    <label for="wapower-phone"><?php echo esc_html($atts['phone_label']); ?><?php echo $atts['required_phone'] === 'true' ? ' *' : ''; ?></label>
                    <input type="tel" id="wapower-phone" name="phone" placeholder="<?php echo esc_attr($atts['phone_placeholder']); ?>" <?php echo $atts['required_phone'] === 'true' ? 'required' : ''; ?>>
                </div>
                <?php endif; ?>
                
                <div class="wapower-field">
                    <label for="wapower-message"><?php echo esc_html($atts['message_label']); ?> *</label>
                    <textarea id="wapower-message" name="message" placeholder="<?php echo esc_attr($atts['message_placeholder']); ?>" maxlength="<?php echo esc_attr($atts['max_length']); ?>" required></textarea>
                </div>
                
                <div class="wapower-field">
                    <button type="submit" class="wapower-submit-btn"><?php echo esc_html($atts['button_text']); ?></button>
                </div>
                
                <div class="wapower-response" style="display: none;"></div>
            </form>
        </div>
        <?php
        return ob_get_clean();
    }
    
    // Shortcode: Pulsante WhatsApp
    public function shortcodeButton($atts) {
        $atts = shortcode_atts(array(
            'phone' => '',
            'message' => '',
            'text' => __('Contattaci su WhatsApp', 'wapower-integration'),
            'style' => 'default',
            'size' => 'medium',
            'target' => '_blank',
        ), $atts);
        
        $phone = $atts['phone'];
        $message = urlencode($atts['message']);
        $url = "https://wa.me/{$phone}?text={$message}";
        
        $classes = array(
            'wapower-button',
            'wapower-button-' . $atts['style'],
            'wapower-button-' . $atts['size']
        );
        
        return sprintf(
            '<a href="%s" class="%s" target="%s">%s</a>',
            esc_url($url),
            esc_attr(implode(' ', $classes)),
            esc_attr($atts['target']),
            esc_html($atts['text'])
        );
    }
    
    // Shortcode: Pulsante floating
    public function shortcodeFloating($atts) {
        $atts = shortcode_atts(array(
            'phone' => '',
            'message' => '',
            'position' => 'bottom-right',
            'size' => '60px',
            'color' => '#25D366',
            'text' => __('Contattaci!', 'wapower-integration'),
            'show_text' => 'true',
        ), $atts);
        
        $phone = $atts['phone'];
        $message = urlencode($atts['message']);
        $url = "https://wa.me/{$phone}?text={$message}";
        
        $styles = array(
            'width: ' . $atts['size'],
            'height: ' . $atts['size'],
            'background-color: ' . $atts['color'],
        );
        
        $position_styles = array();
        switch ($atts['position']) {
            case 'bottom-right':
                $position_styles = array('bottom: 20px', 'right: 20px');
                break;
            case 'bottom-left':
                $position_styles = array('bottom: 20px', 'left: 20px');
                break;
            case 'top-right':
                $position_styles = array('top: 20px', 'right: 20px');
                break;
            case 'top-left':
                $position_styles = array('top: 20px', 'left: 20px');
                break;
        }
        
        $all_styles = array_merge($styles, $position_styles);
        
        ob_start();
        ?>
        <div class="wapower-floating-container">
            <a href="<?php echo esc_url($url); ?>" 
               class="wapower-floating-button" 
               style="<?php echo esc_attr(implode('; ', $all_styles)); ?>" 
               target="_blank">
                <i class="fab fa-whatsapp"></i>
                <?php if ($atts['show_text'] === 'true'): ?>
                    <span class="wapower-floating-text"><?php echo esc_html($atts['text']); ?></span>
                <?php endif; ?>
            </a>
        </div>
        <?php
        return ob_get_clean();
    }
    
    // Shortcode: Statistiche
    public function shortcodeStats($atts) {
        $atts = shortcode_atts(array(
            'range' => 'today',
            'show_sent' => 'true',
            'show_failed' => 'true',
            'show_success_rate' => 'true',
            'title' => __('Statistiche Messaggi', 'wapower-integration'),
        ), $atts);
        
        $stats = $this->getStats($atts['range']);
        
        ob_start();
        ?>
        <div class="wapower-stats-container">
            <h3><?php echo esc_html($atts['title']); ?></h3>
            <div class="wapower-stats-grid">
                <?php if ($atts['show_sent'] === 'true'): ?>
                    <div class="wapower-stat-item sent">
                        <span class="value"><?php echo number_format($stats['sent']); ?></span>
                        <span class="label"><?php _e('Inviati', 'wapower-integration'); ?></span>
                    </div>
                <?php endif; ?>
                
                <?php if ($atts['show_failed'] === 'true'): ?>
                    <div class="wapower-stat-item failed">
                        <span class="value"><?php echo number_format($stats['failed']); ?></span>
                        <span class="label"><?php _e('Falliti', 'wapower-integration'); ?></span>
                    </div>
                <?php endif; ?>
                
                <?php if ($atts['show_success_rate'] === 'true'): ?>
                    <div class="wapower-stat-item rate">
                        <span class="value"><?php echo $stats['success_rate']; ?>%</span>
                        <span class="label"><?php _e('Successo', 'wapower-integration'); ?></span>
                    </div>
                <?php endif; ?>
            </div>
        </div>
        <?php
        return ob_get_clean();
    }
    
    // AJAX: Invia messaggio
    public function ajaxSendMessage() {
        check_ajax_referer('wapower_nonce', 'nonce');
        
        $phone = sanitize_text_field($_POST['phone']);
        $message = sanitize_textarea_field($_POST['message']);
        
        if (empty($phone) || empty($message)) {
            wp_send_json_error(array('message' => __('Messaggio obbligatorio', 'wapower-integration')));
        }
        
        $result = $this->sendMessage($phone, $message);
        
        if ($result['success']) {
            wp_send_json_success(array('message' => __('Messaggio inviato con successo!', 'wapower-integration')));
        } else {
            wp_send_json_error(array('message' => $result['error']));
        }
    }
    
    // AJAX: Ottieni statistiche
    public function ajaxGetStats() {
        check_ajax_referer('wapower_admin_nonce', 'nonce');
        
        $range = sanitize_text_field($_POST['range']);
        $stats = $this->getStats($range);
        
        wp_send_json_success($stats);
    }
    
    // API: Invia messaggio
    private function sendMessage($phone, $message, $priority = 'normal') {
        if (empty($this->api_url) || empty($this->api_key)) {
            return array('success' => false, 'error' => __('Configurazione API non valida', 'wapower-integration'));
        }
        
        $body = array(
            'phone' => $phone,
            'message' => $message,
            'priority' => $priority,
        );
        
        $response = wp_remote_post($this->api_url . '/api/v1/messages', array(
            'headers' => array(
                'Authorization' => 'Bearer ' . $this->api_key,
                'Content-Type' => 'application/json',
            ),
            'body' => json_encode($body),
            'timeout' => 30,
        ));
        
        if (is_wp_error($response)) {
            return array('success' => false, 'error' => $response->get_error_message());
        }
        
        $response_code = wp_remote_retrieve_response_code($response);
        $response_body = wp_remote_retrieve_body($response);
        $data = json_decode($response_body, true);
        
        if ($response_code === 200 && $data['success']) {
            // Log successo
            $this->logMessage($phone, $message, 'sent');
            return array('success' => true, 'data' => $data);
        } else {
            // Log errore
            $error = $data['error'] ?? __('Errore sconosciuto', 'wapower-integration');
            $this->logMessage($phone, $message, 'failed', $error);
            return array('success' => false, 'error' => $error);
        }
    }
    
    // Ottieni statistiche
    private function getStats($range = 'today') {
        global $wpdb;
        
        $table_name = $wpdb->prefix . 'wapower_messages';
        
        switch ($range) {
            case 'today':
                $where = "DATE(created_at) = CURDATE()";
                break;
            case 'yesterday':
                $where = "DATE(created_at) = CURDATE() - INTERVAL 1 DAY";
                break;
            case 'week':
                $where = "created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)";
                break;
            case 'month':
                $where = "created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)";
                break;
            default:
                $where = "1=1";
        }
        
        $sent = $wpdb->get_var("SELECT COUNT(*) FROM {$table_name} WHERE {$where} AND status = 'sent'");
        $failed = $wpdb->get_var("SELECT COUNT(*) FROM {$table_name} WHERE {$where} AND status = 'failed'");
        $total = $sent + $failed;
        
        $success_rate = $total > 0 ? round(($sent / $total) * 100, 2) : 0;
        
        return array(
            'sent' => (int)$sent,
            'failed' => (int)$failed,
            'total' => (int)$total,
            'success_rate' => $success_rate,
        );
    }
    
    // Log messaggio
    private function logMessage($phone, $message, $status, $error = null) {
        global $wpdb;
        
        $table_name = $wpdb->prefix . 'wapower_messages';
        
        $wpdb->insert(
            $table_name,
            array(
                'phone' => $phone,
                'message' => $message,
                'status' => $status,
                'error' => $error,
                'created_at' => current_time('mysql'),
            ),
            array('%s', '%s', '%s', '%s', '%s')
        );
    }
    
    // Registra route REST API
    public function registerRestRoutes() {
        register_rest_route('wapower/v1', '/send', array(
            'methods' => 'POST',
            'callback' => array($this, 'restSendMessage'),
            'permission_callback' => array($this, 'restPermissionCheck'),
        ));
        
        register_rest_route('wapower/v1', '/webhook', array(
            'methods' => 'POST',
            'callback' => array($this, 'restWebhookHandler'),
            'permission_callback' => '__return_true',
        ));
        
        register_rest_route('wapower/v1', '/stats', array(
            'methods' => 'GET',
            'callback' => array($this, 'restGetStats'),
            'permission_callback' => array($this, 'restPermissionCheck'),
        ));
        
        register_rest_route('wapower/v1', '/status', array(
            'methods' => 'GET',
            'callback' => array($this, 'restGetStatus'),
            'permission_callback' => '__return_true',
        ));
    }
    
    public function restSendMessage($request) {
        $phone = $request->get_param('phone');
        $message = $request->get_param('message');
        $priority = $request->get_param('priority') ?: 'normal';
        
        if (empty($phone) || empty($message)) {
            return new WP_Error('missing_params', __('Telefono e messaggio sono obbligatori', 'wapower-integration'), array('status' => 400));
        }
        
        $result = $this->sendMessage($phone, $message, $priority);
        
        if ($result['success']) {
            return new WP_REST_Response(array(
                'success' => true,
                'message' => __('Messaggio inviato con successo', 'wapower-integration'),
                'data' => $result['data'],
            ), 200);
        } else {
            return new WP_Error('send_failed', $result['error'], array('status' => 500));
        }
    }
    
    public function restWebhookHandler($request) {
        $body = $request->get_body();
        $data = json_decode($body, true);
        
        if (!$data) {
            return new WP_Error('invalid_json', __('JSON non valido', 'wapower-integration'), array('status' => 400));
        }
        
        // Verifica firma HMAC se configurata
        $webhook_secret = get_option('wapower_webhook_secret');
        if (!empty($webhook_secret)) {
            $signature = $request->get_header('X-WAPower-Signature');
            $expected_signature = 'sha256=' . hash_hmac('sha256', $body, $webhook_secret);
            
            if (!hash_equals($signature, $expected_signature)) {
                return new WP_Error('invalid_signature', __('Firma non valida', 'wapower-integration'), array('status' => 401));
            }
        }
        
        // Processa evento
        $event = $data['event'] ?? '';
        $payload = $data['data'] ?? array();
        
        switch ($event) {
            case 'message_sent':
                do_action('wapower_message_sent', $payload);
                break;
            case 'message_failed':
                do_action('wapower_message_failed', $payload);
                break;
            case 'whatsapp_ready':
                do_action('wapower_whatsapp_ready', $payload);
                break;
            case 'whatsapp_disconnected':
                do_action('wapower_whatsapp_disconnected', $payload);
                break;
            case 'email_processed':
                do_action('wapower_email_processed', $payload);
                break;
        }
        
        return new WP_REST_Response(array('success' => true), 200);
    }
    
    public function restGetStats($request) {
        $range = $request->get_param('range') ?: 'today';
        $stats = $this->getStats($range);
        
        return new WP_REST_Response(array(
            'success' => true,
            'data' => $stats,
        ), 200);
    }
    
    public function restGetStatus($request) {
        return new WP_REST_Response(array(
            'success' => true,
            'version' => WAPOWER_PLUGIN_VERSION,
            'status' => 'active',
        ), 200);
    }
    
    public function restPermissionCheck($request) {
        return current_user_can('manage_options');
    }
    
    // Integrazione WooCommerce
    public function wooNewOrder($order_id) {
        $order = wc_get_order($order_id);
        $phone = $order->get_billing_phone();
        
        if (empty($phone)) return;
        
        $message = sprintf(
            __('Ciao %s! Grazie per il tuo ordine #%s. Ti terremo aggiornato sullo stato.', 'wapower-integration'),
            $order->get_billing_first_name(),
            $order->get_order_number()
        );
        
        $this->sendMessage($phone, $message);
    }
    
    public function wooOrderStatusChanged($order_id, $old_status, $new_status) {
        $order = wc_get_order($order_id);
        $phone = $order->get_billing_phone();
        
        if (empty($phone)) return;
        
        $status_messages = array(
            'processing' => __('Il tuo ordine #%s è in elaborazione.', 'wapower-integration'),
            'shipped' => __('Il tuo ordine #%s è stato spedito!', 'wapower-integration'),
            'completed' => __('Il tuo ordine #%s è stato completato. Grazie!', 'wapower-integration'),
            'cancelled' => __('Il tuo ordine #%s è stato annullato.', 'wapower-integration'),
        );
        
        if (isset($status_messages[$new_status])) {
            $message = sprintf($status_messages[$new_status], $order->get_order_number());
            $this->sendMessage($phone, $message);
        }
    }
    
    // Integrazione Contact Form 7
    public function cf7MailSent($contact_form) {
        $submission = WPCF7_Submission::get_instance();
        $posted_data = $submission->get_posted_data();
        
        $phone = $posted_data['your-phone'] ?? '';
        $message = $posted_data['your-message'] ?? '';
        
        if (!empty($phone) && !empty($message)) {
            $this->sendMessage($phone, $message);
        }
    }
    
    // Integrazione Gravity Forms
    public function gravityFormSubmission($entry, $form) {
        $phone = rgar($entry, '3'); // Assumendo che il campo telefono sia ID 3
        $message = rgar($entry, '4'); // Assumendo che il campo messaggio sia ID 4
        
        if (!empty($phone) && !empty($message)) {
            $this->sendMessage($phone, $message);
        }
    }
    
    // Cleanup logs
    public function cleanupLogs() {
        global $wpdb;
        
        $table_name = $wpdb->prefix . 'wapower_messages';
        $retention_days = get_option('wapower_log_retention_days', 90);
        
        $wpdb->query($wpdb->prepare(
            "DELETE FROM {$table_name} WHERE created_at < DATE_SUB(NOW(), INTERVAL %d DAY)",
            $retention_days
        ));
    }
    
    // Admin menu
    public function adminMenu() {
        add_menu_page(
            __('WAPower', 'wapower-integration'),
            __('WAPower', 'wapower-integration'),
            'manage_options',
            'wapower',
            array($this, 'adminPageMain'),
            'dashicons-whatsapp',
            30
        );
        
        add_submenu_page(
            'wapower',
            __('Impostazioni', 'wapower-integration'),
            __('Impostazioni', 'wapower-integration'),
            'manage_options',
            'wapower-settings',
            array($this, 'adminPageSettings')
        );
        
        add_submenu_page(
            'wapower',
            __('Statistiche', 'wapower-integration'),
            __('Statistiche', 'wapower-integration'),
            'manage_options',
            'wapower-stats',
            array($this, 'adminPageStats')
        );
        
        add_submenu_page(
            'wapower',
            __('Log', 'wapower-integration'),
            __('Log', 'wapower-integration'),
            'manage_options',
            'wapower-logs',
            array($this, 'adminPageLogs')
        );
    }
    
    public function adminPageMain() {
        include WAPOWER_PLUGIN_PATH . 'admin/main.php';
    }
    
    public function adminPageSettings() {
        include WAPOWER_PLUGIN_PATH . 'admin/settings.php';
    }
    
    public function adminPageStats() {
        include WAPOWER_PLUGIN_PATH . 'admin/stats.php';
    }
    
    public function adminPageLogs() {
        include WAPOWER_PLUGIN_PATH . 'admin/logs.php';
    }
    
    // Admin init
    public function adminInit() {
        register_setting('wapower_settings', 'wapower_api_url');
        register_setting('wapower_settings', 'wapower_api_key');
        register_setting('wapower_settings', 'wapower_webhook_secret');
        register_setting('wapower_settings', 'wapower_log_retention_days');
        register_setting('wapower_settings', 'wapower_auto_woo_notifications');
        register_setting('wapower_settings', 'wapower_auto_cf7_notifications');
    }
    
    // Admin notices
    public function adminNotices() {
        if (empty($this->api_url) || empty($this->api_key)) {
            ?>
            <div class="notice notice-warning is-dismissible">
                <p><?php _e('WAPower: Configura URL API e chiave API nelle impostazioni.', 'wapower-integration'); ?></p>
            </div>
            <?php
        }
    }
}

/**
 * Widget: Contatto WAPower
 */
class WAPower_Contact_Widget extends WP_Widget {
    
    public function __construct() {
        parent::__construct(
            'wapower_contact',
            __('WAPower Contatto', 'wapower-integration'),
            array('description' => __('Widget per form di contatto WAPower', 'wapower-integration'))
        );
    }
    
    public function widget($args, $instance) {
        echo $args['before_widget'];
        
        if (!empty($instance['title'])) {
            echo $args['before_title'] . apply_filters('widget_title', $instance['title']) . $args['after_title'];
        }
        
        // Usa shortcode form
        echo do_shortcode('[wapower_form]');
        
        echo $args['after_widget'];
    }
    
    public function form($instance) {
        $title = !empty($instance['title']) ? $instance['title'] : __('Contattaci', 'wapower-integration');
        ?>
        <p>
            <label for="<?php echo esc_attr($this->get_field_id('title')); ?>"><?php _e('Titolo:', 'wapower-integration'); ?></label>
            <input class="widefat" id="<?php echo esc_attr($this->get_field_id('title')); ?>" 
                   name="<?php echo esc_attr($this->get_field_name('title')); ?>" 
                   type="text" value="<?php echo esc_attr($title); ?>">
        </p>
        <?php
    }
    
    public function update($new_instance, $old_instance) {
        $instance = array();
        $instance['title'] = (!empty($new_instance['title'])) ? sanitize_text_field($new_instance['title']) : '';
        return $instance;
    }
}

/**
 * Activation Hook
 */
register_activation_hook(__FILE__, 'wapower_activate');
function wapower_activate() {
    global $wpdb;
    
    $table_name = $wpdb->prefix . 'wapower_messages';
    
    $charset_collate = $wpdb->get_charset_collate();
    
    $sql = "CREATE TABLE $table_name (
        id mediumint(9) NOT NULL AUTO_INCREMENT,
        phone varchar(20) NOT NULL,
        message text NOT NULL,
        status varchar(20) DEFAULT 'pending',
        error text,
        source varchar(50) DEFAULT 'manual',
        created_at datetime DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY phone (phone),
        KEY status (status),
        KEY created_at (created_at)
    ) $charset_collate;";
    
    require_once(ABSPATH . 'wp-admin/includes/upgrade.php');
    dbDelta($sql);
    
    // Imposta opzioni predefinite
    add_option('wapower_log_retention_days', 90);
    add_option('wapower_auto_woo_notifications', true);
    add_option('wapower_auto_cf7_notifications', false);
    
    // Schedula cleanup
    if (!wp_next_scheduled('wapower_cleanup_logs')) {
        wp_schedule_event(time(), 'daily', 'wapower_cleanup_logs');
    }
}

/**
 * Deactivation Hook
 */
register_deactivation_hook(__FILE__, 'wapower_deactivate');
function wapower_deactivate() {
    wp_clear_scheduled_hook('wapower_cleanup_logs');
    wp_clear_scheduled_hook('wapower_update_stats');
}

/**
 * Uninstall Hook
 */
register_uninstall_hook(__FILE__, 'wapower_uninstall');
function wapower_uninstall() {
    global $wpdb;
    
    // Rimuovi tabelle
    $wpdb->query("DROP TABLE IF EXISTS {$wpdb->prefix}wapower_messages");
    
    // Rimuovi opzioni
    delete_option('wapower_api_url');
    delete_option('wapower_api_key');
    delete_option('wapower_webhook_secret');
    delete_option('wapower_log_retention_days');
    delete_option('wapower_auto_woo_notifications');
    delete_option('wapower_auto_cf7_notifications');
}

// Inizializza plugin
add_action('plugins_loaded', function() {
    new WAPower_Integration();
});

// Load textdomain
add_action('init', function() {
    load_plugin_textdomain('wapower-integration', false, dirname(plugin_basename(__FILE__)) . '/languages');
});
?>