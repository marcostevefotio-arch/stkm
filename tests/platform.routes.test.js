const test=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const db=require('../src/config/database');
const platformRoutes=require('../src/routes/platform.routes');

async function listen(t,role='SUPER_ADMIN',userId=90){
 const app=express();app.use(express.json());
 app.use((req,res,next)=>{req.user={id:userId,organization_id:99,role};next();});
 app.use('/api/platform',platformRoutes);
 const server=app.listen(0);
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 await new Promise(resolve=>server.once('listening',resolve));
 return `http://127.0.0.1:${server.address().port}/api/platform`;
}

test('platform administration is restricted to SUPER_ADMIN',async t=>{
 const originalExecute=db.execute;let queries=0;
 db.execute=async()=>{queries+=1;return [[{total:0}],[]];};
 t.after(()=>{db.execute=originalExecute;});
 const url=await listen(t,'ADMIN'),[response,pricing]=await Promise.all([fetch(`${url}/overview`),fetch(`${url}/pricing`)]);
 assert.equal(response.status,403);
 assert.equal(pricing.status,403);
 assert.equal(queries,0);
});

test('platform overview returns tenant, subscription and support queue totals',async t=>{
 const originalExecute=db.execute;
 db.execute=async sql=>{
  if(sql.includes('FROM organizations'))return [[{total:12}],[]];
  if(sql.includes("status='active'"))return [[{total:7}],[]];
  if(sql.includes("status='trialing'"))return [[{total:3}],[]];
  if(sql.includes('assigned_agent_id IS NULL'))return [[{total:2}],[]];
  if(sql.includes('FROM support_tickets'))return [[{total:5}],[]];
  throw Error(`Unexpected SQL: ${sql}`);
 };
 t.after(()=>{db.execute=originalExecute;});
 const url=await listen(t),response=await fetch(`${url}/overview`);
 assert.equal(response.status,200);
 assert.deepEqual(await response.json(),{tenants:12,activeSubscriptions:7,trialSubscriptions:3,openChats:5,waitingChats:2});
});

test('platform agent can update only their own availability',async t=>{
 const originalExecute=db.execute;let values;
 db.execute=async(sql,params)=>{assert.match(sql,/INSERT INTO support_agent_presence/);values=params;return [{affectedRows:1},[]];};
 t.after(()=>{db.execute=originalExecute;});
 const url=await listen(t,'SUPER_ADMIN',90);
 const invalid=await fetch(`${url}/agents/presence`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({available:'yes'})});
 assert.equal(invalid.status,400);
 const response=await fetch(`${url}/agents/presence`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({available:true})});
 assert.equal(response.status,200);
 assert.deepEqual(values,[90,true]);
 assert.deepEqual(await response.json(),{available:true,message:'Vous êtes disponible pour les demandes.'});
});

test('platform agent claims an unassigned chat transactionally',async t=>{
 const originalGetConnection=db.getConnection;const statements=[];let committed=false;
 db.getConnection=async()=>({
  beginTransaction:async()=>{},
  commit:async()=>{committed=true;},
  rollback:async()=>{},
  release:()=>{},
  execute:async(sql,values)=>{
   statements.push({sql,values});
   if(sql.startsWith('SELECT id,organization_id,assigned_agent_id'))return [[{id:14,organization_id:42,assigned_agent_id:null,status:'open'}],[]];
   return [{insertId:1,affectedRows:1},[]];
  }
 });
 t.after(()=>{db.getConnection=originalGetConnection;});
 const url=await listen(t,'SUPER_ADMIN',90),response=await fetch(`${url}/support/14/claim`,{method:'POST'});
 assert.equal(response.status,200);
 assert.equal(committed,true);
 assert.deepEqual(await response.json(),{message:'Chat pris en charge.'});
 assert.ok(statements.some(item=>item.sql.startsWith('UPDATE support_tickets SET assigned_agent_id=?')));
 assert.ok(statements.some(item=>item.sql.includes('SUPPORT_CHAT_CLAIMED')||item.values?.includes('SUPPORT_CHAT_CLAIMED')));
});

test('platform can change an organization status with an audit entry',async t=>{
 const originalGetConnection=db.getConnection,statements=[];let committed=false;
 db.getConnection=async()=>({
  beginTransaction:async()=>{},
  commit:async()=>{committed=true;},
  rollback:async()=>{},
  release:()=>{},
  execute:async(sql,values)=>{
   statements.push({sql,values});
   if(sql.startsWith('SELECT id,status FROM organizations'))return [[{id:42,status:'active'}],[]];
   return [{affectedRows:1},[]];
  }
 });
 t.after(()=>{db.getConnection=originalGetConnection;});
 const url=await listen(t),invalid=await fetch(`${url}/organizations/42/status`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:'unknown'})});
 assert.equal(invalid.status,400);
 const response=await fetch(`${url}/organizations/42/status`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:'suspended'})});
 assert.equal(response.status,200);
 assert.deepEqual(await response.json(),{status:'suspended',message:'Statut de l’établissement mis à jour.'});
 assert.equal(committed,true);
 assert.ok(statements.some(item=>item.values?.includes('PLATFORM_ORGANIZATION_STATUS_CHANGED')));
});

test('platform can update an existing subscription to an active plan',async t=>{
 const originalGetConnection=db.getConnection,statements=[];let committed=false;
 db.getConnection=async()=>({
  beginTransaction:async()=>{},
  commit:async()=>{committed=true;},
  rollback:async()=>{},
  release:()=>{},
  execute:async(sql,values)=>{
   statements.push({sql,values});
   if(sql.startsWith('SELECT id FROM organizations'))return [[{id:42}],[]];
   if(sql.startsWith('SELECT id,plan_id,status,current_period_start,current_period_end FROM subscriptions'))return [[{id:3,plan_id:1,status:'trialing',current_period_start:'2026-10-01',current_period_end:'2026-11-01'}],[]];
   if(sql.startsWith('SELECT id FROM plans'))return [[{id:2}],[]];
   return [{affectedRows:1},[]];
  }
 });
 t.after(()=>{db.getConnection=originalGetConnection;});
 const url=await listen(t),response=await fetch(`${url}/organizations/42/subscription`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({plan_id:'2',status:'active'})});
 assert.equal(response.status,200);
 assert.deepEqual(await response.json(),{message:'Abonnement mis à jour.'});
 assert.equal(committed,true);
 assert.ok(statements.some(item=>item.sql.startsWith('UPDATE subscriptions SET plan_id=?')));
 assert.ok(statements.some(item=>item.values?.includes('PLATFORM_SUBSCRIPTION_CHANGED')));
});

test('platform can create a pricing plan and rejects invalid values',async t=>{
 const originalGetConnection=db.getConnection,statements=[];let committed=false;
 db.getConnection=async()=>({
  beginTransaction:async()=>{},
  commit:async()=>{committed=true;},
  rollback:async()=>{},
  release:()=>{},
  execute:async(sql,values)=>{statements.push({sql,values});return [{insertId:8,affectedRows:1},[]];}
 });
 t.after(()=>{db.getConnection=originalGetConnection;});
 const url=await listen(t);
 const invalid=await fetch(`${url}/pricing`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:'INVALID CODE',name:'Plan',monthly_price:120,currency:'XAF',max_users:5,max_products:100})});
 assert.equal(invalid.status,400);
 const response=await fetch(`${url}/pricing`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:'pro-monthly',name:'Pro',monthly_price:25000,currency:'XAF',max_users:20,max_products:5000})});
 assert.equal(response.status,201);
 assert.equal(committed,true);
 assert.ok(statements.some(item=>item.sql.startsWith('INSERT INTO plans')));
 assert.ok(statements.some(item=>item.values?.includes('PLATFORM_PLAN_CREATED')));
});

test('platform can create an active promotion for the public portal',async t=>{
 const originalGetConnection=db.getConnection,statements=[];let committed=false;
 db.getConnection=async()=>({
  beginTransaction:async()=>{},
  commit:async()=>{committed=true;},
  rollback:async()=>{},
  release:()=>{},
  execute:async(sql,values)=>{statements.push({sql,values});return [{insertId:12,affectedRows:1},[]];}
 });
 t.after(()=>{db.getConnection=originalGetConnection;});
 const url=await listen(t);
 const response=await fetch(`${url}/promotions`,{
  method:'POST',
  headers:{'Content-Type':'application/json'},
  body:JSON.stringify({code:'WELCOME7',name:'Bienvenue',discount_type:'percent',discount_value:15,starts_at:'2026-11-04',ends_at:'2026-12-31',is_active:true}),
 });
 assert.equal(response.status,201);
 assert.deepEqual(await response.json(),{id:12,message:'Promotion créée.'});
 assert.equal(committed,true);
 assert.ok(statements.some(item=>item.sql.startsWith('INSERT INTO platform_promotions')));
 assert.ok(statements.some(item=>item.values?.includes('PLATFORM_PROMOTION_CREATED')));
});

test('platform invoices apply active promotion discounts and create draft records',async t=>{
 const originalGetConnection=db.getConnection,statements=[];let committed=false;
 db.getConnection=async()=>({
  beginTransaction:async()=>{},
  commit:async()=>{committed=true;},
  rollback:async()=>{},
  release:()=>{},
  execute:async(sql,values)=>{
   statements.push({sql,values});
   if(sql.startsWith('SELECT s.id,s.plan_id'))return [[{id:7,plan_id:2,contract_amount:'15000.00',monthly_price:'15000.00',currency:'XAF'}],[]];
   if(sql.startsWith('SELECT id,discount_type,discount_value'))return [[{id:4,discount_type:'percent',discount_value:'20.00'}],[]];
   if(sql.startsWith('INSERT INTO platform_invoices'))return [{insertId:11},[]];
   return [{affectedRows:1},[]];
  }
 });
 t.after(()=>{db.getConnection=originalGetConnection;});
 const url=await listen(t),response=await fetch(`${url}/invoices`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({organization_id:'42',period_start:'2026-11-01',period_end:'2026-11-30',due_date:'2026-11-14',promotion_id:'4'})});
 assert.equal(response.status,201);
 const data=await response.json();
 assert.equal(data.total_amount,12000);
 assert.equal(data.currency,'XAF');
 assert.equal(committed,true);
 const insert=statements.find(item=>item.sql.startsWith('INSERT INTO platform_invoices'));
 assert.deepEqual(insert.values.slice(6,10),[15000,3000,12000,'XAF']);
});

test('platform can create a subscription when an organization has none',async t=>{
 const originalGetConnection=db.getConnection,statements=[];let committed=false;
 db.getConnection=async()=>({
  beginTransaction:async()=>{},
  commit:async()=>{committed=true;},
  rollback:async()=>{},
  release:()=>{},
  execute:async(sql,values)=>{
   statements.push({sql,values});
   if(sql.startsWith('SELECT id FROM organizations'))return [[{id:42}],[]];
   if(sql.startsWith('SELECT id,plan_id,status,current_period_start,current_period_end'))return [[],[]];
   if(sql.startsWith('SELECT id FROM plans'))return [[{id:2}],[]];
   if(sql.startsWith('INSERT INTO subscriptions'))return [{insertId:19},[]];
   return [{affectedRows:1},[]];
  }
 });
 t.after(()=>{db.getConnection=originalGetConnection;});
 const url=await listen(t),response=await fetch(`${url}/organizations/42/subscription`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({plan_id:'2',status:'trialing'})});
 assert.equal(response.status,200);
 assert.equal(committed,true);
 assert.ok(statements.some(item=>item.sql.startsWith('INSERT INTO subscriptions')));
 assert.ok(statements.some(item=>item.values?.includes('PLATFORM_SUBSCRIPTION_CREATED')));
});

test('platform FAQ and training content are validated and audited transactionally',async t=>{
 const originalGetConnection=db.getConnection,statements=[];let committed=0;
 db.getConnection=async()=>({
  beginTransaction:async()=>{},
  commit:async()=>{committed+=1;},
  rollback:async()=>{},
  release:()=>{},
  execute:async(sql,values)=>{statements.push({sql,values});return [{insertId:21,affectedRows:1},[]];}
 });
 t.after(()=>{db.getConnection=originalGetConnection;});
 const url=await listen(t);
 const invalid=await fetch(`${url}/trainings`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:'Formation',description:'Guide utile',url:'javascript:alert(1)',format:'video',is_active:true,sort_order:1})});
 assert.equal(invalid.status,400);
 const faq=await fetch(`${url}/faqs`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question:'Comment gérer un forfait ?',answer:'Contactez notre équipe pour vous accompagner.',category:'Abonnement',sort_order:1,is_active:true})});
 assert.equal(faq.status,201);
 const training=await fetch(`${url}/trainings`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:'Formation à la caisse',description:'Consultez ce guide de prise en main.',url:'https://example.com/formation',format:'video',is_active:true,sort_order:1})});
 assert.equal(training.status,201);
 assert.equal(committed,2);
 assert.ok(statements.some(item=>item.sql.startsWith('INSERT INTO platform_faqs')));
 assert.ok(statements.some(item=>item.sql.startsWith('INSERT INTO platform_trainings')));
 assert.ok(statements.some(item=>item.values?.includes('PLATFORM_FAQ_CREATED')));
 assert.ok(statements.some(item=>item.values?.includes('PLATFORM_TRAINING_CREATED')));
});

test('platform can onboard an agent but cannot disable its last active account',async t=>{
 const originalGetConnection=db.getConnection,statements=[];let committed=0,rolledBack=0;
 db.getConnection=async()=>({
  beginTransaction:async()=>{},
  commit:async()=>{committed+=1;},
  rollback:async()=>{rolledBack+=1;},
  release:()=>{},
  execute:async(sql,values)=>{
   statements.push({sql,values});
   if(sql.startsWith('SELECT id FROM users WHERE email='))return [[],[]];
   if(sql.startsWith('SELECT id,organization_id,is_active FROM users'))return [[{id:90,organization_id:99,is_active:1}],[]];
   if(sql.startsWith("SELECT COUNT(*) total FROM users WHERE role='SUPER_ADMIN'"))return [[{total:1}],[]];
   if(sql.startsWith('INSERT INTO users'))return [{insertId:91},[]];
   return [{affectedRows:1},[]];
  }
 });
 t.after(()=>{db.getConnection=originalGetConnection;});
 const url=await listen(t,'SUPER_ADMIN',80);
 const invalid=await fetch(`${url}/agents`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({full_name:'Agent',email:'agent@example.com',password:'short'})});
 assert.equal(invalid.status,400);
 const created=await fetch(`${url}/agents`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({full_name:'Agent',email:'agent@example.com',password:'Agent-Password-123!'})});
 assert.equal(created.status,201);
 assert.ok(statements.some(item=>item.sql.startsWith('INSERT INTO users')));
 assert.equal(committed,1);
 const deactivate=await fetch(`${url}/agents/90/active`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({active:false})});
 assert.equal(deactivate.status,409);
 assert.equal(rolledBack,1);
});
