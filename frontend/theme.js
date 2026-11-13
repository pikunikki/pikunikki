// キャラに合わせた背景色を、ページが表示される前に当てる(ちらつき防止)。
// 色を決めて保存するのは app.js の applyTheme()。
try {
  const bg = localStorage.getItem('theme.bg');
  if (bg) document.documentElement.style.setProperty('--theme-bg', bg);
} catch { /* 保存できない環境では既定のピンクのまま */ }
