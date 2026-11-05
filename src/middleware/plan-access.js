const {MODULE_KEYS,parseJson}=require('../config/pricing');

function requireFeature(feature){
 if(!MODULE_KEYS.includes(feature))throw new Error(`Fonctionnalité inconnue : ${feature}`);
 return (req,res,next)=>{
  if(req.user?.role==='SUPER_ADMIN')return next();
  const raw=req.user?.subscription_modules;
  if(raw===null||raw===undefined)return next();
  const modules=parseJson(raw,null);
  if(Array.isArray(modules)&&modules.includes(feature))return next();
  return res.status(403).json({error:`La fonctionnalité « ${feature} » n’est pas comprise dans votre forfait. Contactez l’assistance REDAMS pour la souscrire.`});
 };
}

module.exports={requireFeature};
