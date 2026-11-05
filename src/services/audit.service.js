const db=require('../config/database');
exports.audit=async({tenantId,userId,action,entityType,entityId,details=null})=>{
 await db.execute('INSERT INTO audit_logs(organization_id,user_id,action,entity_type,entity_id,details_json) VALUES(?,?,?,?,?,?)',
 [tenantId,userId,action,entityType,entityId||null,details?JSON.stringify(details):null]);
};
