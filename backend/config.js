require('dotenv').config();
const mysql = require('mysql2/promise');

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'pikunikki',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'pikunikki',
};

module.exports = {
  port: Number(process.env.PORT || 3000),
  dbConfig,
  pool: mysql.createPool({ ...dbConfig, waitForConnections: true, connectionLimit: 10, charset: 'utf8mb4' }),
  SESSION_DAYS: 7,
};
