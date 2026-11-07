const test=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const db=require('../src/config/database');
const search=require('../src/routes/search.routes');

test('general search excludes patient and insurer modules for a cashier',async t=>{
 const original=db.execute,calls=[];
 db.execute=async sql=>{calls.push(sql);return [[]];};
 t.after(()=>{db.execute=original;});
 const app=express();
 app.use((req,res,next)=>{req.tenantId=42;req.user={role:'CASHIER',subscription_modules:null};next();});
 app.use('/search',search);
 const server=app.listen(0);await new Promise(resolve=>server.once('listening',resolve));
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 const response=await fetch(`http://127.0.0.1:${server.address().port}/search?q=patient`);
 assert.equal(response.status,200);
 const result=await response.json();
 assert.deepEqual(result.patients,[]);assert.deepEqual(result.insurers,[]);
 assert.equal(calls.length,0);
 assert.equal(calls.some(sql=>sql.includes('FROM patients')||sql.includes('FROM insurers')),false);
});
