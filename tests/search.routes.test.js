const test=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const db=require('../src/config/database');
const searchRoutes=require('../src/routes/search.routes');

test('general search validates its query and returns tenant-scoped module results',async(t)=>{
 const originalExecute=db.execute,queries=[];
 db.execute=async(sql,values)=>{
  queries.push({sql,values});
  return [[{module:queries.length}],[]];
 };
 t.after(()=>{db.execute=originalExecute;});

 const app=express();
 app.use((req,res,next)=>{req.tenantId=42;req.user={role:'OWNER'};next();});
 app.use('/api/search',searchRoutes);
 const server=app.listen(0);
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 await new Promise(resolve=>server.once('listening',resolve));
 const baseUrl=`http://127.0.0.1:${server.address().port}/api/search`;

 const tooShort=await fetch(`${baseUrl}?q=x`);
 assert.equal(tooShort.status,400);
 assert.equal(queries.length,0);

 const response=await fetch(`${baseUrl}?q=paracetamol`);
 assert.equal(response.status,200);
 const results=await response.json();
 assert.deepEqual(Object.keys(results),['products','movements','alerts','suppliers','purchases','patients','insurers']);
 assert.deepEqual(results,{
  products:[{module:1}],
  movements:[{module:2}],
  alerts:[{module:3}],
  suppliers:[{module:4}],
  purchases:[{module:5}],
  patients:[{module:6}],
  insurers:[{module:7}],
 });
 assert.equal(queries.length,7);
 for(const query of queries)assert.equal(query.values[0],42);
});
