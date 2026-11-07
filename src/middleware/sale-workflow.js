const db=require('../config/database');
const {canCollect}=require('../../public/js/access-policy');

async function assertCashAccess(req,connection=db,{lock=false}={}){
 if(!canCollect(req.user,{}))throw Object.assign(Error('Permission caisse insuffisante ou module Caisse absent du forfait.'),{status:403});
 if(lock)await connection.execute('SELECT id FROM organizations WHERE id=? FOR UPDATE',[req.tenantId]);
 if(req.user.role!=='PHARMACIST')return;
 const [rows]=await connection.execute(`SELECT separate_sale_payment FROM organization_settings WHERE organization_id=?${lock?' FOR UPDATE':''}`,[req.tenantId]);
 if(!canCollect(req.user,rows[0]))throw Object.assign(Error('Accès caisse refusé : en mode deux temps, le pharmacien saisit et le caissier encaisse. Le module Caisse est requis.'),{status:403});
}
async function requireCashAccess(req,res,next){
 try{await assertCashAccess(req);next();}
 catch(error){if(error.status)return res.status(error.status).json({error:error.message});next(error);}
}
module.exports={assertCashAccess,requireCashAccess};
