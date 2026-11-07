const r=require('express').Router(),db=require('../config/database'),{audit}=require('../services/audit.service'),{requireRole}=require('../middleware/auth');
const canManageProcurement=requireRole('OWNER','ADMIN','STOREKEEPER');
const {requireModuleAccess}=require('../middleware/module-access');
r.use(requireModuleAccess('procurement'));
const {averageCost}=require('../services/stock-valuation.service');
const validDate=value=>{
 if(!value)return true;
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
 const date=new Date(`${value}T00:00:00.000Z`);
 return !Number.isNaN(date.getTime())&&date.toISOString().slice(0,10)===value;
};
function validateItems(items){
 if(!Array.isArray(items)||items.length<1||items.length>100)return 'La commande doit contenir de 1 à 100 produits.';
 const seen=new Set();
 for(const item of items){
  if(!item||typeof item!=='object')return 'Une ligne de commande est invalide.';
  const productId=Number(item.product_id),quantity=Number(item.quantity_ordered),cost=Number(item.unit_cost||0);
  if(!Number.isSafeInteger(productId)||productId<=0)return 'Un produit de la commande est invalide.';
  if(seen.has(productId))return 'Chaque produit ne peut apparaître qu’une fois dans une commande.';
  if(!Number.isFinite(quantity)||quantity<=0)return 'Les quantités commandées doivent être supérieures à zéro.';
  if(!Number.isFinite(cost)||cost<0)return 'Les coûts unitaires doivent être positifs ou nuls.';
  seen.add(productId);
 }
 return null;
}
async function validateProducts(connection,tenantId,items){
 const ids=items.map(item=>Number(item.product_id)),placeholders=ids.map(()=>'?').join(',');
 const [rows]=await connection.execute(
  `SELECT id FROM products WHERE organization_id=? AND is_active=1 AND id IN (${placeholders})`,
  [tenantId,...ids]
 );
 return rows.length===ids.length;
}
async function insertItems(connection,orderId,items){
 for(const item of items)await connection.execute(
  'INSERT INTO purchase_order_items(purchase_order_id,product_id,quantity_ordered,unit_cost) VALUES(?,?,?,?)',
  [orderId,Number(item.product_id),Number(item.quantity_ordered),Number(item.unit_cost||0)]
 );
}

r.get('/',async(req,res,next)=>{
 try{
  const [rows]=await db.execute(
   `SELECT o.id,o.supplier_id,o.reference,o.status,o.expected_date,o.notes,o.created_at,
           s.name supplier_name,COUNT(i.id) item_count,
           COALESCE(SUM(i.quantity_ordered),0) quantity_ordered,
           COALESCE(SUM(i.quantity_received),0) quantity_received,
           COALESCE(SUM(i.quantity_ordered*i.unit_cost),0) total_amount
    FROM purchase_orders o
    JOIN suppliers s ON s.id=o.supplier_id AND s.organization_id=o.organization_id
    LEFT JOIN purchase_order_items i ON i.purchase_order_id=o.id
    WHERE o.organization_id=?
    GROUP BY o.id ORDER BY o.created_at DESC LIMIT 500`,
   [req.tenantId]
  );
  res.json(rows);
 }catch(error){next(error);}
});

r.get('/:id',async(req,res,next)=>{
 try{
  const [orders]=await db.execute(
   `SELECT o.id,o.supplier_id,o.reference,o.status,o.expected_date,o.notes,o.created_at,s.name supplier_name
    FROM purchase_orders o JOIN suppliers s
      ON s.id=o.supplier_id AND s.organization_id=o.organization_id
    WHERE o.id=? AND o.organization_id=?`,
   [req.params.id,req.tenantId]
  );
  if(!orders.length)return res.status(404).json({error:'Commande introuvable.'});
  const [items]=await db.execute(
   `SELECT i.id,i.product_id,i.quantity_ordered,i.quantity_received,i.unit_cost,p.sku,p.name product_name,p.unit
    FROM purchase_order_items i JOIN products p ON p.id=i.product_id
    WHERE i.purchase_order_id=? ORDER BY p.name`,
   [req.params.id]
  );
  res.json({...orders[0],items});
 }catch(error){next(error);}
});

r.post('/',canManageProcurement,async(req,res,next)=>{
 const body=req.body||{},items=body.items,validation=validateItems(items);
 if(!body.supplier_id||!Number.isSafeInteger(Number(body.supplier_id))||Number(body.supplier_id)<=0)return res.status(400).json({error:'Un fournisseur valide est obligatoire.'});
 if(validation)return res.status(400).json({error:validation});
 if(!validDate(body.expected_date))return res.status(400).json({error:'La date de livraison prévue est invalide.'});
 let connection;
 try{
  connection=await db.getConnection();
  await connection.beginTransaction();
  const [suppliers]=await connection.execute('SELECT id FROM suppliers WHERE id=? AND organization_id=? AND is_active=1 FOR UPDATE',[body.supplier_id,req.tenantId]);
  if(!suppliers.length){await connection.rollback();connection.release();connection=null;return res.status(404).json({error:'Fournisseur introuvable.'});}
  if(!await validateProducts(connection,req.tenantId,items)){await connection.rollback();connection.release();connection=null;return res.status(400).json({error:'Un produit est absent ou archivé.'});}
  const [result]=await connection.execute(
   'INSERT INTO purchase_orders(organization_id,supplier_id,reference,expected_date,notes,created_by) VALUES(?,?,?,?,?,?)',
   [req.tenantId,body.supplier_id,body.reference||null,body.expected_date||null,body.notes||null,req.user.id]
  );
  await insertItems(connection,result.insertId,items);
  await connection.commit();connection.release();connection=null;
  await audit({tenantId:req.tenantId,userId:req.user.id,action:'PURCHASE_CREATED',entityType:'purchase_order',entityId:result.insertId});
  res.status(201).json({id:result.insertId,message:'Brouillon de commande créé.'});
 }catch(error){if(connection){await connection.rollback();connection.release();}next(error);}
});

r.put('/:id',canManageProcurement,async(req,res,next)=>{
 const body=req.body||{},items=body.items,validation=validateItems(items);
 if(validation)return res.status(400).json({error:validation});
 if(body.expected_date!==undefined&&!validDate(body.expected_date))return res.status(400).json({error:'La date de livraison prévue est invalide.'});
 let connection;
 try{
  connection=await db.getConnection();
  await connection.beginTransaction();
  const [orders]=await connection.execute('SELECT id,supplier_id,status FROM purchase_orders WHERE id=? AND organization_id=? FOR UPDATE',[req.params.id,req.tenantId]);
  if(!orders.length){await connection.rollback();connection.release();connection=null;return res.status(404).json({error:'Commande introuvable.'});}
  if(orders[0].status!=='draft'){await connection.rollback();connection.release();connection=null;return res.status(409).json({error:'Seuls les brouillons peuvent être modifiés.'});}
  const supplierId=body.supplier_id===undefined?orders[0].supplier_id:Number(body.supplier_id);
  const [suppliers]=await connection.execute('SELECT id,is_active FROM suppliers WHERE id=? AND organization_id=? FOR UPDATE',[supplierId,req.tenantId]);
  if(!suppliers.length||(!suppliers[0].is_active&&supplierId!==Number(orders[0].supplier_id))){await connection.rollback();connection.release();connection=null;return res.status(404).json({error:'Fournisseur introuvable ou archivé.'});}
  if(!await validateProducts(connection,req.tenantId,items)){await connection.rollback();connection.release();connection=null;return res.status(400).json({error:'Un produit est absent ou archivé.'});}
  await connection.execute(
   'UPDATE purchase_orders SET supplier_id=?,reference=?,expected_date=?,notes=? WHERE id=? AND organization_id=?',
   [supplierId,body.reference||null,body.expected_date||null,body.notes||null,req.params.id,req.tenantId]
  );
  await connection.execute('DELETE FROM purchase_order_items WHERE purchase_order_id=?',[req.params.id]);
  await insertItems(connection,req.params.id,items);
  await connection.commit();connection.release();connection=null;
  await audit({tenantId:req.tenantId,userId:req.user.id,action:'PURCHASE_UPDATED',entityType:'purchase_order',entityId:req.params.id});
  res.json({message:'Commande modifiée.'});
 }catch(error){if(connection){await connection.rollback();connection.release();}next(error);}
});

r.post('/:id/order',canManageProcurement,async(req,res,next)=>{
 try{
  const [result]=await db.execute(
   "UPDATE purchase_orders SET status='ordered' WHERE id=? AND organization_id=? AND status='draft'",
   [req.params.id,req.tenantId]
  );
  if(!result.affectedRows)return res.status(409).json({error:'Cette commande n’est plus un brouillon.'});
  await audit({tenantId:req.tenantId,userId:req.user.id,action:'PURCHASE_ORDERED',entityType:'purchase_order',entityId:req.params.id});
  res.json({message:'Commande confirmée.'});
 }catch(error){next(error);}
});

r.post('/:id/receive',canManageProcurement,async(req,res,next)=>{
 const items=req.body?.items;
 if(!Array.isArray(items)||!items.length)return res.status(400).json({error:'Indiquez les lignes et quantités à réceptionner.'});
 const seen=new Set();
 for(const item of items){
  const id=Number(item.item_id),quantity=Number(item.quantity);
  if(!Number.isSafeInteger(id)||id<=0||seen.has(id)||!Number.isFinite(quantity)||quantity<=0||!/^\d{1,11}(?:\.\d{1,3})?$/.test(String(item.quantity)))return res.status(400).json({error:'Chaque ligne doit avoir un identifiant unique et une quantité valide à trois décimales maximum.'});
  seen.add(id);
 }
 let connection;
 try{
  connection=await db.getConnection();
  await connection.beginTransaction();
  const [orders]=await connection.execute(
   "SELECT id,reference,status FROM purchase_orders WHERE id=? AND organization_id=? FOR UPDATE",
   [req.params.id,req.tenantId]
  );
  if(!orders.length){await connection.rollback();connection.release();connection=null;return res.status(404).json({error:'Commande introuvable.'});}
  if(!['ordered','partially_received'].includes(orders[0].status)){await connection.rollback();connection.release();connection=null;return res.status(409).json({error:'La commande doit être confirmée avant réception.'});}
  for(const item of items){
   const [lines]=await connection.execute(
    `SELECT i.id,i.product_id,i.quantity_ordered,i.quantity_received,i.unit_cost,p.name product_name
     FROM purchase_order_items i JOIN products p ON p.id=i.product_id
     WHERE i.id=? AND i.purchase_order_id=? FOR UPDATE`,
    [item.item_id,req.params.id]
   );
   if(!lines.length){await connection.rollback();connection.release();connection=null;return res.status(400).json({error:'Une ligne de commande est introuvable.'});}
   const line=lines[0],quantity=Number(item.quantity),remaining=Number(line.quantity_ordered)-Number(line.quantity_received);
   if(quantity>remaining){await connection.rollback();connection.release();connection=null;return res.status(409).json({error:`La quantité reçue dépasse le reste à livrer pour ${line.product_name}.`});}
   const [products]=await connection.execute('SELECT quantity_on_hand,purchase_cost FROM products WHERE id=? AND organization_id=? FOR UPDATE',[line.product_id,req.tenantId]);
   if(!products.length){await connection.rollback();connection.release();connection=null;return res.status(404).json({error:'Produit introuvable dans cet établissement.'});}
   let cost;
   try{cost=averageCost(products[0].quantity_on_hand,products[0].purchase_cost,item.quantity,line.unit_cost);}
   catch(error){if(error instanceof RangeError){await connection.rollback();connection.release();connection=null;return res.status(400).json({error:'Quantité ou coût incompatible avec la valorisation du stock.'});}throw error;}
   await connection.execute('UPDATE products SET quantity_on_hand=quantity_on_hand+?,purchase_cost=? WHERE id=? AND organization_id=?',[quantity,cost,line.product_id,req.tenantId]);
   await connection.execute('UPDATE purchase_order_items SET quantity_received=quantity_received+? WHERE id=?',[quantity,line.id]);
   const reference=orders[0].reference||`CMD-${orders[0].id}`;
   await connection.execute(
    'INSERT INTO stock_movements(organization_id,product_id,user_id,movement_type,quantity,reference,notes) VALUES(?,?,?,?,?,?,?)',
    [req.tenantId,line.product_id,req.user.id,'IN',quantity,reference,`Réception commande ${reference}.`]
   );
  }
  const [pending]=await connection.execute('SELECT COUNT(*) pending FROM purchase_order_items WHERE purchase_order_id=? AND quantity_received<quantity_ordered',[req.params.id]);
  const status=Number(pending[0].pending)===0?'received':'partially_received';
  await connection.execute('UPDATE purchase_orders SET status=? WHERE id=? AND organization_id=?',[status,req.params.id,req.tenantId]);
  await connection.commit();connection.release();connection=null;
  await audit({tenantId:req.tenantId,userId:req.user.id,action:'PURCHASE_RECEIVED',entityType:'purchase_order',entityId:req.params.id,details:{items:items.length,status}});
  res.json({message:status==='received'?'Commande entièrement réceptionnée.':'Réception partielle enregistrée.',status});
 }catch(error){if(connection){await connection.rollback();connection.release();}next(error);}
});

r.post('/:id/cancel',canManageProcurement,async(req,res,next)=>{
 try{
  const [result]=await db.execute(
   `UPDATE purchase_orders o SET status='cancelled'
    WHERE o.id=? AND o.organization_id=? AND o.status IN ('draft','ordered')
      AND NOT EXISTS(SELECT 1 FROM purchase_order_items i WHERE i.purchase_order_id=o.id AND i.quantity_received>0)`,
   [req.params.id,req.tenantId]
  );
  if(!result.affectedRows)return res.status(409).json({error:'Cette commande ne peut pas être annulée.'});
  await audit({tenantId:req.tenantId,userId:req.user.id,action:'PURCHASE_CANCELLED',entityType:'purchase_order',entityId:req.params.id});
  res.json({message:'Commande annulée.'});
 }catch(error){next(error);}
});

module.exports=r;
