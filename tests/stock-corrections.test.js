const test=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const db=require('../src/config/database');
const stockRoutes=require('../src/routes/stock.routes');

test('stock corrections need another validator and adjust stock by the difference',async(t)=>{
 const originalGet=db.getConnection,originalExecute=db.execute,statements=[];
 let userId=2;
 db.execute=async()=>[{insertId:1,affectedRows:1},[]];
 db.getConnection=async()=>({
  beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{},release:()=>{},
  execute:async(sql,values)=>{
   statements.push({sql,values});
   if(sql.startsWith('SELECT * FROM stock_movement_corrections'))return [[{id:9,movement_id:4,requested_by:2,status:'pending',new_quantity:'8',new_reference:null,new_notes:null}]];
   if(sql.startsWith('SELECT id,product_id'))return [[{id:4,product_id:3,movement_type:'OUT',quantity:'5',reference:null,notes:null}]];
   if(sql.startsWith('SELECT id,quantity_on_hand'))return [[{id:3,quantity_on_hand:'20'}]];
   return [{affectedRows:1}];
  }
 });
 t.after(()=>{db.getConnection=originalGet;db.execute=originalExecute;});
 const app=express();
 app.use(express.json());
 app.use((req,res,next)=>{req.tenantId=1;req.user={id:userId,role:'OWNER'};next();});
 app.use('/api/stock',stockRoutes);
 const server=app.listen(0);
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 await new Promise(resolve=>server.once('listening',resolve));
 const url=`http://127.0.0.1:${server.address().port}/api/stock/corrections/9/approve`;

 assert.equal((await fetch(url,{method:'POST'})).status,403);
 userId=5;
 const approved=await fetch(url,{method:'POST'});
 assert.equal(approved.status,200);
 const stockUpdate=statements.find(item=>item.sql.startsWith('UPDATE products'));
 assert.equal(stockUpdate.values[0],17);
});
