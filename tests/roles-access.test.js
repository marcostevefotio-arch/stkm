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

async function listen(t,role){
 const app=express();app.use(express.json());
 app.use((req,res,next)=>{req.tenantId=42;req.user={id:7,organization_id:42,role};next();});
 app.use('/api/products',productsRoutes);
 app.use('/api/stock',stockRoutes);
 app.use('/api/suppliers',suppliersRoutes);
 app.use('/api/purchases',purchasesRoutes);
 app.use('/api/patients',patientsRoutes);
 app.use('/api/insurers',insurersRoutes);
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
 const base=await listen(t,'CASHIER'),[patientsResponse,insurersResponse]=await Promise.all([fetch(`${base}/patients`),fetch(`${base}/insurers`)]);
 assert.equal(patientsResponse.status,200);
 assert.equal(insurersResponse.status,200);
 assert.deepEqual(await patientsResponse.json(),[{id:2,patient_code:'P-2',full_name:'Patient Test'}]);
 assert.deepEqual(await insurersResponse.json(),[{id:3,name:'Assureur Test'}]);
 assert.match(queries[0],/SELECT id,patient_code,full_name\s+FROM patients/);
 assert.match(queries[1],/SELECT i\.id,i\.name FROM insurers/);
});
