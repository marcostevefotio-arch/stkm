const test=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const db=require('../src/config/database');
const sales=require('../src/routes/sales.routes');
const settings=require('../src/routes/settings.routes');

async function setup(t,role='CASHIER',userId=7,modules=null){
 const app=express();app.use(express.json());
 app.use((req,res,next)=>{req.tenantId=42;req.user={id:userId,role,subscription_modules:modules};next();});
 app.use('/sales',sales);app.use('/settings',settings);
 app.use((error,req,res,next)=>res.status(500).json({error:error.message}));
 const server=app.listen(0);await new Promise(resolve=>server.once('listening',resolve));
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 return `http://127.0.0.1:${server.address().port}`;
}
const post=(url,body,method='POST')=>fetch(url,{method,headers:{'content-type':'application/json'},body:JSON.stringify(body)});

test('separated sale persists its policy, deducts stock and never requires a cash session',async t=>{
 const original=db.getConnection,calls=[];
 db.getConnection=async()=>({
  beginTransaction:async()=>calls.push('begin'),commit:async()=>calls.push('commit'),rollback:async()=>calls.push('rollback'),release:()=>{},
  execute:async(sql,values)=>{
   calls.push({sql,values});
   if(sql.startsWith('SELECT id,role FROM users'))return [[{id:8,role:'CASHIER'}]];
   if(sql.includes('FROM organization_settings'))return [[{sales_tax_rate:'0',separate_sale_payment:1}]];
   if(sql.includes('FROM products WHERE'))return [[{id:3,sku:'S',name:'Produit',unit:'u',quantity_on_hand:'5',sale_price:'10',purchase_cost:'3',prescription_required:0,max_customer_quantity:null,minimum_purchase_interval_hours:null}]];
   if(sql.startsWith('INSERT INTO sales_invoices'))return [{insertId:15}];
   return [{affectedRows:1}];
  }
 });
 t.after(()=>{db.getConnection=original;});
 const base=await setup(t,'PHARMACIST');
 let response=await post(`${base}/sales`,{items:[{product_id:3,quantity:1}],payments:[{method:'cash',amount:10,cash_received:10}]});
 assert.equal(response.status,409);
 assert.match((await response.json()).error,/séparément/);
 assert.ok(calls.includes('rollback'));
 assert.equal(calls.some(x=>x.sql&&x.sql.startsWith('INSERT INTO sales_invoices')),false);
 calls.length=0;
 response=await post(`${base}/sales`,{items:[{product_id:3,quantity:1}],payments:[]});
 assert.equal(response.status,201);
 const result=await response.json();
 assert.equal(result.status,'issued');assert.equal(result.separate_cashier,true);
 const insert=calls.find(x=>x.sql&&x.sql.startsWith('INSERT INTO sales_invoices'));
 assert.equal(insert.values[10],7);assert.equal(insert.values[11],true);
 assert.ok(calls.some(x=>x.sql&&x.sql.startsWith('UPDATE products SET quantity_on_hand')));
 assert.equal(calls.some(x=>x.sql&&(x.sql.includes('FROM cash_sessions')||x.sql.startsWith('INSERT INTO sales_payments'))),false);
 assert.ok(calls.some(x=>x.sql&&x.sql.includes('INSERT INTO audit_logs')));
 assert.ok(calls.includes('commit'));
});

test('separated payment requires another user and a cash subscription before cash access',async t=>{
 const original=db.getConnection,calls=[];
 let seller=7,modules=null;
 db.getConnection=async()=>({
  beginTransaction:async()=>{},commit:async()=>calls.push('commit'),rollback:async()=>calls.push('rollback'),release:()=>{},
  execute:async(sql,values)=>{
   calls.push({sql,values});
   if(sql.includes('FROM sales_invoices WHERE'))return [[{id:15,patient_id:null,total_amount:'10',status:'issued',created_by:seller,separate_cashier:1}]];
   if(sql.includes('FROM cash_sessions'))return [[]];
   return [[]];
  }
 });
 t.after(()=>{db.getConnection=original;});
 const base=await setup(t,'ADMIN',7,modules);
 let response=await post(`${base}/sales/15/payments`,{payments:[{method:'cash',amount:10,cash_received:10}]});
 assert.equal(response.status,403);assert.match((await response.json()).error,/propre vente/);
 assert.ok(calls.includes('rollback'));assert.equal(calls.some(x=>x.sql&&x.sql.includes('FROM cash_sessions')),false);
 seller=8;calls.length=0;
 response=await post(`${base}/sales/15/payments`,{payments:[{method:'cash',amount:10,cash_received:10}]});
 assert.equal(response.status,409);assert.match((await response.json()).error,/session de caisse/);
 const cashQuery=calls.find(x=>x.sql&&x.sql.includes('FROM cash_sessions'));
 assert.deepEqual(cashQuery.values,[42]);
 const noCash=await setup(t,'CASHIER',7,'["sales"]');
 calls.length=0;
 response=await post(`${noCash}/sales/15/payments`,{payments:[{method:'cash',amount:10,cash_received:10}]});
 assert.equal(response.status,403);assert.match((await response.json()).error,/caisse/);
 assert.equal(calls.some(x=>x.sql&&x.sql.includes('FROM cash_sessions')),false);
});

test('cash queue uses tenant and current seller filters and requires cash feature',async t=>{
 const original=db.execute,calls=[];
 db.execute=async(sql,values)=>{
  calls.push({sql,values});
  if(sql.includes('FROM sales_invoices i'))return [[{id:15,items:[{product_name:'Produit test',quantity:'2.000',unit:'boîte'}]}]];
  return [[]];
 };
 t.after(()=>{db.execute=original;});
 const base=await setup(t,'CASHIER',7,'["sales","cash"]');
 const response=await fetch(`${base}/sales/pending`);
 assert.equal(response.status,200);
 const pending=await response.json();
 assert.deepEqual(pending[0].items,[{product_name:'Produit test',quantity:'2.000',unit:'boîte'}]);
 assert.deepEqual(calls[0].values,[42,7,0]);
 assert.match(calls[0].sql,/i\.created_by<>\?/);
 assert.match(calls[0].sql,/i\.separate_cashier=1/);
 assert.match(calls[0].sql,/JSON_ARRAYAGG\(JSON_OBJECT\('product_name',si\.product_name,'quantity',si\.quantity,'unit',si\.unit\)\)/);
 const noCash=await setup(t,'CASHIER',7,'["sales"]');
 assert.equal((await fetch(`${noCash}/sales/pending`)).status,403);
 assert.equal(calls.length,1);
 assert.equal((await fetch(`${base}/sales/pending?offset=-1`)).status,400);
});

test('invoice detail exposes the returned item value for the same balance calculation as payments',async t=>{
 const original=db.execute,calls=[];
 db.execute=async(sql,values)=>{
  calls.push({sql,values});
  if(sql.includes('FROM sales_invoices i WHERE'))return [[{id:15,total_amount:'100.00',paid_amount:'40.00',refunded_amount:'20.00'}]];
  if(sql.includes('SUM(ri.refund_amount)'))return [[{returned_value:'20.00'}]];
  return [[]];
 };
 t.after(()=>{db.execute=original;});
 const base=await setup(t);
 const response=await fetch(`${base}/sales/15`);
 assert.equal(response.status,200);
 const invoice=await response.json();
 assert.equal(invoice.returned_value,'20.00');
 assert.equal(Number(invoice.total_amount)-Number(invoice.returned_value)-Number(invoice.paid_amount)+Number(invoice.refunded_amount),60);
 assert.deepEqual(calls.find(x=>x.sql.includes('SUM(ri.refund_amount)')).values,['15']);
});

test('another cashier records partial and final payments atomically and returns the status',async t=>{
 const original=db.getConnection,calls=[];let paid=0,failAudit=false;
 db.getConnection=async()=>({
  beginTransaction:async()=>calls.push('begin'),commit:async()=>calls.push('commit'),rollback:async()=>calls.push('rollback'),release:()=>{},
  execute:async(sql,values)=>{
   calls.push({sql,values});
   if(sql.includes('FROM sales_invoices WHERE'))return [[{id:15,patient_id:null,total_amount:'10',status:paid?'partially_paid':'issued',created_by:8,separate_cashier:1}]];
   if(sql.includes('FROM cash_sessions'))return [[{id:4}]];
   if(sql.includes('SELECT COALESCE((SELECT SUM(amount) FROM sales_payments'))return [[{paid:String(paid),refunded:'0',returned_value:'0'}]];
   if(sql.includes('INSERT INTO sales_payments')){paid+=Number(values[2]);return [{affectedRows:1}];}
   if(sql.includes('SELECT i.total_amount'))return [[{total_amount:'10',paid:String(paid),refunded:'0',returned_value:'0'}]];
   if(sql.includes('SELECT COALESCE(SUM(ri.refund_amount)'))return [[{returned_value:'0'}]];
   if(failAudit&&sql.includes('INSERT INTO audit_logs'))throw Error('Audit unavailable');
   return [{affectedRows:1}];
  }
 });
 t.after(()=>{db.getConnection=original;});
 const base=await setup(t);
 let response=await post(`${base}/sales/15/payments`,{payments:[{method:'cash',amount:4,cash_received:4}]});
 assert.equal(response.status,200);assert.equal((await response.json()).status,'partially_paid');
 assert.ok(calls.some(x=>x.sql&&x.sql.startsWith('INSERT INTO cash_movements')&&x.values.at(-1)===7));
 assert.ok(calls.includes('commit'));
 calls.length=0;
 response=await post(`${base}/sales/15/payments`,{payments:[{method:'cash',amount:6,cash_received:6}]});
 assert.equal(response.status,200);assert.equal((await response.json()).status,'paid');
 assert.ok(calls.includes('commit'));
 paid=0;calls.length=0;failAudit=true;
 response=await post(`${base}/sales/15/payments`,{payments:[{method:'cash',amount:4,cash_received:4}]});
 assert.equal(response.status,500);assert.ok(calls.includes('rollback'));assert.ok(!calls.includes('commit'));
});

test('only admins may change the workflow, and audit failure rolls back the setting',async t=>{
 const original=db.getConnection,calls=[];let fail=false;
 db.getConnection=async()=>({
  beginTransaction:async()=>calls.push('begin'),commit:async()=>calls.push('commit'),rollback:async()=>calls.push('rollback'),release:()=>{},
  execute:async(sql,values)=>{
   calls.push({sql,values});
   if(sql.includes('SELECT separate_sale_payment'))return [[{separate_sale_payment:0}]];
   if(fail&&sql.includes('INSERT INTO audit_logs'))throw Error('Audit unavailable');
   return [{affectedRows:1}];
  }
 });
 t.after(()=>{db.getConnection=original;});
 const cashier=await setup(t);
 assert.equal((await post(`${cashier}/settings/sale-workflow`,{separate_sale_payment:true},'PUT')).status,403);
 const admin=await setup(t,'ADMIN');
 assert.equal((await post(`${admin}/settings/sale-workflow`,{separate_sale_payment:'true'},'PUT')).status,400);
 let response=await post(`${admin}/settings/sale-workflow`,{separate_sale_payment:true},'PUT');
 assert.equal(response.status,200);assert.ok(calls.includes('commit'));
 const audit=calls.find(x=>x.sql&&x.sql.includes('INSERT INTO audit_logs'));
 assert.deepEqual(JSON.parse(audit.values[3]),{before:false,after:true});
 calls.length=0;fail=true;
 response=await post(`${admin}/settings/sale-workflow`,{separate_sale_payment:true},'PUT');
 assert.equal(response.status,500);assert.ok(calls.includes('rollback'));assert.ok(!calls.includes('commit'));
});
