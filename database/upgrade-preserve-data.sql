-- REDAMS-STK: MySQL 8, migrations 2026110501 through 2026110702.
-- Select the EXISTING database before executing this file.
-- Stop application writes and create/test an external SQL backup first.
-- Set the exact database name and confirm the backup below.
-- This file never resets tables, seeds data or rewrites business rows.
-- DDL is not transactional: on failure, keep the backup and inspect the schema.
-- This covers the eight versioned migrations, not an arbitrary legacy schema.
-- The portal migration history is intentionally left untouched.
SET @redams_expected_database = NULL;
SET @redams_backup_confirmed = 0;

DELIMITER $$
-- This reserved helper is the only routine replaced by this file.
DROP PROCEDURE IF EXISTS redams_upgrade_preserve_data_2026110701$$
CREATE PROCEDURE redams_upgrade_preserve_data_2026110701()
BEGIN
    DECLARE locked INT DEFAULT 0;
    DECLARE finished INT DEFAULT 0;
    DECLARE table_name_value VARCHAR(64);
    DECLARE column_name_value VARCHAR(64);
    DECLARE type_value VARCHAR(255);
    DECLARE nullable_value VARCHAR(3);
    DECLARE default_value VARCHAR(60);
    DECLARE definition_value VARCHAR(255);
    DECLARE actual_type VARCHAR(255);
    DECLARE actual_nullable VARCHAR(3);
    DECLARE actual_default VARCHAR(60);
    DECLARE column_count INT;
    DECLARE role_type VARCHAR(255);
    DECLARE message_value VARCHAR(128);
    DECLARE fields CURSOR FOR
        SELECT jt.table_name, jt.column_name, jt.column_type,
               jt.nullable_value, jt.default_value, jt.definition
        FROM JSON_TABLE(
            '[["platform_promotions","plan_id","bigint unsigned","YES",null,"BIGINT UNSIGNED NULL"],
              ["products","purchase_cost","decimal(18,4)","YES",null,"DECIMAL(18,4) NULL"],
              ["sales_invoice_items","unit_purchase_cost","decimal(18,4)","YES",null,"DECIMAL(18,4) NULL"],
              ["organization_settings","separate_sale_payment","tinyint(1)","NO","0","TINYINT(1) NOT NULL DEFAULT 0"],
              ["organization_settings","merge_pharmacist_storekeeper","tinyint(1)","NO","0","TINYINT(1) NOT NULL DEFAULT 0"],
              ["sales_invoices","separate_cashier","tinyint(1)","NO","0","TINYINT(1) NOT NULL DEFAULT 0"]]',
            '$[*]' COLUMNS(
                table_name VARCHAR(64) PATH '$[0]',
                column_name VARCHAR(64) PATH '$[1]',
                column_type VARCHAR(255) PATH '$[2]',
                nullable_value VARCHAR(3) PATH '$[3]',
                default_value VARCHAR(60) PATH '$[4]',
                definition VARCHAR(255) PATH '$[5]'
            )
        ) jt;
    DECLARE CONTINUE HANDLER FOR NOT FOUND SET finished = 1;
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        IF locked = 1 THEN
            DO RELEASE_LOCK('redams_schema_migrations');
        END IF;
        RESIGNAL;
    END;

    IF DATABASE() IS NULL OR @redams_expected_database IS NULL
       OR BINARY DATABASE() <> BINARY @redams_expected_database THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Select the existing target database and set redams_expected_database.';
    END IF;
    IF COALESCE(@redams_backup_confirmed, 0) <> 1 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'External backup not confirmed; no business schema changes applied.';
    END IF;
    SELECT GET_LOCK('redams_schema_migrations', 0) INTO locked;
    IF COALESCE(locked, 0) <> 1 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Another schema migration is running.';
    END IF;

    -- Complete preflight before the first business-table ALTER or CREATE.
    IF (SELECT COUNT(*) FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'
          AND ENGINE = 'InnoDB'
          AND TABLE_NAME IN ('organizations','users','plans','platform_promotions',
                             'products','sales_invoice_items','organization_settings','sales_invoices')) <> 8 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Required REDAMS tables are missing or are not InnoDB; do not initialize this production database.';
    END IF;
    IF (SELECT COUNT(*) FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('organizations','users','plans')
          AND COLUMN_NAME = 'id' AND LOWER(COLUMN_TYPE) = 'bigint unsigned' AND IS_NULLABLE = 'NO') <> 3
       OR (SELECT COUNT(*) FROM information_schema.STATISTICS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('organizations','users','plans')
             AND INDEX_NAME = 'PRIMARY') <> 3
       OR (SELECT COUNT(*) FROM information_schema.STATISTICS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('organizations','users','plans')
             AND INDEX_NAME = 'PRIMARY' AND COLUMN_NAME = 'id' AND SEQ_IN_INDEX = 1) <> 3 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Incompatible parent identifiers; foreign keys cannot be added safely.';
    END IF;

    OPEN fields;
    check_fields: LOOP
        FETCH fields INTO table_name_value, column_name_value, type_value,
                          nullable_value, default_value, definition_value;
        IF finished = 1 THEN LEAVE check_fields; END IF;
        SELECT COUNT(*), MAX(LOWER(COLUMN_TYPE)), MAX(IS_NULLABLE), MAX(COLUMN_DEFAULT)
          INTO column_count, actual_type, actual_nullable, actual_default
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = table_name_value AND COLUMN_NAME = column_name_value;
        IF column_count > 0 AND
           (actual_type <> type_value OR actual_nullable <> nullable_value
            OR NOT (actual_default <=> default_value)) THEN
            SET message_value = CONCAT('Incompatible existing column: ', table_name_value, '.', column_name_value);
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = message_value;
        END IF;
    END LOOP;
    CLOSE fields;
    SET finished = 0;

    SELECT MAX(LOWER(COLUMN_TYPE)), MAX(IS_NULLABLE), MAX(COLUMN_DEFAULT)
      INTO role_type, actual_nullable, actual_default
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'role';
    IF role_type IS NULL OR role_type NOT IN (
        'enum(''owner'',''admin'',''pharmacist'',''storekeeper'',''cashier'',''viewer'',''super_admin'')',
        'enum(''owner'',''admin'',''pharmacist'',''storekeeper'',''cashier'',''viewer'',''super_admin'',''accountant'')')
       OR actual_nullable <> 'NO' OR COALESCE(UPPER(actual_default), '') <> 'VIEWER' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Incompatible users.role; existing roles will not be rewritten.';
    END IF;

    IF EXISTS(SELECT 1 FROM information_schema.KEY_COLUMN_USAGE
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'platform_promotions'
                AND COLUMN_NAME = 'plan_id' AND REFERENCED_TABLE_NAME IS NOT NULL
                AND (REFERENCED_TABLE_NAME <> 'plans' OR REFERENCED_COLUMN_NAME <> 'id')) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Incompatible promotion foreign key.';
    END IF;
    IF EXISTS(SELECT 1 FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'platform_promotions' AND COLUMN_NAME = 'plan_id') THEN
        SET @redams_sql = 'SELECT COUNT(*) INTO @redams_orphans FROM platform_promotions p LEFT JOIN plans x ON x.id=p.plan_id WHERE p.plan_id IS NOT NULL AND x.id IS NULL';
        PREPARE redams_statement FROM @redams_sql;
        EXECUTE redams_statement;
        DEALLOCATE PREPARE redams_statement;
        IF @redams_orphans > 0 THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Orphan promotion references; no existing rows will be corrected automatically.';
        END IF;
    END IF;

    IF EXISTS(SELECT 1 FROM information_schema.TABLES
              WHERE TABLE_SCHEMA = DATABASE()
                AND TABLE_NAME IN ('accounting_books','accounting_entries','accounting_review_snapshots')
                AND (TABLE_TYPE <> 'BASE TABLE' OR ENGINE <> 'InnoDB')) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Incompatible accounting table engine or object type.';
    END IF;

    -- Validate all existing accounting columns. Missing tables are created below.
    IF EXISTS(
        SELECT 1 FROM information_schema.COLUMNS c
        LEFT JOIN JSON_TABLE(
            '[["accounting_books","organization_id","bigint unsigned","NO"],
              ["accounting_books","opening_date","date","NO"],
              ["accounting_books","accounts","json","NO"],
              ["accounting_books","created_by","bigint unsigned","NO"],
              ["accounting_books","created_at","timestamp","NO"],
              ["accounting_entries","id","bigint unsigned","NO"],
              ["accounting_entries","organization_id","bigint unsigned","NO"],
              ["accounting_entries","entry_date","date","NO"],
              ["accounting_entries","kind","enum(''opening'',''normal'')","NO"],
              ["accounting_entries","status","enum(''draft'',''posted'')","NO"],
              ["accounting_entries","description","varchar(500)","NO"],
              ["accounting_entries","lines","json","NO"],
              ["accounting_entries","created_by","bigint unsigned","NO"],
              ["accounting_entries","created_at","timestamp","NO"],
              ["accounting_review_snapshots","id","bigint unsigned","NO"],
              ["accounting_review_snapshots","organization_id","bigint unsigned","NO"],
              ["accounting_review_snapshots","preliminary_id","bigint unsigned","YES"],
              ["accounting_review_snapshots","status","enum(''preliminary'',''final'')","NO"],
              ["accounting_review_snapshots","period_from","date","NO"],
              ["accounting_review_snapshots","period_to","date","NO"],
              ["accounting_review_snapshots","snapshot_text","longtext","NO"],
              ["accounting_review_snapshots","snapshot_hash","char(64)","NO"],
              ["accounting_review_snapshots","created_by","bigint unsigned","NO"],
              ["accounting_review_snapshots","created_at","timestamp","NO"]]',
            '$[*]' COLUMNS(table_name VARCHAR(64) PATH '$[0]', column_name VARCHAR(64) PATH '$[1]',
                            column_type VARCHAR(255) PATH '$[2]', nullable_value VARCHAR(3) PATH '$[3]')
        ) e ON c.TABLE_NAME = e.table_name AND c.COLUMN_NAME = e.column_name
        WHERE c.TABLE_SCHEMA = DATABASE()
          AND c.TABLE_NAME IN ('accounting_books','accounting_entries','accounting_review_snapshots')
          AND (e.column_name IS NULL OR LOWER(c.COLUMN_TYPE) <> e.column_type OR c.IS_NULLABLE <> e.nullable_value)
    ) OR EXISTS(
        SELECT 1 FROM information_schema.TABLES t
        WHERE t.TABLE_SCHEMA = DATABASE()
          AND t.TABLE_NAME IN ('accounting_books','accounting_entries','accounting_review_snapshots')
          AND (SELECT COUNT(*) FROM information_schema.COLUMNS c
               WHERE c.TABLE_SCHEMA = DATABASE() AND c.TABLE_NAME = t.TABLE_NAME)
              <> CASE t.TABLE_NAME WHEN 'accounting_books' THEN 5 WHEN 'accounting_entries' THEN 9 ELSE 10 END
    ) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Incompatible existing accounting columns; existing tables will not be replaced.';
    END IF;
    IF EXISTS(SELECT 1 FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('accounting_entries','accounting_review_snapshots')
                AND COLUMN_NAME = 'id' AND EXTRA NOT LIKE '%auto_increment%')
       OR EXISTS(SELECT 1 FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'accounting_entries'
                   AND COLUMN_NAME = 'status' AND COALESCE(COLUMN_DEFAULT, '') <> 'draft') THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Incompatible accounting identifiers or entry status default.';
    END IF;

    IF EXISTS(
        SELECT 1 FROM JSON_TABLE(
            '[["accounting_books","organization_id","organizations","id"],
              ["accounting_books","created_by","users","id"],
              ["accounting_entries","organization_id","accounting_books","organization_id"],
              ["accounting_entries","created_by","users","id"],
              ["accounting_review_snapshots","organization_id","accounting_books","organization_id"],
              ["accounting_review_snapshots","created_by","users","id"],
              ["accounting_review_snapshots","preliminary_id","accounting_review_snapshots","id"]]',
            '$[*]' COLUMNS(table_name VARCHAR(64) PATH '$[0]', column_name VARCHAR(64) PATH '$[1]',
                            parent_table VARCHAR(64) PATH '$[2]', parent_column VARCHAR(64) PATH '$[3]')
        ) e JOIN information_schema.TABLES t ON t.TABLE_SCHEMA = DATABASE() AND t.TABLE_NAME = e.table_name
        WHERE NOT EXISTS(SELECT 1 FROM information_schema.KEY_COLUMN_USAGE k
                         WHERE k.TABLE_SCHEMA = DATABASE() AND k.TABLE_NAME = e.table_name
                           AND k.COLUMN_NAME = e.column_name AND k.REFERENCED_TABLE_NAME = e.parent_table
                           AND k.REFERENCED_COLUMN_NAME = e.parent_column)
    ) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Missing or incompatible existing accounting foreign key.';
    END IF;
    IF EXISTS(
        SELECT 1 FROM JSON_TABLE(
            '[["accounting_books","PRIMARY","organization_id",0],
              ["accounting_entries","PRIMARY","id",0],
              ["accounting_entries","idx_accounting_entries_tenant_date","organization_id,entry_date,id",1],
              ["accounting_review_snapshots","PRIMARY","id",0],
              ["accounting_review_snapshots","uq_accounting_review_final","preliminary_id",0],
              ["accounting_review_snapshots","idx_accounting_review_tenant","organization_id,id",1]]',
            '$[*]' COLUMNS(table_name VARCHAR(64) PATH '$[0]', index_name VARCHAR(64) PATH '$[1]',
                            columns_value VARCHAR(128) PATH '$[2]', non_unique INT PATH '$[3]')
        ) e JOIN information_schema.TABLES t ON t.TABLE_SCHEMA = DATABASE() AND t.TABLE_NAME = e.table_name
        WHERE COALESCE((SELECT GROUP_CONCAT(s.COLUMN_NAME ORDER BY s.SEQ_IN_INDEX)
                        FROM information_schema.STATISTICS s
                        WHERE s.TABLE_SCHEMA = DATABASE() AND s.TABLE_NAME = e.table_name
                          AND s.INDEX_NAME = e.index_name AND s.NON_UNIQUE = e.non_unique), '') <> e.columns_value
    ) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Missing or incompatible existing accounting index.';
    END IF;

    OPEN fields;
    add_fields: LOOP
        FETCH fields INTO table_name_value, column_name_value, type_value,
                          nullable_value, default_value, definition_value;
        IF finished = 1 THEN LEAVE add_fields; END IF;
        IF NOT EXISTS(SELECT 1 FROM information_schema.COLUMNS
                      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = table_name_value AND COLUMN_NAME = column_name_value) THEN
            SET @redams_sql = CONCAT('ALTER TABLE `', table_name_value, '` ADD COLUMN `', column_name_value, '` ', definition_value);
            PREPARE redams_statement FROM @redams_sql;
            EXECUTE redams_statement;
            DEALLOCATE PREPARE redams_statement;
        END IF;
    END LOOP;
    CLOSE fields;

    IF NOT EXISTS(SELECT 1 FROM information_schema.KEY_COLUMN_USAGE
                  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'platform_promotions' AND COLUMN_NAME = 'plan_id'
                    AND REFERENCED_TABLE_NAME = 'plans' AND REFERENCED_COLUMN_NAME = 'id') THEN
        ALTER TABLE platform_promotions ADD CONSTRAINT fk_promotion_plan FOREIGN KEY (plan_id) REFERENCES plans(id);
    END IF;
    IF role_type = 'enum(''owner'',''admin'',''pharmacist'',''storekeeper'',''cashier'',''viewer'',''super_admin'')' THEN
        ALTER TABLE users MODIFY role ENUM('OWNER','ADMIN','PHARMACIST','STOREKEEPER','CASHIER','VIEWER','SUPER_ADMIN','ACCOUNTANT') NOT NULL DEFAULT 'VIEWER';
    END IF;

    CREATE TABLE IF NOT EXISTS accounting_books (
        organization_id BIGINT UNSIGNED PRIMARY KEY,
        opening_date DATE NOT NULL,
        accounts JSON NOT NULL,
        created_by BIGINT UNSIGNED NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(organization_id) REFERENCES organizations(id),
        FOREIGN KEY(created_by) REFERENCES users(id)
    ) ENGINE=InnoDB;
    CREATE TABLE IF NOT EXISTS accounting_entries (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        organization_id BIGINT UNSIGNED NOT NULL,
        entry_date DATE NOT NULL,
        kind ENUM('opening','normal') NOT NULL,
        status ENUM('draft','posted') NOT NULL DEFAULT 'draft',
        description VARCHAR(500) NOT NULL,
        `lines` JSON NOT NULL,
        created_by BIGINT UNSIGNED NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        KEY idx_accounting_entries_tenant_date(organization_id,entry_date,id),
        FOREIGN KEY(organization_id) REFERENCES accounting_books(organization_id),
        FOREIGN KEY(created_by) REFERENCES users(id)
    ) ENGINE=InnoDB;
    CREATE TABLE IF NOT EXISTS accounting_review_snapshots (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        organization_id BIGINT UNSIGNED NOT NULL,
        preliminary_id BIGINT UNSIGNED NULL,
        status ENUM('preliminary','final') NOT NULL,
        period_from DATE NOT NULL,
        period_to DATE NOT NULL,
        snapshot_text LONGTEXT NOT NULL,
        snapshot_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
        created_by BIGINT UNSIGNED NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_accounting_review_final(preliminary_id),
        KEY idx_accounting_review_tenant(organization_id,id),
        FOREIGN KEY(organization_id) REFERENCES accounting_books(organization_id),
        FOREIGN KEY(created_by) REFERENCES users(id),
        FOREIGN KEY(preliminary_id) REFERENCES accounting_review_snapshots(id)
    ) ENGINE=InnoDB;
    DO RELEASE_LOCK('redams_schema_migrations');
    SET locked = 0;
    SELECT DATABASE() AS updated_database, 'Schema update completed; existing business values preserved.' AS result;
END$$
CALL redams_upgrade_preserve_data_2026110701()$$
DROP PROCEDURE redams_upgrade_preserve_data_2026110701$$
DELIMITER ;
