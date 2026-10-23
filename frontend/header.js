document.addEventListener('DOMContentLoaded', () => {
  const header = document.getElementById('common-header');
  if (!header) return;

  fetch('header.html')
    .then((response) => {
      if (!response.ok) {
        throw new Error('ヘッダーを読み込めませんでした');
      }
      return response.text();
    })
    .then((html) => {
      header.innerHTML = html;
    })
    .catch((error) => console.error(error));
});
