const test=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const db=require('../src/config/database');
const salesRoutes=require('../src/routes/sales.routes');

async function listen(app,t){
 const server=app.listen(0);
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 await new Promise(resolve=>server.once('listening',resolve));
 return `http://127.0.0.1:${server.address().port}/api/sales`;
}
function appFor(role='CASHIER'){
 const app=express();app.use(express.json());
 app.use((req,res,next)=>{req.tenantId=42;req.user={id:7,role};next();});
 app.use('/api/sales',salesRoutes);
 return app;
}

test('sales validate lines, payment methods and prescription images before database access',async(t)=>{
 const originalGetConnection=db.getConnection;let calls=0;
 db.getConnection=async()=>{calls+=1;throw Error('Database should not be called');};
 t.after(()=>{db.getConnection=originalGetConnection;});
 const url=await listen(appFor(),t);
 const invalidLine=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({items:[{product_id:1,quantity:0.0001}]})});
 assert.equal(invalidLine.status,400);
 const invalidPayment=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({items:[{product_id:1,quantity:1}],payments:[{method:'bitcoin',amount:1}]})});
 assert.equal(invalidPayment.status,400);
 const invalidPrescription=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({items:[{product_id:1,quantity:1}],prescription_image:{mime_type:'image/jpeg',data:'not-an-image'}})});
 assert.equal(invalidPrescription.status,400);
 assert.equal(calls,0);
});

test('sales API restricts sales and payment operations to authorized roles',async(t)=>{
 const originalGetConnection=db.getConnection;let calls=0;
 db.getConnection=async()=>{calls+=1;throw Error('Database should not be called');};
 t.after(()=>{db.getConnection=originalGetConnection;});
 const url=await listen(appFor('VIEWER'),t);
 const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({items:[{product_id:1,quantity:1}]})});
 assert.equal(response.status,403);
 assert.equal(calls,0);
});

test('cash payments require an explicit received amount on both sale and payment endpoints',async t=>{
 const original=db.getConnection;let calls=0;
 db.getConnection=async()=>{calls++;throw Error('Invalid cash input must not reach the database');};
 t.after(()=>{db.getConnection=original;});
 const url=await listen(appFor(),t);
 for(const value of [undefined,null,'',' ',0,9,-1,'invalid']){
  const payment={method:'cash',amount:10,...(value===undefined?{}:{cash_received:value})};
  for(const endpoint of [url,`${url}/15/payments`]){
   const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({items:[{product_id:3,quantity:1}],payments:[payment]})});
   assert.equal(response.status,400);
   assert.match((await response.json()).error,/espèces/);
  }
 }
 assert.equal(calls,0);
});

for(const role of ['CASHIER','PHARMACIST'])test(`single-step ${role}: receipt, prescription proof, tax, stock and cash payment are recorded atomically`,async(t)=>{
 const originalGetConnection=db.getConnection,originalExecute=db.execute,queries=[];
 let committed=false,rolledBack=false,released=false;
 const connection={
  beginTransaction:async()=>{},
  commit:async()=>{committed=true;},
  rollback:async()=>{rolledBack=true;},
  release:()=>{released=true;},
  execute:async(sql,values)=>{
   queries.push({sql,values});
   if(sql.startsWith('SELECT id,role FROM users'))return [[{id:8,role:'CASHIER'}],[]];
   if(sql.includes('FROM cash_sessions')&&sql.includes("status='open'"))return [[{id:5,opening_cash:'100.00',opened_at:'2026-01-01 09:00:00'}],[]];
   if(sql.includes('FROM products WHERE organization_id=? AND is_active=1'))return [[{id:3,sku:'SKU-3',name:'Produit test',unit:'boîte',quantity_on_hand:'8.000',sale_price:'10.00',purchase_cost:'3.1234',prescription_required:1,max_customer_quantity:'2.000',minimum_purchase_interval_hours:null}],[]];
   if(sql.includes('SELECT sales_tax_rate'))return [[{sales_tax_rate:'10.00'}],[]];
   if(sql.startsWith('INSERT INTO sales_invoices'))return [{insertId:70},[]];
   if(sql.includes('SELECT COALESCE((SELECT SUM(amount) FROM sales_payments'))return [[{paid:'0.00',refunded:'0.00',returned_value:'0.00'}],[]];
   if(sql.includes('SELECT i.total_amount'))return [[{total_amount:'11.00',paid:'11.00',refunded:'0.00',returned_value:'0.00'}],[]];
   if(sql.includes('SELECT COALESCE(SUM(ri.refund_amount)'))return [[{returned_value:'0.00'}],[]];
   return [{affectedRows:1,insertId:90},[]];
  },
 };
 db.getConnection=async()=>connection;
 db.execute=async()=>[{affectedRows:1},[]];
 t.after(()=>{db.getConnection=originalGetConnection;db.execute=originalExecute;});
 const url=await listen(appFor(role),t);
 const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
  items:[{product_id:3,quantity:1,prescription_provided:true}],
 prescription_image:{mime_type:'image/jpeg',data:Buffer.from([0xff,0xd8,0xff,0x01,0x02]).toString('base64')},
 payments:[{method:'cash',amount:11,cash_received:20}],
 })});
 assert.equal(response.status,201);
 const result=await response.json();
 assert.equal(result.invoice_number,`FAC-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-000070`);
 assert.equal(result.tax_amount,1);
 assert.equal(result.total_amount,11);
 assert.deepEqual(result.review_flags,[]);
 assert.equal(committed,true);assert.equal(rolledBack,false);assert.equal(released,true);
 const line=queries.find(query=>query.sql.startsWith('INSERT INTO sales_invoice_items'));
 assert.equal(line.values[10],1);assert.equal(line.values[11],true);
 assert.equal(line.values[12],'3.1234');
 assert.match(queries.find(query=>query.sql.includes('FROM products WHERE organization_id=? AND is_active=1')).sql,/purchase_cost[\s\S]*FOR UPDATE/);
 const prescription=queries.find(query=>query.sql.startsWith('INSERT INTO sales_invoice_prescriptions'));
 assert.equal(prescription.values[0],70);assert.equal(prescription.values[1],'image/jpeg');
 assert.deepEqual(prescription.values[2],Buffer.from([0xff,0xd8,0xff,0x01,0x02]));
 assert.equal(prescription.values[3],7);
 assert.deepEqual(queries.find(query=>query.sql.startsWith('UPDATE products SET quantity_on_hand')).values,[7,3,42]);
 const payment=queries.find(query=>query.sql.startsWith('INSERT INTO sales_payments'));
 assert.equal(payment.values[3],20);assert.equal(payment.values[4],9);
 assert.equal(queries.some(query=>query.sql.startsWith('INSERT INTO stock_movements')&&query.sql.includes("'OUT'")),true);
});

test('prescription-required products cannot be sold without an attached prescription image',async(t)=>{
 const originalGetConnection=db.getConnection;
 const connection={
  beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{},release:()=>{},
  execute:async(sql)=>sql.includes('FROM cash_sessions')?[[{id:5}],[]]:sql.includes('FROM products WHERE organization_id=? AND is_active=1')?[[{id:3,sku:'SKU-3',name:'Produit réglementé',unit:'boîte',quantity_on_hand:'5.000',sale_price:'10.00',prescription_required:1,max_customer_quantity:null,minimum_purchase_interval_hours:null}],[]]:[[],[]],
 };
 db.getConnection=async()=>connection;
 t.after(()=>{db.getConnection=originalGetConnection;});
 const url=await listen(appFor(),t);
 const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({items:[{product_id:3,quantity:1,prescription_provided:true}]})});
 assert.equal(response.status,400);
 assert.match((await response.json()).error,/photo de l’ordonnance/i);
});

test('a sale attempted while the till is closed returns a clear error',async(t)=>{
 const originalGetConnection=db.getConnection;let rolledBack=false;
 db.getConnection=async()=>({
  beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{rolledBack=true;},release:()=>{},
  execute:async sql=>sql.includes('FROM cash_sessions')?[[],[]]:[[],[]],
 });
 t.after(()=>{db.getConnection=originalGetConnection;});
 const url=await listen(appFor(),t);
 const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({items:[{product_id:1,quantity:1}]})});
 assert.equal(response.status,409);
 assert.match((await response.json()).error,/Ouvrez une session de caisse/i);
 assert.equal(rolledBack,true);
});

test('cashiers cannot retrieve saved medical prescriptions',async(t)=>{
 const originalExecute=db.execute;let calls=0;
 db.execute=async()=>{calls+=1;return [[],[]];};
 t.after(()=>{db.execute=originalExecute;});
 const url=await listen(appFor(),t);
 const response=await fetch(`${url}/70/prescription`);
 assert.equal(response.status,403);
 assert.equal(calls,0);
});

test('pharmacists can retrieve a tenant-scoped prescription image without caching it',async(t)=>{
 const originalExecute=db.execute,image=Buffer.from([0xff,0xd8,0xff,0x01]);
 db.execute=async(sql,values)=>{assert.match(sql,/i\.organization_id=\?/);assert.deepEqual(values,['70',42]);return [[{mime_type:'image/jpeg',image_data:image}],[]];};
 t.after(()=>{db.execute=originalExecute;});
 const url=await listen(appFor('PHARMACIST'),t);
 const response=await fetch(`${url}/70/prescription`);
 assert.equal(response.status,200);
 assert.equal(response.headers.get('content-type'),'image/jpeg');
 assert.equal(response.headers.get('cache-control'),'private, no-store');
 assert.equal(response.headers.get('x-content-type-options'),'nosniff');
 assert.deepEqual(Buffer.from(await response.arrayBuffer()),image);
});

test('quantity and short-interval purchase checks are returned as review-only flags',async(t)=>{
 const originalGetConnection=db.getConnection,originalExecute=db.execute; let recordedCost;
 const connection={
  beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{},release:()=>{},
  execute:async(sql,values)=>{
   if(sql.startsWith('SELECT id,role FROM users'))return [[{id:8,role:'CASHIER'}],[]];
   if(sql.includes('FROM cash_sessions')&&sql.includes("status='open'"))return [[{id:5,opening_cash:'0.00'}],[]];
   if(sql.includes('FROM patients WHERE id=?'))return [[{id:8,full_name:'Patient test'}],[]];
   if(sql.includes('FROM products WHERE organization_id=? AND is_active=1'))return [[{id:3,sku:'SKU-3',name:'Produit à surveiller',unit:'boîte',quantity_on_hand:'10.000',sale_price:'1.00',purchase_cost:null,prescription_required:0,max_customer_quantity:'2.000',minimum_purchase_interval_hours:24}],[]];
   if(sql.includes('SELECT sales_tax_rate'))return [[{sales_tax_rate:'0.00'}],[]];
   if(sql.includes('SELECT COALESCE(SUM(CASE WHEN TIMESTAMPDIFF'))return [[{recent_quantity:'1.000',recent_seconds:7200}],[]];
   if(sql.startsWith('INSERT INTO sales_invoices'))return [{insertId:71},[]];
   if(sql.startsWith('INSERT INTO sales_invoice_items'))recordedCost=values[12];
   return [{affectedRows:1},[]];
  },
 };
 db.getConnection=async()=>connection;db.execute=async()=>[{affectedRows:1},[]];
 t.after(()=>{db.getConnection=originalGetConnection;db.execute=originalExecute;});
 const url=await listen(appFor(),t);
 const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({patient_id:8,items:[{product_id:3,quantity:3}]})});
 assert.equal(response.status,201);
 const result=await response.json();
 assert.deepEqual(result.review_flags.map(flag=>flag.type),['short_interval','quantity_limit']);
 assert.equal(recordedCost,null);
});

test('a missing historical cost column rolls back the sale rather than losing the snapshot',async(t)=>{
 const originalGetConnection=db.getConnection, calls=[];
 const connection={
  beginTransaction:async()=>calls.push('begin'),commit:async()=>calls.push('commit'),
  rollback:async()=>calls.push('rollback'),release:()=>calls.push('release'),
  execute:async(sql)=>{
   if(sql.includes('FROM cash_sessions'))return [[{id:5}],[]];
   if(sql.includes('FROM products WHERE organization_id=? AND is_active=1'))return [[{id:3,sku:'S',name:'P',unit:'u',quantity_on_hand:'2.000',sale_price:'1.00',purchase_cost:'0.5000',prescription_required:0,max_customer_quantity:null,minimum_purchase_interval_hours:null}],[]];
   if(sql.includes('SELECT sales_tax_rate'))return [[{sales_tax_rate:'0.00'}],[]];
   if(sql.startsWith('INSERT INTO sales_invoices'))return [{insertId:71},[]];
   if(sql.startsWith('INSERT INTO sales_invoice_items'))throw Error('Unknown column unit_purchase_cost');
   return [{affectedRows:1},[]];
  }
 };
 db.getConnection=async()=>connection;t.after(()=>{db.getConnection=originalGetConnection;});
 const app=appFor();app.use((error,req,res,next)=>res.status(500).json({error:error.message}));
 const url=await listen(app,t);
 const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({items:[{product_id:3,quantity:1}]})});
 assert.equal(response.status,500);assert.match((await response.json()).error,/Unknown column/);
 assert.ok(calls.includes('rollback'));assert.ok(calls.includes('release'));assert.ok(!calls.includes('commit'));
});

test('invoice detail does not expose historical purchase cost to sales users',async t=>{
 const originalExecute=db.execute;let itemQuery;
 db.execute=async(sql)=>{
  if(sql.includes('FROM sales_invoices i WHERE'))return [[{id:70}],[]];
  if(sql.includes('SUM(ri.refund_amount)'))return [[{returned_value:'0.00'}],[]];
  if(sql.includes('FROM sales_invoice_items WHERE')){itemQuery=sql;return [[],[]];}
  return [[],[]];
 };
 t.after(()=>{db.execute=originalExecute;});
 const url=await listen(appFor(),t);
 assert.equal((await fetch(`${url}/70`)).status,200);
 assert.ok(itemQuery);assert.doesNotMatch(itemQuery,/unit_purchase_cost|\*/);
});

test('a returned item is refunded from its receipt value and restocked in one transaction',async(t)=>{
 const originalGetConnection=db.getConnection,originalExecute=db.execute,queries=[];
 let committed=false;
 const connection={
  beginTransaction:async()=>{},commit:async()=>{committed=true;},rollback:async()=>{},release:()=>{},
  execute:async(sql,values)=>{
   queries.push({sql,values});
   if(sql.includes('FROM sales_invoices WHERE id=?')&&sql.includes('FOR UPDATE'))return [[{id:70,invoice_number:'FAC-TEST',total_amount:'20.00',status:'paid'}],[]];
   if(sql.includes('FROM cash_sessions')&&sql.includes("status='open'"))return [[{id:5,opening_cash:'50.00'}],[]];
   if(sql.includes('FROM sales_invoice_items si JOIN products'))return [[{id:9,product_id:3,quantity:'2.000',returned_quantity:'0.000',line_total:'20.00',product_name:'Produit test',unit:'boîte',quantity_on_hand:'3.000'}],[]];
   if(sql.startsWith('SELECT COALESCE(SUM(refund_amount),0) refunded'))return [[{refunded:'0.00'}],[]];
   if(sql.includes('SELECT COALESCE((SELECT SUM(amount) FROM sales_payments'))return [[{paid:'20.00',refunded:'0.00'}],[]];
   if(sql.startsWith('INSERT INTO sales_returns'))return [{insertId:99},[]];
   if(sql.includes('SELECT i.total_amount'))return [[{total_amount:'20.00',paid:'20.00',refunded:'10.00',returned_value:'10.00'}],[]];
   if(sql.includes('SELECT COALESCE(SUM(ri.refund_amount)'))return [[{returned_value:'10.00'}],[]];
   return [{affectedRows:1,insertId:99},[]];
  },
 };
 db.getConnection=async()=>connection;db.execute=async()=>[{affectedRows:1},[]];
 t.after(()=>{db.getConnection=originalGetConnection;db.execute=originalExecute;});
 const url=await listen(appFor(),t);
 const response=await fetch(`${url}/70/returns`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({items:[{item_id:9,quantity:1,restocked:true}],refund_method:'cash',reason:'Produit retourné'})});
 assert.equal(response.status,201);
 const result=await response.json();
 assert.equal(result.refund_amount,10);
 assert.equal(committed,true);
 assert.deepEqual(queries.find(query=>query.sql.startsWith('UPDATE products SET quantity_on_hand=quantity_on_hand+')).values,[1,3,42]);
 assert.match(queries.find(query=>query.sql.startsWith('UPDATE products SET quantity_on_hand=quantity_on_hand+')).sql,/purchase_cost=NULL/);
 assert.equal(queries.some(query=>query.sql.startsWith('INSERT INTO stock_movements')&&query.sql.includes("'IN'")),true);
 assert.equal(queries.some(query=>query.sql.startsWith('INSERT INTO cash_movements')&&query.sql.includes("'refund'")),true);
});
