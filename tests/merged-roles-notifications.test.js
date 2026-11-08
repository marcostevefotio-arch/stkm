const test=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const db=require('../src/config/database');
const policy=require('../public/js/access-policy');
const {requireRole}=require('../src/middleware/auth');
const {authenticate}=require('../src/middleware/auth');
const jwt=require('jsonwebtoken');
const {notifyCashiers}=require('../src/services/sale-notification.service');
const settings=require('../src/routes/settings.routes');
const sales=require('../src/routes/sales.routes');
const products=require('../src/routes/products.routes');

test('merged roles combine only pharmacist and storekeeper permissions and remain reversible',()=>{
 for(const role of ['PHARMACIST','STOREKEEPER']){
  const user={role,subscription_modules:null,merge_pharmacist_storekeeper:1};
  for(const feature of ['stock','procurement','sales','cash','patients'])assert.equal(policy.canAccessModule(user,feature),true);
  for(const page of ['products','movements','purchases','patients','invoices','pos'])assert.equal(policy.canAccessPage(user,{separate_sale_payment:1},page),true);
  assert.equal(policy.canAccessPage(user,{separate_sale_payment:1},'cash'),false);
  assert.equal(policy.canAccessPage(user,{separate_sale_payment:0},'cash'),true);
  for(const page of ['users','roles','reports','accounting-results'])assert.equal(policy.canAccessPage(user,{},page),false);
  assert.equal(policy.roleLabel(user),'Pharmacien / Gestionnaire de stock');
  assert.equal(policy.hasRole(user,'STOREKEEPER'),true);
  assert.equal(policy.hasRole(user,'PHARMACIST'),true);
  const limited={...user,subscription_modules:['sales']};
  assert.equal(policy.canAccessModule(limited,'stock'),false);
  assert.equal(policy.canSell(limited,{separate_sale_payment:0}),false);
  assert.equal(policy.canSell(limited,{separate_sale_payment:1}),true);
  user.merge_pharmacist_storekeeper=0;
  assert.equal(policy.hasRole(user,role==='PHARMACIST'?'STOREKEEPER':'PHARMACIST'),false);
  assert.equal(policy.roleLabel(user),null);
 }
 for(const role of ['CASHIER','VIEWER','ACCOUNTANT']){
  assert.equal(policy.hasRole({role,merge_pharmacist_storekeeper:1},'STOREKEEPER','PHARMACIST'),false);
 }
});

test('requireRole honors the reversible merger without granting administrative permissions',()=>{
 for(const role of ['PHARMACIST','STOREKEEPER']){
  const req={user:{role,merge_pharmacist_storekeeper:1}};
  let allowed=0,status=null;
  const res={status:value=>{status=value;return res;},json:()=>{}};
  requireRole('PHARMACIST')(req,res,()=>allowed++);
  requireRole('STOREKEEPER')(req,res,()=>allowed++);
  requireRole('OWNER','ADMIN')(req,res,()=>allowed++);
  assert.equal(allowed,2);assert.equal(status,403);
 }
});

test('every sale notifies active cash-eligible recipients using the same transaction',async()=>{
 const recipients=['OWNER','ADMIN','CASHIER','PHARMACIST','STOREKEEPER'].map((role,index)=>({id:index+1,role}));
 for(const separate of [false,true]){
  for(const merged of [0,1]){
   const calls=[];
   const connection={execute:async(sql,values)=>{
    calls.push({sql,values});
    return sql.startsWith('SELECT')?[recipients]:[{insertId:1}];
   }};
   await notifyCashiers(connection,{tenantId:42,user:{id:9,role:'PHARMACIST',subscription_modules:null},settings:{separate_sale_payment:Number(separate),merge_pharmacist_storekeeper:merged,currency:'CAD'},invoiceNumber:'FAC-20261107-000001',totalAmount:10,status:separate?'issued':'paid',separate});
   assert.match(calls[0].sql,/organization_id=\? AND is_active=1/);
   assert.deepEqual(calls[0].values,[42]);
   const inserted=calls.slice(1);
   assert.deepEqual(inserted.map(call=>call.values[3]),separate?[1,2,3]:merged?[1,2,3,4,5]:[1,2,3,4]);
   assert.ok(inserted.every(call=>call.values[0]===42&&call.values[4]===9));
   assert.match(inserted[0].values[2],separate?/En attente d’encaissement/:/Déjà réglée/);
  }
 }
 const connection={execute:async sql=>{if(sql.startsWith('SELECT'))return [recipients];throw Error('No cash subscription must not notify');}};
 await notifyCashiers(connection,{tenantId:42,user:{id:9,subscription_modules:['sales']},settings:{},invoiceNumber:'FAC-20261107-000001',totalAmount:10,status:'paid',separate:false});
 await assert.rejects(notifyCashiers({execute:async()=>{throw Error('notification failure');}},{tenantId:42,user:{id:9},settings:{},invoiceNumber:'FAC-20261107-000001',totalAmount:10}),/notification failure/);
});

async function listen(t,user){
 const app=express();app.use(express.json());
 app.use((req,res,next)=>{req.user=user;req.tenantId=42;next();});
 app.use('/settings',settings);app.use('/sales',sales);app.use('/products',products);
 app.use((error,req,res,next)=>res.status(500).json({error:error.message}));
 const server=app.listen(0);await new Promise(resolve=>server.once('listening',resolve));
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 return `http://127.0.0.1:${server.address().port}`;
}

test('merger setting requires admin and explicit boolean, preserves users and audits changes',async t=>{
 const original=db.getConnection,calls=[];
 db.getConnection=async()=>({
  beginTransaction:async()=>{},commit:async()=>calls.push('COMMIT'),rollback:async()=>calls.push('ROLLBACK'),release:()=>{},
  execute:async(sql,values)=>{calls.push({sql,values});return sql.includes('SELECT merge_')?[[{merge_pharmacist_storekeeper:0}]]:[[]];}
 });
 t.after(()=>{db.getConnection=original;});
 const post=(base,enabled)=>fetch(`${base}/settings/role-merger`,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({merge_pharmacist_storekeeper:enabled})});
 const pharmacist=await listen(t,{id:7,role:'PHARMACIST',merge_pharmacist_storekeeper:1});
 assert.equal((await post(pharmacist,true)).status,403);
 const admin=await listen(t,{id:8,role:'ADMIN'});
 assert.equal((await post(admin,'true')).status,400);
 for(const enabled of [true,false]){
  const response=await post(admin,enabled);
  assert.equal(response.status,200);
  assert.equal((await response.json()).merge_pharmacist_storekeeper,enabled);
 }
 assert.equal(calls.filter(call=>call==='COMMIT').length,2);
 assert.equal(calls.some(call=>/UPDATE users|ALTER TABLE users/.test(call.sql||'')),false);
 assert.ok(calls.some(call=>call.sql?.includes('ROLE_MERGER_CHANGED')));
});

test('invoice barcode lookup is tenant scoped and guarded by cash permissions',async t=>{
 const original=db.execute,calls=[];
 db.execute=async(sql,values)=>{
  calls.push({sql,values});
  if(sql.includes('organization_settings'))return [[{separate_sale_payment:1}]];
  return values[1]==='FAC-20261107-000001'?[[{id:15}]]:[[]];
 };
 t.after(()=>{db.execute=original;});
 const cashier=await listen(t,{id:8,role:'CASHIER'});
 let response=await fetch(`${cashier}/sales/by-number/FAC-20261107-000001`);
 assert.equal(response.status,200);assert.equal((await response.json()).id,15);
 assert.deepEqual(calls[0].values,[42,'FAC-20261107-000001']);
 assert.equal((await fetch(`${cashier}/sales/by-number/FAC-20261107-000002`)).status,404);
 assert.equal((await fetch(`${cashier}/sales/by-number/invalid`)).status,400);
 const pharmacist=await listen(t,{id:7,role:'STOREKEEPER',merge_pharmacist_storekeeper:1});
 assert.equal((await fetch(`${pharmacist}/sales/by-number/FAC-20261107-000001`)).status,403);
});

test('existing pharmacist gets stock mutation permissions from the current database flag, not the token',async t=>{
 const originalExecute=db.execute,originalConnection=db.getConnection,secret=process.env.JWT_SECRET;
 process.env.JWT_SECRET='test-merged-role-only';
 let merged=0,inserts=0;
 db.execute=async sql=>{
  if(sql.includes('FROM users u JOIN organizations')){
   assert.match(sql,/os\.merge_pharmacist_storekeeper/);
   return [[{id:7,organization_id:42,role:'PHARMACIST',is_active:1,password_version:0,organization_status:'active',subscription_modules:null,merge_pharmacist_storekeeper:merged}]];
  }
  return [[]];
 };
 db.getConnection=async()=>({
  beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{},release:()=>{},
  execute:async sql=>{if(sql.startsWith('INSERT INTO products')){inserts++;return [{insertId:3}];}return [[]];}
 });
 t.after(()=>{
  db.execute=originalExecute;db.getConnection=originalConnection;
  if(secret===undefined)delete process.env.JWT_SECRET;else process.env.JWT_SECRET=secret;
 });
 const app=express();app.use(express.json());app.use(authenticate);
 app.use((req,res,next)=>{req.tenantId=Number(req.user.organization_id);next();});
 app.use('/products',products);
 const server=app.listen(0);await new Promise(resolve=>server.once('listening',resolve));
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 const headers={'content-type':'application/json',authorization:'Bearer '+jwt.sign({sub:7,pv:0},process.env.JWT_SECRET)};
 const create=()=>fetch(`http://127.0.0.1:${server.address().port}/products`,{method:'POST',headers,body:JSON.stringify({sku:'TEST',name:'Test product'})});
 assert.equal((await create()).status,403);
 merged=1;assert.equal((await create()).status,201);assert.equal(inserts,1);
 merged=0;assert.equal((await create()).status,403);assert.equal(inserts,1);
});
