// スキーマ適用+初期データ: npm run db:init (サーバー起動時にも自動で実行される)
const { setupDatabase } = require('./setup');

setupDatabase()
  .then(() => console.log('database ready'))
  .catch((e) => { console.error(e.message); process.exit(1); });
