(() => {
  'use strict';

  const KEY_URL = 'rss.endpoint';
  const KEY_CACHE = 'rss.cache';
  const KEY_THEME = 'rss.theme';
  const KEY_VIEW = 'rss.view';
  const KEY_OPEN = 'rss.open';
  const OTHER = 'その他';
  const CATEGORIES = ['国内メイン', 'IT', '経済', '鉄道', OTHER];
  const TIMEOUT_MS = 120000;
  const MAX_BYTES = 5 * 1024 * 1024;
  const MAX_ITEMS = 300;

  const $ = (id) => document.getElementById(id);
  const els = {
    fetchBtn: $('fetchBtn'),
    settingsBtn: $('settingsBtn'),
    settings: $('settings'),
    endpoint: $('endpoint'),
    saveBtn: $('saveBtn'),
    clearBtn: $('clearBtn'),
    status: $('status'),
    groups: $('groups'),
    filter: $('filter'),
    filterRow: $('filterRow'),
    themeBtn: $('themeBtn'),
    viewBtn: $('viewBtn'),
  };

  let items = [];

  const setStatus = (msg, isError = false) => {
    els.status.textContent = msg;
    els.status.classList.toggle('error', isError);
  };

  // Logic Apps の URL（https かつ *.logic.azure.com のみ許可）
  const parseEndpoint = (value) => {
    let u;
    try { u = new URL(value.replace(/\s+/g, '')); } catch { return null; }
    if (u.protocol !== 'https:' || !u.hostname.endsWith('.logic.azure.com')) return null;
    if (!u.searchParams.has('sig')) return null;
    if (!u.searchParams.has('api-version')) u.searchParams.set('api-version', '2016-10-01');
    return u;
  };

  const safeHttpUrl = (value) => {
    if (typeof value !== 'string') return null;
    try {
      const u = new URL(value);
      return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
    } catch { return null; }
  };

  // HTML を含む要約をプレーンテキスト化（DOMParser は script を実行しない）
  const toPlainText = (html) => {
    if (typeof html !== 'string') return '';
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
  };

  const str = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v));

  // 定義外・未指定のカテゴリは「その他」に集約
  const toCategory = (v) => {
    const s = str(v).trim();
    return CATEGORIES.includes(s) ? s : OTHER;
  };

  const firstLink = (o) => {
    const candidates = [o.primaryLink, o.link, o.url, o.href];
    if (Array.isArray(o.links)) candidates.push(...o.links);
    for (const c of candidates) {
      const v = safeHttpUrl(typeof c === 'object' && c ? c.href || c.url : c);
      if (v) return v;
    }
    return null;
  };

  const normalize = (raw) => {
    let list = raw;
    if (!Array.isArray(list) && list && typeof list === 'object') {
      // { "国内メイン": [...], "IT": [...] } 形式（カテゴリ別グループ）
      if (CATEGORIES.some((c) => Array.isArray(list[c]))) {
        list = CATEGORIES.flatMap((c) =>
          (Array.isArray(list[c]) ? list[c] : []).map((o) => ({ category: c, ...o }))
        );
      } else {
        list = list.value || list.items || list.body || list.entries || list.feeds;
      }
    }
    if (!Array.isArray(list)) throw new Error('想定外のJSON形式です（配列が見つかりません）');
    return list
      .flat()
      .filter((o) => o && typeof o === 'object')
      .slice(0, MAX_ITEMS)
      .map((o) => {
        const dateStr = o.publishDate || o.publishedAt || o.pubDate || o.updatedOn || o.date || '';
        const t = Date.parse(dateStr);
        return {
          title: str(o.title).trim() || '(無題)',
          link: firstLink(o),
          summary: toPlainText(str(o.summary || o.description || o.content)),
          source: str(o.source || o.feedTitle || o.feed || ''),
          category: toCategory(o.category || o.genre),
          time: Number.isNaN(t) ? null : t,
        };
      })
      .sort((a, b) => (b.time ?? 0) - (a.time ?? 0));
  };

  const fmtDate = (t) =>
    new Date(t).toLocaleString('ja-JP', { dateStyle: 'medium', timeStyle: 'short' });

  const renderCard = (i) => {
    const li = document.createElement('li');
    li.className = 'card';

    const h = document.createElement('h2');
    if (i.link) {
      const a = document.createElement('a');
      a.href = i.link;
      a.target = '_blank';
      a.rel = 'noopener noreferrer nofollow';
      a.referrerPolicy = 'no-referrer';
      a.textContent = i.title;
      h.append(a);
    } else {
      h.textContent = i.title;
    }
    li.append(h);

    const meta = [i.source, i.time ? fmtDate(i.time) : ''].filter(Boolean).join(' ・ ');
    if (meta) {
      const m = document.createElement('div');
      m.className = 'meta';
      m.textContent = meta;
      li.append(m);
    }
    if (i.summary) {
      const p = document.createElement('p');
      p.className = 'summary';
      p.textContent = i.summary;
      li.append(p);
    }
    return li;
  };

  const loadOpenState = () => {
    try { return JSON.parse(localStorage.getItem(KEY_OPEN) || '{}') || {}; } catch { return {}; }
  };

  const render = () => {
    const q = els.filter.value.trim().toLowerCase();
    const shown = q
      ? items.filter((i) => (i.title + ' ' + i.summary + ' ' + i.source).toLowerCase().includes(q))
      : items;
    const open = loadOpenState();

    const groups = CATEGORIES.map((cat) => {
      const list = shown.filter((i) => i.category === cat);
      if (list.length === 0) return null;

      const details = document.createElement('details');
      details.className = 'group';
      details.open = open[cat] !== false; // 初期状態は開く
      details.addEventListener('toggle', () => {
        const state = loadOpenState();
        state[cat] = details.open;
        localStorage.setItem(KEY_OPEN, JSON.stringify(state));
      });

      const summary = document.createElement('summary');
      const name = document.createElement('span');
      name.textContent = cat;
      const count = document.createElement('span');
      count.className = 'count';
      count.textContent = String(list.length);
      summary.append(name, count);

      const ul = document.createElement('ul');
      ul.className = 'cards';
      ul.append(...list.map(renderCard));

      details.append(summary, ul);
      return details;
    }).filter(Boolean);

    els.groups.replaceChildren(...groups);
    els.filterRow.hidden = items.length === 0;
  };

  const fetchNews = async () => {
    const u = parseEndpoint(localStorage.getItem(KEY_URL) || '');
    if (!u) {
      els.settings.hidden = false;
      els.settingsBtn.setAttribute('aria-expanded', 'true');
      setStatus('Logic Apps のURLを設定してください（https://*.logic.azure.com で、?api-version=...&sig=... を含む完全なURL）。', true);
      return;
    }

    els.fetchBtn.disabled = true;
    setStatus('取得中…（Logic Apps の実行に時間がかかる場合があります）');
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      // text/plain の単純リクエスト（プリフライト不要）。空ボディだと Safari で 400 になる場合があるため '{}' を送る
      const res = await fetch(u.href, {
        method: 'POST',
        mode: 'cors',
        credentials: 'omit',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
        body: '{}',
        signal: ctrl.signal,
      });
      const text = await res.text();
      if (!res.ok) {
        const detail = text.replace(/\s+/g, ' ').slice(0, 200);
        throw new Error(`HTTP ${res.status}${detail ? ' - ' + detail : ''}`);
      }
      if (text.length > MAX_BYTES) throw new Error('レスポンスが大きすぎます');
      items = normalize(JSON.parse(text));
      localStorage.setItem(KEY_CACHE, JSON.stringify({ at: Date.now(), items }));
      setStatus(`${items.length} 件取得（${fmtDate(Date.now())}）`);
      render();
    } catch (e) {
      const msg = e.name === 'AbortError' ? 'タイムアウトしました' : e.message;
      setStatus(`取得に失敗しました: ${msg}`, true);
    } finally {
      clearTimeout(timer);
      els.fetchBtn.disabled = false;
    }
  };

  const loadCache = () => {
    try {
      const c = JSON.parse(localStorage.getItem(KEY_CACHE) || 'null');
      if (c && Array.isArray(c.items)) {
        items = c.items.map((i) => ({
          title: str(i.title),
          link: safeHttpUrl(i.link),
          summary: str(i.summary),
          source: str(i.source),
          category: toCategory(i.category),
          time: typeof i.time === 'number' ? i.time : null,
        }));
        setStatus(`前回の取得結果を表示中（${fmtDate(c.at)}）`);
        render();
      }
    } catch { /* 破損したキャッシュは無視 */ }
  };

  els.fetchBtn.addEventListener('click', fetchNews);
  els.filter.addEventListener('input', render);
  els.settingsBtn.addEventListener('click', () => {
    els.settings.hidden = !els.settings.hidden;
    els.settingsBtn.setAttribute('aria-expanded', String(!els.settings.hidden));
  });
  els.saveBtn.addEventListener('click', () => {
    const u = parseEndpoint(els.endpoint.value);
    if (!u) {
      setStatus('URLが不完全です。https://*.logic.azure.com で始まり、?api-version=...&sig=... まで含む完全なURLを貼り付けてください。', true);
      return;
    }
    localStorage.setItem(KEY_URL, u.href);
    els.endpoint.value = '';
    els.settings.hidden = true;
    els.settingsBtn.setAttribute('aria-expanded', 'false');
    setStatus('URLを保存しました。');
  });
  els.clearBtn.addEventListener('click', () => {
    localStorage.removeItem(KEY_URL);
    localStorage.removeItem(KEY_CACHE);
    els.endpoint.value = '';
    items = [];
    render();
    setStatus('URLと取得結果を削除しました。');
  });

  const applyTheme = (theme) => {
    document.documentElement.dataset.theme = theme;
    const dark = theme === 'dark';
    els.themeBtn.textContent = dark ? '☀️' : '🌙';
    els.themeBtn.title = dark ? 'ライトモードに切替' : 'ダークモードに切替';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#242526' : '#ffffff');
  };

  const applyView = (view) => {
    const titlesOnly = view === 'titles';
    document.body.classList.toggle('titles-only', titlesOnly);
    els.viewBtn.textContent = titlesOnly ? '☰' : '📰';
    els.viewBtn.title = titlesOnly ? 'タイトル+本文に切替' : 'タイトルのみに切替';
  };

  els.themeBtn.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem(KEY_THEME, next);
    applyTheme(next);
  });
  els.viewBtn.addEventListener('click', () => {
    const next = document.body.classList.contains('titles-only') ? 'full' : 'titles';
    localStorage.setItem(KEY_VIEW, next);
    applyView(next);
  });
  applyTheme(document.documentElement.dataset.theme || 'light');
  applyView(localStorage.getItem(KEY_VIEW) === 'titles' ? 'titles' : 'full');

  loadCache();
})();
