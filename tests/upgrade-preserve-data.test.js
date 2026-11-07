require('dotenv').config();
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const mysql=require('mysql2/promise');

const sql=fs.readFileSync(path.join(__dirname,'../database/upgrade-preserve-data.sql'),'utf8');
const procedure=sql.slice(sql.indexOf('CREATE PROCEDURE '),sql.indexOf('END$$')+3);
const call='CALL redams_upgrade_preserve_data_2026110701()';

test('production upgrade has explicit backup and target guards and no business-row DML',()=>{
 assert.match(sql,/SET @redams_expected_database = NULL/);
 assert.match(sql,/SET @redams_backup_confirmed = 0/);
 assert.doesNotMatch(sql,/\b(?:TRUNCATE|DELETE FROM|INSERT INTO|REPLACE INTO|DROP TABLE|DROP DATABASE)\b/i);
 assert.match(sql,/RESIGNAL/);
 assert.match(sql,/GET_LOCK\('redams_schema_migrations'/);
 assert.match(sql,/`lines` JSON NOT NULL/);
});

test('SQL upgrade preserves rows, reruns safely and blocks incompatible production schemas',
 {skip:process.env.UPGRADE_MYSQL_INTEGRATION!=='true'},async t=>{
 const connection=await mysql.createConnection({
  host:process.env.DB_HOST,port:Number(process.env.DB_PORT||3306),
  user:process.env.DB_USER,password:process.env.DB_PASSWORD,charset:'utf8mb4'
 });
 const name=`redams_upgrade_test_${crypto.randomBytes(8).toString('hex')}`;
 let created=false;
 t.after(async()=>{
  try{if(created)await connection.query(`DROP DATABASE \`${name}\``);}
  finally{await connection.end();}
 });
 await connection.query(`CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4`);
 created=true;
 await connection.query(`USE \`${name}\``);
 for(const statement of [
  'CREATE TABLE organizations(id BIGINT UNSIGNED PRIMARY KEY) ENGINE=InnoDB',
  "CREATE TABLE users(id BIGINT UNSIGNED PRIMARY KEY,role ENUM('OWNER','ADMIN','PHARMACIST','STOREKEEPER','CASHIER','VIEWER','SUPER_ADMIN') NOT NULL DEFAULT 'VIEWER') ENGINE=InnoDB",
  'CREATE TABLE plans(id BIGINT UNSIGNED PRIMARY KEY) ENGINE=InnoDB',
  'CREATE TABLE platform_promotions(id BIGINT UNSIGNED PRIMARY KEY) ENGINE=InnoDB',
  'CREATE TABLE products(id BIGINT UNSIGNED PRIMARY KEY,name VARCHAR(100),quantity_on_hand DECIMAL(14,3)) ENGINE=InnoDB',
  'CREATE TABLE sales_invoice_items(id BIGINT UNSIGNED PRIMARY KEY,quantity DECIMAL(14,3),line_total DECIMAL(14,2)) ENGINE=InnoDB',
  'CREATE TABLE organization_settings(organization_id BIGINT UNSIGNED PRIMARY KEY,display_name VARCHAR(100)) ENGINE=InnoDB',
  'CREATE TABLE sales_invoices(id BIGINT UNSIGNED PRIMARY KEY,total_amount DECIMAL(14,2),status VARCHAR(40)) ENGINE=InnoDB',
  'INSERT INTO organizations VALUES(42)',
  "INSERT INTO users VALUES(7,'CASHIER'),(8,'PHARMACIST')",
  'INSERT INTO plans VALUES(1)',
  'INSERT INTO platform_promotions VALUES(1)',
  "INSERT INTO products VALUES(3,'Existing product',17.125)",
  'INSERT INTO sales_invoice_items VALUES(5,2.125,40.25)',
  "INSERT INTO organization_settings VALUES(42,'Existing company')",
  "INSERT INTO sales_invoices VALUES(15,40.25,'paid')"
 ])await connection.query(statement);
 const tables=['organizations','users','plans','platform_promotions','products','sales_invoice_items','organization_settings','sales_invoices'];
 const projections=['id','id,role','id','id','id,name,quantity_on_hand','id,quantity,line_total','organization_id,display_name','id,total_amount,status'];
 async function snapshot(){
  const result=[];
  for(let i=0;i<tables.length;i++){
   const [rows]=await connection.query(`SELECT ${projections[i]} FROM \`${tables[i]}\` ORDER BY 1`);
   result.push(rows);
  }
  return result;
 }
 async function fieldExists(table,column){
  const [rows]=await connection.execute('SELECT COUNT(*) count FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND COLUMN_NAME=?',[name,table,column]);
  return Number(rows[0].count)>0;
 }
 const before=await snapshot();
 await connection.query(procedure);
 await assert.rejects(connection.query(call),/target database/);
 await connection.execute('SET @redams_expected_database=?',[name]);
 await assert.rejects(connection.query(call),/backup not confirmed/);
 assert.equal(await fieldExists('products','purchase_cost'),false);
 await connection.query('SET @redams_backup_confirmed=1');

 await connection.query('ALTER TABLE sales_invoices ADD COLUMN separate_cashier VARCHAR(10)');
 await assert.rejects(connection.query(call),/Incompatible existing column/);
 assert.equal(await fieldExists('products','purchase_cost'),false);
 await connection.query('ALTER TABLE sales_invoices DROP COLUMN separate_cashier');
 await connection.query('ALTER TABLE platform_promotions ADD COLUMN plan_id BIGINT UNSIGNED NULL');
 await connection.query('UPDATE platform_promotions SET plan_id=999 WHERE id=1');
 await assert.rejects(connection.query(call),/Orphan promotion references/);
 assert.equal(await fieldExists('products','purchase_cost'),false);
 await connection.query('UPDATE platform_promotions SET plan_id=NULL WHERE id=1');

 await connection.query(call);
 assert.deepEqual(await snapshot(),before);
 const [[product]]=await connection.query('SELECT purchase_cost FROM products WHERE id=3');
 assert.equal(product.purchase_cost,null);
 const [[invoice]]=await connection.query('SELECT separate_cashier FROM sales_invoices WHERE id=15');
 assert.equal(invoice.separate_cashier,0);
 await connection.query("UPDATE products SET purchase_cost=7.1250 WHERE id=3");
 await connection.query('UPDATE organization_settings SET separate_sale_payment=1 WHERE organization_id=42');
 await connection.query('UPDATE sales_invoices SET separate_cashier=1 WHERE id=15');
 await connection.query("INSERT INTO accounting_books(organization_id,opening_date,accounts,created_by) VALUES(42,'2026-01-01',JSON_ARRAY(),7)");
 await connection.query("INSERT INTO accounting_entries(organization_id,entry_date,kind,status,description,`lines`,created_by) VALUES(42,'2026-01-01','normal','draft','Existing entry',JSON_ARRAY(),7)");
 await connection.query("INSERT INTO accounting_review_snapshots(organization_id,status,period_from,period_to,snapshot_text,snapshot_hash,created_by) VALUES(42,'preliminary','2026-01-01','2026-12-31','{}',REPEAT('a',64),7)");
 const allTables=[...tables,'accounting_books','accounting_entries','accounting_review_snapshots'];
 async function fullSnapshot(){
  const result=[];
  for(const table of allTables){
   const [rows]=await connection.query(`SELECT * FROM \`${table}\` ORDER BY 1`);
   result.push(rows);
  }
  return result;
 }
 const updated=await fullSnapshot();
 await connection.query(call);
 assert.deepEqual(await fullSnapshot(),updated);
 await connection.query('ALTER TABLE accounting_entries ADD INDEX test_fk_support(organization_id)');
 await connection.query('ALTER TABLE accounting_entries DROP INDEX idx_accounting_entries_tenant_date');
 await assert.rejects(connection.query(call),/accounting index/);
 await connection.query('DROP PROCEDURE redams_upgrade_preserve_data_2026110701');
});
