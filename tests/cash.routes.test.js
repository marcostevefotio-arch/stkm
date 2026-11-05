const test=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const db=require('../src/config/database');
const cashRoutes=require('../src/routes/cash.routes');

async function listen(app,t){
 const server=app.listen(0);
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 await new Promise(resolve=>server.once('listening',resolve));
 return `http://127.0.0.1:${server.address().port}/api/cash`;
}
function appFor(role='CASHIER'){
 const app=express();app.use(express.json());
 app.use((req,res,next)=>{req.tenantId=42;req.user={id:7,role};next();});
 app.use('/api/cash',cashRoutes);
 return app;
}

test('opening a cash session validates the float before database access',async(t)=>{
 const originalGetConnection=db.getConnection;let calls=0;
 db.getConnection=async()=>{calls+=1;throw Error('Database should not be called for invalid amounts');};
 t.after(()=>{db.getConnection=originalGetConnection;});
 const url=await listen(appFor(),t);
 const invalid=await fetch(`${url}/sessions`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({opening_cash:-1})});
 assert.equal(invalid.status,400);assert.equal(calls,0);
});

test('an organization cannot open a second concurrent cash session',async(t)=>{
 const originalGetConnection=db.getConnection;let rolledBack=false,released=false;
 db.getConnection=async()=>({
  beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{rolledBack=true;},release:()=>{released=true;},
  execute:async sql=>sql.includes('FROM cash_sessions')?[[{id:12}],[]]:[[{id:42}],[]],
 });
 t.after(()=>{db.getConnection=originalGetConnection;});
 const url=await listen(appFor(),t);
 const response=await fetch(`${url}/sessions`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({opening_cash:25})});
 assert.equal(response.status,409);
 assert.equal(rolledBack,true);assert.equal(released,true);
});

test('cash closing stores the expected balance and counted variance',async(t)=>{
 const originalGetConnection=db.getConnection,originalExecute=db.execute,queries=[];
 let committed=false,released=false;
 const connection={
  beginTransaction:async()=>{},commit:async()=>{committed=true;},rollback:async()=>{},release:()=>{released=true;},
  execute:async(sql,values)=>{
   queries.push({sql,values});
   if(sql.includes('FROM cash_sessions')&&sql.includes("status='open'"))return [[{id:12,opening_cash:'100.00'}],[]];
   if(sql.includes('FROM cash_movements')&&sql.includes('net_cash'))return [[{net_cash:'42.50'}],[]];
   return [{affectedRows:1},[]];
  },
 };
 db.getConnection=async()=>connection;db.execute=async()=>[{affectedRows:1},[]];
 t.after(()=>{db.getConnection=originalGetConnection;db.execute=originalExecute;});
 const url=await listen(appFor(),t);
 const response=await fetch(`${url}/sessions/12/close`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({closing_cash:140})});
 assert.equal(response.status,200);
 assert.deepEqual(await response.json(),{message:'Session clôturée.',expected_cash:142.5,closing_cash:140,variance:-2.5});
 assert.equal(committed,true);assert.equal(released,true);
 const close=queries.find(query=>query.sql.startsWith('UPDATE cash_sessions SET expected_cash'));
 assert.deepEqual(close.values,[142.5,140,-2.5,7,'12',42]);
});

test('cash operations require an authorized cashier role',async(t)=>{
 const originalGetConnection=db.getConnection;let calls=0;
 db.getConnection=async()=>{calls+=1;throw Error('Database should not be called');};
 t.after(()=>{db.getConnection=originalGetConnection;});
 const url=await listen(appFor('VIEWER'),t);
 const response=await fetch(`${url}/sessions`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({opening_cash:0})});
 assert.equal(response.status,403);assert.equal(calls,0);
});
