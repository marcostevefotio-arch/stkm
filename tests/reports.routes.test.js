const test=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const db=require('../src/config/database');
const reportsRoutes=require('../src/routes/reports.routes');

async function listen(t){
 const app=express();
 app.use((req,res,next)=>{req.tenantId=42;next();});
 app.use('/api/reports',reportsRoutes);
 const server=app.listen(0);
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 await new Promise(resolve=>server.once('listening',resolve));
 return `http://127.0.0.1:${server.address().port}/api/reports`;
}

test('reports reject unsupported periods before querying tenant data',async(t)=>{
 const originalExecute=db.execute;let calls=0;
 db.execute=async()=>{calls+=1;throw Error('Database should not be called');};
 t.after(()=>{db.execute=originalExecute;});
 const url=await listen(t);
 const response=await fetch(`${url}?days=14`);
 assert.equal(response.status,400);
 assert.match((await response.json()).error,/7, 30, 90 ou 365/);
 assert.equal(calls,0);
});

test('reports return tenant-scoped sales, stock, categories and purchasing analytics',async(t)=>{
 const originalExecute=db.execute,queries=[];
 db.execute=async(sql,values)=>{
  queries.push({sql,values});
  if(sql.includes('FROM sales_invoices')&&sql.includes('GROUP BY DATE_FORMAT(created_at'))return [[{report_date:'2026-11-04',invoice_count:'2',gross_revenue:'120.00',tax_amount:'10.00'}],[]];
  if(sql.includes('FROM sales_returns'))return [[{report_date:'2026-11-04',refunds:'5.00'}],[]];
  if(sql.includes('FROM products p'))return [[{id:1,sku:'SKU-1',name:'Produit A',category:'Santé',unit:'boîte',quantity_on_hand:'4.000',reorder_level:'5.000',sale_price:'20.00',units_sold:'3.000',net_revenue:'60.00'}],[]];
  if(sql.includes('GROUP BY COALESCE(NULLIF(p.category'))return [[{category:'Santé',units_sold:'3.000',net_revenue:'60.00',invoice_count:2}],[]];
  if(sql.includes('FROM stock_movements'))return [[{report_date:'2026-11-04',movement_type:'OUT',quantity:'3.000',movement_count:2}],[]];
  if(sql.includes('FROM purchase_orders'))return [[{status:'received',order_count:1,ordered_value:'45.00'}],[]];
  throw Error(`Unexpected report query: ${sql}`);
 };
 t.after(()=>{db.execute=originalExecute;});
 const url=await listen(t),response=await fetch(`${url}?days=30`);
 assert.equal(response.status,200);
 const report=await response.json();
 assert.equal(report.period_days,30);
 assert.equal(report.sales[0].gross_revenue,'120.00');
 assert.equal(report.returns[0].refunds,'5.00');
 assert.equal(report.products[0].units_sold,'3.000');
 assert.equal(report.categories[0].category,'Santé');
 assert.equal(report.movements[0].movement_type,'OUT');
 assert.equal(report.purchases[0].order_count,1);
 assert.equal(queries.length,6);
 assert.ok(queries.every(query=>query.values.includes(42)));
 assert.ok(queries.every(query=>query.sql.includes('organization_id')));
 assert.match(queries[0].sql,/SELECT DATE_FORMAT\(created_at,'%Y-%m-%d'\).*GROUP BY DATE_FORMAT\(created_at,'%Y-%m-%d'\)/s);
 assert.match(queries[1].sql,/SELECT DATE_FORMAT\(sr\.created_at,'%Y-%m-%d'\).*GROUP BY DATE_FORMAT\(sr\.created_at,'%Y-%m-%d'\)/s);
 assert.match(queries[4].sql,/SELECT DATE_FORMAT\(created_at,'%Y-%m-%d'\).*GROUP BY DATE_FORMAT\(created_at,'%Y-%m-%d'\),movement_type/s);
});
