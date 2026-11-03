(() => {
  'use strict';

  const KEY_URL = 'rss.endpoint';
  const KEY_CACHE = 'rss.cache';
  const TIMEOUT_MS = 60000;
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
    cards: $('cards'),
    filter: $('filter'),
    filterRow: $('filterRow'),
  };

  let items = [];

  const setStatus = (msg, isError = false) => {
    els.status.textContent = msg;
    els.status.classList.toggle('error', isError);
  };

  // Logic Apps の URL（https かつ *.logic.azure.com のみ許可）
  const parseEndpoint = (value) => {
    let u;
    try { u = new URL(value.trim()); } catch { return null; }
    if (u.protocol !== 'https:' || !u.hostname.endsWith('.logic.azure.com')) return null;
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
      list = list.value || list.items || list.body || list.entries || list.feeds;
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
          time: Number.isNaN(t) ? null : t,
        };
      })
      .sort((a, b) => (b.time ?? 0) - (a.time ?? 0));
  };

  const fmtDate = (t) =>
    new Date(t).toLocaleString('ja-JP', { dateStyle: 'medium', timeStyle: 'short' });

  const render = () => {
    const q = els.filter.value.trim().toLowerCase();
    const shown = q
      ? items.filter((i) => (i.title + ' ' + i.summary + ' ' + i.source).toLowerCase().includes(q))
      : items;

    els.cards.replaceChildren(
      ...shown.map((i) => {
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
      })
    );
    els.filterRow.hidden = items.length === 0;
  };

  const fetchNews = async () => {
    const u = parseEndpoint(localStorage.getItem(KEY_URL) || '');
    if (!u) {
      els.settings.hidden = false;
      els.settingsBtn.setAttribute('aria-expanded', 'true');
      setStatus('Logic Apps のURLを設定してください（https://*.logic.azure.com のみ有効）。', true);
      return;
    }

    els.fetchBtn.disabled = true;
    setStatus('取得中…（Logic Apps の実行に時間がかかる場合があります）');
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      // カスタムヘッダー/Content-Type なしの単純リクエスト（CORSプリフライト不要）
      const res = await fetch(u.href, {
        method: 'POST',
        mode: 'cors',
        credentials: 'omit',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
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
      setStatus('URLは https://*.logic.azure.com 形式で入力してください。', true);
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

  loadCache();
})();
