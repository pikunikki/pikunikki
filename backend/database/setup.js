// DBの準備(テーブル作成・初期データ・旧スキーマからの移行)。
// サーバー起動時と `npm run db:init` の両方から呼ばれる。何度実行しても安全。
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const { dbConfig } = require('../config');

async function columnExists(conn, table, column) {
  const [rows] = await conn.query(
    'SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?',
    [table, column]);
  return rows.length > 0;
}

// 旧スキーマ(email なし・username が UNIQUE)を現行に合わせる
async function migrate(conn) {
  if (!(await columnExists(conn, 'users', 'email'))) {
    await conn.query('ALTER TABLE users ADD COLUMN email VARCHAR(255) NULL AFTER username');
    // 既存ユーザーは仮のメールを入れる(再登録が必要)
    await conn.query("UPDATE users SET email = CONCAT('user', id, '@legacy.invalid') WHERE email IS NULL");
    await conn.query('ALTER TABLE users MODIFY email VARCHAR(255) NOT NULL, ADD UNIQUE KEY uq_users_email (email)');
    console.log('migrated: users.email を追加しました');
  }
  // ニックネームは重複可(旧スキーマの UNIQUE を外す)
  const [idx] = await conn.query(
    "SELECT DISTINCT index_name FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'users' AND column_name = 'username' AND non_unique = 0");
  for (const { index_name, INDEX_NAME } of idx) {
    await conn.query(`ALTER TABLE users DROP INDEX \`${index_name || INDEX_NAME}\``);
    console.log('migrated: username の UNIQUE を外しました');
  }
}

async function setupDatabase() {
  let conn;
  try {
    conn = await mysql.createConnection({ ...dbConfig, multipleStatements: true, charset: 'utf8mb4' });
  } catch (e) {
    const hint = {
      ER_ACCESS_DENIED_ERROR: '.env の DB_USER / DB_PASSWORD を確認してください',
      ER_DBACCESS_DENIED_ERROR: `データベース "${dbConfig.database}" がないか、ユーザーに権限がありません(backend/README.md の CREATE DATABASE / GRANT)`,
      ER_BAD_DB_ERROR: `データベース "${dbConfig.database}" がありません。CREATE DATABASE してください(backend/README.md)`,
      ECONNREFUSED: 'MySQL が起動していません(DB_HOST / DB_PORT も確認)',
    }[e.code] || '';
    throw new Error(`MySQL に接続できません: ${e.code || e.message}${hint ? ' → ' + hint : ''}`);
  }
  try {
    for (const f of ['schema.sql', 'seed.sql']) {
      await conn.query(fs.readFileSync(path.join(__dirname, f), 'utf8'));
    }
    await migrate(conn);
  } finally {
    await conn.end();
  }
}

module.exports = { setupDatabase };
