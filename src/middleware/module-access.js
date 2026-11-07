const {canAccessModule}=require('../../public/js/access-policy');

const requireModuleAccess=feature=>(req,res,next)=>{
 if(!canAccessModule(req.user,feature))return res.status(403).json({error:'Ce module n’est pas autorisé pour votre rôle ou votre forfait.'});
 next();
};
module.exports={requireModuleAccess};
