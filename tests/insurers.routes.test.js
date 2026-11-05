const test=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const db=require('../src/config/database');
const insurersRoutes=require('../src/routes/insurers.routes');

async function listen(app,t){
 const server=app.listen(0);
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 await new Promise(resolve=>server.once('listening',resolve));
 return `http://127.0.0.1:${server.address().port}/api/insurers`;
}
function appFor(role){
 const app=express();app.use(express.json());
 app.use((req,res,next)=>{req.tenantId=42;req.user={id:7,role};next();});
 app.use('/api/insurers',insurersRoutes);
 return app;
}

test('patient insurance coverage requires a role authorized for patient records',async(t)=>{
 const originalExecute=db.execute;let queryCount=0;
 db.execute=async()=>{queryCount+=1;return [[],[]];};
 t.after(()=>{db.execute=originalExecute;});
 const url=await listen(appFor('VIEWER'),t);
 const response=await fetch(`${url}/coverages`);
 assert.equal(response.status,403);
 assert.equal(queryCount,0);
});

test('invalid insurance coverage percentage is rejected before database access',async(t)=>{
 const originalGetConnection=db.getConnection,originalExecute=db.execute;let queryCount=0;
 db.getConnection=async()=>{queryCount+=1;throw Error('Database should not be called');};
 db.execute=async()=>{queryCount+=1;return [[],[]];};
 t.after(()=>{db.getConnection=originalGetConnection;db.execute=originalExecute;});
 const url=await listen(appFor('PHARMACIST'),t);
 const response=await fetch(`${url}/coverages`,{
  method:'POST',
  headers:{'Content-Type':'application/json'},
  body:JSON.stringify({patient_id:1,insurer_id:2,policy_number:'POL-1',coverage_percent:101}),
 });
 assert.equal(response.status,400);
 assert.match((await response.json()).error,/0 et 100/);
 assert.equal(queryCount,0);
});
