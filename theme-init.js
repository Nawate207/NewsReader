(() => {
  'use strict';
  let theme;
  try { theme = localStorage.getItem('rss.theme'); } catch { /* ignore */ }
  if (theme !== 'light' && theme !== 'dark') {
    theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  document.documentElement.dataset.theme = theme;
})();
