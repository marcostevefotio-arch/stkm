const test=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const db=require('../src/config/database');
const purchasesRoutes=require('../src/routes/purchases.routes');

test('purchase drafts reject invalid lines and dates before database access',async(t)=>{
 const app=express();
 app.use(express.json());
 app.use((req,res,next)=>{req.tenantId=42;req.user={id:7,role:'OWNER'};next();});
 app.use('/api/purchases',purchasesRoutes);
 const server=app.listen(0);
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 await new Promise(resolve=>server.once('listening',resolve));
 const url=`http://127.0.0.1:${server.address().port}/api/purchases`;

 const invalidLine=await fetch(url,{
  method:'POST',
  headers:{'Content-Type':'application/json'},
  body:JSON.stringify({supplier_id:1,items:[{product_id:1,quantity_ordered:0,unit_cost:0}]}),
 });
 assert.equal(invalidLine.status,400);
 assert.match((await invalidLine.json()).error,/quantités/);

 const invalidDate=await fetch(url,{
  method:'POST',
  headers:{'Content-Type':'application/json'},
  body:JSON.stringify({supplier_id:1,expected_date:'2027-02-31',items:[{product_id:1,quantity_ordered:1,unit_cost:0}]}),
 });
 assert.equal(invalidDate.status,400);
 assert.match((await invalidDate.json()).error,/date/);
});

test('partial purchase receipt updates stock, movement history and order status atomically',async(t)=>{
 const originalGetConnection=db.getConnection,originalExecute=db.execute,queries=[];
 let committed=false,rolledBack=false,released=false;
 const connection={
  beginTransaction:async()=>{},
  commit:async()=>{committed=true;},
  rollback:async()=>{rolledBack=true;},
  release:()=>{released=true;},
  execute:async(sql,values)=>{
   queries.push({sql,values});
   if(sql.includes('SELECT id,reference,status FROM purchase_orders'))return [[{id:10,reference:null,status:'ordered'}],[]];
   if(sql.includes('SELECT i.id,i.product_id'))return [[{id:20,product_id:30,quantity_ordered:'5.000',quantity_received:'0.000',unit_cost:'8.00',product_name:'Produit test'}],[]];
   if(sql.includes('SELECT quantity_on_hand,purchase_cost FROM products'))return [[{quantity_on_hand:'2.000',purchase_cost:'5.0000'}],[]];
   if(sql.includes('SELECT COUNT(*) pending'))return [[{pending:1}],[]];
   return [{affectedRows:1,insertId:50},[]];
  },
 };
 db.getConnection=async()=>connection;
 db.execute=async()=>[{affectedRows:1},[]];
 t.after(()=>{db.getConnection=originalGetConnection;db.execute=originalExecute;});

 const app=express();
 app.use(express.json());
 app.use((req,res,next)=>{req.tenantId=42;req.user={id:7,role:'OWNER'};next();});
 app.use('/api/purchases',purchasesRoutes);
 const server=app.listen(0);
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 await new Promise(resolve=>server.once('listening',resolve));

 const response=await fetch(`http://127.0.0.1:${server.address().port}/api/purchases/10/receive`,{
  method:'POST',
  headers:{'Content-Type':'application/json'},
  body:JSON.stringify({items:[{item_id:20,quantity:2}]}),
 });
 assert.equal(response.status,200);
 assert.deepEqual(await response.json(),{message:'Réception partielle enregistrée.',status:'partially_received'});
 assert.equal(committed,true);
 assert.equal(rolledBack,false);
 assert.equal(released,true);
 const stockUpdate=queries.find(query=>query.sql.startsWith('UPDATE products'));
 assert.deepEqual(stockUpdate.values,[2,'6.5000',30,42]);
 const movement=queries.find(query=>query.sql.startsWith('INSERT INTO stock_movements'));
 assert.deepEqual(movement.values,[42,30,7,'IN',2,'CMD-10','Réception commande CMD-10.']);
 const statusUpdate=queries.find(query=>query.sql.startsWith('UPDATE purchase_orders SET status'));
 assert.deepEqual(statusUpdate.values,['partially_received','10',42]);
});
