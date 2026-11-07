const r=require('express').Router(),db=require('../config/database'),QR=require('qrcode'),{audit}=require('../services/audit.service'),{requireRole}=require('../middleware/auth');
const canManageInventory=requireRole('OWNER','ADMIN','STOREKEEPER');
const {requireModuleAccess}=require('../middleware/module-access');
r.use(requireModuleAccess('stock'));
r.get('/',async(req,res,next)=>{try{const [rows]=await db.execute('SELECT id,sku,name,category,unit,quantity_on_hand,reorder_level,sale_price,purchase_cost,barcode,prescription_required,max_customer_quantity,minimum_purchase_interval_hours FROM products WHERE organization_id=? AND is_active=1 ORDER BY name',[req.tenantId]);res.json(rows);}catch(e){next(e);}});
const validId=value=>(typeof value==='number'||typeof value==='string'&&value.trim()!=='')&&Number.isSafeInteger(Number(value))&&Number(value)>0;
r.post('/labels',canManageInventory,async(req,res,next)=>{
 const {ids,format}=req.body||{};
 if(!Array.isArray(ids)||ids.length<1||ids.length>1000||ids.some(id=>!validId(id))||new Set(ids.map(Number)).size!==ids.length)return res.status(400).json({error:'Sélectionnez entre 1 et 1 000 produits sans doublon.'});
 if(!['barcode','qr'].includes(format))return res.status(400).json({error:'Choisissez un format de code-barres ou QR valide.'});
 let connection;
 try{
  connection=await db.getConnection();await connection.beginTransaction();
  const placeholders=ids.map(()=>'?').join(',');
  const [products]=await connection.execute(
   `SELECT id,sku,name,barcode FROM products WHERE organization_id=? AND is_active=1 AND id IN (${placeholders}) ORDER BY name FOR UPDATE`,
   [req.tenantId,...ids.map(Number)]
  );
  if(products.length!==ids.length)throw Object.assign(Error('Un ou plusieurs produits sont introuvables ou archivés.'),{status:404});
  const prepared=products.map(product=>({...product,barcode:String(product.barcode||'').trim()||`RDM${product.id}`,generated:!String(product.barcode||'').trim()}));
  const codes=prepared.map(product=>product.barcode),normalizedCodes=new Set(codes.map(code=>code.toLocaleLowerCase('en-US')));
  if(normalizedCodes.size!==prepared.length)throw Object.assign(Error('Des produits sélectionnés partagent le même code. Corrigez leurs codes-barres avant impression.'),{status:409});
  if(format==='barcode'&&prepared.some(product=>!/^[\x20-\x7e]{1,120}$/.test(product.barcode)))throw Object.assign(Error('Un code-barres Code 128 doit contenir uniquement des caractères ASCII imprimables (120 maximum).'),{status:400});
  if(prepared.some(product=>prepared.some(other=>Number(other.id)!==Number(product.id)&&(other.sku.toLocaleLowerCase('en-US')===product.barcode.toLocaleLowerCase('en-US')||other.barcode.toLocaleLowerCase('en-US')===product.sku.toLocaleLowerCase('en-US')))))throw Object.assign(Error('Un code sélectionné correspond au SKU ou au code-barres d’un autre produit sélectionné.'),{status:409});
  const codePlaceholders=codes.map(()=>'?').join(',');
  const [conflicts]=await connection.execute(
   `SELECT id,sku,barcode FROM products WHERE organization_id=? AND is_active=1 AND id NOT IN (${placeholders})
    AND (barcode IN (${codePlaceholders}) OR sku IN (${codePlaceholders}))`,
   [req.tenantId,...prepared.map(product=>Number(product.id)),...codes,...codes]
  );
  if(conflicts.length)throw Object.assign(Error('Un code sélectionné existe déjà sur un autre produit. Corrigez les codes-barres avant impression.'),{status:409});
  for(const product of prepared)if(product.generated)await connection.execute('UPDATE products SET barcode=? WHERE id=? AND organization_id=?',[product.barcode,product.id,req.tenantId]);
  const labels=await Promise.all(prepared.map(async product=>({
   id:Number(product.id),sku:product.sku,name:product.name,barcode:product.barcode,
   ...(format==='qr'?{qr_data:await QR.toDataURL(product.barcode,{width:180,margin:1,errorCorrectionLevel:'M'})}:{})
  })));
  await connection.commit();connection.release();connection=null;
  const generated=prepared.filter(product=>product.generated);
  if(generated.length)await audit({tenantId:req.tenantId,userId:req.user.id,action:'PRODUCT_BARCODES_GENERATED',entityType:'product',entityId:generated[0].id,details:{productIds:generated.map(product=>Number(product.id))}});
  res.json({format,labels});
 }catch(error){if(connection){await connection.rollback();connection.release();}if(error.status)return res.status(error.status).json({error:error.message});next(error);}
});
function numberField(value,label,{required=false}={}){
 if(value===undefined||value===null||value===''){return required?`${label} est obligatoire.`:null;}
 if(typeof value!=='number'&&typeof value!=='string')return `${label} doit être un nombre positif ou nul.`;
 const number=Number(value);
 return Number.isFinite(number)&&number>=0?null:`${label} doit être un nombre positif ou nul.`;
}
const numeric=value=>(typeof value==='number'||typeof value==='string'&&value.trim()!=='')&&Number.isFinite(Number(value));
function validateSaleRules(body){
 if(body.prescription_required!==undefined&&!['true','false',true,false,0,1,'0','1'].includes(body.prescription_required))return 'La règle d’ordonnance est invalide.';
 if(body.max_customer_quantity!==undefined&&body.max_customer_quantity!==null&&body.max_customer_quantity!==''&&(!numeric(body.max_customer_quantity)||Number(body.max_customer_quantity)<=0||Number(body.max_customer_quantity)>99999999999.999||Math.abs(Number(body.max_customer_quantity)*1000-Math.round(Number(body.max_customer_quantity)*1000))>1e-7))return 'Le seuil de quantité doit être supérieur à zéro et limité à trois décimales.';
 if(body.minimum_purchase_interval_hours!==undefined&&body.minimum_purchase_interval_hours!==null&&body.minimum_purchase_interval_hours!==''&&(!numeric(body.minimum_purchase_interval_hours)||!Number.isInteger(Number(body.minimum_purchase_interval_hours))||Number(body.minimum_purchase_interval_hours)<1||Number(body.minimum_purchase_interval_hours)>8760))return 'L’intervalle d’achat doit être compris entre 1 et 8 760 heures.';
 return null;
}
const enabled=value=>value===true||value===1||value==='1'||value==='true';
const validCost=value=>value===null||value===''||value===undefined||/^\d{1,14}(?:\.\d{1,4})?$/.test(String(value));
r.post('/',canManageInventory,async(req,res,next)=>{let connection;try{const b=req.body||{},sku=String(b.sku||'').trim(),name=String(b.name||'').trim();
 if(!sku||!name)return res.status(400).json({error:'SKU et nom obligatoires.'});
 if(!validCost(b.purchase_cost))return res.status(400).json({error:'Le coût d’achat doit être positif ou nul, avec au plus quatre décimales.'});
 const validation=numberField(b.quantity_on_hand,'Le stock initial')||numberField(b.reorder_level,'Le seuil')||numberField(b.sale_price,'Le prix')||validateSaleRules(b);
 if(validation)return res.status(400).json({error:validation});
 const initialStock=Number(b.quantity_on_hand||0),unit=String(b.unit||'unité').trim();
 if(!unit)return res.status(400).json({error:'L’unité est obligatoire.'});
 connection=await db.getConnection();await connection.beginTransaction();
 const [x]=await connection.execute('INSERT INTO products(organization_id,sku,name,category,unit,quantity_on_hand,reorder_level,sale_price,barcode,prescription_required,max_customer_quantity,minimum_purchase_interval_hours,purchase_cost) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
 [req.tenantId,sku,name,b.category||null,unit,initialStock,Number(b.reorder_level||0),Number(b.sale_price||0),b.barcode||null,enabled(b.prescription_required),b.max_customer_quantity?Number(b.max_customer_quantity):null,b.minimum_purchase_interval_hours?Number(b.minimum_purchase_interval_hours):null,b.purchase_cost===undefined||b.purchase_cost===null||b.purchase_cost===''?null:String(b.purchase_cost)]);
 if(initialStock>0)await connection.execute('INSERT INTO stock_movements(organization_id,product_id,user_id,movement_type,quantity,reference,notes) VALUES(?,?,?,?,?,?,?)',
 [req.tenantId,x.insertId,req.user.id,'ADJUSTMENT',initialStock,'STOCK_INITIAL','Stock initial à la création du produit.']);
 await connection.commit();connection.release();connection=null;
 await audit({tenantId:req.tenantId,userId:req.user.id,action:'PRODUCT_CREATED',entityType:'product',entityId:x.insertId});res.status(201).json({id:x.insertId,message:'Produit créé.'});
 }catch(e){if(connection){await connection.rollback();connection.release();}next(e);}});
r.put('/:id',canManageInventory,async(req,res,next)=>{try{const b=req.body||{},fields={sku:'sku',name:'name',category:'category',unit:'unit',reorder_level:'reorder_level',sale_price:'sale_price',purchase_cost:'purchase_cost',barcode:'barcode',prescription_required:'prescription_required',max_customer_quantity:'max_customer_quantity',minimum_purchase_interval_hours:'minimum_purchase_interval_hours'},sets=[],values=[];
 if(!validCost(b.purchase_cost))return res.status(400).json({error:'Le coût d’achat doit être positif ou nul, avec au plus quatre décimales.'});
 if(Object.prototype.hasOwnProperty.call(b,'purchase_cost')&&(!Object.prototype.hasOwnProperty.call(b,'expected_purchase_cost')||!validCost(b.expected_purchase_cost)))return res.status(400).json({error:'Le coût moyen initial doit être fourni pour vérifier les modifications concurrentes.'});
 if(Object.prototype.hasOwnProperty.call(b,'sku')){const value=String(b.sku||'').trim();if(!value)return res.status(400).json({error:'Le SKU est obligatoire.'});sets.push('sku=?');values.push(value);}
 if(Object.prototype.hasOwnProperty.call(b,'name')){const value=String(b.name||'').trim();if(!value)return res.status(400).json({error:'Le nom est obligatoire.'});sets.push('name=?');values.push(value);}
 const saleRuleError=validateSaleRules(b);if(saleRuleError)return res.status(400).json({error:saleRuleError});
 for(const field of ['category','unit','reorder_level','sale_price','purchase_cost','barcode','prescription_required','max_customer_quantity','minimum_purchase_interval_hours'])if(Object.prototype.hasOwnProperty.call(b,field)){
  if(field==='unit'&&!String(b[field]||'').trim())return res.status(400).json({error:'L’unité est obligatoire.'});
  if(['reorder_level','sale_price'].includes(field)){const validation=numberField(b[field],field==='reorder_level'?'Le seuil':'Le prix',{required:true});if(validation)return res.status(400).json({error:validation});}
  sets.push(`${fields[field]}=?`);values.push(field==='category'||field==='barcode'?b[field]||null:field==='unit'?String(b[field]).trim():field==='prescription_required'?enabled(b[field]):['max_customer_quantity','minimum_purchase_interval_hours','purchase_cost'].includes(field)&&b[field]===''?null:b[field]);
 }
 if(!sets.length)return res.status(400).json({error:'Aucune modification à enregistrer.'});
 const checkingCost=Object.prototype.hasOwnProperty.call(b,'purchase_cost');
 const [x]=await db.execute(`UPDATE products SET ${sets.join(',')} WHERE id=? AND organization_id=? AND is_active=1${checkingCost?' AND purchase_cost <=> ?':''}`,[...values,req.params.id,req.tenantId,...(checkingCost?[b.expected_purchase_cost===''?null:b.expected_purchase_cost]:[])]);
 if(!x.affectedRows){const [rows]=await db.execute('SELECT id,purchase_cost FROM products WHERE id=? AND organization_id=? AND is_active=1',[req.params.id,req.tenantId]);if(!rows.length)return res.status(404).json({error:'Produit introuvable.'});if(checkingCost&&String(rows[0].purchase_cost===null?'':rows[0].purchase_cost)!==String(b.expected_purchase_cost===null?'':b.expected_purchase_cost))return res.status(409).json({error:'Le coût a changé. Actualisez le produit avant de le modifier.'});}
 await audit({tenantId:req.tenantId,userId:req.user.id,action:'PRODUCT_UPDATED',entityType:'product',entityId:req.params.id,details:checkingCost?{previous_purchase_cost:b.expected_purchase_cost===''?null:b.expected_purchase_cost,purchase_cost:b.purchase_cost===''?null:b.purchase_cost}:null});res.json({message:'Produit modifié.'});
 }catch(e){next(e);}});
r.delete('/:id',canManageInventory,async(req,res,next)=>{try{const [x]=await db.execute('UPDATE products SET is_active=0 WHERE id=? AND organization_id=? AND is_active=1',[req.params.id,req.tenantId]);
 if(!x.affectedRows)return res.status(404).json({error:'Produit introuvable.'});
 await audit({tenantId:req.tenantId,userId:req.user.id,action:'PRODUCT_ARCHIVED',entityType:'product',entityId:req.params.id});res.json({message:'Produit archivé.'});
 }catch(e){next(e);}});module.exports=r;
