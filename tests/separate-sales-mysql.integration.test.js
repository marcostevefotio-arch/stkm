require('dotenv').config();
const test=require('node:test');
const assert=require('node:assert/strict');
const mysql=require('mysql2/promise');
const express=require('express');
const db=require('../src/config/database');
const sales=require('../src/routes/sales.routes');

test('separated sale and payment work on isolated MySQL temporary tables',{skip:process.env.SALES_MYSQL_INTEGRATION!=='true'},async t=>{
 const c=await mysql.createConnection({host:process.env.DB_HOST,port:Number(process.env.DB_PORT||3306),user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME,charset:'utf8mb4'});
 t.after(()=>c.end());
 const statements=[
  'CREATE TEMPORARY TABLE organizations (id BIGINT UNSIGNED PRIMARY KEY) ENGINE=InnoDB',
  'CREATE TEMPORARY TABLE organization_settings (organization_id BIGINT UNSIGNED PRIMARY KEY, sales_tax_rate DECIMAL(5,2), separate_sale_payment BOOLEAN NOT NULL DEFAULT 0) ENGINE=InnoDB',
  'CREATE TEMPORARY TABLE products (id BIGINT UNSIGNED PRIMARY KEY, organization_id BIGINT UNSIGNED, sku VARCHAR(80), name VARCHAR(190), unit VARCHAR(40), quantity_on_hand DECIMAL(14,3), sale_price DECIMAL(14,2), purchase_cost DECIMAL(18,4), prescription_required BOOLEAN, max_customer_quantity DECIMAL(14,3), minimum_purchase_interval_hours INT, is_active BOOLEAN) ENGINE=InnoDB',
  "CREATE TEMPORARY TABLE sales_invoices (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,organization_id BIGINT UNSIGNED,invoice_number VARCHAR(50),patient_id BIGINT UNSIGNED,patient_name VARCHAR(190),subtotal DECIMAL(14,2),tax_rate DECIMAL(5,2),tax_amount DECIMAL(14,2),total_amount DECIMAL(14,2),status VARCHAR(40) DEFAULT 'issued',review_flags JSON,notes TEXT,created_by BIGINT UNSIGNED,separate_cashier BOOLEAN NOT NULL DEFAULT 0) ENGINE=InnoDB",
  'CREATE TEMPORARY TABLE sales_invoice_items (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,invoice_id BIGINT UNSIGNED,product_id BIGINT UNSIGNED,sku VARCHAR(80),product_name VARCHAR(190),unit VARCHAR(40),quantity DECIMAL(14,3),unit_price DECIMAL(14,2),line_subtotal DECIMAL(14,2),line_tax DECIMAL(14,2),line_total DECIMAL(14,2),prescription_required BOOLEAN,prescription_provided BOOLEAN,unit_purchase_cost DECIMAL(18,4)) ENGINE=InnoDB',
  'CREATE TEMPORARY TABLE stock_movements (organization_id BIGINT UNSIGNED,product_id BIGINT UNSIGNED,user_id BIGINT UNSIGNED,movement_type VARCHAR(20),quantity DECIMAL(14,3),reference VARCHAR(120),notes TEXT) ENGINE=InnoDB',
  'CREATE TEMPORARY TABLE cash_sessions (id BIGINT UNSIGNED PRIMARY KEY,organization_id BIGINT UNSIGNED,status VARCHAR(20),opening_cash DECIMAL(14,2),opened_at DATETIME) ENGINE=InnoDB',
  'CREATE TEMPORARY TABLE sales_payments (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,invoice_id BIGINT UNSIGNED,payment_method VARCHAR(30),amount DECIMAL(14,2),cash_received DECIMAL(14,2),cash_change DECIMAL(14,2),insurer_id BIGINT UNSIGNED,reference VARCHAR(190),recorded_by BIGINT UNSIGNED) ENGINE=InnoDB',
  'CREATE TEMPORARY TABLE sales_returns (id BIGINT UNSIGNED PRIMARY KEY,invoice_id BIGINT UNSIGNED,refund_amount DECIMAL(14,2)) ENGINE=InnoDB',
  'CREATE TEMPORARY TABLE sales_return_items (return_id BIGINT UNSIGNED,refund_amount DECIMAL(14,2)) ENGINE=InnoDB',
  'CREATE TEMPORARY TABLE cash_movements (organization_id BIGINT UNSIGNED,session_id BIGINT UNSIGNED,movement_type VARCHAR(20),payment_method VARCHAR(30),amount DECIMAL(14,2),cash_received DECIMAL(14,2),cash_change DECIMAL(14,2),description VARCHAR(255),invoice_id BIGINT UNSIGNED,recorded_by BIGINT UNSIGNED) ENGINE=InnoDB',
  'CREATE TEMPORARY TABLE audit_logs (organization_id BIGINT UNSIGNED,user_id BIGINT UNSIGNED,action VARCHAR(100),entity_type VARCHAR(100),entity_id VARCHAR(80),details_json JSON) ENGINE=InnoDB'
 ];
 for(const sql of statements)await c.query(sql);
 await c.execute('INSERT INTO organizations VALUES (42)');
 await c.execute('INSERT INTO organization_settings VALUES (42,0,1)');
 await c.execute("INSERT INTO products VALUES (3,42,'S','Produit','u',5,10,3,0,NULL,NULL,1)");
 const original=db.getConnection;
 db.getConnection=async()=>({beginTransaction:()=>c.beginTransaction(),commit:()=>c.commit(),rollback:()=>c.rollback(),release:()=>{},execute:(...args)=>c.execute(...args)});
 t.after(()=>{db.getConnection=original;});
 let user=7,role='PHARMACIST';
 const app=express();app.use(express.json());app.use((req,res,next)=>{req.tenantId=42;req.user={id:user,role};next();});
 app.use('/sales',sales);app.use((error,req,res,next)=>res.status(500).json({error:error.message}));
 const server=app.listen(0);await new Promise(resolve=>server.once('listening',resolve));
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 const base=`http://127.0.0.1:${server.address().port}/sales`;
 const post=(path,data)=>fetch(`${base}${path}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)});
 let response=await post('',{items:[{product_id:3,quantity:1}],payments:[]});
 assert.equal(response.status,201,await response.clone().text());
 const invoice=await response.json();assert.equal(invoice.status,'issued');
 let [rows]=await c.execute('SELECT quantity_on_hand FROM products WHERE id=3');assert.equal(rows[0].quantity_on_hand,'4.000');
 await c.execute('UPDATE organization_settings SET separate_sale_payment=0 WHERE organization_id=42');
 await c.execute("INSERT INTO cash_sessions VALUES(4,42,'open',0,NOW())");
 role='ADMIN';
 response=await post(`/${invoice.id}/payments`,{payments:[{method:'cash',amount:4,cash_received:4}]});
 assert.equal(response.status,403);
 user=8;role='CASHIER';
 response=await post(`/${invoice.id}/payments`,{payments:[{method:'cash',amount:4,cash_received:4}]});
 assert.equal(response.status,200,await response.clone().text());assert.equal((await response.json()).status,'partially_paid');
 response=await post(`/${invoice.id}/payments`,{payments:[{method:'cash',amount:6,cash_received:6}]});
 assert.equal(response.status,200,await response.clone().text());assert.equal((await response.json()).status,'paid');
 [rows]=await c.execute('SELECT recorded_by,amount FROM sales_payments ORDER BY id');
 assert.deepEqual(rows.map(row=>[row.recorded_by,row.amount]),[[8,'4.00'],[8,'6.00']]);
 [rows]=await c.execute('SELECT COUNT(*) count FROM audit_logs');assert.equal(Number(rows[0].count),3);
});
