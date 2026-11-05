CREATE TABLE IF NOT EXISTS organizations (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, name VARCHAR(180) NOT NULL,
 address TEXT, phone VARCHAR(50), slogan VARCHAR(255), email VARCHAR(190),
 slug VARCHAR(100) NOT NULL UNIQUE, status ENUM('active','suspended','closed') NOT NULL DEFAULT 'active',
 created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS users (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, organization_id BIGINT UNSIGNED NOT NULL,
 full_name VARCHAR(180) NOT NULL, email VARCHAR(190) NOT NULL, password_hash VARCHAR(255) NOT NULL,
 role ENUM('OWNER','ADMIN','PHARMACIST','STOREKEEPER','CASHIER','VIEWER','SUPER_ADMIN') NOT NULL DEFAULT 'VIEWER',
 is_active BOOLEAN NOT NULL DEFAULT TRUE, password_version INT UNSIGNED NOT NULL DEFAULT 0, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 UNIQUE KEY uq_user_tenant_email(organization_id,email), KEY idx_users_role_active(role,is_active),
 FOREIGN KEY(organization_id) REFERENCES organizations(id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS account_email_claims (
 email VARCHAR(190) PRIMARY KEY, user_id BIGINT UNSIGNED NULL UNIQUE,
 FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS organization_settings (
 organization_id BIGINT UNSIGNED PRIMARY KEY, display_name VARCHAR(180), logo_url VARCHAR(500),
 primary_color CHAR(7) NOT NULL DEFAULT '#145C4B', secondary_color CHAR(7) NOT NULL DEFAULT '#D7A84B',
 locale VARCHAR(8) NOT NULL DEFAULT 'fr', currency CHAR(3) NOT NULL DEFAULT 'XAF',
 timezone VARCHAR(80) NOT NULL DEFAULT 'Africa/Douala', date_format VARCHAR(30) NOT NULL DEFAULT 'DD/MM/YYYY',
 sales_tax_rate DECIMAL(5,2) NOT NULL DEFAULT 0,
 qr_format VARCHAR(30) NOT NULL DEFAULT 'QR', barcode_format VARCHAR(30) NOT NULL DEFAULT 'CODE128',
 default_label_format VARCHAR(20) NOT NULL DEFAULT 'barcode',
 patient_code_mode ENUM('auto','manual') NOT NULL DEFAULT 'manual',
 patient_code_format VARCHAR(60) NOT NULL DEFAULT 'PAT-{SEQ:5}',
 patient_code_sequence BIGINT UNSIGNED NOT NULL DEFAULT 0,
 FOREIGN KEY(organization_id) REFERENCES organizations(id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS notifications (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, organization_id BIGINT UNSIGNED NOT NULL,
 title VARCHAR(180) NOT NULL, message TEXT NOT NULL,
 audience ENUM('organization','user') NOT NULL,
 recipient_user_id BIGINT UNSIGNED NULL, created_by BIGINT UNSIGNED NOT NULL,
 created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 KEY idx_notifications_tenant_date(organization_id,created_at),
 KEY idx_notifications_recipient(recipient_user_id,created_at),
 FOREIGN KEY(organization_id) REFERENCES organizations(id),
 FOREIGN KEY(recipient_user_id) REFERENCES users(id),
 FOREIGN KEY(created_by) REFERENCES users(id),
 CHECK ((audience='organization' AND recipient_user_id IS NULL) OR (audience='user' AND recipient_user_id IS NOT NULL))
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS notification_reads (
 notification_id BIGINT UNSIGNED NOT NULL, user_id BIGINT UNSIGNED NOT NULL,
 read_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(notification_id,user_id),
 FOREIGN KEY(notification_id) REFERENCES notifications(id) ON DELETE CASCADE,
 FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS plans (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, code VARCHAR(60) NOT NULL UNIQUE, name VARCHAR(100) NOT NULL,
 plan_type ENUM('starter','ultimate','customized') NOT NULL DEFAULT 'customized',
 billing_interval ENUM('monthly','annual','biennial') NOT NULL DEFAULT 'monthly',
 monthly_price DECIMAL(12,2) NOT NULL DEFAULT 0,
 annual_price DECIMAL(12,2) NULL, biennial_price DECIMAL(12,2) NULL,
 included_modules JSON NULL, module_prices JSON NULL,
 extra_user_price DECIMAL(12,2) NOT NULL DEFAULT 0,
 currency CHAR(3) NOT NULL DEFAULT 'XAF', max_users INT UNSIGNED NOT NULL DEFAULT 5,
 max_products INT UNSIGNED NOT NULL DEFAULT 500, is_active BOOLEAN NOT NULL DEFAULT TRUE
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS platform_promotions (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, code VARCHAR(60) NOT NULL UNIQUE, name VARCHAR(120) NOT NULL,
 discount_type ENUM('percent','fixed') NOT NULL, discount_value DECIMAL(12,2) NOT NULL,
 starts_at DATE NOT NULL, ends_at DATE NULL, is_active BOOLEAN NOT NULL DEFAULT TRUE,
 created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 CHECK(discount_value>0)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS subscriptions (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, organization_id BIGINT UNSIGNED NOT NULL,
 plan_id BIGINT UNSIGNED NOT NULL, promotion_id BIGINT UNSIGNED NULL,
 status ENUM('trialing','active','past_due','suspended','cancelled') NOT NULL DEFAULT 'trialing',
 billing_interval ENUM('monthly','annual','biennial') NOT NULL DEFAULT 'monthly',
 contract_amount DECIMAL(12,2) NULL, max_users INT UNSIGNED NULL, selected_modules JSON NULL,
 current_period_start DATE NOT NULL, current_period_end DATE NOT NULL,
 FOREIGN KEY(organization_id) REFERENCES organizations(id), FOREIGN KEY(plan_id) REFERENCES plans(id),
 FOREIGN KEY(promotion_id) REFERENCES platform_promotions(id),
 KEY idx_subscription_tenant(organization_id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS subscription_payments (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, subscription_id BIGINT UNSIGNED NOT NULL,
 amount DECIMAL(12,2) NOT NULL, currency CHAR(3) NOT NULL, payment_status ENUM('pending','paid','failed','refunded') NOT NULL DEFAULT 'pending',
 provider VARCHAR(60), provider_reference VARCHAR(190), paid_at DATETIME NULL,
 FOREIGN KEY(subscription_id) REFERENCES subscriptions(id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS platform_invoices (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, invoice_number VARCHAR(40) NOT NULL UNIQUE,
 organization_id BIGINT UNSIGNED NOT NULL, subscription_id BIGINT UNSIGNED NOT NULL,
 promotion_id BIGINT UNSIGNED NULL, period_start DATE NOT NULL, period_end DATE NOT NULL,
 subtotal DECIMAL(12,2) NOT NULL, discount_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
 total_amount DECIMAL(12,2) NOT NULL, currency CHAR(3) NOT NULL,
 status ENUM('draft','sent','paid','void') NOT NULL DEFAULT 'draft',
 due_date DATE NOT NULL, paid_at DATETIME NULL, notes VARCHAR(500) NULL,
 created_by BIGINT UNSIGNED NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 KEY idx_platform_invoices_org(organization_id,created_at),
 FOREIGN KEY(organization_id) REFERENCES organizations(id),
 FOREIGN KEY(subscription_id) REFERENCES subscriptions(id),
 FOREIGN KEY(promotion_id) REFERENCES platform_promotions(id),
 FOREIGN KEY(created_by) REFERENCES users(id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS platform_faqs (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, question VARCHAR(255) NOT NULL,
 answer TEXT NOT NULL, category VARCHAR(100) NOT NULL DEFAULT 'Général',
 sort_order INT NOT NULL DEFAULT 0, is_active BOOLEAN NOT NULL DEFAULT TRUE,
 updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS platform_trainings (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, title VARCHAR(180) NOT NULL,
 description TEXT NOT NULL, url VARCHAR(1000) NULL,
 format ENUM('article','video','link') NOT NULL DEFAULT 'article',
 is_active BOOLEAN NOT NULL DEFAULT TRUE,
 sort_order INT NOT NULL DEFAULT 0, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS products (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, organization_id BIGINT UNSIGNED NOT NULL,
 sku VARCHAR(80) NOT NULL, barcode VARCHAR(120), name VARCHAR(190) NOT NULL, category VARCHAR(120),
 unit VARCHAR(40) NOT NULL DEFAULT 'unité', quantity_on_hand DECIMAL(14,3) NOT NULL DEFAULT 0,
 reorder_level DECIMAL(14,3) NOT NULL DEFAULT 0, sale_price DECIMAL(14,2) NOT NULL DEFAULT 0,
 prescription_required BOOLEAN NOT NULL DEFAULT FALSE,
 max_customer_quantity DECIMAL(14,3) NULL, minimum_purchase_interval_hours INT UNSIGNED NULL,
 is_active BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 UNIQUE KEY uq_product_sku_tenant(organization_id,sku), KEY idx_product_tenant_name(organization_id,name),
 KEY idx_product_barcode(organization_id,barcode), FOREIGN KEY(organization_id) REFERENCES organizations(id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS stock_movements (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, organization_id BIGINT UNSIGNED NOT NULL,
 product_id BIGINT UNSIGNED NOT NULL, user_id BIGINT UNSIGNED NOT NULL,
 movement_type ENUM('IN','OUT','ADJUSTMENT') NOT NULL, quantity DECIMAL(14,3) NOT NULL,
 reference VARCHAR(120), notes TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 KEY idx_moves_tenant_date(organization_id,created_at),
 FOREIGN KEY(organization_id) REFERENCES organizations(id), FOREIGN KEY(product_id) REFERENCES products(id),
 FOREIGN KEY(user_id) REFERENCES users(id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS stock_movement_corrections (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, organization_id BIGINT UNSIGNED NOT NULL,
 movement_id BIGINT UNSIGNED NOT NULL, requested_by BIGINT UNSIGNED NOT NULL,
 old_quantity DECIMAL(14,3) NOT NULL, old_reference VARCHAR(120), old_notes TEXT,
 new_quantity DECIMAL(14,3) NOT NULL, new_reference VARCHAR(120), new_notes TEXT,
 reason VARCHAR(500) NOT NULL,
 status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
 validated_by BIGINT UNSIGNED NULL, validated_at TIMESTAMP NULL, decision_note VARCHAR(500) NULL,
 created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 KEY idx_corrections_movement(movement_id,status), KEY idx_corrections_tenant_status(organization_id,status),
 FOREIGN KEY(organization_id) REFERENCES organizations(id), FOREIGN KEY(movement_id) REFERENCES stock_movements(id),
 FOREIGN KEY(requested_by) REFERENCES users(id), FOREIGN KEY(validated_by) REFERENCES users(id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS suppliers (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, organization_id BIGINT UNSIGNED NOT NULL,
 name VARCHAR(190) NOT NULL, contact_name VARCHAR(180), email VARCHAR(190), phone VARCHAR(50),
 address TEXT, notes TEXT, is_active BOOLEAN NOT NULL DEFAULT TRUE,
 created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 KEY idx_suppliers_tenant_name(organization_id,name),
 FOREIGN KEY(organization_id) REFERENCES organizations(id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS purchase_orders (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, organization_id BIGINT UNSIGNED NOT NULL,
 supplier_id BIGINT UNSIGNED NOT NULL, reference VARCHAR(120),
 status ENUM('draft','ordered','partially_received','received','cancelled') NOT NULL DEFAULT 'draft',
 expected_date DATE NULL, notes TEXT, created_by BIGINT UNSIGNED NOT NULL,
 created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 UNIQUE KEY uq_purchase_reference_tenant(organization_id,reference),
 KEY idx_purchase_tenant_date(organization_id,created_at),
 KEY idx_purchase_tenant_status(organization_id,status),
 FOREIGN KEY(organization_id) REFERENCES organizations(id),
 FOREIGN KEY(supplier_id) REFERENCES suppliers(id),
 FOREIGN KEY(created_by) REFERENCES users(id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS purchase_order_items (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, purchase_order_id BIGINT UNSIGNED NOT NULL,
 product_id BIGINT UNSIGNED NOT NULL, quantity_ordered DECIMAL(14,3) NOT NULL,
 quantity_received DECIMAL(14,3) NOT NULL DEFAULT 0, unit_cost DECIMAL(14,2) NOT NULL DEFAULT 0,
 created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 UNIQUE KEY uq_purchase_item_product(purchase_order_id,product_id),
 FOREIGN KEY(purchase_order_id) REFERENCES purchase_orders(id),
 FOREIGN KEY(product_id) REFERENCES products(id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS patients (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, organization_id BIGINT UNSIGNED NOT NULL,
 patient_code VARCHAR(80) NOT NULL, full_name VARCHAR(190) NOT NULL,
 birth_date DATE NULL, gender ENUM('F','M','OTHER','UNSPECIFIED') NOT NULL DEFAULT 'UNSPECIFIED',
 phone VARCHAR(50), email VARCHAR(190), address TEXT,
 is_active BOOLEAN NOT NULL DEFAULT TRUE,
 created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 UNIQUE KEY uq_patient_code_tenant(organization_id,patient_code),
 KEY idx_patients_tenant_name(organization_id,full_name),
 FOREIGN KEY(organization_id) REFERENCES organizations(id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS patient_medical_history (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, organization_id BIGINT UNSIGNED NOT NULL,
 patient_id BIGINT UNSIGNED NOT NULL, condition_name VARCHAR(190) NOT NULL,
 condition_code VARCHAR(80), start_date DATE NULL, end_date DATE NULL,
 status ENUM('ongoing','resolved','in_remission') NOT NULL DEFAULT 'ongoing',
 notes TEXT, recorded_by BIGINT UNSIGNED NOT NULL, is_active BOOLEAN NOT NULL DEFAULT TRUE,
 created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 KEY idx_medical_history_patient(organization_id,patient_id,is_active),
 KEY idx_medical_history_condition(organization_id,condition_name),
 FOREIGN KEY(organization_id) REFERENCES organizations(id),
 FOREIGN KEY(patient_id) REFERENCES patients(id),
 FOREIGN KEY(recorded_by) REFERENCES users(id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS insurers (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, organization_id BIGINT UNSIGNED NOT NULL,
 name VARCHAR(190) NOT NULL, contact_name VARCHAR(180), email VARCHAR(190), phone VARCHAR(50),
 address TEXT, notes TEXT, is_active BOOLEAN NOT NULL DEFAULT TRUE,
 created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 KEY idx_insurers_tenant_name(organization_id,name),
 FOREIGN KEY(organization_id) REFERENCES organizations(id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS patient_insurance_coverages (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, organization_id BIGINT UNSIGNED NOT NULL,
 patient_id BIGINT UNSIGNED NOT NULL, insurer_id BIGINT UNSIGNED NOT NULL,
 policy_number VARCHAR(120) NOT NULL, member_number VARCHAR(120),
 start_date DATE NULL, end_date DATE NULL,
 coverage_percent DECIMAL(5,2) NULL, notes TEXT,
 status ENUM('active','inactive') NOT NULL DEFAULT 'active',
 created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 KEY idx_patient_coverages_patient(organization_id,patient_id,status),
 KEY idx_patient_coverages_insurer(organization_id,insurer_id),
 FOREIGN KEY(organization_id) REFERENCES organizations(id),
 FOREIGN KEY(patient_id) REFERENCES patients(id),
 FOREIGN KEY(insurer_id) REFERENCES insurers(id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS sales_invoices (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, organization_id BIGINT UNSIGNED NOT NULL,
 invoice_number VARCHAR(40) NOT NULL, patient_id BIGINT UNSIGNED NULL, patient_name VARCHAR(190) NULL,
 subtotal DECIMAL(14,2) NOT NULL, tax_rate DECIMAL(5,2) NOT NULL DEFAULT 0,
 tax_amount DECIMAL(14,2) NOT NULL DEFAULT 0, total_amount DECIMAL(14,2) NOT NULL,
 status ENUM('issued','partially_paid','paid','partially_returned','returned','cancelled') NOT NULL DEFAULT 'issued',
 review_flags JSON NULL, notes TEXT, created_by BIGINT UNSIGNED NOT NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE KEY uq_sales_invoice_number(organization_id,invoice_number),
 KEY idx_sales_invoice_tenant_date(organization_id,created_at),
 KEY idx_sales_invoice_patient(organization_id,patient_id,created_at),
 KEY idx_sales_invoice_status(organization_id,status),
 FOREIGN KEY(organization_id) REFERENCES organizations(id),
 FOREIGN KEY(patient_id) REFERENCES patients(id),
 FOREIGN KEY(created_by) REFERENCES users(id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS sales_invoice_prescriptions (
 invoice_id BIGINT UNSIGNED PRIMARY KEY, mime_type VARCHAR(40) NOT NULL,
 image_data MEDIUMBLOB NOT NULL, captured_by BIGINT UNSIGNED NOT NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(invoice_id) REFERENCES sales_invoices(id),
 FOREIGN KEY(captured_by) REFERENCES users(id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS sales_invoice_items (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, invoice_id BIGINT UNSIGNED NOT NULL,
 product_id BIGINT UNSIGNED NOT NULL, sku VARCHAR(80) NOT NULL, product_name VARCHAR(190) NOT NULL,
 unit VARCHAR(40) NOT NULL, quantity DECIMAL(14,3) NOT NULL, returned_quantity DECIMAL(14,3) NOT NULL DEFAULT 0,
 unit_price DECIMAL(14,2) NOT NULL, line_subtotal DECIMAL(14,2) NOT NULL,
 line_tax DECIMAL(14,2) NOT NULL, line_total DECIMAL(14,2) NOT NULL,
 prescription_required BOOLEAN NOT NULL DEFAULT FALSE, prescription_provided BOOLEAN NOT NULL DEFAULT FALSE,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 KEY idx_sales_items_invoice(invoice_id),
 FOREIGN KEY(invoice_id) REFERENCES sales_invoices(id),
 FOREIGN KEY(product_id) REFERENCES products(id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS sales_payments (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, invoice_id BIGINT UNSIGNED NOT NULL,
 payment_method ENUM('cash','mobile_money','bank_transfer','insurance','other') NOT NULL,
 amount DECIMAL(14,2) NOT NULL, cash_received DECIMAL(14,2) NOT NULL DEFAULT 0,
 cash_change DECIMAL(14,2) NOT NULL DEFAULT 0, insurer_id BIGINT UNSIGNED NULL,
 reference VARCHAR(190) NULL, recorded_by BIGINT UNSIGNED NOT NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 KEY idx_sales_payments_invoice(invoice_id),
 FOREIGN KEY(invoice_id) REFERENCES sales_invoices(id),
 FOREIGN KEY(insurer_id) REFERENCES insurers(id),
 FOREIGN KEY(recorded_by) REFERENCES users(id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS cash_sessions (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, organization_id BIGINT UNSIGNED NOT NULL,
 opened_by BIGINT UNSIGNED NOT NULL, closed_by BIGINT UNSIGNED NULL,
 opening_cash DECIMAL(14,2) NOT NULL, expected_cash DECIMAL(14,2) NULL,
 closing_cash DECIMAL(14,2) NULL, variance DECIMAL(14,2) NULL,
 status ENUM('open','closed') NOT NULL DEFAULT 'open',
 opened_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, closed_at DATETIME NULL,
 KEY idx_cash_sessions_tenant_status(organization_id,status,opened_at),
 FOREIGN KEY(organization_id) REFERENCES organizations(id),
 FOREIGN KEY(opened_by) REFERENCES users(id),
 FOREIGN KEY(closed_by) REFERENCES users(id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS cash_movements (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, organization_id BIGINT UNSIGNED NOT NULL,
 session_id BIGINT UNSIGNED NOT NULL,
 movement_type ENUM('sale','income','expense','refund') NOT NULL,
 payment_method ENUM('cash','mobile_money','bank_transfer','insurance','other') NOT NULL,
 amount DECIMAL(14,2) NOT NULL, cash_received DECIMAL(14,2) NOT NULL DEFAULT 0,
 cash_change DECIMAL(14,2) NOT NULL DEFAULT 0, description VARCHAR(255) NOT NULL,
 invoice_id BIGINT UNSIGNED NULL, recorded_by BIGINT UNSIGNED NOT NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 KEY idx_cash_movements_session(session_id,created_at),
 KEY idx_cash_movements_tenant_date(organization_id,created_at),
 FOREIGN KEY(organization_id) REFERENCES organizations(id),
 FOREIGN KEY(session_id) REFERENCES cash_sessions(id),
 FOREIGN KEY(invoice_id) REFERENCES sales_invoices(id),
 FOREIGN KEY(recorded_by) REFERENCES users(id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS sales_returns (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, invoice_id BIGINT UNSIGNED NOT NULL,
 return_number VARCHAR(40) NOT NULL, refund_amount DECIMAL(14,2) NOT NULL,
 refund_method ENUM('cash','mobile_money','bank_transfer','insurance','other') NOT NULL,
 cash_received DECIMAL(14,2) NOT NULL DEFAULT 0, cash_change DECIMAL(14,2) NOT NULL DEFAULT 0,
 insurer_id BIGINT UNSIGNED NULL, reason VARCHAR(500) NOT NULL, recorded_by BIGINT UNSIGNED NOT NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE KEY uq_sales_return_number(invoice_id,return_number),
 KEY idx_sales_returns_invoice(invoice_id,created_at),
 FOREIGN KEY(invoice_id) REFERENCES sales_invoices(id),
 FOREIGN KEY(insurer_id) REFERENCES insurers(id),
 FOREIGN KEY(recorded_by) REFERENCES users(id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS sales_return_items (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, return_id BIGINT UNSIGNED NOT NULL,
 invoice_item_id BIGINT UNSIGNED NOT NULL, quantity DECIMAL(14,3) NOT NULL,
 refund_amount DECIMAL(14,2) NOT NULL, restocked BOOLEAN NOT NULL DEFAULT TRUE,
 KEY idx_sales_return_items_return(return_id),
 KEY idx_sales_return_items_invoice_item(invoice_item_id),
 FOREIGN KEY(return_id) REFERENCES sales_returns(id),
 FOREIGN KEY(invoice_item_id) REFERENCES sales_invoice_items(id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS audit_logs (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, organization_id BIGINT UNSIGNED NOT NULL,
 user_id BIGINT UNSIGNED, action VARCHAR(100) NOT NULL, entity_type VARCHAR(80) NOT NULL,
 entity_id VARCHAR(80), details_json JSON, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 KEY idx_audit_tenant_date(organization_id,created_at),
 FOREIGN KEY(organization_id) REFERENCES organizations(id), FOREIGN KEY(user_id) REFERENCES users(id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS password_resets (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, user_id BIGINT UNSIGNED NOT NULL,
 token_hash CHAR(64) NOT NULL, expires_at DATETIME NOT NULL, used_at DATETIME NULL,
 FOREIGN KEY(user_id) REFERENCES users(id), KEY idx_reset_token(token_hash)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS backup_records (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, organization_id BIGINT UNSIGNED NOT NULL,
 file_name VARCHAR(255) NOT NULL, status ENUM('queued','completed','failed') NOT NULL DEFAULT 'queued',
 created_by BIGINT UNSIGNED, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(organization_id) REFERENCES organizations(id), FOREIGN KEY(created_by) REFERENCES users(id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS support_tickets (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, organization_id BIGINT UNSIGNED NOT NULL,
 user_id BIGINT UNSIGNED NOT NULL, subject VARCHAR(190) NOT NULL, message TEXT NOT NULL,
 status ENUM('open','in_progress','closed') NOT NULL DEFAULT 'open', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 support_token CHAR(32) NULL, assigned_agent_id BIGINT UNSIGNED NULL,
 KEY idx_support_tickets_tenant_user(organization_id,user_id,created_at),
 UNIQUE KEY uq_support_ticket_token(support_token),
 KEY idx_support_queue(assigned_agent_id,status,created_at),
 FOREIGN KEY(assigned_agent_id) REFERENCES users(id),
 FOREIGN KEY(organization_id) REFERENCES organizations(id), FOREIGN KEY(user_id) REFERENCES users(id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS support_ticket_messages (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, organization_id BIGINT UNSIGNED NOT NULL,
 ticket_id BIGINT UNSIGNED NOT NULL, user_id BIGINT UNSIGNED NOT NULL, message TEXT NOT NULL,
 created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 KEY idx_support_messages_ticket(organization_id,ticket_id,created_at),
 FOREIGN KEY(organization_id) REFERENCES organizations(id),
 FOREIGN KEY(ticket_id) REFERENCES support_tickets(id) ON DELETE CASCADE,
 FOREIGN KEY(user_id) REFERENCES users(id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS support_agent_presence (
 user_id BIGINT UNSIGNED PRIMARY KEY, is_available BOOLEAN NOT NULL DEFAULT FALSE,
 updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS platform_settings (
 setting_key VARCHAR(100) PRIMARY KEY, setting_value JSON, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;
