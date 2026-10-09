const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const { pool, port, SESSION_DAYS } = require('./config');

const UPLOAD_DIR = path.join(__dirname, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp' };
const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => cb(null, crypto.randomBytes(16).toString('hex') + EXT[file.mimetype]),
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, file.mimetype in EXT),
});

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/uploads', express.static(UPLOAD_DIR));
// 同一オリジンで配信するとCookieがそのまま使える(frontendは読み取りのみ)
app.use(express.static(path.join(__dirname, '..', 'frontend')));

const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

async function createSession(res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  await pool.query(
    'INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? DAY))',
    [token, userId, SESSION_DAYS]
  );
  res.cookie('session', token, { httpOnly: true, sameSite: 'lax', maxAge: SESSION_DAYS * 864e5 });
}

const auth = wrap(async (req, res, next) => {
  const token = req.cookies.session;
  if (token) {
    const [rows] = await pool.query(
      `SELECT u.id, u.username, u.character_id FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token = ? AND s.expires_at > NOW()`, [token]);
    if (rows[0]) { req.user = rows[0]; return next(); }
  }
  res.status(401).json({ error: 'ログインが必要です' });
});

const toPost = (p) => ({ id: p.id, text: p.text, photo: p.photo_path ? '/uploads/' + p.photo_path : null, date: p.created_at });

app.get('/api/characters', wrap(async (req, res) => {
  const [rows] = await pool.query('SELECT id, emoji, name FROM characters ORDER BY id');
  res.json(rows);
}));

// 新規登録(キャラ選択まで終えた後に呼ぶ)
app.post('/api/register', wrap(async (req, res) => {
  const { username, password, character } = req.body || {};
  if (typeof username !== 'string' || typeof password !== 'string' || typeof character !== 'string')
    return res.status(400).json({ error: '入力が不正です' });
  const name = username.trim();
  if (!name || name.length > 50) return res.status(400).json({ error: 'ユーザー名は1〜50文字です' });
  if (password.length < 4 || password.length > 72) return res.status(400).json({ error: 'パスワードは4〜72文字です' });
  const [chars] = await pool.query('SELECT id FROM characters WHERE id = ?', [character]);
  if (!chars[0]) return res.status(400).json({ error: 'キャラクターが不正です' });
  try {
    const [r] = await pool.query('INSERT INTO users (username, password_hash, character_id) VALUES (?, ?, ?)',
      [name, await bcrypt.hash(password, 10), character]);
    await createSession(res, r.insertId);
    res.status(201).json({ username: name, character });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'そのユーザー名は使われています' });
    throw e;
  }
}));

app.post('/api/login', wrap(async (req, res) => {
  const { username, password } = req.body || {};
  if (typeof username !== 'string' || typeof password !== 'string')
    return res.status(400).json({ error: '入力が不正です' });
  const [rows] = await pool.query('SELECT * FROM users WHERE username = ?', [username.trim()]);
  const u = rows[0];
  if (!u || !(await bcrypt.compare(password, u.password_hash)))
    return res.status(401).json({ error: 'ユーザー名またはパスワードが違います' });
  await createSession(res, u.id);
  res.json({ username: u.username, character: u.character_id });
}));

app.post('/api/logout', wrap(async (req, res) => {
  if (req.cookies.session) await pool.query('DELETE FROM sessions WHERE token = ?', [req.cookies.session]);
  res.clearCookie('session');
  res.json({ ok: true });
}));

// マイページ・ホーム用: ユーザー情報と投稿数
app.get('/api/me', auth, wrap(async (req, res) => {
  const [[{ n }]] = await pool.query('SELECT COUNT(*) AS n FROM posts WHERE user_id = ?', [req.user.id]);
  res.json({ username: req.user.username, character: req.user.character_id, postCount: n });
}));

app.get('/api/posts', auth, wrap(async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM posts WHERE user_id = ? ORDER BY created_at DESC, id DESC', [req.user.id]);
  res.json(rows.map(toPost));
}));

// 写真(任意, フィールド名 photo) + 日記本文(text)
app.post('/api/posts', auth, upload.single('photo'), wrap(async (req, res) => {
  const text = typeof req.body.text === 'string' ? req.body.text.trim() : '';
  if (!text) {
    if (req.file) fs.unlink(req.file.path, () => {});
    return res.status(400).json({ error: '日記を入力してください' });
  }
  const [r] = await pool.query('INSERT INTO posts (user_id, text, photo_path) VALUES (?, ?, ?)',
    [req.user.id, text, req.file ? req.file.filename : null]);
  const [[row]] = await pool.query('SELECT * FROM posts WHERE id = ?', [r.insertId]);
  res.status(201).json(toPost(row));
}));

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) return res.status(400).json({ error: '画像は5MB以下にしてください' });
  console.error(err);
  res.status(500).json({ error: 'サーバーエラー' });
});

if (require.main === module) app.listen(port, () => console.log(`http://localhost:${port}`));
module.exports = app;
