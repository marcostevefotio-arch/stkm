const test=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const db=require('../src/config/database');
const productsRoutes=require('../src/routes/products.routes');
const stockRoutes=require('../src/routes/stock.routes');
const suppliersRoutes=require('../src/routes/suppliers.routes');
const purchasesRoutes=require('../src/routes/purchases.routes');
const patientsRoutes=require('../src/routes/patients.routes');
const insurersRoutes=require('../src/routes/insurers.routes');
const salesRoutes=require('../src/routes/sales.routes');
const reportsRoutes=require('../src/routes/reports.routes');
const {authenticate}=require('../src/middleware/auth');
const jwt=require('jsonwebtoken');

async function listen(t,role){
 const app=express();app.use(express.json());
 app.use((req,res,next)=>{req.tenantId=42;req.user={id:7,organization_id:42,role};next();});
 app.use('/api/products',productsRoutes);
 app.use('/api/stock',stockRoutes);
 app.use('/api/suppliers',suppliersRoutes);
 app.use('/api/purchases',purchasesRoutes);
 app.use('/api/patients',patientsRoutes);
 app.use('/api/insurers',insurersRoutes);
 app.use('/api/sales',salesRoutes);
 app.use('/api/reports',reportsRoutes);
 const server=app.listen(0);
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 await new Promise(resolve=>server.once('listening',resolve));
 return `http://127.0.0.1:${server.address().port}/api`;
}

test('viewer cannot mutate inventory, procurement, patient or insurer records',async t=>{
 const originalExecute=db.execute,originalGetConnection=db.getConnection;let calls=0;
 db.execute=async()=>{calls+=1;return [[],[]];};
 db.getConnection=async()=>{calls+=1;throw Error('Database should not be reached');};
 t.after(()=>{db.execute=originalExecute;db.getConnection=originalGetConnection;});
 const base=await listen(t,'VIEWER'),headers={'Content-Type':'application/json'},body=JSON.stringify({});
 const responses=await Promise.all([
  fetch(`${base}/products`,{method:'POST',headers,body}),
  fetch(`${base}/stock/movements`,{method:'POST',headers,body}),
  fetch(`${base}/suppliers`,{method:'POST',headers,body}),
  fetch(`${base}/purchases`,{method:'POST',headers,body}),
  fetch(`${base}/patients`,{method:'POST',headers,body}),
  fetch(`${base}/insurers`,{method:'POST',headers,body}),
  fetch(`${base}/patients`),
 ]);
 assert.deepEqual(responses.map(response=>response.status),[403,403,403,403,403,403,403]);
 assert.equal(calls,0);
});

test('cashier patient and insurer lookups expose only point-of-sale fields',async t=>{
 const originalExecute=db.execute,queries=[];
 db.execute=async(sql,values)=>{
  queries.push(sql);
  if(sql.includes('FROM patients'))return [[{id:2,patient_code:'P-2',full_name:'Patient Test'}],[]];
  if(sql.includes('FROM insurers'))return [[{id:3,name:'Assureur Test'}],[]];
  throw Error(`Unexpected query: ${sql}`);
 };
 t.after(()=>{db.execute=originalExecute;});
 const base=await listen(t,'CASHIER'),[patientsResponse,insurersResponse]=await Promise.all([fetch(`${base}/sales/patients`),fetch(`${base}/sales/insurers`)]);
 assert.equal(patientsResponse.status,200);
 assert.equal(insurersResponse.status,200);
 assert.deepEqual(await patientsResponse.json(),[{id:2,patient_code:'P-2',full_name:'Patient Test'}]);
 assert.deepEqual(await insurersResponse.json(),[{id:3,name:'Assureur Test'}]);
 assert.match(queries[0],/SELECT id,patient_code,full_name\s+FROM patients/);
 assert.match(queries[1],/SELECT id,name FROM insurers/);
});

test('cashier cannot read inventory, procurement, reports or patient modules even with an unrestricted plan',async t=>{
 const original=db.execute;let calls=0;
 db.execute=async()=>{calls++;throw Error('Forbidden module must not query data');};
 t.after(()=>{db.execute=original;});
 const base=await listen(t,'CASHIER');
 for(const path of ['/products','/stock/movements','/suppliers','/purchases','/patients','/patients/2','/insurers','/insurers/coverages','/reports']){
  assert.equal((await fetch(base+path)).status,403,path);
 }
 assert.equal(calls,0);
});

test('sales product lookup contains only sale fields, without purchase costs or stock-management permissions',async t=>{
 const original=db.execute;let query,values;
 db.execute=async(sql,args)=>{query=sql;values=args;return [[{id:3,name:'Produit',sale_price:'10',quantity_on_hand:'5'}]];};
 t.after(()=>{db.execute=original;});
 const base=await listen(t,'CASHIER');
 const response=await fetch(`${base}/sales/products`);
 assert.equal(response.status,200);
 assert.deepEqual(values,[42]);assert.match(query,/organization_id=\? AND is_active=1/);
 assert.doesNotMatch(query,/purchase_cost|reorder_level|\*/);
});

test('authenticated cashier uses their database role rather than administrator claims in the token',async t=>{
 const original=db.execute,secret=process.env.JWT_SECRET,calls=[];
 process.env.JWT_SECRET='test-role-permissions-only';
 db.execute=async(sql,values)=>{
  calls.push({sql,values});
  if(sql.includes('FROM users u JOIN organizations'))return [[{id:7,organization_id:42,role:'CASHIER',is_active:1,password_version:0,organization_status:'active',subscription_modules:null}]];
  if(sql.includes('FROM sales_invoices'))return [[]];
  throw Error('Restricted module must not query data');
 };
 t.after(()=>{db.execute=original;if(secret===undefined)delete process.env.JWT_SECRET;else process.env.JWT_SECRET=secret;});
 const app=express();
 app.use(authenticate);
 app.use('/products',productsRoutes);
 app.use('/sales',salesRoutes);
 const server=app.listen(0);await new Promise(resolve=>server.once('listening',resolve));
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 const url=`http://127.0.0.1:${server.address().port}`;
 const headers={authorization:`Bearer ${jwt.sign({sub:7,pv:0,role:'OWNER'},process.env.JWT_SECRET)}`};
 assert.equal((await fetch(`${url}/products`,{headers})).status,403);
 assert.equal((await fetch(`${url}/sales`,{headers})).status,200);
 assert.equal(calls.filter(({sql})=>sql.includes('FROM products')).length,0);
 assert.deepEqual(calls.find(({sql})=>sql.includes('FROM sales_invoices')).values,[42]);
});
