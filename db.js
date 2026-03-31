require('dotenv').config(); // Loads the .env file
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT || 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// Simple test to see if it works
pool.getConnection()
  .then(conn => {
    console.log("✅ Successfully connected to MySQL!");
    conn.release();
  })
  .catch(err => {
    console.error("❌ Connection failed:", err.message);
  });

module.exports = pool;