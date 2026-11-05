const r=require('express').Router(),db=require('../config/database');
const {MODULE_KEYS,parseJson}=require('../config/pricing');
r.get('/',async(req,res,next)=>{try{
 const raw=req.user?.subscription_modules;
 const modules=raw===null||raw===undefined?MODULE_KEYS:parseJson(raw,[]);
 if(!Array.isArray(modules)||!modules.includes('stock'))return res.json({products:0,stockUnits:0,lowStock:0,movementsToday:0,stock_available:false});
 const t=req.tenantId;
 const [[p]]=await db.execute('SELECT COUNT(*) total FROM products WHERE organization_id=? AND is_active=1',[t]);
 const [[q]]=await db.execute('SELECT COALESCE(SUM(quantity_on_hand),0) total FROM products WHERE organization_id=? AND is_active=1',[t]);
 const [[l]]=await db.execute('SELECT COUNT(*) total FROM products WHERE organization_id=? AND is_active=1 AND quantity_on_hand<=reorder_level',[t]);
 const [[m]]=await db.execute('SELECT COUNT(*) total FROM stock_movements WHERE organization_id=? AND DATE(created_at)=CURDATE()',[t]);
 res.json({products:p.total,stockUnits:q.total,lowStock:l.total,movementsToday:m.total,stock_available:true});
 }catch(e){next(e);}});module.exports=r;
