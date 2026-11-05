const test=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const db=require('../src/config/database');
const productsRoutes=require('../src/routes/products.routes');

async function listen(t){
 const app=express();app.use(express.json());
 app.use((req,res,next)=>{req.tenantId=42;req.user={id:7,role:'ADMIN'};next();});
 app.use('/api/products',productsRoutes);
 const server=app.listen(0);
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 await new Promise(resolve=>server.once('listening',resolve));
 return `http://127.0.0.1:${server.address().port}/api/products`;
}

test('product sale-safety rules reject invalid values before database access',async(t)=>{
 const originalGetConnection=db.getConnection;let calls=0;
 db.getConnection=async()=>{calls+=1;throw Error('Database should not be called');};
 t.after(()=>{db.getConnection=originalGetConnection;});
 const url=await listen(t);
 const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sku:'SKU-1',name:'Produit',quantity_on_hand:1,reorder_level:0,sale_price:5,minimum_purchase_interval_hours:8761})});
 assert.equal(response.status,400);
 assert.match((await response.json()).error,/intervalle/i);
 assert.equal(calls,0);
});

test('product creation persists prescription and advisory quantity rules',async(t)=>{
 const originalGetConnection=db.getConnection,originalExecute=db.execute;let inserted;
 const connection={
  beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{},release:()=>{},
  execute:async(sql,values)=>{if(sql.startsWith('INSERT INTO products')){inserted={sql,values};return [{insertId:8},[]];}return [{affectedRows:1},[]];},
 };
 db.getConnection=async()=>connection;db.execute=async()=>[{affectedRows:1},[]];
 t.after(()=>{db.getConnection=originalGetConnection;db.execute=originalExecute;});
 const url=await listen(t);
 const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sku:'SKU-8',name:'Produit contrôlé',unit:'boîte',quantity_on_hand:5,reorder_level:1,sale_price:12.5,prescription_required:true,max_customer_quantity:2,minimum_purchase_interval_hours:24})});
 assert.equal(response.status,201);
 assert.match(inserted.sql,/prescription_required,max_customer_quantity,minimum_purchase_interval_hours/);
 assert.deepEqual(inserted.values,[42,'SKU-8','Produit contrôlé',null,'boîte',5,1,12.5,null,true,2,24]);
});

test('product label generation validates the format and selection before database access',async(t)=>{
 const originalGetConnection=db.getConnection;let calls=0;
 db.getConnection=async()=>{calls+=1;throw Error('Database should not be called');};
 t.after(()=>{db.getConnection=originalGetConnection;});
 const url=await listen(t);
 const invalidFormat=await fetch(`${url}/labels`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ids:[1],format:'pdf'})});
 assert.equal(invalidFormat.status,400);
 const duplicateIds=await fetch(`${url}/labels`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ids:[1,1],format:'qr'})});
 assert.equal(duplicateIds.status,400);
 assert.equal(calls,0);
});

test('product labels persist unique barcodes and return printable QR images',async(t)=>{
 const originalGetConnection=db.getConnection,originalExecute=db.execute,queries=[];let committed=false,rolledBack=false;
 const connection={
  beginTransaction:async()=>{},
  commit:async()=>{committed=true;},
  rollback:async()=>{rolledBack=true;},
  release:()=>{},
  execute:async(sql,values)=>{
   queries.push({sql,values});
   if(sql.startsWith('SELECT id,sku,name,barcode FROM products'))return [[{id:8,sku:'SKU-8',name:'Produit contrôlé',barcode:null}],[]];
   if(sql.startsWith('SELECT id,sku,barcode FROM products'))return [[],[]];
   return [{affectedRows:1},[]];
  },
 };
 db.getConnection=async()=>connection;
 db.execute=async(sql,values)=>{queries.push({sql,values});return [{affectedRows:1},[]];};
 t.after(()=>{db.getConnection=originalGetConnection;db.execute=originalExecute;});
 const url=await listen(t);
 const response=await fetch(`${url}/labels`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ids:[8],format:'qr'})});
 assert.equal(response.status,200);
 const result=await response.json();
 assert.equal(result.labels.length,1);
 assert.equal(result.labels[0].barcode,'RDM8');
 assert.match(result.labels[0].qr_data,/^data:image\/png;base64,/);
 assert.deepEqual(queries.find(query=>query.sql.startsWith('UPDATE products SET barcode')).values,['RDM8',8,42]);
 assert.equal(committed,true);
 assert.equal(rolledBack,false);
 assert.equal(queries.some(query=>query.sql.startsWith('INSERT INTO audit_logs')),true);
});
