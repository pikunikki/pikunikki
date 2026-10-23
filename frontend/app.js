// バックエンド(backend/app.js の API)を呼ぶデータ層。
// 各HTMLは同期関数として呼んでいるため、同期XHRで実装している。
// backend から http://localhost:3000/ で配信して開くこと(Cookie認証・同一オリジン前提)。

// true: APIを呼ばず localStorage だけで画面遷移を確認できるデモモード(バックエンド停止中用)
// GitHub Pages(静的配信のみでAPIが無い)で開いたときは自動でデモモードになる
const DEMO_MODE = location.hostname.endsWith('github.io');
const demoGet = (key, fallback) => { try { return JSON.parse(localStorage.getItem('demo.' + key)) ?? fallback; } catch { return fallback; } };
const demoSet = (key, value) => localStorage.setItem('demo.' + key, JSON.stringify(value));

const CHARACTERS = [
  { id: 'pink', name: 'ピンク', image: 'image/pink.webp', card: 'image/card-pink.jpg' },
  { id: 'orange', name: 'オレンジ', image: 'image/orange.webp', card: 'image/card-orange.jpg' },
  { id: 'purple', name: 'パープル', image: 'image/purple.webp', card: 'image/card-purple.jpg' },
  { id: 'blue', name: 'ブルー', image: 'image/blue.webp', card: 'image/card-blue.jpg' },
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
  if (DEMO_MODE) return { username: demoGet('name', 'ゲスト'), userId: demoGet('userId', 'guest'), character: demoGet('character', 'cat') };
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
  const userId = document.getElementById('signup-id').value.trim().toLowerCase();
  const email = document.getElementById('signup-email').value.trim();
  const password = await sha256(document.getElementById('signup-password').value);
  if (!DEMO_MODE) {
    const r = api('GET', '/api/users/exists?email=' + encodeURIComponent(email));
    if (r.ok && r.data.exists) { alert('このメールアドレスは登録済みです'); return; }
    const r2 = api('GET', '/api/users/exists?userId=' + encodeURIComponent(userId));
    if (r2.ok && r2.data.exists) { alert('このIDは使われています'); return; }
  }
  sessionStorage.setItem('pending', JSON.stringify({ name: nickname, userId, email, password }));
  location.href = 'character.html';
}

// character.html が users に新規ユーザーを書き込んで save('users', users) を呼ぶ
function getUsers() { return {}; }

function save(key, value) {
  if (key !== 'users') return;
  const [name, u] = Object.entries(value)[0];
  if (DEMO_MODE) { // キャラ選択の結果だけ覚えておく
    demoSet('name', name);
    demoSet('userId', JSON.parse(sessionStorage.getItem('pending') || '{}').userId || 'guest');
    demoSet('character', u.character);
    return;
  }
  const pending = JSON.parse(sessionStorage.getItem('pending') || '{}');
  const r = api('POST', '/api/register', { nickname: name, userId: pending.userId, email: pending.email, password: u.password, character: u.character });
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

// ---- キャラ変更・友達 ----
// デモモード用の登録済みユーザー(検索・申請の相手)
const DEMO_USERS = [
  { id: 101, userId: 'yuzu', username: 'ゆず', character: 'orange' },
  { id: 102, userId: 'meika', username: 'めいか', character: 'purple' },
  { id: 103, userId: 'yuyumero', username: 'ゆゆめろ', character: 'blue' },
  { id: 104, userId: 'fuwaru', username: 'ふわる', character: 'pink' },
];

function setCharacter(id) {
  if (DEMO_MODE) { demoSet('character', id); return; }
  const r = api('PUT', '/api/me/character', { character: id });
  if (!r.ok) throw new Error((r.data && r.data.error) || 'キャラの変更に失敗しました');
  meCache = undefined;
}

// 友達一覧 [{ id, username, character }]
function getFriends() {
  if (DEMO_MODE) return DEMO_USERS.filter((u) => demoGet('friends', []).includes(u.id));
  const r = api('GET', '/api/friends');
  return r.ok ? r.data : [];
}

// IDの完全一致で検索(大文字小文字は区別しない・自分は除く)
function searchUsers(userId) {
  const code = userId.trim().toLowerCase();
  if (DEMO_MODE) return DEMO_USERS.filter((u) => u.userId === code && u.userId !== demoGet('userId', 'guest'));
  const r = api('GET', '/api/users/search?userId=' + encodeURIComponent(code));
  return r.ok ? r.data : [];
}

function sendFriendRequest(userId) {
  if (DEMO_MODE) {
    if (demoGet('friends', []).includes(userId)) throw new Error('すでに友達です');
    const sent = demoGet('sentRequests', []);
    if (sent.includes(userId)) throw new Error('申請済みです');
    demoSet('sentRequests', [...sent, userId]);
    return;
  }
  const r = api('POST', '/api/friend-requests', { receiverId: userId });
  if (!r.ok) throw new Error((r.data && r.data.error) || '申請に失敗しました');
}

// 自分宛ての未承認の申請 [{ id, username, character }]
function getFriendRequests() {
  if (DEMO_MODE) { // デモは「ゆず」から申請が届いている状態から始まる
    const handled = demoGet('handledRequests', []);
    return DEMO_USERS.filter((u) => u.id === 101 && !handled.includes(u.id)).map((u) => ({ id: u.id, username: u.username, userId: u.userId, character: u.character }));
  }
  const r = api('GET', '/api/friend-requests');
  return r.ok ? r.data : [];
}

function answerFriendRequest(id, accept) {
  if (DEMO_MODE) {
    demoSet('handledRequests', [...demoGet('handledRequests', []), id]);
    if (accept) demoSet('friends', [...demoGet('friends', []), id]);
    return;
  }
  const r = api('POST', `/api/friend-requests/${id}/${accept ? 'accept' : 'reject'}`);
  if (!r.ok) throw new Error((r.data && r.data.error) || '処理に失敗しました');
}

const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function postHtml(p) {
  return `<div class="card"><time>${new Date(p.date).toLocaleString('ja-JP')}</time>` +
    (p.photo ? `<img src="${p.photo}" alt="">` : '') +
    `<p>${escapeHtml(p.text).replace(/\n/g, '<br>')}</p></div>`;
}
