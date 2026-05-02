const mysql = require("mysql2");
require("dotenv").config();

const dbName = process.env.DB_NAME || "admin";

const db = mysql.createConnection({
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "Arko@9748276237",
  database: dbName,
});

db.connect((err) => {
  if (err) {
    console.error("MySQL connection failed:", err.message);
    throw err;
  }
  console.log(`MySQL Connected (db: ${dbName})`);
});

module.exports = db;

