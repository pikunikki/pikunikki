// schema.sql と seed.sql を流し込む: npm run db:init
// 事前に DB とユーザーを作成しておくこと(README 参照)
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const { dbConfig } = require('../config');

// 旧スキーマ(email列なし)で作成済みのDBを新スキーマに合わせる
async function migrate(conn) {
  const [cols] = await conn.query("SHOW COLUMNS FROM users LIKE 'email'");
  if (cols.length) return;
  // 既存ユーザーにはダミーのメールを振る(旧アカウントでのログインはできないので再登録が必要)
  await conn.query('ALTER TABLE users ADD COLUMN email VARCHAR(255) NULL AFTER username');
  await conn.query("UPDATE users SET email = CONCAT('legacy-', id, '@invalid.local') WHERE email IS NULL");
  await conn.query('ALTER TABLE users MODIFY email VARCHAR(255) NOT NULL, ADD UNIQUE KEY uq_users_email (email)');
  const [idx] = await conn.query("SHOW INDEX FROM users WHERE Column_name = 'username' AND Non_unique = 0");
  for (const k of idx) await conn.query('ALTER TABLE users DROP INDEX ??', [k.Key_name]);
  console.log('migrated users: added email');
}

// user_code 列がない既存DBに追加する(既存ユーザーには user<id> を振る)
async function migrateUserCode(conn) {
  const [cols] = await conn.query("SHOW COLUMNS FROM users LIKE 'user_code'");
  if (cols.length) return;
  await conn.query('ALTER TABLE users ADD COLUMN user_code VARCHAR(20) NULL AFTER username');
  await conn.query("UPDATE users SET user_code = CONCAT('user', id) WHERE user_code IS NULL");
  await conn.query('ALTER TABLE users MODIFY user_code VARCHAR(20) NOT NULL, ADD UNIQUE KEY uq_users_code (user_code)');
  console.log('migrated users: added user_code');
}

(async () => {
  const conn = await mysql.createConnection({ ...dbConfig, multipleStatements: true, charset: 'utf8mb4' });
  for (const f of ['schema.sql', 'seed.sql']) {
    await conn.query(fs.readFileSync(path.join(__dirname, f), 'utf8'));
    console.log('applied', f);
  }
  await migrate(conn);
  await migrateUserCode(conn);
  const [sharedPostColumns] = await conn.query("SHOW COLUMNS FROM shared_posts LIKE 'status'");
  if (!sharedPostColumns.length) {
    await conn.query(
      "ALTER TABLE shared_posts ADD COLUMN status ENUM('pending', 'accepted', 'rejected') NOT NULL DEFAULT 'pending' AFTER receiver_id"
    );
    console.log('migrated shared_posts: added status');
  }
  await conn.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
