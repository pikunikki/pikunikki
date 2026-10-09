// バックエンド(backend/app.js の API)を呼ぶデータ層。
// 各HTMLは同期関数として呼んでいるため、同期XHRで実装している(HTML側は無変更で動く)。
// backend から http://localhost:3000/ で配信して開くこと(Cookie認証・同一オリジン前提)。
const CHARACTERS = [
  { id: 'cat', emoji: '🐱', name: 'ねこ' },
  { id: 'dog', emoji: '🐶', name: 'いぬ' },
  { id: 'rabbit', emoji: '🐰', name: 'うさぎ' },
  { id: 'bear', emoji: '🐻', name: 'くま' },
  { id: 'panda', emoji: '🐼', name: 'ぱんだ' },
  { id: 'fox', emoji: '🦊', name: 'きつね' },
];

// 同期API呼び出し。成功なら {status, data}、通信失敗は例外
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

// ---- パスワードのハッシュ ----
// 平文をそのまま送らないよう SHA-256 にしてから送る(サーバー側でさらに bcrypt)
async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// login.html は「getUsers()[name]; user.password !== await hash(pw)」でパスワード照合している。
// サーバーは保存済みハッシュを返さないので、照合を hash() の中でサーバーに行わせる:
// 成功なら LOGIN_OK と同一のオブジェクトを返し、user.password === hash() が成り立つ。
const LOGIN_OK = { loginOk: true };
let loginName = '';

async function hash(text) {
  const h = await sha256(text);
  if (!location.pathname.endsWith('login.html')) return h;
  const r = api('POST', '/api/login', { username: loginName, password: h });
  meCache = undefined;
  return r.ok ? LOGIN_OK : 'invalid';
}

// getUsers() は画面ごとに用途が違う
function getUsers() {
  const page = location.pathname;
  if (page.endsWith('login.html')) {
    // 任意のユーザー名に対し照合用オブジェクトを返す(実際の判定は hash() 内)
    return new Proxy({}, { get: (_, name) => { loginName = String(name); return { password: LOGIN_OK }; } });
  }
  if (page.endsWith('register.html')) {
    // 重複チェック: 既に存在すれば truthy
    return new Proxy({}, {
      get: (_, name) => {
        const r = api('GET', '/api/users/exists?username=' + encodeURIComponent(String(name).trim()));
        return r.ok && r.data.exists ? { exists: true } : undefined;
      },
    });
  }
  return {}; // character.html: ここに新規ユーザーを書き込んで save('users', …) する
}

// character.html が save('users', users) を呼んだら新規登録APIに送る
function save(key, value) {
  if (key !== 'users') return;
  for (const [username, u] of Object.entries(value)) {
    const r = api('POST', '/api/register', { username, password: u.password, character: u.character });
    if (!r.ok) {
      alert((r.data && r.data.error) || '登録に失敗しました');
      location.href = 'register.html';
      throw new Error('register failed'); // 後続の画面遷移を止める
    }
    meCache = undefined;
  }
}

// ログイン必須ページで呼ぶ
function requireLogin() {
  const user = getCurrentUser();
  if (!user) location.replace('login.html');
  return user;
}

function logout() {
  api('POST', '/api/logout');
  meCache = undefined;
  location.href = 'login.html';
}

// ---- 投稿 ----
const getPosts = () => {
  const r = api('GET', '/api/posts');
  return r.ok ? r.data : [];
};

function dataUrlToBlob(url) {
  const [head, b64] = url.split(',');
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new Blob([bytes], { type: head.match(/:(.*?);/)[1] });
}

function addPost(post) {
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
