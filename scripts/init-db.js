require('dotenv').config();
const fs=require('fs'),path=require('path'),db=require('../src/config/database');
const {ALL_MODULES,DEFAULT_PLANS}=require('../src/config/pricing');
const {recordBuiltInMigration,verifyBuiltInMigrationSchema}=require('../src/services/database-upgrade.service');
const columnMigrations=[
 ['users','password_version','INT UNSIGNED NOT NULL DEFAULT 0'],
 ['organization_settings','default_label_format',"VARCHAR(20) NOT NULL DEFAULT 'barcode'"],
 ['organization_settings','logo_mime_type','VARCHAR(30) NULL'],
 ['organization_settings','logo_data','LONGBLOB NULL'],
 ['support_tickets','support_token','CHAR(32) NULL'],
 ['support_tickets','assigned_agent_id','BIGINT UNSIGNED NULL'],
 ['support_tickets','assigned_staff_id','BIGINT UNSIGNED NULL'],
 ['support_tickets','assignment_type',"ENUM('assigned','voluntary') NULL"],
 ['support_tickets','assigned_staff_at','DATETIME NULL'],
 ['support_tickets','closed_at','DATETIME NULL'],
 ['support_ticket_messages','staff_id','BIGINT UNSIGNED NULL'],
 ['platform_invoices','created_by_staff_id','BIGINT UNSIGNED NULL'],
 ['subscriptions','promotion_id','BIGINT UNSIGNED NULL'],
 ['organizations','address','TEXT NULL'],
 ['organizations','phone','VARCHAR(50) NULL'],
 ['organizations','slogan','VARCHAR(255) NULL'],
 ['organizations','email','VARCHAR(190) NULL'],
 ['organizations','partner_id','BIGINT UNSIGNED NULL'],
 ['platform_promotions','new_users_only','BOOLEAN NOT NULL DEFAULT FALSE'],
 ['platform_promotions','plan_id','BIGINT UNSIGNED NULL'],
 ['organization_settings','sales_tax_rate','DECIMAL(5,2) NOT NULL DEFAULT 0'],
 ['organization_settings','separate_sale_payment','TINYINT(1) NOT NULL DEFAULT 0'],
 ['organization_settings','merge_pharmacist_storekeeper','TINYINT(1) NOT NULL DEFAULT 0'],
 ['sales_invoices','separate_cashier','TINYINT(1) NOT NULL DEFAULT 0'],
 ['organization_settings','patient_code_mode',"ENUM('auto','manual') NOT NULL DEFAULT 'manual'"],
 ['organization_settings','patient_code_format',"VARCHAR(60) NOT NULL DEFAULT 'PAT-{SEQ:5}'"],
 ['organization_settings','patient_code_sequence','BIGINT UNSIGNED NOT NULL DEFAULT 0'],
 ['products','prescription_required','BOOLEAN NOT NULL DEFAULT FALSE'],
 ['products','purchase_cost','DECIMAL(18,4) NULL'],
 ['sales_invoice_items','unit_purchase_cost','DECIMAL(18,4) NULL'],
 ['products','max_customer_quantity','DECIMAL(14,3) NULL'],
 ['products','minimum_purchase_interval_hours','INT UNSIGNED NULL'],
 ['plans','plan_type',"ENUM('starter','ultimate','customized','trial') NOT NULL DEFAULT 'customized'"],
 ['plans','annual_price','DECIMAL(12,2) NULL'],
 ['plans','biennial_price','DECIMAL(12,2) NULL'],
 ['plans','included_modules','JSON NULL'],
 ['plans','module_prices','JSON NULL'],
 ['plans','extra_user_price','DECIMAL(12,2) NOT NULL DEFAULT 0'],
 ['subscriptions','contract_amount','DECIMAL(12,2) NULL'],
 ['subscriptions','max_users','INT UNSIGNED NULL'],
 ['subscriptions','selected_modules','JSON NULL'],
 ['subscriptions','target_plan_id','BIGINT UNSIGNED NULL'],
];
async function ensureColumn(table,column,definition){
 const [rows]=await db.execute(
  'SELECT COUNT(*) column_count FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?',
  [table,column]
 );
 if(Number(rows[0].column_count)===0)await db.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
}
async function ensureIndex(table,index,definition){
 const [rows]=await db.execute(
  'SELECT COUNT(*) index_count FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND INDEX_NAME=?',
  [table,index]
 );
 if(Number(rows[0].index_count)===0)await db.query(`ALTER TABLE \`${table}\` ADD ${definition}`);
}
async function ensureForeignKey(table,column,referencedTable,referencedColumn,constraint){
 const [rows]=await db.execute(
  'SELECT COUNT(*) constraint_count FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=? AND REFERENCED_TABLE_NAME=? AND REFERENCED_COLUMN_NAME=?',
  [table,column,referencedTable,referencedColumn]
 );
 if(Number(rows[0].constraint_count)===0)await db.query(`ALTER TABLE \`${table}\` ADD CONSTRAINT \`${constraint}\` FOREIGN KEY(\`${column}\`) REFERENCES \`${referencedTable}\`(\`${referencedColumn}\`)`);
}
(async()=>{
 const sql=fs.readFileSync(path.join(__dirname,'../database/schema.sql'),'utf8');
 for(const statement of sql.split(/;\s*(?:\r?\n|$)/).map(value=>value.trim()).filter(Boolean))await db.query(statement);
 for(const [table,column,definition] of columnMigrations)await ensureColumn(table,column,definition);
 await db.query("ALTER TABLE plans MODIFY plan_type ENUM('starter','ultimate','customized','trial') NOT NULL DEFAULT 'customized'");
 await db.query("ALTER TABLE plans MODIFY billing_interval ENUM('monthly','annual','biennial') NOT NULL DEFAULT 'monthly'");
 await db.query("ALTER TABLE subscriptions MODIFY billing_interval ENUM('monthly','annual','biennial') NOT NULL DEFAULT 'monthly'");
 await db.query('ALTER TABLE support_ticket_messages MODIFY user_id BIGINT UNSIGNED NULL');
 await db.query('ALTER TABLE platform_invoices MODIFY created_by BIGINT UNSIGNED NULL');
 await ensureIndex('support_tickets','uq_support_ticket_token','UNIQUE KEY uq_support_ticket_token(support_token)');
 await ensureIndex('support_tickets','idx_support_queue','KEY idx_support_queue(assigned_agent_id,status,created_at)');
 await ensureIndex('support_tickets','idx_support_staff_history','KEY idx_support_staff_history(assigned_staff_id,status,closed_at)');
 await ensureIndex('users','idx_users_role_active','KEY idx_users_role_active(role,is_active)');
 await ensureForeignKey('support_tickets','assigned_agent_id','users','id','fk_support_ticket_agent');
 await ensureForeignKey('subscriptions','promotion_id','platform_promotions','id','fk_subscription_promotion');
 await ensureForeignKey('organizations','partner_id','platform_partners','id','fk_organization_partner');
 await ensureForeignKey('platform_promotions','plan_id','plans','id','fk_promotion_plan');
 await recordBuiltInMigration(db,'2026110501_promotion_plan_scope');
 await recordBuiltInMigration(db,'2026110601_product_purchase_cost');
 await verifyBuiltInMigrationSchema(db,'2026110602_accounting_book');
 await recordBuiltInMigration(db,'2026110602_accounting_book');
 await verifyBuiltInMigrationSchema(db,'2026110603_sale_unit_purchase_cost');
 await recordBuiltInMigration(db,'2026110603_sale_unit_purchase_cost');
 await verifyBuiltInMigrationSchema(db,'2026110701_separate_sale_payment');
 await recordBuiltInMigration(db,'2026110701_separate_sale_payment');
 await verifyBuiltInMigrationSchema(db,'2026110702_merge_pharmacist_storekeeper');
 await recordBuiltInMigration(db,'2026110702_merge_pharmacist_storekeeper');
 await verifyBuiltInMigrationSchema(db,'2026111201_database_logo_storage');
 await recordBuiltInMigration(db,'2026111201_database_logo_storage');
 await verifyBuiltInMigrationSchema(db,'2026111301_tenant_backups');
 await recordBuiltInMigration(db,'2026111301_tenant_backups');
 await db.execute(
  `INSERT IGNORE INTO account_email_claims(email,user_id)
   SELECT LOWER(email),MIN(id) FROM users GROUP BY LOWER(email)`
 );
 await db.execute("UPDATE plans SET is_active=FALSE WHERE code='starter-monthly'");
 for(const plan of DEFAULT_PLANS){
  await db.execute(
   `INSERT IGNORE INTO plans(code,name,plan_type,billing_interval,monthly_price,annual_price,biennial_price,
    included_modules,module_prices,extra_user_price,currency,max_users,max_products,is_active)
    VALUES(?,?,?,'monthly',?,?,?,?,?,?,?,?,?,?)`,
   [plan.code,plan.name,plan.plan_type,plan.monthly_price,plan.annual_price,plan.biennial_price,
    JSON.stringify(plan.included_modules),JSON.stringify(plan.module_prices||{}),plan.extra_user_price,plan.currency,plan.max_users,plan.max_products,plan.is_active]
  );
 }
 await db.execute(
  `UPDATE plans SET monthly_price=25000,annual_price=350000,biennial_price=600000,
   extra_user_price=5000,included_modules=?,is_active=TRUE
   WHERE code='ultimate' AND monthly_price=0 AND annual_price IS NULL AND biennial_price IS NULL AND is_active=FALSE`,
  [JSON.stringify(ALL_MODULES)]
 );
 const customized=DEFAULT_PLANS.find(plan=>plan.code==='customized');
 await db.execute(
  `UPDATE plans SET included_modules=?,module_prices=?,is_active=TRUE
   WHERE code='customized' AND (module_prices IS NULL OR JSON_LENGTH(module_prices)=0)
   AND (included_modules IS NULL OR JSON_LENGTH(included_modules)=0) AND is_active=FALSE`,
  [JSON.stringify(customized.included_modules),JSON.stringify(customized.module_prices)]
 );
 const defaultFaqs=[
  ['Comment ajouter un produit ou corriger son stock ?','Ouvrez « Catalogue produits » pour créer ou modifier une fiche. Utilisez « Mouvements » pour enregistrer une entrée, une sortie ou un ajustement; chaque mouvement conserve sa traçabilité.','Stocks',10],
  ['Comment scanner un produit à la vente ?','Dans le point de vente, utilisez « Scanner un code ». Une douchette USB/Bluetooth fonctionne comme un clavier; la caméra nécessite une autorisation du navigateur et une connexion HTTPS ou localhost.','Ventes',20],
  ['Pourquoi une vente est-elle refusée ?','Une session de caisse doit être ouverte. Vérifiez aussi que le produit est actif, que sa quantité est suffisante et qu’une ordonnance est jointe lorsqu’elle est requise.','Ventes',30],
  ['Comment récupérer mes données ?','Les propriétaires et administrateurs peuvent télécharger une sauvegarde JSON dans Paramètres > Sauvegarde & restauration. Les logos enregistrés en base depuis la migration 2026111201_database_logo_storage sont inclus; les anciens logos du dossier public/uploads/logos doivent être téléversés de nouveau.','Données',40],
  ['Qui peut suivre une demande d’assistance ?','Chaque membre voit ses propres demandes. Les demandes de chat sont transmises à l’équipe REDAMS : un agent disponible peut les prendre en charge. Si aucun agent n’est disponible, le chat reste dans la file d’attente.','Assistance',50],
  ['Comment gérer mon abonnement ?','Contactez l’équipe REDAMS depuis le chat d’assistance pour toute question sur votre forfait ou son renouvellement.','Abonnement',60],
  ['Comment obtenir une formation ?','Consultez les ressources de formation dans Assistance ou contactez notre équipe pour organiser un accompagnement.','Formation',70]
 ];
 for(const [question,answer,category,sortOrder] of defaultFaqs){
  await db.execute(
   `INSERT INTO platform_faqs(question,answer,category,sort_order,is_active)
    SELECT ?,?,?,?,TRUE FROM DUAL
    WHERE NOT EXISTS(SELECT 1 FROM platform_faqs WHERE question=?)`,
   [question,answer,category,sortOrder,question]
  );
 }
 console.log('Schéma initialisé.');
 await db.end();
})().catch(async error=>{console.error(error);await db.end();process.exit(1);});
