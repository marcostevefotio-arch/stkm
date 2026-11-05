module.exports=(req,res,next)=>{if(!req.user?.organization_id)return res.status(403).json({error:'Tenant absent.'});req.tenantId=Number(req.user.organization_id);next();};
