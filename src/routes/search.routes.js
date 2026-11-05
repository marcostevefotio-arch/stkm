const r=require('express').Router(),db=require('../config/database');
const {MODULE_KEYS,parseJson}=require('../config/pricing');

r.get('/',async(req,res,next)=>{
 try{
  const query=String(req.query.q||'').trim();
  if(query.length<2)return res.status(400).json({error:'Saisissez au moins 2 caractères.'});
  if(query.length>100)return res.status(400).json({error:'La recherche est limitée à 100 caractères.'});
  const raw=req.user?.subscription_modules;
  const modules=raw===null||raw===undefined?MODULE_KEYS:parseJson(raw,[]);
  const hasFeature=feature=>Array.isArray(modules)&&modules.includes(feature);
  const term=`%${query}%`;
  let products=[],movements=[],alerts=[],suppliers=[],purchases=[],patients=[],insurers=[];
  if(hasFeature('stock')){
   [products]=await db.execute(
    `SELECT id,sku,name,category,unit,quantity_on_hand,reorder_level,sale_price,barcode
     FROM products WHERE organization_id=? AND is_active=1
     AND (sku LIKE ? OR name LIKE ? OR category LIKE ? OR barcode LIKE ?)
     ORDER BY name LIMIT 50`,
    [req.tenantId,term,term,term,term]
   );
   [movements]=await db.execute(
    `SELECT m.id,m.movement_type,m.quantity,m.reference,m.notes,m.created_at,
            p.sku,p.name product_name
     FROM stock_movements m
     JOIN products p ON p.id=m.product_id AND p.organization_id=m.organization_id
     WHERE m.organization_id=?
       AND (p.sku LIKE ? OR p.name LIKE ? OR m.movement_type LIKE ? OR m.reference LIKE ? OR m.notes LIKE ?)
     ORDER BY m.created_at DESC LIMIT 50`,
    [req.tenantId,term,term,term,term,term]
   );
   [alerts]=await db.execute(
    `SELECT id,sku,name,category,unit,quantity_on_hand,reorder_level
     FROM products WHERE organization_id=? AND is_active=1
       AND quantity_on_hand<=reorder_level
       AND (sku LIKE ? OR name LIKE ? OR category LIKE ? OR barcode LIKE ?)
     ORDER BY name LIMIT 50`,
    [req.tenantId,term,term,term,term]
   );
  }
  if(hasFeature('procurement')){
   [suppliers]=await db.execute(
    `SELECT id,name,contact_name,email,phone
     FROM suppliers WHERE organization_id=? AND is_active=1
       AND (name LIKE ? OR contact_name LIKE ? OR email LIKE ? OR phone LIKE ?)
     ORDER BY name LIMIT 50`,
    [req.tenantId,term,term,term,term]
   );
   [purchases]=await db.execute(
    `SELECT o.id,o.reference,o.status,o.expected_date,o.created_at,s.name supplier_name,
            COUNT(DISTINCT i.id) item_count,
            GROUP_CONCAT(DISTINCT p.name ORDER BY p.name SEPARATOR ', ') product_names
     FROM purchase_orders o
     JOIN suppliers s ON s.id=o.supplier_id AND s.organization_id=o.organization_id
     LEFT JOIN purchase_order_items i ON i.purchase_order_id=o.id
     LEFT JOIN products p ON p.id=i.product_id
     WHERE o.organization_id=?
       AND (o.reference LIKE ? OR CAST(o.id AS CHAR) LIKE ? OR s.name LIKE ? OR o.status LIKE ? OR p.name LIKE ? OR p.sku LIKE ?)
     GROUP BY o.id ORDER BY o.created_at DESC LIMIT 50`,
    [req.tenantId,term,term,term,term,term,term]
   );
  }
  if(hasFeature('patients')){
   [patients]=await db.execute(
    `SELECT id,patient_code,full_name,birth_date,gender,phone,email
     FROM patients WHERE organization_id=? AND is_active=1
       AND (patient_code LIKE ? OR full_name LIKE ? OR phone LIKE ? OR email LIKE ?)
     ORDER BY full_name LIMIT 50`,
    [req.tenantId,term,term,term,term]
   );
   [insurers]=await db.execute(
    `SELECT id,name,contact_name,email,phone
     FROM insurers WHERE organization_id=? AND is_active=1
       AND (name LIKE ? OR contact_name LIKE ? OR email LIKE ? OR phone LIKE ?)
     ORDER BY name LIMIT 50`,
    [req.tenantId,term,term,term,term]
   );
  }
  res.json({products,movements,alerts,suppliers,purchases,patients,insurers});
 }catch(e){next(e);}
});

module.exports=r;
