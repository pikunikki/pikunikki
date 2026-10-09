// localStorage を使った簡易データ層(のちにバックエンドAPIへ置き換える想定)
const CHARACTERS = [
  { id: 'cat', emoji: '🐱', name: 'ねこ' },
  { id: 'dog', emoji: '🐶', name: 'いぬ' },
  { id: 'rabbit', emoji: '🐰', name: 'うさぎ' },
  { id: 'bear', emoji: '🐻', name: 'くま' },
  { id: 'panda', emoji: '🐼', name: 'ぱんだ' },
  { id: 'fox', emoji: '🦊', name: 'きつね' },
];

const load = (key, fallback) => JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback));
const save = (key, value) => localStorage.setItem(key, JSON.stringify(value));

const getUsers = () => load('users', {});
const getCurrentName = () => localStorage.getItem('currentUser');
const getCurrentUser = () => getUsers()[getCurrentName()];
const setCurrentName = (name) => localStorage.setItem('currentUser', name);
const getCharacter = (id) => CHARACTERS.find((c) => c.id === id);

// 簡易ハッシュ(プロトタイプ用。本番はサーバー側で bcrypt 等を使う)
async function hash(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ログイン必須ページで呼ぶ
function requireLogin() {
  const user = getCurrentUser();
  if (!user) location.replace('login.html');
  return user;
}

function logout() {
  localStorage.removeItem('currentUser');
  location.href = 'login.html';
}

const getPosts = (name) => load('posts', []).filter((p) => p.user === name);
function addPost(post) {
  const posts = load('posts', []);
  posts.unshift(post);
  save('posts', posts);
}

const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function postHtml(p) {
  return `<div class="card"><time>${new Date(p.date).toLocaleString('ja-JP')}</time>` +
    (p.photo ? `<img src="${p.photo}" alt="">` : '') +
    `<p>${escapeHtml(p.text).replace(/\n/g, '<br>')}</p></div>`;
}
