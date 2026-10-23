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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// ユーザーIDはサーバーが自動で決める(8文字・紛らわしい文字を除いた小文字英数字。検索は大文字小文字を区別しない)
const ID_CHARS = 'abcdefghjkmnpqrstuvwxyz23456789';
const generateUserId = () => Array.from({ length: 8 }, () => ID_CHARS[crypto.randomInt(ID_CHARS.length)]).join('');
const normalizeUserId = (v) => (typeof v === 'string' ? v.trim().toLowerCase() : '');
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
      `SELECT u.id, u.username, u.user_code, u.character_id FROM sessions s JOIN users u ON u.id = s.user_id
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

// 新規登録画面の重複チェック用
app.get('/api/users/exists', wrap(async (req, res) => {
  const email = typeof req.query.email === 'string' ? req.query.email.trim().toLowerCase() : '';
  const [rows] = await pool.query('SELECT 1 FROM users WHERE email = ?', [email]);
  res.json({ exists: rows.length > 0 });
}));

// 新規登録(キャラ選択まで終えた後に呼ぶ)
app.post('/api/register', wrap(async (req, res) => {
  const { nickname, email, password, character } = req.body || {};
  if ([nickname, email, password, character].some((v) => typeof v !== 'string'))
    return res.status(400).json({ error: '入力が不正です' });
  const name = nickname.trim();
  const mail = email.trim().toLowerCase();
  if (!name || name.length > 50) return res.status(400).json({ error: 'ニックネームは1〜50文字です' });
  if (!EMAIL_RE.test(mail) || mail.length > 255) return res.status(400).json({ error: 'メールアドレスが不正です' });
  if (password.length < 4 || password.length > 72) return res.status(400).json({ error: 'パスワードが不正です' });
  const [chars] = await pool.query('SELECT id FROM characters WHERE id = ?', [character]);
  if (!chars[0]) return res.status(400).json({ error: 'キャラクターが不正です' });
  const hash = await bcrypt.hash(password, 10);
  // IDが偶然重複したら作り直す
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateUserId();
    try {
      const [r] = await pool.query('INSERT INTO users (username, user_code, email, password_hash, character_id) VALUES (?, ?, ?, ?, ?)',
        [name, code, mail, hash, character]);
      await createSession(res, r.insertId);
      return res.status(201).json({ username: name, userId: code, character });
    } catch (e) {
      if (e.code !== 'ER_DUP_ENTRY') throw e;
      if (!String(e.message).includes('uq_users_code')) return res.status(409).json({ error: 'このメールアドレスは登録済みです' });
    }
  }
  throw new Error('user id generation failed');
}));

app.post('/api/login', wrap(async (req, res) => {
  const { email, password } = req.body || {};
  if (typeof email !== 'string' || typeof password !== 'string')
    return res.status(400).json({ error: '入力が不正です' });
  const [rows] = await pool.query('SELECT * FROM users WHERE email = ?', [email.trim().toLowerCase()]);
  const u = rows[0];
  if (!u || !(await bcrypt.compare(password, u.password_hash)))
    return res.status(401).json({ error: 'メールアドレスまたはパスワードが違います' });
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
  res.json({ username: req.user.username, userId: req.user.user_code, character: req.user.character_id, postCount: n });
}));

// キャラ変更(マイページ)
app.put('/api/me/character', auth, wrap(async (req, res) => {
  const character = typeof req.body?.character === 'string' ? req.body.character : '';
  const [chars] = await pool.query('SELECT id FROM characters WHERE id = ?', [character]);
  if (!chars[0]) return res.status(400).json({ error: 'キャラクターが不正です' });
  await pool.query('UPDATE users SET character_id = ? WHERE id = ?', [character, req.user.id]);
  res.json({ character });
}));

app.get('/api/friends', auth, wrap(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT u.id, u.username, u.user_code AS userId, u.character_id AS \`character\`
     FROM friendships f
     JOIN users u ON u.id = f.friend_id
     WHERE f.user_id = ?
     ORDER BY u.username`,
    [req.user.id]
  );

  res.json(rows);
}));

// IDで友達検索(完全一致・大文字小文字は区別しない)
app.get('/api/users/search', auth, wrap(async (req, res) => {
  const code = normalizeUserId(req.query.userId);
  if (!code) return res.json([]);
  const [rows] = await pool.query(
    `SELECT id, username, user_code AS userId, character_id AS \`character\`
     FROM users
     WHERE id <> ? AND user_code = ?`,
    [req.user.id, code]
  );
  res.json(rows);
}));

// 自分宛ての未承認の友達申請
app.get('/api/friend-requests', auth, wrap(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT fr.id, u.username, u.user_code AS userId, u.character_id AS \`character\`
     FROM friend_requests fr
     JOIN users u ON u.id = fr.sender_id
     WHERE fr.receiver_id = ? AND fr.status = 'pending'
     ORDER BY fr.created_at DESC, fr.id DESC`,
    [req.user.id]
  );
  res.json(rows);
}));

app.post('/api/friend-requests/:id/reject', auth, wrap(async (req, res) => {
  const [r] = await pool.query(
    `UPDATE friend_requests SET status = 'rejected'
     WHERE id = ? AND receiver_id = ? AND status = 'pending'`,
    [Number(req.params.id), req.user.id]
  );
  if (!r.affectedRows) return res.status(404).json({ error: '申請が見つかりません' });
  res.json({ ok: true });
}));

app.post('/api/friend-requests', auth, wrap(async (req, res) => {
  const receiverId = Number(req.body?.receiverId);

  if (!Number.isInteger(receiverId) || receiverId <= 0) {
    return res.status(400).json({ error: '送信先が不正です' });
  }

  if (receiverId === req.user.id) {
    return res.status(400).json({ error: '自分自身には申請できません' });
  }

  const [users] = await pool.query(
    'SELECT id FROM users WHERE id = ?',
    [receiverId]
  );

  if (!users[0]) {
    return res.status(404).json({ error: 'ユーザーが見つかりません' });
  }

  const [friends] = await pool.query(
    `SELECT 1
     FROM friendships
     WHERE user_id = ? AND friend_id = ?`,
    [req.user.id, receiverId]
  );

  if (friends.length) {
    return res.status(409).json({ error: 'すでに友達です' });
  }

  try {
    await pool.query(
      `INSERT INTO friend_requests
       (sender_id, receiver_id)
       VALUES (?, ?)`,
      [req.user.id, receiverId]
    );
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: '申請済みです' });
    }
    throw error;
  }

  res.status(201).json({ ok: true });
}));

app.post('/api/friend-requests/:id/accept', auth, wrap(async (req, res) => {
  const requestId = Number(req.params.id);

  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    const [requests] = await conn.query(
      `SELECT sender_id, receiver_id
       FROM friend_requests
       WHERE id = ?
         AND receiver_id = ?
         AND status = 'pending'
       FOR UPDATE`,
      [requestId, req.user.id]
    );

    const request = requests[0];

    if (!request) {
      await conn.rollback();
      return res.status(404).json({ error: '申請が見つかりません' });
    }

    await conn.query(
      `UPDATE friend_requests
       SET status = 'accepted'
       WHERE id = ?`,
      [requestId]
    );

    // 相手からも申請していた場合は、そちらも承認済みにする
    await conn.query(
      `UPDATE friend_requests
       SET status = 'accepted'
       WHERE sender_id = ? AND receiver_id = ? AND status = 'pending'`,
      [request.receiver_id, request.sender_id]
    );

    await conn.query(
      `INSERT IGNORE INTO friendships
       (user_id, friend_id)
       VALUES (?, ?), (?, ?)`,
      [
        request.sender_id,
        request.receiver_id,
        request.receiver_id,
        request.sender_id,
      ]
    );

    await conn.commit();
    res.json({ ok: true });
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}));

app.post('/api/posts/:id/share', auth, wrap(async (req, res) => {
  const postId = Number(req.params.id);
  const receiverId = Number(req.body?.receiverId);

  if (!Number.isInteger(postId) || !Number.isInteger(receiverId)) {
    return res.status(400).json({ error: '入力が不正です' });
  }

  if (receiverId === req.user.id) {
    return res.status(400).json({ error: '自分自身には送れません' });
  }

  const [posts] = await pool.query(
    `SELECT id
     FROM posts
     WHERE id = ? AND user_id = ?`,
    [postId, req.user.id]
  );

  if (!posts[0]) {
    return res.status(404).json({ error: '自分の投稿ではありません' });
  }

  const [friends] = await pool.query(
    `SELECT 1
     FROM friendships
     WHERE user_id = ? AND friend_id = ?`,
    [req.user.id, receiverId]
  );

  if (!friends.length) {
    return res.status(403).json({ error: '友達にだけ送信できます' });
  }

  try {
    await pool.query(
      `INSERT INTO shared_posts
       (post_id, sender_id, receiver_id)
       VALUES (?, ?, ?)`,
      [postId, req.user.id, receiverId]
    );
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'すでに送信済みです' });
    }
    throw error;
  }

  res.status(201).json({ ok: true });
}));

app.get('/api/posts', auth, wrap(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT DISTINCT p.*
     FROM posts p
     LEFT JOIN shared_posts sp
       ON sp.post_id = p.id
     WHERE
       (
         p.user_id = ?
         AND NOT EXISTS (
           SELECT 1
           FROM shared_posts sent
           WHERE sent.post_id = p.id
             AND sent.sender_id = ?
         )
       )
       OR sp.receiver_id = ?
     ORDER BY p.created_at DESC, p.id DESC`,
    [req.user.id, req.user.id, req.user.id]
  );

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
