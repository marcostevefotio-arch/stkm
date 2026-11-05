const r=require('express').Router(),db=require('../config/database'),{audit}=require('../services/audit.service'),{requireRole}=require('../middleware/auth');
const canManageInventory=requireRole('OWNER','ADMIN','STOREKEEPER');
r.get('/movements',async(req,res,next)=>{try{const [rows]=await db.execute(`SELECT m.id,m.movement_type,m.quantity,m.reference,m.notes,m.created_at,p.sku,p.name product_name FROM stock_movements m JOIN products p ON p.id=m.product_id AND p.organization_id=m.organization_id WHERE m.organization_id=? ORDER BY m.created_at DESC LIMIT 100`,[req.tenantId]);res.json(rows);}catch(e){next(e);}});
r.post('/movements',canManageInventory,async(req,res,next)=>{const b=req.body||{},qty=Number(b.quantity);if(!b.product_id||!['IN','OUT','ADJUSTMENT'].includes(b.movement_type)||!Number.isFinite(qty)||qty<=0)return res.status(400).json({error:'Produit, type et quantité valide requis.'});
 const c=await db.getConnection();try{await c.beginTransaction();const [p]=await c.execute('SELECT id,quantity_on_hand FROM products WHERE id=? AND organization_id=? FOR UPDATE',[b.product_id,req.tenantId]);
 if(!p.length){await c.rollback();return res.status(404).json({error:'Produit introuvable dans cet établissement.'});}
 const current=Number(p[0].quantity_on_hand),next=b.movement_type==='ADJUSTMENT'?qty:current+(b.movement_type==='IN'?qty:-qty);
 if(next<0){await c.rollback();return res.status(409).json({error:'Stock insuffisant.'});}
 await c.execute('UPDATE products SET quantity_on_hand=? WHERE id=? AND organization_id=?',[next,b.product_id,req.tenantId]);
 const [x]=await c.execute('INSERT INTO stock_movements(organization_id,product_id,user_id,movement_type,quantity,reference,notes) VALUES(?,?,?,?,?,?,?)',[req.tenantId,b.product_id,req.user.id,b.movement_type,qty,b.reference||null,b.notes||null]);
 await c.commit();await audit({tenantId:req.tenantId,userId:req.user.id,action:'STOCK_MOVEMENT',entityType:'stock_movement',entityId:x.insertId});res.status(201).json({id:x.insertId,quantity_on_hand:next});
 }catch(e){await c.rollback();next(e);}finally{c.release();}});module.exports=r;
