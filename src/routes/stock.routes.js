const r=require('express').Router(),db=require('../config/database'),{audit}=require('../services/audit.service'),{requireRole}=require('../middleware/auth');
const canManageInventory=requireRole('OWNER','ADMIN','STOREKEEPER','SUPER_ADMIN');
const {requireModuleAccess}=require('../middleware/module-access');
r.use(requireModuleAccess('stock'));
const canValidate=requireRole('OWNER','ADMIN','SUPER_ADMIN');
const documentMovement=/^(Vente |Retour facture|Annulation de la facture|Réception commande|Stock initial)/;
const signs={IN:1,OUT:-1};
const text=(value,max)=>value===undefined||value===null||value===''?null:(typeof value==='string'&&value.length<=max?value:false);
r.get('/movements',async(req,res,next)=>{try{const [rows]=await db.execute(`SELECT m.id,m.movement_type,m.quantity,m.reference,m.notes,m.created_at,p.sku,p.name product_name,
  ac.id correction_id,ac.old_quantity corrected_from,ac.reason correction_reason,ac.validated_at corrected_at,ru.full_name modified_by_name,vu.full_name validated_by_name,
  pc.id pending_id,pc.new_quantity pending_quantity,pc.new_reference pending_reference,pc.new_notes pending_notes,pc.reason pending_reason,pc.requested_by pending_by_id,pu.full_name pending_by_name
  FROM stock_movements m JOIN products p ON p.id=m.product_id AND p.organization_id=m.organization_id
  LEFT JOIN stock_movement_corrections ac ON ac.id=(SELECT MAX(x.id) FROM stock_movement_corrections x WHERE x.movement_id=m.id AND x.status='approved')
  LEFT JOIN users ru ON ru.id=ac.requested_by LEFT JOIN users vu ON vu.id=ac.validated_by
  LEFT JOIN stock_movement_corrections pc ON pc.id=(SELECT MAX(x.id) FROM stock_movement_corrections x WHERE x.movement_id=m.id AND x.status='pending')
  LEFT JOIN users pu ON pu.id=pc.requested_by
  WHERE m.organization_id=? ORDER BY m.created_at DESC,m.id DESC LIMIT 100`,[req.tenantId]);
 res.json(rows.map(row=>({...row,correctable:!documentMovement.test(row.notes||'')&&row.reference!=='STOCK_INITIAL'})));}catch(e){next(e);}});
r.post('/movements/:id/corrections',canManageInventory,async(req,res,next)=>{
 try{
  const b=req.body||{},reason=typeof b.reason==='string'?b.reason.trim():'';
  if(!reason||reason.length>500)return res.status(400).json({error:'Le motif de la correction est obligatoire (500 caractères maximum).'});
  const reference=text(b.reference,120),notes=text(b.notes,65535),quantity=Number(b.quantity);
  if(reference===false||notes===false)return res.status(400).json({error:'Référence ou note invalide.'});
  if(!Number.isFinite(quantity)||quantity<=0)return res.status(400).json({error:'La quantité doit être supérieure à zéro.'});
  const [rows]=await db.execute('SELECT id,movement_type,quantity,reference,notes FROM stock_movements WHERE id=? AND organization_id=?',[req.params.id,req.tenantId]);
  const movement=rows[0];
  if(!movement)return res.status(404).json({error:'Mouvement introuvable.'});
  if(documentMovement.test(movement.notes||'')||movement.reference==='STOCK_INITIAL')return res.status(409).json({error:'Ce mouvement est lié à un document (vente, retour, réception, stock initial) et ne peut pas être corrigé ici.'});
  if(movement.movement_type==='ADJUSTMENT'&&quantity!==Number(movement.quantity))return res.status(409).json({error:'La quantité d’un ajustement ne peut pas être corrigée. Enregistrez un nouvel ajustement.'});
  if(quantity===Number(movement.quantity)&&(reference||null)===(movement.reference||null)&&(notes||null)===(movement.notes||null))return res.status(400).json({error:'Aucune modification à enregistrer.'});
  const [pending]=await db.execute("SELECT id FROM stock_movement_corrections WHERE movement_id=? AND status='pending'",[movement.id]);
  if(pending.length)return res.status(409).json({error:'Une correction est déjà en attente de validation pour ce mouvement.'});
  const [x]=await db.execute('INSERT INTO stock_movement_corrections(organization_id,movement_id,requested_by,old_quantity,old_reference,old_notes,new_quantity,new_reference,new_notes,reason) VALUES(?,?,?,?,?,?,?,?,?,?)',[req.tenantId,movement.id,req.user.id,movement.quantity,movement.reference,movement.notes,quantity,reference,notes,reason]);
  await audit({tenantId:req.tenantId,userId:req.user.id,action:'STOCK_CORRECTION_REQUESTED',entityType:'stock_movement',entityId:movement.id});
  res.status(201).json({id:x.insertId,message:'Correction soumise pour validation.'});
 }catch(e){next(e);}
});
r.post('/corrections/:id/approve',canValidate,async(req,res,next)=>{
 const c=await db.getConnection();
 try{
  await c.beginTransaction();
  const [crs]=await c.execute('SELECT * FROM stock_movement_corrections WHERE id=? AND organization_id=? FOR UPDATE',[req.params.id,req.tenantId]);
  const cr=crs[0];
  if(!cr){await c.rollback();return res.status(404).json({error:'Correction introuvable.'});}
  if(cr.status!=='pending'){await c.rollback();return res.status(409).json({error:'Cette correction a déjà été traitée.'});}
  if(Number(cr.requested_by)===Number(req.user.id)&&req.user.role!=='SUPER_ADMIN'){await c.rollback();return res.status(403).json({error:'La correction doit être validée par une autre personne que son auteur.'});}
  const [mvs]=await c.execute('SELECT id,product_id,movement_type,quantity,reference,notes FROM stock_movements WHERE id=? AND organization_id=? FOR UPDATE',[cr.movement_id,req.tenantId]);
  const mv=mvs[0];
  if(!mv){await c.rollback();return res.status(404).json({error:'Mouvement introuvable.'});}
  const [ps]=await c.execute('SELECT id,quantity_on_hand FROM products WHERE id=? AND organization_id=? FOR UPDATE',[mv.product_id,req.tenantId]);
  if(!ps.length){await c.rollback();return res.status(404).json({error:'Produit introuvable.'});}
  const delta=(signs[mv.movement_type]||0)*(Number(cr.new_quantity)-Number(mv.quantity)),next=Number(ps[0].quantity_on_hand)+delta;
  if(next<0){await c.rollback();return res.status(409).json({error:'Stock insuffisant pour appliquer cette correction.'});}
  if(delta)await c.execute('UPDATE products SET quantity_on_hand=?,purchase_cost=NULL WHERE id=? AND organization_id=?',[next,mv.product_id,req.tenantId]);
  await c.execute('UPDATE stock_movements SET quantity=?,reference=?,notes=? WHERE id=? AND organization_id=?',[cr.new_quantity,cr.new_reference,cr.new_notes,mv.id,req.tenantId]);
  await c.execute("UPDATE stock_movement_corrections SET status='approved',validated_by=?,validated_at=NOW(),old_quantity=?,old_reference=?,old_notes=? WHERE id=?",[req.user.id,mv.quantity,mv.reference,mv.notes,cr.id]);
  await c.commit();
  await audit({tenantId:req.tenantId,userId:req.user.id,action:'STOCK_CORRECTION_APPROVED',entityType:'stock_movement',entityId:mv.id});
  res.json({message:'Correction validée et appliquée.',quantity_on_hand:next});
 }catch(e){await c.rollback();next(e);}finally{c.release();}
});
r.post('/corrections/:id/reject',canValidate,async(req,res,next)=>{
 try{
  const note=text((req.body||{}).note,500);
  if(note===false)return res.status(400).json({error:'Le motif du rejet est limité à 500 caractères.'});
  const [x]=await db.execute("UPDATE stock_movement_corrections SET status='rejected',validated_by=?,validated_at=NOW(),decision_note=? WHERE id=? AND organization_id=? AND status='pending'",[req.user.id,note,req.params.id,req.tenantId]);
  if(!x.affectedRows)return res.status(404).json({error:'Aucune correction en attente avec cet identifiant.'});
  await audit({tenantId:req.tenantId,userId:req.user.id,action:'STOCK_CORRECTION_REJECTED',entityType:'stock_correction',entityId:Number(req.params.id)});
  res.json({message:'Correction rejetée.'});
 }catch(e){next(e);}
});
r.post('/movements',canManageInventory,async(req,res,next)=>{const b=req.body||{},qty=Number(b.quantity);if(!b.product_id||!['IN','OUT','ADJUSTMENT'].includes(b.movement_type)||!Number.isFinite(qty)||qty<=0)return res.status(400).json({error:'Produit, type et quantité valide requis.'});
 const c=await db.getConnection();try{await c.beginTransaction();const [p]=await c.execute('SELECT id,quantity_on_hand FROM products WHERE id=? AND organization_id=? FOR UPDATE',[b.product_id,req.tenantId]);
 if(!p.length){await c.rollback();return res.status(404).json({error:'Produit introuvable dans cet établissement.'});}
 const current=Number(p[0].quantity_on_hand),next=b.movement_type==='ADJUSTMENT'?qty:current+(b.movement_type==='IN'?qty:-qty);
 if(next<0){await c.rollback();return res.status(409).json({error:'Stock insuffisant.'});}
 await c.execute('UPDATE products SET quantity_on_hand=?,purchase_cost=IF(? > 0,NULL,purchase_cost) WHERE id=? AND organization_id=?',[next,next-current,b.product_id,req.tenantId]);
 const [x]=await c.execute('INSERT INTO stock_movements(organization_id,product_id,user_id,movement_type,quantity,reference,notes) VALUES(?,?,?,?,?,?,?)',[req.tenantId,b.product_id,req.user.id,b.movement_type,qty,b.reference||null,b.notes||null]);
 await c.commit();await audit({tenantId:req.tenantId,userId:req.user.id,action:'STOCK_MOVEMENT',entityType:'stock_movement',entityId:x.insertId});res.status(201).json({id:x.insertId,quantity_on_hand:next});
 }catch(e){await c.rollback();next(e);}finally{c.release();}});module.exports=r;
