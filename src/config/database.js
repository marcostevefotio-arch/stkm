const mysql=require('mysql2/promise'); require('dotenv').config();
module.exports=mysql.createPool({host:process.env.DB_HOST,port:Number(process.env.DB_PORT||3306),user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME,waitForConnections:true,connectionLimit:Number(process.env.DB_CONNECTION_LIMIT||10),charset:'utf8mb4'});
