require('dotenv').config();
const app=require('./app'),db=require('./config/database');
const {startDailyBackups}=require('./services/tenant-backup.service');
(async()=>{
 try{
  await db.query('SELECT 1');
  const port=Number(process.env.PORT||3000);
  app.listen(port,()=>{
   console.log(`REDAMS-STK v2 : http://localhost:${port}`);
   startDailyBackups();
  });
 }catch(e){console.error('MySQL indisponible:',e.message);process.exit(1);}
})();
