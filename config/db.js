const mysql = require("mysql2");
require("dotenv").config();

const dbType = process.env.DB_TYPE || "local";

const commonConfig = {
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
};

let db;

switch (dbType.toLowerCase()) {
  case "tidb":
    console.log("🔍 Database Type: TiDB");

    db = mysql.createPool({
      ...commonConfig,
      waitForConnections: true,
      connectionLimit: 10,
      ssl: {
        minVersion: "TLSv1.2",
      },
    });

    db.getConnection((err, conn) => {
      if (err) {
        console.error("❌ TiDB Connection Failed:", err.message);
      } else {
        console.log(`✅ Connected to TiDB`);
        console.log(`📍 Host: ${process.env.DB_HOST}`);
        console.log(`📂 Database: ${process.env.DB_NAME}`);
        conn.release();
      }
    });

    break;

  case "hostinger":
    console.log("🔍 Database Type: Hostinger");

    db = mysql.createPool({
      ...commonConfig,
      waitForConnections: true,
      connectionLimit: 10,
    });

    db.getConnection((err, conn) => {
      if (err) {
        console.error("❌ Hostinger Connection Failed:", err.message);
      } else {
        console.log(`✅ Connected to Hostinger MySQL`);
        console.log(`📍 Host: ${process.env.DB_HOST}`);
        console.log(`📂 Database: ${process.env.DB_NAME}`);
        conn.release();
      }
    });

    break;

  case "local":
  default:
    console.log("🔍 Database Type: Local MySQL");

    db = mysql.createConnection(commonConfig);

    db.connect((err) => {
      if (err) {
        console.error("❌ Local MySQL Connection Failed:", err.message);
        return;
      }

      console.log(`✅ Connected to Local MySQL`);
      console.log(`📍 Host: ${process.env.DB_HOST}`);
      console.log(`📂 Database: ${process.env.DB_NAME}`);
    });

    break;
}

module.exports = db;