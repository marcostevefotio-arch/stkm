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
