const mysql = require("mysql2");
require("dotenv").config();

const dbName = process.env.DB_NAME || "admin";

// 🔁 Decide: use TiDB if DB_HOST is set (not localhost), else keep local
const isCloud =
  process.env.DB_HOST &&
  process.env.DB_HOST !== "localhost" &&
  process.env.DB_HOST !== "127.0.0.1";

const commonConfig = {
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: dbName,
};

let db;

if (isCloud) {
  db = mysql.createPool({
    ...commonConfig,
    port: 4000, // TiDB port
    waitForConnections: true,
    connectionLimit: 10,
    ssl: { minVersion: "TLSv1.2" },
  });

  // quick check (non-breaking)
  db.getConnection((err, conn) => {
    if (err) {
      console.error("❌ TiDB connection failed:", err.message);
    } else {
      console.log(`✅ TiDB Connected (db: ${dbName})`);
      conn.release();
    }
  });
} else {
  // 🖥️ Local MySQL → keep your old behavior
  db = mysql.createConnection(commonConfig);

  db.connect((err) => {
    if (err) {
      console.error("❌ Local MySQL connection failed:", err.message);
      throw err;
    }
    console.log(`✅ Local MySQL Connected (db: ${dbName})`);
  });
}

module.exports = db;