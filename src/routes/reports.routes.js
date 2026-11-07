const router=require('express').Router();
const db=require('../config/database');
const {requireModuleAccess}=require('../middleware/module-access');
router.use(requireModuleAccess('reports'));

const allowedPeriods=new Set([7,30,90,365]);

router.get('/',async(req,res,next)=>{
 const days=Number(req.query.days||30);
 if(!allowedPeriods.has(days))return res.status(400).json({error:'La période doit être de 7, 30, 90 ou 365 jours.'});
 try{
  const tenantId=req.tenantId,lookback=days*2-1;
  const [[sales],[returns],[products],[categories],[movements],[purchases]] = await Promise.all([
   db.execute(
    `SELECT DATE_FORMAT(created_at,'%Y-%m-%d') AS report_date,COUNT(*) AS invoice_count,
            COALESCE(SUM(total_amount),0) AS gross_revenue,
            COALESCE(SUM(tax_amount),0) AS tax_amount
     FROM sales_invoices
     WHERE organization_id=? AND status<>'cancelled'
       AND created_at>=DATE_SUB(CURDATE(),INTERVAL ? DAY)
     GROUP BY DATE_FORMAT(created_at,'%Y-%m-%d') ORDER BY report_date`,
    [tenantId,lookback]
   ),
   db.execute(
    `SELECT DATE_FORMAT(sr.created_at,'%Y-%m-%d') AS report_date,COALESCE(SUM(sr.refund_amount),0) AS refunds
     FROM sales_returns sr
     JOIN sales_invoices si ON si.id=sr.invoice_id AND si.organization_id=?
     WHERE sr.created_at>=DATE_SUB(CURDATE(),INTERVAL ? DAY)
     GROUP BY DATE_FORMAT(sr.created_at,'%Y-%m-%d') ORDER BY report_date`,
    [tenantId,lookback]
   ),
   db.execute(
    `SELECT p.id,p.sku,p.name,COALESCE(p.category,'') AS category,p.unit,
            p.quantity_on_hand,p.reorder_level,p.sale_price,
            COALESCE(sold.units_sold,0) AS units_sold,
            COALESCE(sold.net_revenue,0) AS net_revenue
     FROM products p
     LEFT JOIN (
       SELECT sii.product_id,
              SUM(GREATEST(sii.quantity-sii.returned_quantity,0)) AS units_sold,
              SUM(GREATEST(sii.quantity-sii.returned_quantity,0)*sii.unit_price) AS net_revenue
       FROM sales_invoice_items sii
       JOIN sales_invoices si ON si.id=sii.invoice_id
       WHERE si.organization_id=? AND si.status<>'cancelled'
         AND si.created_at>=DATE_SUB(CURDATE(),INTERVAL ? DAY)
       GROUP BY sii.product_id
     ) sold ON sold.product_id=p.id
     WHERE p.organization_id=? AND p.is_active=1
     ORDER BY p.quantity_on_hand ASC,p.name`,
    [tenantId,days-1,tenantId]
   ),
   db.execute(
    `SELECT COALESCE(NULLIF(p.category,''),'Sans catégorie') AS category,
            SUM(GREATEST(sii.quantity-sii.returned_quantity,0)) AS units_sold,
            COALESCE(SUM(GREATEST(sii.quantity-sii.returned_quantity,0)*sii.unit_price),0) AS net_revenue,
            COUNT(DISTINCT si.id) AS invoice_count
     FROM sales_invoice_items sii
     JOIN sales_invoices si ON si.id=sii.invoice_id
     JOIN products p ON p.id=sii.product_id AND p.organization_id=si.organization_id
     WHERE si.organization_id=? AND si.status<>'cancelled'
       AND si.created_at>=DATE_SUB(CURDATE(),INTERVAL ? DAY)
     GROUP BY COALESCE(NULLIF(p.category,''),'Sans catégorie')
     ORDER BY net_revenue DESC`,
    [tenantId,days-1]
   ),
   db.execute(
    `SELECT DATE_FORMAT(created_at,'%Y-%m-%d') AS report_date,movement_type,
            COALESCE(SUM(quantity),0) AS quantity,COUNT(*) AS movement_count
     FROM stock_movements
     WHERE organization_id=? AND created_at>=DATE_SUB(CURDATE(),INTERVAL ? DAY)
     GROUP BY DATE_FORMAT(created_at,'%Y-%m-%d'),movement_type ORDER BY report_date`,
    [tenantId,days-1]
   ),
   db.execute(
    `SELECT po.status,COUNT(DISTINCT po.id) AS order_count,
            COALESCE(SUM(poi.quantity_ordered*poi.unit_cost),0) AS ordered_value
     FROM purchase_orders po
     LEFT JOIN purchase_order_items poi ON poi.purchase_order_id=po.id
     WHERE po.organization_id=? AND po.status<>'cancelled'
       AND po.created_at>=DATE_SUB(CURDATE(),INTERVAL ? DAY)
     GROUP BY po.status`,
    [tenantId,days-1]
   )
  ]);
  res.json({period_days:days,sales,returns,products,categories,movements,purchases});
 }catch(error){next(error);}
});

module.exports=router;
