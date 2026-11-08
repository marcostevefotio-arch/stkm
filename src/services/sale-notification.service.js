const {canCollect}=require('../../public/js/access-policy');

async function notifyCashiers(connection,{tenantId,user,settings,invoiceNumber,totalAmount,status,separate}){
 const [recipients]=await connection.execute("SELECT id,role FROM users WHERE organization_id=? AND is_active=1 AND role IN ('OWNER','ADMIN','CASHIER','PHARMACIST','STOREKEEPER') ORDER BY id",[tenantId]);
 const title=`Nouvelle vente ${invoiceNumber}`;
 const message=`Facture ${invoiceNumber} · ${totalAmount.toFixed(2)} ${settings.currency||'XAF'} · ${separate?'En attente d’encaissement':status==='paid'?'Déjà réglée':'Vente émise, consulter le solde'}.`;
 for(const recipient of recipients){
  const profile={...user,...recipient,merge_pharmacist_storekeeper:settings.merge_pharmacist_storekeeper};
  if(!canCollect(profile,settings))continue;
  await connection.execute("INSERT INTO notifications(organization_id,title,message,audience,recipient_user_id,created_by) VALUES(?,?,?,'user',?,?)",[tenantId,title,message,recipient.id,user.id]);
 }
}

module.exports={notifyCashiers};
