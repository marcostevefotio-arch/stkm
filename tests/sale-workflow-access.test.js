const test=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const db=require('../src/config/database');
const policy=require('../public/js/access-policy');
const sales=require('../src/routes/sales.routes');
const cash=require('../src/routes/cash.routes');

test('page access follows roles, subscriptions and both sale modes',()=>{
 for(const role of ['OWNER','ADMIN','PHARMACIST','CASHIER','STOREKEEPER','VIEWER']){
  for(const separate of [0,1]){
   const user={role,subscription_modules:null},settings={separate_sale_payment:separate};
   const operator=['OWNER','ADMIN','PHARMACIST','CASHIER'].includes(role);
   assert.equal(policy.canAccessPage(user,settings,'pos'),operator&&!(separate&&role==='CASHIER'));
   assert.equal(policy.canAccessPage(user,settings,'cash'),operator&&!(separate&&role==='PHARMACIST'));
   assert.equal(policy.canAccessPage(user,settings,'invoices'),operator);
   assert.equal(policy.canAccessPage(user,settings,'settings'),['OWNER','ADMIN'].includes(role));
   assert.equal(policy.canAccessPage(user,settings,'workflow'),['OWNER','ADMIN'].includes(role));
   assert.equal(policy.canAccessPage(user,settings,'patients'),['OWNER','ADMIN','PHARMACIST'].includes(role));
   assert.equal(policy.canAccessPage(user,settings,'security'),true);
   assert.equal(policy.canAccessPage(user,settings,'products'),['OWNER','ADMIN','STOREKEEPER','VIEWER'].includes(role));
   assert.equal(policy.canAccessPage(user,settings,'purchases'),['OWNER','ADMIN','STOREKEEPER','VIEWER'].includes(role));
   assert.equal(policy.canAccessPage(user,settings,'reports'),['OWNER','ADMIN','VIEWER'].includes(role));
  }
 }
 const pharmacist={role:'PHARMACIST',subscription_modules:'["sales"]'};
 assert.equal(policy.canAccessPage(pharmacist,{separate_sale_payment:1},'pos'),true);
 assert.equal(policy.canAccessPage(pharmacist,{separate_sale_payment:0},'pos'),false);
 assert.equal(policy.canAccessPage(pharmacist,{},'products'),false);
 assert.equal(policy.canAccessPage({...pharmacist,subscription_modules:'invalid'}, {},'pos'),false);
 const accountant={role:'ACCOUNTANT',subscription_modules:['reports']};
 assert.equal(policy.canAccessPage(accountant,{},'accounting-results'),true);
 assert.equal(policy.canAccessPage(accountant,{},'dashboard'),false);
 assert.equal(policy.canAccessPage(accountant,{},'cash'),false);
 assert.equal(policy.canAccessPage({role:'UNKNOWN'}, {},'products'),false);
 assert.equal(policy.canAccessModule({role:'CASHIER',subscription_modules:null},'stock'),false);
});

async function setup(t,role){
 const app=express();app.use(express.json());
 app.use((req,res,next)=>{req.tenantId=42;req.user={id:7,role,subscription_modules:null};next();});
 app.use('/sales',sales);app.use('/cash',cash);
 app.use((error,req,res,next)=>res.status(500).json({error:error.message}));
 const server=app.listen(0);await new Promise(resolve=>server.once('listening',resolve));
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 return `http://127.0.0.1:${server.address().port}`;
}
const post=(url,body)=>fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});

test('two-step cashier cannot create sales and denied requests roll back before stock access',async t=>{
 const original=db.getConnection,calls=[];
 db.getConnection=async()=>({
  beginTransaction:async()=>{},commit:async()=>calls.push('commit'),rollback:async()=>calls.push('rollback'),release:()=>{},
  execute:async sql=>{calls.push(sql);return sql.includes('organization_settings')?[[{separate_sale_payment:1}]]:[[]];}
 });
 t.after(()=>{db.getConnection=original;});
 const base=await setup(t,'CASHIER');
 const response=await post(`${base}/sales`,{items:[{product_id:3,quantity:1}],payments:[]});
 assert.equal(response.status,403);
 assert.ok(calls.includes('rollback'));assert.ok(!calls.includes('commit'));
 assert.equal(calls.some(sql=>sql.includes('FROM products')),false);
});

test('two-step pharmacist is denied cash, queues, payments and refunds without cash side effects',async t=>{
 const originalExecute=db.execute,originalConnection=db.getConnection,calls=[];
 const execute=async(sql,values)=>{
  calls.push({sql,values});
  if(sql.includes('organization_settings'))return [[{separate_sale_payment:1}]];
  return [[]];
 };
 db.execute=execute;
 db.getConnection=async()=>({beginTransaction:async()=>{},rollback:async()=>calls.push({sql:'rollback'}),release:()=>{},execute});
 t.after(()=>{db.execute=originalExecute;db.getConnection=originalConnection;});
 const base=await setup(t,'PHARMACIST');
 const responses=[
  await fetch(`${base}/cash`),
  await post(`${base}/cash/sessions`,{opening_cash:0}),
  await post(`${base}/cash/sessions/4/close`,{closing_cash:0}),
  await post(`${base}/cash/movements`,{movement_type:'income',payment_method:'cash',amount:1,description:'Test'}),
  await fetch(`${base}/sales/pending`),
  await post(`${base}/sales/15/payments`,{payments:[{method:'cash',amount:10,cash_received:10}]}),
  await post(`${base}/sales/15/returns`,{items:[{item_id:1,quantity:1}],refund_method:'cash',reason:'Retour'})
 ];
 assert.deepEqual(responses.map(response=>response.status),responses.map(()=>403));
 assert.equal(calls.some(({sql})=>sql.includes('cash_sessions')||sql.includes('cash_movements')||sql.includes('sales_invoices')),false);
 assert.equal(calls.filter(({sql})=>sql==='rollback').length,2);
});

test('a prepared invoice still rejects pharmacist payment after switching to single-step mode',async t=>{
 const original=db.getConnection,calls=[];
 db.getConnection=async()=>({
  beginTransaction:async()=>{},rollback:async()=>calls.push('rollback'),release:()=>{},
  execute:async sql=>{
   calls.push(sql);
   if(sql.includes('organization_settings'))return [[{separate_sale_payment:0}]];
   if(sql.includes('FROM sales_invoices'))return [[{id:15,total_amount:10,status:'issued',created_by:8,separate_cashier:1}]];
   return [[]];
  }
 });
 t.after(()=>{db.getConnection=original;});
 const base=await setup(t,'PHARMACIST');
 const response=await post(`${base}/sales/15/payments`,{payments:[{method:'cash',amount:10,cash_received:10}]});
 assert.equal(response.status,403);assert.ok(calls.includes('rollback'));
 assert.equal(calls.some(sql=>sql.includes('cash_sessions')),false);
});

test('single-step pharmacist can read cash and settings failures are reported rather than allowed',async t=>{
 const original=db.execute;let fail=false;
 db.execute=async sql=>{
  if(sql.includes('organization_settings')){
   if(fail)throw Error('Settings unavailable');
   return [[{separate_sale_payment:0}]];
  }
  return [[]];
 };
 t.after(()=>{db.execute=original;});
 const base=await setup(t,'PHARMACIST');
 assert.equal((await fetch(`${base}/cash`)).status,200);
 fail=true;
 const response=await fetch(`${base}/cash`);
 assert.equal(response.status,500);assert.match((await response.json()).error,/Settings unavailable/);
});

test('cash mutations recheck the workflow under the organization lock',async t=>{
 const originalExecute=db.execute,originalConnection=db.getConnection,calls=[];
 db.execute=async()=>[[{separate_sale_payment:0}]];
 db.getConnection=async()=>({
  beginTransaction:async()=>{},rollback:async()=>calls.push('rollback'),release:()=>{},
  execute:async sql=>{
   calls.push(sql);
   return sql.includes('organization_settings')?[[{separate_sale_payment:1}]]:[[]];
  }
 });
 t.after(()=>{db.execute=originalExecute;db.getConnection=originalConnection;});
 const base=await setup(t,'PHARMACIST');
 for(const [path,body] of [
  ['/cash/sessions',{opening_cash:0}],
  ['/cash/sessions/4/close',{closing_cash:0}],
  ['/cash/movements',{movement_type:'income',payment_method:'cash',amount:1,description:'Test'}]
 ]){
  assert.equal((await post(`${base}${path}`,body)).status,403);
 }
 assert.equal(calls.filter(sql=>sql==='rollback').length,3);
 assert.equal(calls.filter(sql=>sql.includes('FROM organizations')&&sql.includes('FOR UPDATE')).length,3);
 assert.equal(calls.some(sql=>sql.includes('cash_sessions')||sql.includes('cash_movements')),false);
});
