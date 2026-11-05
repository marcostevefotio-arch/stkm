const test=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const db=require('../src/config/database');
const searchRoutes=require('../src/routes/search.routes');
const dashboardRoutes=require('../src/routes/dashboard.routes');

async function listen(t,route,modules){
 const app=express();
 app.use((req,res,next)=>{req.user={subscription_modules:JSON.stringify(modules)};req.tenantId=42;next();});
 app.use(route);
 const server=app.listen(0);
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 await new Promise(resolve=>server.once('listening',resolve));
 return `http://127.0.0.1:${server.address().port}`;
}

test('global search returns only data from subscribed modules',async t=>{
 const originalExecute=db.execute,queries=[];
 db.execute=async sql=>{queries.push(sql);return [[],[]];};
 t.after(()=>{db.execute=originalExecute;});
 const url=await listen(t,searchRoutes,['stock']);
 const response=await fetch(`${url}/?q=abc`);
 assert.equal(response.status,200);
 assert.deepEqual(await response.json(),{products:[],movements:[],alerts:[],suppliers:[],purchases:[],patients:[],insurers:[]});
 assert.equal(queries.length,3);
 assert.ok(queries.every(sql=>sql.includes('products')||sql.includes('stock_movements')));
});

test('dashboard does not query or expose stock data when stock is not included',async t=>{
 const originalExecute=db.execute;
 let queried=false;
 db.execute=async()=>{queried=true;throw Error('Stock queries should not run.');};
 t.after(()=>{db.execute=originalExecute;});
 const url=await listen(t,dashboardRoutes,['sales']);
 const response=await fetch(url);
 assert.equal(response.status,200);
 assert.deepEqual(await response.json(),{products:0,stockUnits:0,lowStock:0,movementsToday:0,stock_available:false});
 assert.equal(queried,false);
});
