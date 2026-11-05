const router=require('express').Router();
const db=require('../config/database');
const {audit}=require('../services/audit.service');
const {requireRole}=require('../middleware/auth');
const allowSales=requireRole('OWNER','ADMIN','PHARMACIST','CASHIER');
const viewPrescription=requireRole('OWNER','ADMIN','PHARMACIST');
const paymentMethods=new Set(['cash','mobile_money','bank_transfer','insurance','other']);
const prescriptionMimeTypes=new Set(['image/jpeg','image/png','image/webp']);
const maxPrescriptionBytes=500*1024;
const isNumeric=value=>(typeof value==='number'&&Number.isFinite(value))||(typeof value==='string'&&value.trim()!==''&&Number.isFinite(Number(value)));
const money=value=>Math.round((Number(value)+Number.EPSILON)*100)/100;
const validId=value=>isNumeric(value)&&Number.isSafeInteger(Number(value))&&Number(value)>0;
const validQuantity=value=>isNumeric(value)&&Number(value)>0&&Number(value)<=99999999999.999&&Math.abs(Number(value)*1000-Math.round(Number(value)*1000))<1e-7;
const validMoney=value=>isNumeric(value)&&Number(value)>=0&&Number(value)<=999999999999&&Math.abs(Number(value)*100-Math.round(Number(value)*100))<1e-7;
const roundLine=(quantity,price)=>money(Number(quantity)*Number(price));
function validatePayments(payments,{allowEmpty=true}={}){
 if(payments===undefined&&allowEmpty)return null;
 if(!Array.isArray(payments)||(!allowEmpty&&!payments.length)||payments.length>10)return 'Les paiements doivent contenir de 1 à 10 lignes.';
 for(const payment of payments){
  if(!payment||!paymentMethods.has(payment.method)||!validMoney(payment.amount)||Number(payment.amount)<=0)return 'Un mode ou montant de paiement est invalide.';
  if(payment.method==='cash'&&payment.cash_received!==undefined&&(!validMoney(payment.cash_received)||Number(payment.cash_received)<Number(payment.amount)))return 'Le montant reçu en espèces doit couvrir le montant encaissé.';
  if(payment.method==='insurance'&&!validId(payment.insurer_id))return 'Sélectionnez l’assureur pour le paiement par assurance.';
  if(payment.reference!==undefined&&(typeof payment.reference!=='string'||payment.reference.length>190))return 'La référence de paiement est limitée à 190 caractères.';
 }
 return null;
}
function validateItems(items){
 if(!Array.isArray(items)||items.length<1||items.length>100)return 'La vente doit contenir de 1 à 100 produits.';
 const seen=new Set();
 for(const item of items){
  if(!item||!validId(item.product_id)||!validQuantity(item.quantity))return 'Un produit ou une quantité de vente est invalide.';
  if(seen.has(Number(item.product_id)))return 'Regroupez chaque produit sur une seule ligne.';
  if(item.prescription_provided!==undefined&&typeof item.prescription_provided!=='boolean')return 'La confirmation d’ordonnance est invalide.';
  seen.add(Number(item.product_id));
 }
 return null;
}
function parsePrescriptionImage(image){
 if(image===undefined||image===null)return null;
 if(!image||typeof image!=='object'||!prescriptionMimeTypes.has(image.mime_type)||typeof image.data!=='string'||image.data.length===0||image.data.length>Math.ceil(maxPrescriptionBytes/3)*4||image.data.length%4!==0||!/^[A-Za-z0-9+/]+={0,2}$/.test(image.data))throw Object.assign(Error('L’image de l’ordonnance est invalide ou trop volumineuse (maximum 500 Ko).'),{status:400});
 const data=Buffer.from(image.data,'base64');
 if(data.length===0||data.length>maxPrescriptionBytes||data.toString('base64')!==image.data)throw Object.assign(Error('L’image de l’ordonnance est invalide ou trop volumineuse (maximum 500 Ko).'),{status:400});
 const jpeg=image.mime_type==='image/jpeg'&&data.length>=3&&data[0]===0xff&&data[1]===0xd8&&data[2]===0xff;
 const png=image.mime_type==='image/png'&&data.length>=8&&data.subarray(0,8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]));
 const webp=image.mime_type==='image/webp'&&data.length>=12&&data.toString('ascii',0,4)==='RIFF'&&data.toString('ascii',8,12)==='WEBP';
 if(!jpeg&&!png&&!webp)throw Object.assign(Error('Le format du fichier ne correspond pas à une image JPEG, PNG ou WebP valide.'),{status:400});
 return {mimeType:image.mime_type,data};
}
function validateInvoiceInput(body){
 const validation=validateItems(body.items)||validatePayments(body.payments);
 if(validation)return validation;
 if(body.prescription_image!==undefined&&body.prescription_image!==null&&(typeof body.prescription_image!=='object'||Array.isArray(body.prescription_image)))return 'L’image de l’ordonnance est invalide.';
 if(body.patient_id!==undefined&&body.patient_id!==null&&body.patient_id!==''&&!validId(body.patient_id))return 'Le patient sélectionné est invalide.';
 if(body.patient_name!==undefined&&(typeof body.patient_name!=='string'||body.patient_name.length>190))return 'Le nom du client est trop long.';
 if(body.notes!==undefined&&(typeof body.notes!=='string'||body.notes.length>2000))return 'Les notes sont limitées à 2 000 caractères.';
 return null;
}
async function findOpenSession(connection,tenantId,{required=true,lock=false}={}){
 const [rows]=await connection.execute(
  `SELECT id,opening_cash,opened_at FROM cash_sessions
   WHERE organization_id=? AND status='open' ORDER BY id DESC LIMIT 1${lock?' FOR UPDATE':''}`,
  [tenantId]
 );
 if(!rows.length&&required)throw Object.assign(Error('Ouvrez une session de caisse avant cette opération.'),{status:409});
 return rows[0]||null;
}
async function validateInsurance(connection,tenantId,patientId,insurerId){
 if(!patientId)throw Object.assign(Error('Un patient est requis pour un paiement par assurance.'),{status:400});
 const [rows]=await connection.execute(
  `SELECT c.id FROM patient_insurance_coverages c
   JOIN insurers i ON i.id=c.insurer_id AND i.organization_id=c.organization_id AND i.is_active=1
   JOIN patients p ON p.id=c.patient_id AND p.organization_id=c.organization_id AND p.is_active=1
   WHERE c.organization_id=? AND c.patient_id=? AND c.insurer_id=? AND c.status='active'
     AND (c.start_date IS NULL OR c.start_date<=CURRENT_DATE())
     AND (c.end_date IS NULL OR c.end_date>=CURRENT_DATE()) LIMIT 1`,
  [tenantId,patientId,insurerId]
 );
 if(!rows.length)throw Object.assign(Error('Aucune couverture active ne correspond à ce patient et cet assureur.'),{status:400});
}
async function addPayments(connection,{tenantId,userId,invoiceId,patientId,totalAmount,payments,session}){
 const [[totals]]=await connection.execute(
  `SELECT COALESCE((SELECT SUM(amount) FROM sales_payments WHERE invoice_id=?),0) paid,
          COALESCE((SELECT SUM(refund_amount) FROM sales_returns WHERE invoice_id=?),0) refunded,
          COALESCE((SELECT SUM(ri.refund_amount) FROM sales_return_items ri JOIN sales_returns sr ON sr.id=ri.return_id WHERE sr.invoice_id=?),0) returned_value`,
  [invoiceId,invoiceId,invoiceId]
 );
 const balance=money(Number(totalAmount)-Number(totals.returned_value)-Number(totals.paid)+Number(totals.refunded));
 const requested=money(payments.reduce((sum,payment)=>sum+Number(payment.amount),0));
 if(requested>balance+0.001)throw Object.assign(Error('Le total des paiements dépasse le solde de la facture.'),{status:409});
 for(const payment of payments){
  const amount=money(payment.amount);
  if(payment.method==='insurance')await validateInsurance(connection,tenantId,patientId,Number(payment.insurer_id));
  const received=payment.method==='cash'?money(payment.cash_received===undefined?amount:payment.cash_received):0;
  const change=payment.method==='cash'?money(received-amount):0;
  await connection.execute(
   `INSERT INTO sales_payments(invoice_id,payment_method,amount,cash_received,cash_change,insurer_id,reference,recorded_by)
    VALUES(?,?,?,?,?,?,?,?)`,
   [invoiceId,payment.method,amount,received,change,payment.method==='insurance'?Number(payment.insurer_id):null,payment.reference||null,userId]
  );
  await connection.execute(
   `INSERT INTO cash_movements(organization_id,session_id,movement_type,payment_method,amount,cash_received,cash_change,description,invoice_id,recorded_by)
    VALUES(?,?,'sale',?,?,?,?,?,?,?)`,
   [tenantId,session.id,payment.method,amount,received,change,`Paiement facture ${invoiceId}`,invoiceId,userId]
  );
 }
}
async function refreshInvoiceStatus(connection,invoiceId){
 const [[row]]=await connection.execute(
  `SELECT i.total_amount,
          COALESCE((SELECT SUM(amount) FROM sales_payments WHERE invoice_id=i.id),0) paid,
          COALESCE((SELECT SUM(refund_amount) FROM sales_returns WHERE invoice_id=i.id),0) refunded,
          COALESCE((SELECT SUM(ri.refund_amount) FROM sales_return_items ri JOIN sales_returns sr ON sr.id=ri.return_id WHERE sr.invoice_id=i.id),0) returned_value
   FROM sales_invoices i WHERE i.id=?`,
  [invoiceId]
 );
 const netPaid=money(Number(row.paid)-Number(row.refunded)),remainingTotal=money(Number(row.total_amount)-Number(row.returned_value));
 let status;
 if(remainingTotal<=0)status='returned';
 else if(Number(row.returned_value)>0)status='partially_returned';
 else if(netPaid<=0)status='issued';
 else if(netPaid+0.001>=remainingTotal)status='paid';
 else status='partially_paid';
 await connection.execute('UPDATE sales_invoices SET status=? WHERE id=?',[status,invoiceId]);
 return status;
}
async function createSale(req,res,next){
 const body=req.body||{},validation=validateInvoiceInput(body);
 if(validation)return res.status(400).json({error:validation});
 let prescriptionImage;
 try{prescriptionImage=parsePrescriptionImage(body.prescription_image);}catch(error){return res.status(error.status||400).json({error:error.message});}
 let connection;
 try{
  connection=await db.getConnection();await connection.beginTransaction();
  const session=await findOpenSession(connection,req.tenantId,{lock:true});
  const patientId=body.patient_id?Number(body.patient_id):null;
  if(patientId){
   const [patients]=await connection.execute('SELECT id,full_name FROM patients WHERE id=? AND organization_id=? AND is_active=1 FOR UPDATE',[patientId,req.tenantId]);
   if(!patients.length)throw Object.assign(Error('Patient actif introuvable.'),{status:404});
   body.patient_name=patients[0].full_name;
  }
  const ids=body.items.map(item=>Number(item.product_id)),placeholders=ids.map(()=>'?').join(',');
  const [products]=await connection.execute(
   `SELECT id,sku,name,unit,quantity_on_hand,sale_price,prescription_required,max_customer_quantity,minimum_purchase_interval_hours
    FROM products WHERE organization_id=? AND is_active=1 AND id IN (${placeholders}) ORDER BY id FOR UPDATE`,
   [req.tenantId,...ids]
  );
  if(products.length!==ids.length)throw Object.assign(Error('Un produit est absent ou archivé.'),{status:400});
  const byId=new Map(products.map(product=>[Number(product.id),product]));
  const [settings]=await connection.execute('SELECT sales_tax_rate FROM organization_settings WHERE organization_id=?',[req.tenantId]);
  const taxRate=Number(settings[0]?.sales_tax_rate||0),prepared=[],flags=[];
  let subtotal=0;
  for(const item of body.items){
   const product=byId.get(Number(item.product_id)),quantity=Number(item.quantity),available=Number(product.quantity_on_hand);
   if(quantity>available)throw Object.assign(Error(`Stock insuffisant pour ${product.name} (${available} ${product.unit} disponible(s)).`),{status:409});
   if(product.prescription_required&&(!item.prescription_provided||!prescriptionImage))throw Object.assign(Error(`Confirmez la présentation et joignez une photo de l’ordonnance pour ${product.name}.`),{status:400});
   const lineSubtotal=roundLine(quantity,product.sale_price),lineTax=money(lineSubtotal*taxRate/100),lineTotal=money(lineSubtotal+lineTax);
   subtotal=money(subtotal+lineSubtotal);
   prepared.push({product,quantity,lineSubtotal,lineTax,lineTotal,prescriptionProvided:Boolean(item.prescription_provided)});
   const maximum=product.max_customer_quantity===null?null:Number(product.max_customer_quantity);
   const interval=Math.min(8760,Math.max(0,Math.floor(Number(product.minimum_purchase_interval_hours||0))));
   let priorQuantity=0;
   if(patientId&&interval>0){
    const intervalSeconds=Math.floor(interval*3600);
    const [[history]]=await connection.execute(
     `SELECT COALESCE(SUM(CASE WHEN TIMESTAMPDIFF(SECOND,s.created_at,CURRENT_TIMESTAMP)>=0
         AND TIMESTAMPDIFF(SECOND,s.created_at,CURRENT_TIMESTAMP)<${intervalSeconds}
        THEN GREATEST(si.quantity-si.returned_quantity,0) ELSE 0 END),0) recent_quantity,
       MIN(CASE WHEN si.returned_quantity<si.quantity AND TIMESTAMPDIFF(SECOND,s.created_at,CURRENT_TIMESTAMP)>=0
        THEN TIMESTAMPDIFF(SECOND,s.created_at,CURRENT_TIMESTAMP) END) recent_seconds
      FROM sales_invoice_items si JOIN sales_invoices s ON s.id=si.invoice_id
      WHERE s.organization_id=? AND s.patient_id=? AND si.product_id=? AND s.status<>'cancelled'
        AND s.created_at>=DATE_SUB(NOW(),INTERVAL 365 DAY)`,
     [req.tenantId,patientId,product.id]
    );
    priorQuantity=Number(history.recent_quantity);
    if(history.recent_seconds!==null&&Number(history.recent_seconds)<intervalSeconds)flags.push({type:'short_interval',product_id:Number(product.id),product_name:product.name,message:`Un achat récent de ce produit est à vérifier (intervalle minimal configuré : ${interval} h).`});
   }
   const totalQuantity=Number((quantity+priorQuantity).toFixed(3));
   if(maximum!==null&&totalQuantity>maximum)flags.push({type:'quantity_limit',product_id:Number(product.id),product_name:product.name,message:`Quantité cumulée à vérifier : ${totalQuantity} ${product.unit}, seuil configuré ${maximum} ${product.unit}${interval>0?` sur ${interval} h`:''}.`});
  }
  const taxAmount=money(prepared.reduce((sum,line)=>sum+line.lineTax,0)),totalAmount=money(subtotal+taxAmount);
  if(body.payments?.some(payment=>payment.method==='insurance'))await validateInsurance(connection,req.tenantId,patientId,Number(body.payments.find(payment=>payment.method==='insurance').insurer_id));
  const [inserted]=await connection.execute(
   `INSERT INTO sales_invoices(organization_id,invoice_number,patient_id,patient_name,subtotal,tax_rate,tax_amount,total_amount,review_flags,notes,created_by)
    VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
   [req.tenantId,`TMP-${require('crypto').randomUUID()}`,patientId,body.patient_name||null,subtotal,taxRate,taxAmount,totalAmount,flags.length?JSON.stringify(flags):null,body.notes||null,req.user.id]
  );
  const invoiceId=inserted.insertId,invoiceNumber=`FAC-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${String(invoiceId).padStart(6,'0')}`;
  await connection.execute('UPDATE sales_invoices SET invoice_number=? WHERE id=?',[invoiceNumber,invoiceId]);
  if(prescriptionImage)await connection.execute(
   'INSERT INTO sales_invoice_prescriptions(invoice_id,mime_type,image_data,captured_by) VALUES(?,?,?,?)',
   [invoiceId,prescriptionImage.mimeType,prescriptionImage.data,req.user.id]
  );
  for(const line of prepared){
   await connection.execute(
    `INSERT INTO sales_invoice_items(invoice_id,product_id,sku,product_name,unit,quantity,unit_price,line_subtotal,line_tax,line_total,prescription_required,prescription_provided)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
    [invoiceId,line.product.id,line.product.sku,line.product.name,line.product.unit,line.quantity,line.product.sale_price,line.lineSubtotal,line.lineTax,line.lineTotal,line.product.prescription_required,line.prescriptionProvided]
   );
   const nextStock=Number(line.product.quantity_on_hand)-line.quantity;
   await connection.execute('UPDATE products SET quantity_on_hand=? WHERE id=? AND organization_id=?',[nextStock,line.product.id,req.tenantId]);
   await connection.execute(
    `INSERT INTO stock_movements(organization_id,product_id,user_id,movement_type,quantity,reference,notes)
     VALUES(?,?,?,'OUT',?,?,?)`,
    [req.tenantId,line.product.id,req.user.id,line.quantity,invoiceNumber,`Vente ${invoiceNumber}.`]
   );
  }
  if(body.payments?.length)await addPayments(connection,{tenantId:req.tenantId,userId:req.user.id,invoiceId,patientId,totalAmount,payments:body.payments,session});
  const status=body.payments?.length?await refreshInvoiceStatus(connection,invoiceId):'issued';
  await connection.commit();connection.release();connection=null;
  await audit({tenantId:req.tenantId,userId:req.user.id,action:'SALE_CREATED',entityType:'sales_invoice',entityId:invoiceId,details:{invoiceNumber,totalAmount,reviewFlags:flags}});
  res.status(201).json({id:invoiceId,invoice_number:invoiceNumber,subtotal,tax_rate:taxRate,tax_amount:taxAmount,total_amount:totalAmount,status,review_flags:flags,message:'Vente enregistrée et reçu généré.'});
 }catch(error){if(connection){await connection.rollback();connection.release();}if(error.status)return res.status(error.status).json({error:error.message});next(error);}
}

router.use(allowSales);
router.get('/',async(req,res,next)=>{
 try{
  const [rows]=await db.execute(
   `SELECT i.id,i.invoice_number,i.patient_id,i.patient_name,i.subtotal,i.tax_rate,i.tax_amount,i.total_amount,i.status,i.review_flags,i.created_at,
      COALESCE((SELECT SUM(p.amount) FROM sales_payments p WHERE p.invoice_id=i.id),0) paid_amount,
      COALESCE((SELECT SUM(r.refund_amount) FROM sales_returns r WHERE r.invoice_id=i.id),0) refunded_amount
    FROM sales_invoices i WHERE i.organization_id=? ORDER BY i.created_at DESC LIMIT 500`,
   [req.tenantId]
  );
  res.json(rows);
 }catch(error){next(error);}
});
router.get('/patients/:patientId/insurers',async(req,res,next)=>{
 if(!validId(req.params.patientId))return res.status(400).json({error:'Patient invalide.'});
 try{
  const [rows]=await db.execute(
   `SELECT c.insurer_id,i.name insurer_name
    FROM patient_insurance_coverages c
    JOIN insurers i ON i.id=c.insurer_id AND i.organization_id=c.organization_id
    JOIN patients p ON p.id=c.patient_id AND p.organization_id=c.organization_id AND p.is_active=1
    WHERE c.organization_id=? AND c.patient_id=? AND c.status='active' AND i.is_active=1
      AND (c.start_date IS NULL OR c.start_date<=CURRENT_DATE()) AND (c.end_date IS NULL OR c.end_date>=CURRENT_DATE())
    ORDER BY i.name`,
   [req.tenantId,req.params.patientId]
  );
  res.json(rows);
 }catch(error){next(error);}
});
router.post('/',createSale);
router.get('/:id',async(req,res,next)=>{
 try{
  const [invoices]=await db.execute(
   `SELECT i.*,EXISTS(SELECT 1 FROM sales_invoice_prescriptions sp WHERE sp.invoice_id=i.id) has_prescription,
      COALESCE((SELECT SUM(p.amount) FROM sales_payments p WHERE p.invoice_id=i.id),0) paid_amount,
      COALESCE((SELECT SUM(r.refund_amount) FROM sales_returns r WHERE r.invoice_id=i.id),0) refunded_amount
    FROM sales_invoices i WHERE i.id=? AND i.organization_id=?`,
   [req.params.id,req.tenantId]
  );
  if(!invoices.length)return res.status(404).json({error:'Facture introuvable.'});
  const [items]=await db.execute('SELECT * FROM sales_invoice_items WHERE invoice_id=? ORDER BY id',[req.params.id]);
  const [payments]=await db.execute(
   `SELECT p.id,p.payment_method,p.amount,p.cash_received,p.cash_change,p.insurer_id,p.reference,p.created_at,i.name insurer_name
    FROM sales_payments p LEFT JOIN insurers i ON i.id=p.insurer_id WHERE p.invoice_id=? ORDER BY p.id`,
   [req.params.id]
  );
  const [returns]=await db.execute(
   `SELECT r.id,r.return_number,r.refund_amount,r.refund_method,r.cash_received,r.cash_change,r.insurer_id,i.name insurer_name,r.reason,r.created_at,
      COALESCE((SELECT JSON_ARRAYAGG(JSON_OBJECT('product_name',si.product_name,'quantity',ri.quantity,'refund_amount',ri.refund_amount,'restocked',ri.restocked))
       FROM sales_return_items ri JOIN sales_invoice_items si ON si.id=ri.invoice_item_id WHERE ri.return_id=r.id),JSON_ARRAY()) items
    FROM sales_returns r LEFT JOIN insurers i ON i.id=r.insurer_id WHERE r.invoice_id=? ORDER BY r.id DESC`,
   [req.params.id]
  );
  res.json({...invoices[0],items,payments,returns});
 }catch(error){next(error);}
});
router.get('/:id/prescription',viewPrescription,async(req,res,next)=>{
 if(!validId(req.params.id))return res.status(400).json({error:'Facture invalide.'});
 try{
  const [rows]=await db.execute(
   `SELECT p.mime_type,p.image_data FROM sales_invoice_prescriptions p
    JOIN sales_invoices i ON i.id=p.invoice_id
    WHERE p.invoice_id=? AND i.organization_id=? LIMIT 1`,
   [req.params.id,req.tenantId]
  );
  if(!rows.length)return res.status(404).json({error:'Aucune ordonnance enregistrée pour cette facture.'});
  if(!prescriptionMimeTypes.has(rows[0].mime_type))return res.status(500).json({error:'Le type de fichier enregistré est invalide.'});
  res.set('Content-Type',rows[0].mime_type).set('Content-Disposition',`inline; filename="ordonnance-${Number(req.params.id)}"`).set('Cache-Control','private, no-store').set('X-Content-Type-Options','nosniff').send(rows[0].image_data);
 }catch(error){next(error);}
});
router.post('/:id/payments',async(req,res,next)=>{
 const payments=req.body?.payments,validation=validatePayments(payments,{allowEmpty:false});
 if(validation)return res.status(400).json({error:validation});
 let connection;
 try{
  connection=await db.getConnection();await connection.beginTransaction();
  const [rows]=await connection.execute('SELECT id,patient_id,total_amount,status FROM sales_invoices WHERE id=? AND organization_id=? FOR UPDATE',[req.params.id,req.tenantId]);
  if(!rows.length)throw Object.assign(Error('Facture introuvable.'),{status:404});
  if(rows[0].status==='cancelled'||rows[0].status==='returned')throw Object.assign(Error('Cette facture ne peut plus recevoir de paiement.'),{status:409});
  const session=await findOpenSession(connection,req.tenantId,{lock:true});
  await addPayments(connection,{tenantId:req.tenantId,userId:req.user.id,invoiceId:rows[0].id,patientId:rows[0].patient_id,totalAmount:Number(rows[0].total_amount),payments,session});
  const status=await refreshInvoiceStatus(connection,rows[0].id);
  await connection.commit();connection.release();connection=null;
  await audit({tenantId:req.tenantId,userId:req.user.id,action:'SALE_PAYMENT_RECORDED',entityType:'sales_invoice',entityId:req.params.id});
  res.json({message:'Paiement enregistré.',status});
 }catch(error){if(connection){await connection.rollback();connection.release();}if(error.status)return res.status(error.status).json({error:error.message});next(error);}
});
router.post('/:id/returns',async(req,res,next)=>{
 const body=req.body||{},lines=body.items,method=body.refund_method,reason=typeof body.reason==='string'?body.reason.trim():'';
 if(!Array.isArray(lines)||!lines.length||lines.length>100||!paymentMethods.has(method)||reason.length<3||reason.length>500)return res.status(400).json({error:'Articles, mode de remboursement et motif (3 à 500 caractères) requis.'});
 if(method==='insurance'&&!validId(body.insurer_id))return res.status(400).json({error:'Sélectionnez l’assureur concerné par le remboursement.'});
 if(method==='cash'&&body.cash_received!==undefined&&!validMoney(body.cash_received))return res.status(400).json({error:'Le montant remis en espèces est invalide.'});
 const seen=new Set();
 for(const line of lines){if(!validId(line?.item_id)||!validQuantity(line?.quantity)||seen.has(Number(line.item_id))||(line.restocked!==undefined&&typeof line.restocked!=='boolean'))return res.status(400).json({error:'Une ligne de retour est invalide ou dupliquée.'});seen.add(Number(line.item_id));}
 let connection;
 try{
  connection=await db.getConnection();await connection.beginTransaction();
  const [invoices]=await connection.execute('SELECT id,invoice_number,total_amount,status FROM sales_invoices WHERE id=? AND organization_id=? FOR UPDATE',[req.params.id,req.tenantId]);
  if(!invoices.length)throw Object.assign(Error('Facture introuvable.'),{status:404});
  if(invoices[0].status==='cancelled'||invoices[0].status==='returned')throw Object.assign(Error('Cette facture ne peut plus être retournée.'),{status:409});
  const session=await findOpenSession(connection,req.tenantId,{lock:true});
  let refundAmount=0;const prepared=[];
  for(const line of lines){
   const [items]=await connection.execute(
    `SELECT si.id,si.product_id,si.quantity,si.returned_quantity,si.line_total,si.product_name,si.unit,p.quantity_on_hand
     FROM sales_invoice_items si JOIN products p ON p.id=si.product_id
     WHERE si.id=? AND si.invoice_id=? FOR UPDATE`,
    [line.item_id,invoices[0].id]
   );
   if(!items.length)throw Object.assign(Error('Article de facture introuvable.'),{status:404});
   const item=items[0],newReturned=Number(item.returned_quantity)+Number(line.quantity);
   if(newReturned>Number(item.quantity)+1e-7)throw Object.assign(Error(`La quantité retournée dépasse la quantité achetée pour ${item.product_name}.`),{status:409});
   const [previous]=await connection.execute(
    'SELECT COALESCE(SUM(refund_amount),0) refunded FROM sales_return_items WHERE invoice_item_id=?',
    [item.id]
   );
   const itemRefund=money(money(Number(item.line_total)*newReturned/Number(item.quantity))-Number(previous[0].refunded));
   if(itemRefund<0)throw Object.assign(Error('Le calcul du remboursement est invalide.'),{status:409});
   refundAmount=money(refundAmount+itemRefund);prepared.push({item,quantity:Number(line.quantity),newReturned,itemRefund,restocked:line.restocked!==false});
  }
  if(refundAmount<=0)throw Object.assign(Error('Le montant à rembourser doit être positif.'),{status:400});
  const [[collected]]=await connection.execute(
   `SELECT COALESCE((SELECT SUM(amount) FROM sales_payments WHERE invoice_id=?),0) paid,
      COALESCE((SELECT SUM(refund_amount) FROM sales_returns WHERE invoice_id=?),0) refunded`,
   [invoices[0].id,invoices[0].id]
  );
  if(refundAmount>Number(collected.paid)-Number(collected.refunded)+0.001)throw Object.assign(Error('Le remboursement dépasse le montant effectivement encaissé.'),{status:409});
  if(method==='insurance'){
   const [[insuranceTotals]]=await connection.execute(
    `SELECT COALESCE((SELECT SUM(amount) FROM sales_payments WHERE invoice_id=? AND payment_method='insurance' AND insurer_id=?),0) paid,
      COALESCE((SELECT SUM(refund_amount) FROM sales_returns WHERE invoice_id=? AND refund_method='insurance' AND insurer_id=?),0) refunded`,
    [invoices[0].id,Number(body.insurer_id),invoices[0].id,Number(body.insurer_id)]
   );
   if(refundAmount>Number(insuranceTotals.paid)-Number(insuranceTotals.refunded)+0.001)throw Object.assign(Error('Le remboursement dépasse le montant encaissé pour cet assureur.'),{status:409});
  }
  const received=method==='cash'?money(body.cash_received===undefined?refundAmount:body.cash_received):0;
  if(method==='cash'&&received<refundAmount)throw Object.assign(Error('Le montant remis en espèces doit couvrir le remboursement.'),{status:400});
  const cashChange=method==='cash'?money(received-refundAmount):0;
  const [inserted]=await connection.execute(
   `INSERT INTO sales_returns(invoice_id,return_number,refund_amount,refund_method,cash_received,cash_change,insurer_id,reason,recorded_by)
    VALUES(?,?,?,?,?,?,?,?,?)`,
   [invoices[0].id,`TMP-${require('crypto').randomUUID()}`,refundAmount,method,received,cashChange,method==='insurance'?Number(body.insurer_id):null,reason,req.user.id]
  );
  const returnNumber=`RET-${String(inserted.insertId).padStart(8,'0')}`;
  await connection.execute('UPDATE sales_returns SET return_number=? WHERE id=?',[returnNumber,inserted.insertId]);
  for(const line of prepared){
   await connection.execute('INSERT INTO sales_return_items(return_id,invoice_item_id,quantity,refund_amount,restocked) VALUES(?,?,?,?,?)',[inserted.insertId,line.item.id,line.quantity,line.itemRefund,line.restocked]);
   await connection.execute('UPDATE sales_invoice_items SET returned_quantity=? WHERE id=?',[line.newReturned,line.item.id]);
   if(line.restocked){
    await connection.execute('UPDATE products SET quantity_on_hand=quantity_on_hand+? WHERE id=? AND organization_id=?',[line.quantity,line.item.product_id,req.tenantId]);
    await connection.execute(
     `INSERT INTO stock_movements(organization_id,product_id,user_id,movement_type,quantity,reference,notes)
      VALUES(?,?,?,'IN',?,?,?)`,
     [req.tenantId,line.item.product_id,req.user.id,line.quantity,returnNumber,`Retour facture ${invoices[0].invoice_number}. Motif : ${reason}`]
    );
   }
  }
  await connection.execute(
   `INSERT INTO cash_movements(organization_id,session_id,movement_type,payment_method,amount,cash_received,cash_change,description,invoice_id,recorded_by)
    VALUES(?,?,'refund',?,?,?,?,?,?,?)`,
   [req.tenantId,session.id,method,refundAmount,received,cashChange,`Remboursement ${returnNumber}`,invoices[0].id,req.user.id]
  );
  const status=await refreshInvoiceStatus(connection,invoices[0].id);
  await connection.commit();connection.release();connection=null;
  await audit({tenantId:req.tenantId,userId:req.user.id,action:'SALE_RETURN_RECORDED',entityType:'sales_return',entityId:inserted.insertId,details:{invoiceId:invoices[0].id,refundAmount,returnNumber}});
  res.status(201).json({id:inserted.insertId,return_number:returnNumber,refund_amount:refundAmount,status,message:'Retour et remboursement enregistrés.'});
 }catch(error){if(connection){await connection.rollback();connection.release();}if(error.status)return res.status(error.status).json({error:error.message});next(error);}
});
router.post('/:id/cancel',async(req,res,next)=>{
 const reason=typeof req.body?.reason==='string'?req.body.reason.trim():'';
 if(reason.length<3||reason.length>500)return res.status(400).json({error:'Un motif d’annulation (3 à 500 caractères) est requis.'});
 let connection;
 try{
  connection=await db.getConnection();await connection.beginTransaction();
  const [invoices]=await connection.execute('SELECT id,invoice_number,status FROM sales_invoices WHERE id=? AND organization_id=? FOR UPDATE',[req.params.id,req.tenantId]);
  if(!invoices.length)throw Object.assign(Error('Facture introuvable.'),{status:404});
  if(invoices[0].status!=='issued')throw Object.assign(Error('Seule une facture sans paiement ni retour peut être annulée. Utilisez le processus de retour pour une vente encaissée.'),{status:409});
  const [payments]=await connection.execute('SELECT id FROM sales_payments WHERE invoice_id=? LIMIT 1',[req.params.id]);
  if(payments.length)throw Object.assign(Error('Une facture encaissée doit être corrigée par un retour, pas annulée.'),{status:409});
  const [items]=await connection.execute('SELECT product_id,quantity FROM sales_invoice_items WHERE invoice_id=? FOR UPDATE',[req.params.id]);
  for(const item of items){
   await connection.execute('UPDATE products SET quantity_on_hand=quantity_on_hand+? WHERE id=? AND organization_id=?',[item.quantity,item.product_id,req.tenantId]);
   await connection.execute(
    `INSERT INTO stock_movements(organization_id,product_id,user_id,movement_type,quantity,reference,notes)
     VALUES(?,?,?,'IN',?,?,?)`,
    [req.tenantId,item.product_id,req.user.id,item.quantity,`ANN-${invoices[0].invoice_number}`,`Annulation de la facture. Motif : ${reason}`]
   );
  }
  await connection.execute("UPDATE sales_invoices SET status='cancelled',notes=CONCAT(COALESCE(notes,''),?) WHERE id=? AND organization_id=?",[`\nAnnulation : ${reason}`,req.params.id,req.tenantId]);
  await connection.commit();connection.release();connection=null;
  await audit({tenantId:req.tenantId,userId:req.user.id,action:'SALE_CANCELLED',entityType:'sales_invoice',entityId:req.params.id,details:{reason}});
  res.json({message:'Facture annulée et stock réintégré.'});
 }catch(error){if(connection){await connection.rollback();connection.release();}if(error.status)return res.status(error.status).json({error:error.message});next(error);}
});
module.exports=router;
