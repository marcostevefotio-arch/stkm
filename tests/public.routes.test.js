const test=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const jwt=require('jsonwebtoken');
const db=require('../src/config/database');
const publicRoutes=require('../src/routes/public.routes');

async function listen(t){
 const app=express();
 app.use(express.json());
 app.use('/api/public',publicRoutes);
 const server=app.listen(0);
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 await new Promise(resolve=>server.once('listening',resolve));
 return `http://127.0.0.1:${server.address().port}/api/public`;
}

test('public catalog exposes active plans, promotions and published FAQ',async t=>{
 const originalExecute=db.execute;
 const statements=[];
 db.execute=async(sql)=>{
  statements.push(sql);
  if(sql.includes('FROM plans'))return [[{
   id:2,code:'starter',name:'Starter',plan_type:'starter',monthly_price:15000,annual_price:150000,
   biennial_price:280000,currency:'XAF',max_users:3,max_products:10000000,extra_user_price:5000,
   included_modules:['stock','procurement','sales','cash'],module_prices:null,is_active:1,
  }],[]];
  if(sql.includes('FROM platform_promotions'))return [[{id:3,code:'WELCOME'}],[]];
  if(sql.includes('FROM platform_faqs'))return [[{question:'Question ?',answer:'Réponse',category:'Compte'}],[]];
  throw Error(`Unexpected SQL: ${sql}`);
 };
 t.after(()=>{db.execute=originalExecute;});
 const url=await listen(t),response=await fetch(`${url}/catalog`);
 assert.equal(response.status,200);
 assert.match(response.headers.get('cache-control'),/max-age=60/);
 assert.deepEqual(await response.json(),{
  plans:[{
   id:2,code:'starter',name:'Starter',plan_type:'starter',monthly_price:15000,annual_price:150000,
   biennial_price:280000,currency:'XAF',max_users:3,max_products:10000000,extra_user_price:5000,
   included_modules:['stock','procurement','sales','cash'],module_prices:null,is_active:true,is_purchasable:true,
  }],
  promotions:[{id:3,code:'WELCOME'}],
  faqs:[{question:'Question ?',answer:'Réponse',category:'Compte'}],
  trialDays:7,
  modules:{
   stock:'Gestion des stocks',
   procurement:'Approvisionnement',
   sales:'Ventes & facturation',
   patients:'Patients & assurances',
   cash:'Recettes & caisse',
   reports:'Rapports & analyses',
   administration:'Administration',
   support:'Assistance & formation',
  },
 });
 assert.equal(statements.length,3);
});

test('public catalog keeps plans priced only annually or biennially',async t=>{
 const originalExecute=db.execute;
 db.execute=async sql=>{
  if(sql.includes('FROM plans'))return [[
   {id:8,code:'annual-only',name:'Offre annuelle',plan_type:'ultimate',monthly_price:null,annual_price:90000,biennial_price:null,currency:'XAF',max_users:5,max_products:1000,extra_user_price:5000,included_modules:[],module_prices:null,is_active:1},
   {id:9,code:'customized',name:'Customized',plan_type:'customized',monthly_price:null,annual_price:null,biennial_price:null,currency:'XAF',max_users:1,max_products:1000,extra_user_price:0,included_modules:['reports'],module_prices:{reports:{biennial:45000}},is_active:0},
   {id:10,code:'ultimate',name:'Ultimate',plan_type:'ultimate',monthly_price:0,annual_price:null,biennial_price:null,currency:'XAF',max_users:5,max_products:1000,extra_user_price:5000,included_modules:[],module_prices:null,is_active:0},
  ],[]];
  if(sql.includes('FROM platform_promotions'))return [[],[]];
  if(sql.includes('FROM platform_faqs'))return [[],[]];
  throw Error(`Unexpected SQL: ${sql}`);
 };
 t.after(()=>{db.execute=originalExecute;});
 const url=await listen(t),response=await fetch(`${url}/catalog`);
 assert.equal(response.status,200);
 const catalog=await response.json();
 assert.deepEqual(catalog.plans.map(plan=>plan.id),[8,9,10]);
 assert.equal(catalog.plans[0].annual_price,90000);
 assert.equal(catalog.plans[0].is_purchasable,true);
 assert.equal(catalog.plans[1].module_prices.reports.biennial,45000);
 assert.equal(catalog.plans[1].is_purchasable,false);
 assert.equal(catalog.plans[2].is_purchasable,false);
});

test('public catalog exposes purchasable Starter, Ultimate and Customized plans',async t=>{
 const originalExecute=db.execute;
 const plans=[
  {id:2,code:'starter',name:'Starter',plan_type:'starter',monthly_price:15000,annual_price:150000,biennial_price:280000,currency:'XAF',max_users:3,max_products:10000000,extra_user_price:5000,included_modules:['stock','procurement','sales','cash'],module_prices:null,is_active:1},
  {id:3,code:'ultimate',name:'Ultimate',plan_type:'ultimate',monthly_price:25000,annual_price:350000,biennial_price:600000,currency:'XAF',max_users:5,max_products:10000000,extra_user_price:5000,included_modules:[],module_prices:null,is_active:1},
  {id:4,code:'customized',name:'Customized',plan_type:'customized',monthly_price:0,annual_price:null,biennial_price:null,currency:'XAF',max_users:1,max_products:10000000,extra_user_price:0,included_modules:['stock'],module_prices:{stock:{monthly:12000,annual:120000,biennial:240000}},is_active:1},
 ];
 db.execute=async sql=>{
  if(sql.includes('FROM plans'))return [plans,[]];
  if(sql.includes('FROM platform_promotions'))return [[],[]];
  if(sql.includes('FROM platform_faqs'))return [[],[]];
  throw Error(`Unexpected SQL: ${sql}`);
 };
 t.after(()=>{db.execute=originalExecute;});
 const url=await listen(t),response=await fetch(`${url}/catalog`);
 assert.equal(response.status,200);
 const catalog=await response.json();
 assert.deepEqual(catalog.plans.map(plan=>plan.code),['starter','ultimate','customized']);
 assert.ok(catalog.plans.every(plan=>plan.is_purchasable));
});

test('signup creates the organization, owner and trial subscription in one transaction',async t=>{
 const originalGetConnection=db.getConnection,oldSecret=process.env.JWT_SECRET;
 const statements=[];
 let committed=false,rolledBack=false,released=false;
 process.env.JWT_SECRET='public-signup-test-secret';
 db.getConnection=async()=>({
  beginTransaction:async()=>{},
  commit:async()=>{committed=true;},
  rollback:async()=>{rolledBack=true;},
  release:()=>{released=true;},
  execute:async(sql,values)=>{
   statements.push({sql,values});
   if(sql.startsWith('SELECT id FROM users'))return [[],[]];
   if(sql.includes('FROM plans'))return [[{
    id:2,plan_type:'starter',monthly_price:15000,annual_price:150000,biennial_price:280000,
    extra_user_price:5000,currency:'XAF',max_users:3,max_products:10000000,
    included_modules:['stock','procurement','sales','cash'],module_prices:null,
   }],[]];
   if(sql.startsWith('SELECT id FROM platform_promotions'))return [[{id:3}],[]];
   if(sql.startsWith('INSERT INTO organizations'))return [{insertId:42},[]];
   if(sql.startsWith('INSERT INTO users'))return [{insertId:7},[]];
   if(sql.startsWith('SELECT u.id,u.organization_id'))return [[{
    id:7,organization_id:42,full_name:'Propriétaire Test',email:'owner@example.com',
    role:'OWNER',organization_name:'Clinique Test',organization_status:'active',password_version:0,
   }],[]];
   return [{affectedRows:1},[]];
  },
 });
 t.after(()=>{
  db.getConnection=originalGetConnection;
  if(oldSecret===undefined)delete process.env.JWT_SECRET;else process.env.JWT_SECRET=oldSecret;
 });
 const url=await listen(t);
 const response=await fetch(`${url}/register`,{
  method:'POST',
  headers:{'Content-Type':'application/json'},
  body:JSON.stringify({
   organization_name:'Clinique Test',
   organization_email:'CONTACT@EXAMPLE.COM',
   owner_full_name:'Propriétaire Test',
   owner_email:'OWNER@EXAMPLE.COM',
   password:'a-very-long-test-password',
   plan_id:'2',
   billing_interval:'annual',
   user_limit:4,
   promotion_id:'3',
   accept_terms:true,
  }),
 });
 assert.equal(response.status,201);
 const result=await response.json();
 assert.equal(result.trialDays,7);
 assert.equal(result.user.organization_id,42);
 assert.equal(jwt.verify(result.token,process.env.JWT_SECRET).sub,7);
 assert.equal(committed,true);
 assert.equal(rolledBack,false);
 assert.equal(released,true);
 const claim=statements.find(item=>item.sql.startsWith('INSERT INTO account_email_claims'));
 assert.deepEqual(claim.values,['owner@example.com']);
 const organization=statements.find(item=>item.sql.startsWith('INSERT INTO organizations'));
 assert.equal(organization.values[0],'Clinique Test');
 assert.equal(organization.values[4],'contact@example.com');
 const subscription=statements.find(item=>item.sql.includes('INSERT INTO subscriptions'));
 assert.match(subscription.sql,/INTERVAL 7 DAY/);
 assert.deepEqual(subscription.values,[42,'2',3,'annual',155000,4,'["stock","procurement","sales","cash"]']);
 const audit=statements.find(item=>item.values?.includes('TENANT_SIGNUP_COMPLETED'));
 assert.match(audit.values[5],/"trial_days":7/);
});
