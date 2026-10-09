// schema.sql と seed.sql を流し込む: npm run db:init
// 事前に DB とユーザーを作成しておくこと(README 参照)
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const { dbConfig } = require('../config');

(async () => {
  const conn = await mysql.createConnection({ ...dbConfig, multipleStatements: true, charset: 'utf8mb4' });
  for (const f of ['schema.sql', 'seed.sql']) {
    await conn.query(fs.readFileSync(path.join(__dirname, f), 'utf8'));
    console.log('applied', f);
  }
  await conn.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
