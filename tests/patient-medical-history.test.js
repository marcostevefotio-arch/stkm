const test=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const db=require('../src/config/database');
const patientRoutes=require('../src/routes/patients.routes');

function createServer(role='PHARMACIST'){
 const app=express();
 app.use(express.json());
 app.use((req,res,next)=>{req.tenantId=42;req.user={id:7,role};next();});
 app.use('/api/patients',patientRoutes);
 const server=app.listen(0);
 const ready=new Promise(resolve=>server.once('listening',resolve));
 return {server,ready,url:path=>`http://127.0.0.1:${server.address().port}/api/patients/${path}`};
}

test('medical history only allows authorized roles and flags possible recurrence for professional review',async(t)=>{
 const originalExecute=db.execute,queries=[];
 db.execute=async(sql,values)=>{
  queries.push({sql,values});
  if(sql.startsWith('SELECT id FROM patients'))return [[{id:12}],[]];
  if(sql.startsWith('SELECT id,condition_name'))return [[{id:3,condition_name:'Hypertension',status:'resolved',start_date:'2021-01-01',end_date:'2021-03-01'}],[]];
  if(sql.startsWith('INSERT INTO patient_medical_history'))return [{insertId:20,affectedRows:1},[]];
  return [{affectedRows:1},[]];
 };
 t.after(()=>{db.execute=originalExecute;});
 const {server,ready,url}=createServer();
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 await ready;
 const response=await fetch(url('12/medical-history'),{
  method:'POST',
  headers:{'Content-Type':'application/json'},
  body:JSON.stringify({condition_name:' hypertension ',status:'ongoing',start_date:'2025-01-01'}),
 });
 assert.equal(response.status,201);
 assert.deepEqual(await response.json(),{
  id:20,
  message:'Antécédent enregistré.',
  review_flag:'possible_recurrence',
  similar_records:[{id:3,condition_name:'Hypertension',status:'resolved',start_date:'2021-01-01',end_date:'2021-03-01'}],
 });
 assert.deepEqual(queries[0].values,['12',42]);
 assert.deepEqual(queries[1].values,[42,'12']);
 assert.equal(queries[2].values[0],42);
 assert.equal(queries[2].values[1],'12');
});

test('medical history rejects roles without permission before reading patient data',async(t)=>{
 const originalExecute=db.execute;
 let queryCount=0;
 db.execute=async()=>{queryCount+=1;return [[],[]];};
 t.after(()=>{db.execute=originalExecute;});
 const {server,ready,url}=createServer('STOREKEEPER');
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 await ready;
 const response=await fetch(url('12/medical-history'));
 assert.equal(response.status,403);
 assert.equal(queryCount,0);
});

test('medical history validates dates and status before database access',async(t)=>{
 const originalExecute=db.execute;
 let queryCount=0;
 db.execute=async()=>{queryCount+=1;return [[],[]];};
 t.after(()=>{db.execute=originalExecute;});
 const {server,ready,url}=createServer();
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 await ready;
 const response=await fetch(url('12/medical-history'),{
  method:'POST',
  headers:{'Content-Type':'application/json'},
  body:JSON.stringify({condition_name:'Test',start_date:'2025-02-01',end_date:'2025-01-01'}),
 });
 assert.equal(response.status,400);
 assert.equal(queryCount,0);
});
