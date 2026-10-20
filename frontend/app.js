// バックエンド(backend/app.js の API)を呼ぶデータ層。
// 各HTMLは同期関数として呼んでいるため、同期XHRで実装している。
// backend から http://localhost:3000/ で配信して開くこと(Cookie認証・同一オリジン前提)。

// true: APIを呼ばず localStorage だけで画面遷移を確認できるデモモード(バックエンド停止中用)
// GitHub Pages(静的配信のみでAPIが無い)で開いたときは自動でデモモードになる
const DEMO_MODE = location.hostname.endsWith('github.io');
const demoGet = (key, fallback) => { try { return JSON.parse(localStorage.getItem('demo.' + key)) ?? fallback; } catch { return fallback; } };
const demoSet = (key, value) => localStorage.setItem('demo.' + key, JSON.stringify(value));

const CHARACTERS = [
  { id: 'pink', name: 'ピンク', image: 'image/pink.webp' },
  { id: 'orange', name: 'オレンジ', image: 'image/orange.webp' },
  { id: 'purple', name: 'パープル', image: 'image/purple.webp' },
  { id: 'blue', name: 'ブルー', image: 'image/blue.webp' },
];

// 同期API呼び出し。通信失敗は例外
function api(method, path, body) {
  const xhr = new XMLHttpRequest();
  xhr.open(method, path, false);
  let payload = body;
  if (body && !(body instanceof FormData)) {
    xhr.setRequestHeader('Content-Type', 'application/json');
    payload = JSON.stringify(body);
  }
  xhr.send(payload || null);
  let data = null;
  try { data = JSON.parse(xhr.responseText); } catch { /* 本文なし */ }
  return { status: xhr.status, ok: xhr.status >= 200 && xhr.status < 300, data };
}

// ---- ログイン状態 ----
let meCache; // undefined=未取得, null=未ログイン
function me() {
  if (DEMO_MODE) return { username: demoGet('name', 'ゲスト'), character: demoGet('character', 'cat') };
  if (meCache === undefined) {
    const r = api('GET', '/api/me');
    meCache = r.ok ? r.data : null;
  }
  return meCache;
}
const getCurrentUser = () => (me() ? { character: me().character } : undefined);
const getCurrentName = () => (me() ? me().username : null);
const setCurrentName = () => { meCache = undefined; }; // ログインはサーバーがCookieで保持済み
const getCharacter = (id) => CHARACTERS.find((c) => c.id === id);

// パスワードは SHA-256 にしてから送る(サーバー側でさらに bcrypt)
async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ---- ログイン画面(login.html のフォームから呼ぶ) ----
async function loginSubmit(event) {
  event.preventDefault();
  if (!DEMO_MODE) {
    const email = document.getElementById('login-email').value;
    const password = await sha256(document.getElementById('login-password').value);
    const r = api('POST', '/api/login', { email, password });
    if (!r.ok) { alert((r.data && r.data.error) || 'ログインに失敗しました'); return; }
  }
  location.href = 'home.html';
}

// ---- 新規登録画面(signup.html のフォームから呼ぶ) ----
// キャラ選択が終わるまで登録は確定しないので、入力内容は sessionStorage に預けて character.html へ渡す
async function signupSubmit(event) {
  event.preventDefault();
  const nickname = document.getElementById('signup-name').value.trim();
  const email = document.getElementById('signup-email').value.trim();
  const password = await sha256(document.getElementById('signup-password').value);
  if (!DEMO_MODE) {
    const r = api('GET', '/api/users/exists?email=' + encodeURIComponent(email));
    if (r.ok && r.data.exists) { alert('このメールアドレスは登録済みです'); return; }
  }
  sessionStorage.setItem('pending', JSON.stringify({ name: nickname, email, password }));
  location.href = 'character.html';
}

// character.html が users に新規ユーザーを書き込んで save('users', users) を呼ぶ
function getUsers() { return {}; }

function save(key, value) {
  if (key !== 'users') return;
  const [name, u] = Object.entries(value)[0];
  if (DEMO_MODE) { // キャラ選択の結果だけ覚えておく
    demoSet('name', name);
    demoSet('character', u.character);
    return;
  }
  const pending = JSON.parse(sessionStorage.getItem('pending') || '{}');
  const r = api('POST', '/api/register', { nickname: name, email: pending.email, password: u.password, character: u.character });
  if (!r.ok) {
    alert((r.data && r.data.error) || '登録に失敗しました');
    location.href = 'signup.html';
    throw new Error('register failed'); // 後続の画面遷移を止める
  }
  meCache = undefined;
}

// ログイン必須ページで呼ぶ
function requireLogin() {
  const user = getCurrentUser();
  if (!user && !DEMO_MODE) location.replace('login.html');
  return user;
}

function logout() {
  if (!DEMO_MODE) api('POST', '/api/logout');
  meCache = undefined;
  location.href = 'login.html';
}

// ---- 投稿 ----
const getPosts = () => {
  if (DEMO_MODE) return demoGet('posts', []);
  const r = api('GET', '/api/posts');
  return r.ok ? r.data : [];
};

function dataUrlToBlob(url) {
  const [head, b64] = url.split(',');
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return new Blob([bytes], { type: head.match(/:(.*?);/)[1] });
}

function addPost(post) {
  if (DEMO_MODE) { // post.html が catch するので、容量超過もそのまま例外で伝わる
    demoSet('posts', [{ text: post.text, photo: post.photo, date: Date.now() }, ...demoGet('posts', [])]);
    return;
  }
  const fd = new FormData();
  fd.append('text', post.text);
  if (post.photo) fd.append('photo', dataUrlToBlob(post.photo), 'photo.jpg');
  const r = api('POST', '/api/posts', fd);
  if (!r.ok) throw new Error((r.data && r.data.error) || '投稿に失敗しました'); // post.html が catch して表示
}

const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function postHtml(p) {
  return `<div class="card"><time>${new Date(p.date).toLocaleString('ja-JP')}</time>` +
    (p.photo ? `<img src="${p.photo}" alt="">` : '') +
    `<p>${escapeHtml(p.text).replace(/\n/g, '<br>')}</p></div>`;
}


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
  try {
    const [r] = await pool.query('INSERT INTO users (username, email, password_hash, character_id) VALUES (?, ?, ?, ?)',
      [name, mail, await bcrypt.hash(password, 10), character]);
    await createSession(res, r.insertId);
    res.status(201).json({ username: name, character });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'このメールアドレスは登録済みです' });
    throw e;
  }
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

document.addEventListener("DOMContentLoaded", () => {
  const header = document.getElementById("common-header");

  if (!header) return;

  fetch("header.html")
    .then(response => {
      if (!response.ok) {
        throw new Error("ヘッダーを読み込めませんでした");
      }
      return response.text();
    })
    .then(html => {
      header.innerHTML = html;
    })
    .catch(error => console.error(error));
});