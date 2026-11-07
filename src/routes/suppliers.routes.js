const r=require('express').Router(),db=require('../config/database'),{audit}=require('../services/audit.service'),{requireRole}=require('../middleware/auth');
const canManageProcurement=requireRole('OWNER','ADMIN','STOREKEEPER');
const {requireModuleAccess}=require('../middleware/module-access');
r.use(requireModuleAccess('procurement'));
const fields={name:'name',contact_name:'contact_name',email:'email',phone:'phone',address:'address',notes:'notes'};

r.get('/',async(req,res,next)=>{
 try{
  const activeOnly=req.query.includeArchived==='1'?'':'AND s.is_active=1';
  const [rows]=await db.execute(
   `SELECT s.id,s.name,s.contact_name,s.email,s.phone,s.address,s.notes,s.is_active,s.created_at,
           COUNT(DISTINCT p.id) purchase_count
    FROM suppliers s LEFT JOIN purchase_orders p
      ON p.supplier_id=s.id AND p.organization_id=s.organization_id
    WHERE s.organization_id=? ${activeOnly}
    GROUP BY s.id ORDER BY s.name`,
   [req.tenantId]
  );
  res.json(rows);
 }catch(error){next(error);}
});

r.post('/',canManageProcurement,async(req,res,next)=>{
 try{
  const body=req.body||{},name=String(body.name||'').trim();
  if(!name)return res.status(400).json({error:'Le nom du fournisseur est obligatoire.'});
  const [result]=await db.execute(
   'INSERT INTO suppliers(organization_id,name,contact_name,email,phone,address,notes) VALUES(?,?,?,?,?,?,?)',
   [req.tenantId,name,body.contact_name||null,body.email||null,body.phone||null,body.address||null,body.notes||null]
  );
  await audit({tenantId:req.tenantId,userId:req.user.id,action:'SUPPLIER_CREATED',entityType:'supplier',entityId:result.insertId});
  res.status(201).json({id:result.insertId,message:'Fournisseur créé.'});
 }catch(error){next(error);}
});

r.put('/:id',canManageProcurement,async(req,res,next)=>{
 try{
  const body=req.body||{},sets=[],values=[];
  if(Object.prototype.hasOwnProperty.call(body,'name')){
   const name=String(body.name||'').trim();
   if(!name)return res.status(400).json({error:'Le nom du fournisseur est obligatoire.'});
   sets.push('name=?');values.push(name);
  }
  for(const field of ['contact_name','email','phone','address','notes']){
   if(Object.prototype.hasOwnProperty.call(body,field)){
    sets.push(`${fields[field]}=?`);values.push(body[field]||null);
   }
  }
  if(!sets.length)return res.status(400).json({error:'Aucune modification à enregistrer.'});
  const [result]=await db.execute(
   `UPDATE suppliers SET ${sets.join(',')} WHERE id=? AND organization_id=? AND is_active=1`,
   [...values,req.params.id,req.tenantId]
  );
  if(!result.affectedRows){
   const [rows]=await db.execute('SELECT id FROM suppliers WHERE id=? AND organization_id=? AND is_active=1',[req.params.id,req.tenantId]);
   if(!rows.length)return res.status(404).json({error:'Fournisseur introuvable.'});
  }
  await audit({tenantId:req.tenantId,userId:req.user.id,action:'SUPPLIER_UPDATED',entityType:'supplier',entityId:req.params.id});
  res.json({message:'Fournisseur modifié.'});
 }catch(error){next(error);}
});

r.delete('/:id',canManageProcurement,async(req,res,next)=>{
 try{
  const [result]=await db.execute('UPDATE suppliers SET is_active=0 WHERE id=? AND organization_id=? AND is_active=1',[req.params.id,req.tenantId]);
  if(!result.affectedRows)return res.status(404).json({error:'Fournisseur introuvable.'});
  await audit({tenantId:req.tenantId,userId:req.user.id,action:'SUPPLIER_ARCHIVED',entityType:'supplier',entityId:req.params.id});
  res.json({message:'Fournisseur archivé.'});
 }catch(error){next(error);}
});

module.exports=r;
