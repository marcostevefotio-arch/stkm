const test=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const db=require('../src/config/database');
const patientsRoutes=require('../src/routes/patients.routes');

test('patient records validate input and keep queries scoped to authenticated tenant',async(t)=>{
 const originalExecute=db.execute,queries=[];
 db.execute=async(sql,values)=>{
  queries.push({sql,values});
  if(sql.startsWith('SELECT id FROM patients'))return [[],[]];
  if(sql.startsWith('SELECT id,patient_code'))return [[{id:1,patient_code:'P-001',full_name:'Patient Test'}],[]];
  return [{insertId:1,affectedRows:1},[]];
 };
 t.after(()=>{db.execute=originalExecute;});

 const app=express();
 app.use(express.json());
 app.use((req,res,next)=>{req.tenantId=42;req.user={id:7,role:'OWNER'};next();});
 app.use('/api/patients',patientsRoutes);
 const server=app.listen(0);
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 await new Promise(resolve=>server.once('listening',resolve));
 const url=`http://127.0.0.1:${server.address().port}/api/patients`;

 const invalidDate=await fetch(url,{
  method:'POST',
  headers:{'Content-Type':'application/json'},
  body:JSON.stringify({patient_code:'P-001',full_name:'Patient Test',birth_date:'2027-02-31'}),
 });
 assert.equal(invalidDate.status,400);
 assert.equal(queries.length,0);

 const created=await fetch(url,{
  method:'POST',
  headers:{'Content-Type':'application/json'},
  body:JSON.stringify({patient_code:'P-001',full_name:'Patient Test',birth_date:'1990-05-04',gender:'F'}),
 });
 assert.equal(created.status,201);
 const insert=queries.find(query=>query.sql.startsWith('INSERT INTO patients'));
 assert.deepEqual(insert.values,[42,'P-001','Patient Test','1990-05-04','F',null,null,null]);

 const response=await fetch(url);
 assert.equal(response.status,200);
 assert.deepEqual(await response.json(),[{id:1,patient_code:'P-001',full_name:'Patient Test'}]);
 const listing=queries.find(query=>query.sql.startsWith('SELECT id,patient_code'));
 assert.deepEqual(listing.values,[42]);

 const updated=await fetch(`${url}/1`,{
  method:'PUT',
  headers:{'Content-Type':'application/json'},
  body:JSON.stringify({email:'patient@example.test'}),
 });
 assert.equal(updated.status,200);
 const update=queries.find(query=>query.sql.startsWith('UPDATE patients SET'));
 assert.deepEqual(update.values,['patient@example.test','1',42]);

 const archived=await fetch(`${url}/1`,{method:'DELETE'});
 assert.equal(archived.status,200);
 const archive=queries.find(query=>query.sql.startsWith('UPDATE patients SET is_active'));
 assert.deepEqual(archive.values,['1',42]);

 const archivedList=await fetch(`${url}?includeArchived=1`);
 assert.equal(archivedList.status,200);
 const archivedListing=queries.filter(query=>query.sql.startsWith('SELECT id,patient_code')).at(-1);
 assert.doesNotMatch(archivedListing.sql,/AND is_active=1/);

 const restored=await fetch(`${url}/1/restore`,{method:'POST'});
 assert.equal(restored.status,200);
 const restoreQuery=queries.find(query=>query.sql.startsWith('UPDATE patients SET is_active=1'));
 assert.deepEqual(restoreQuery.values,['1',42]);
});
