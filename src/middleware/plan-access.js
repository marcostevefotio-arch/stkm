const {MODULE_KEYS,parseJson}=require('../config/pricing');

function hasFeature(user,feature){
 if(user?.role==='SUPER_ADMIN')return true;
 const raw=user?.subscription_modules;
 if(raw===null||raw===undefined)return true;
 const modules=parseJson(raw,null);
 return Array.isArray(modules)&&modules.includes(feature);
}
function requireFeature(feature){
 if(!MODULE_KEYS.includes(feature))throw new Error(`Fonctionnalité inconnue : ${feature}`);
 return (req,res,next)=>{
  if(hasFeature(req.user,feature))return next();
  return res.status(403).json({error:`La fonctionnalité « ${feature} » n’est pas comprise dans votre forfait. Contactez l’assistance REDAMS pour la souscrire.`});
 };
}

module.exports={requireFeature,hasFeature};
