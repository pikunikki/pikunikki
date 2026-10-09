// バックエンド(backend/app.js の API)を呼ぶデータ層。
// 各HTMLは同期関数として呼んでいるため、同期XHRで実装している。
// backend から http://localhost:3000/ で配信して開くこと(Cookie認証・同一オリジン前提)。

// true: APIを呼ばず localStorage だけで画面遷移を確認できるデモモード(バックエンド停止中用)
const DEMO_MODE = false;
const demoGet = (key, fallback) => { try { return JSON.parse(localStorage.getItem('demo.' + key)) ?? fallback; } catch { return fallback; } };
const demoSet = (key, value) => localStorage.setItem('demo.' + key, JSON.stringify(value));

const CHARACTERS = [
  { id: 'cat', emoji: '🐱', name: 'ねこ' },
  { id: 'dog', emoji: '🐶', name: 'いぬ' },
  { id: 'rabbit', emoji: '🐰', name: 'うさぎ' },
  { id: 'bear', emoji: '🐻', name: 'くま' },
  { id: 'panda', emoji: '🐼', name: 'ぱんだ' },
  { id: 'fox', emoji: '🦊', name: 'きつね' },
];

// 同期API呼び出し。通信できなかった場合は status 0 を返す(例外にはしない)
function api(method, path, body) {
  try {
    const xhr = new XMLHttpRequest();
    xhr.open(method, path, false);
    let payload = body;
    if (body && !(body instanceof FormData)) {
      xhr.setRequestHeader('Content-Type', 'application/json');
      payload = JSON.stringify(body);
    }
    xhr.send(payload || null);
    let data = null;
    try { data = JSON.parse(xhr.responseText); } catch { /* 本文なし・JSONでない */ }
    return { status: xhr.status, ok: xhr.status >= 200 && xhr.status < 300, data };
  } catch {
    return { status: 0, ok: false, data: null };
  }
}

// 失敗したレスポンスから、利用者向けのメッセージを作る
function errorMessage(r, fallback) {
  if (r.data && r.data.error) return r.data.error;
  if (r.status === 0 || !r.data) {
    return 'サーバーに接続できません。backend を起動し、http://localhost:3000/ から開いているか確認してください' +
      (r.status ? `(HTTP ${r.status})` : '');
  }
  return fallback;
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
    if (!r.ok) { alert(errorMessage(r, 'ログインに失敗しました')); return; }
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
    if (!r.ok) { alert(errorMessage(r, '確認に失敗しました')); return; }
    if (r.data.exists) { alert('このメールアドレスは登録済みです'); return; }
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
    alert(errorMessage(r, '登録に失敗しました'));
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
  if (!r.ok) throw new Error(errorMessage(r, '投稿に失敗しました')); // post.html が catch して表示
}

const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function postHtml(p) {
  return `<div class="card"><time>${new Date(p.date).toLocaleString('ja-JP')}</time>` +
    (p.photo ? `<img src="${p.photo}" alt="">` : '') +
    `<p>${escapeHtml(p.text).replace(/\n/g, '<br>')}</p></div>`;
}
