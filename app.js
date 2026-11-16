(() => {
  'use strict';

  const KEY_URL = 'rss.endpoint';
  const KEY_CACHE = 'rss.cache';
  const KEY_THEME = 'rss.theme';
  const KEY_VIEW = 'rss.view';
  const KEY_OPEN = 'rss.open';
  const KEY_KNOWN = 'rss.known';
  const KEY_UNREAD = 'rss.unread';
  const MAX_KNOWN = 5000;
  const OTHER = 'その他';
  const RAIL = '鉄道';
  const CATEGORIES = ['国内メイン', 'IT', '経済', RAIL, OTHER];
  const TIMEOUT_MS = 120000;
  const FETCH_LABEL = 'ニュースを取得';
  const MAX_BYTES = 20 * 1024 * 1024;
  const MAX_PER_SOURCE = 20;
  const MAX_PER_CATEGORY = 1000;
  const MAX_SUMMARY = 400;

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
    readAllBtn: $('readAllBtn'),
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

  // 会社名がそのまま category に入っている場合（JR東日本 など）は「鉄道」に集約し、会社名は配信元として表示する
  const RAIL_NAME = /^(JR|東京メトロ|東武|西武|京成|京王|小田急|東急|京急|相鉄|近鉄|近畿日本鉄道|南海|京阪|阪急|阪神|名鉄|西鉄)/;

  // 鉄道会社の地域分類（表示名は Logic Apps の name と一致させる）。JR は単独階層
  const RAIL_REGIONS = [
    ['総合', ['鉄道（総合）']],
    ['JR', ['JR北海道', 'JR東日本', 'JR東海', 'JR西日本', 'JR四国', 'JR九州', 'JR貨物']],
    ['北海道・東北', ['札幌市交通局', '仙台市交通局']],
    ['関東', ['東京メトロ', '東京都交通局', '東武鉄道', '西武鉄道', '京成電鉄', '京王電鉄', '小田急電鉄', '東急', '京急電鉄', '相鉄グループ',
      '横浜市交通局', '江ノ島電鉄', 'つくばエクスプレス', '北総鉄道']],
    ['中部', ['名古屋鉄道', '遠州鉄道', '富士急行']],
    ['関西', ['近畿日本鉄道', '南海電鉄', '京阪電鉄', '阪急電鉄', '阪神電鉄', 'Osaka Metro', '京都市交通局', '山陽電気鉄道', '大阪モノレール']],
    ['中国・四国', ['広島電鉄', '伊予鉄道']],
    ['九州・沖縄', ['西日本鉄道']],
    [OTHER, []],
  ];
  const RAIL_REGION_OF = new Map(RAIL_REGIONS.flatMap(([r, names]) => names.map((n) => [n, r])));
  const regionOf = (company) => RAIL_REGION_OF.get(company) || (/^JR/.test(company) ? 'JR' : OTHER);
  const isRail = (name) => RAIL_REGION_OF.has(name) || RAIL_NAME.test(name);

  // 「IT（Yahoo）」のように括弧付きで届いた IT 系は、IT 大分類の配下にメディア別グループとして表示する
  const IT = 'IT';
  const IT_SUB = /^IT\s*[（(]\s*(.+?)\s*[）)]$/;
  const IT_ORDER = ['yahoo', '窓の杜', 'itmedia'];
  const normKey = (s) => s.replace(/\s+/g, '').toLowerCase();

  const resolveCategory = (o) => {
    const raw = str(o.category || o.genre).trim();
    const source = str(o.source || o.feedTitle || o.feed).trim();
    const itSub = raw.match(IT_SUB);
    if (itSub) return { category: IT, source: itSub[1] };
    if (CATEGORIES.includes(raw)) return { category: raw, source };
    if (isRail(raw)) return { category: RAIL, source: source || raw };
    return { category: OTHER, source: source || raw };
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
    const sorted = list
      .flat()
      .filter((o) => o && typeof o === 'object')
      .map((o) => {
        const dateStr = o.publishDate || o.publishedAt || o.pubDate || o.updatedOn || o.date || '';
        const t = Date.parse(dateStr);
        const { category, source } = resolveCategory(o);
        return {
          title: str(o.title).trim() || '(無題)',
          link: firstLink(o),
          summary: toPlainText(str(o.summary || o.description || o.content)).slice(0, MAX_SUMMARY),
          source,
          category,
          time: Number.isNaN(t) ? null : t,
        };
      })
      .map((i) => ({ ...i, key: itemKey(i) }))
      .sort((a, b) => (b.time ?? 0) - (a.time ?? 0));

    // 重複排除と、配信元ごと・カテゴリごとの件数上限（古い記事から切り捨て）
    const seen = new Set();
    const perSource = new Map();
    const perCategory = new Map();
    return sorted.filter((i) => {
      const key = `${i.category}|${i.link || i.title}`;
      if (seen.has(key)) return false;
      const sk = `${i.category}|${i.source}`;
      if (i.source && (perSource.get(sk) || 0) >= MAX_PER_SOURCE) return false;
      if ((perCategory.get(i.category) || 0) >= MAX_PER_CATEGORY) return false;
      seen.add(key);
      perSource.set(sk, (perSource.get(sk) || 0) + 1);
      perCategory.set(i.category, (perCategory.get(i.category) || 0) + 1);
      return true;
    });
  };

  const fmtDate = (t) =>
    new Date(t).toLocaleString('ja-JP', { dateStyle: 'medium', timeStyle: 'short' });

  // ---- 新着（New）/既読管理 ----
  // 記事キー: リンク（なければタイトル）の 53bit ハッシュ（localStorage の容量節約）
  const hash53 = (s) => {
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let k = 0; k < s.length; k++) {
      const c = s.charCodeAt(k);
      h1 = Math.imul(h1 ^ c, 2654435761);
      h2 = Math.imul(h2 ^ c, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
  };
  function itemKey(i) { return hash53(i.link || i.title); }

  const loadList = (k) => {
    try {
      const v = JSON.parse(localStorage.getItem(k) || 'null');
      return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : null;
    } catch { return null; }
  };
  const saveList = (k, arr) => {
    try { localStorage.setItem(k, JSON.stringify(arr)); } catch { /* 容量超過は無視 */ }
  };
  const unread = new Set(loadList(KEY_UNREAD) || []);

  // 取得結果のうち、前回までに見ていない記事を「未読(New)」として記録する。
  // 初回取得（比較対象なし）は基準として記録するだけで New にしない。
  const markNew = (list) => {
    const known = loadList(KEY_KNOWN);
    const keys = list.map((i) => i.key);
    let added = 0;
    if (known) {
      const knownSet = new Set(known);
      keys.forEach((k) => {
        if (!knownSet.has(k)) { unread.add(k); added++; }
      });
    }
    const current = new Set(keys);
    [...unread].forEach((k) => { if (!current.has(k)) unread.delete(k); });
    const merged = [...(known || []).filter((k) => !current.has(k)), ...keys].slice(-MAX_KNOWN);
    saveList(KEY_KNOWN, merged);
    saveList(KEY_UNREAD, [...unread]);
    return added;
  };

  const updateNewBadges = () => {
    els.groups.querySelectorAll('details').forEach((d) => {
      const n = d.querySelectorAll('.card.is-new').length;
      const b = d.querySelector(':scope > summary > .new-label');
      b.hidden = n === 0;
      b.textContent = `New ${n}`;
    });
    els.readAllBtn.hidden = unread.size === 0;
  };

  const markRead = (key) => {
    if (!unread.delete(key)) return;
    saveList(KEY_UNREAD, [...unread]);
    els.groups.querySelectorAll('.card.is-new').forEach((c) => {
      if (c.dataset.key !== key) return;
      c.classList.remove('is-new');
      c.querySelector('.new-label')?.remove();
    });
    updateNewBadges();
  };

  const renderCard = (i) => {
    const li = document.createElement('li');
    li.className = 'card';
    li.dataset.key = i.key;

    const h = document.createElement('h2');
    if (unread.has(i.key)) {
      li.classList.add('is-new');
      const nl = document.createElement('span');
      nl.className = 'new-label';
      nl.textContent = 'New';
      h.append(nl);
    }
    if (i.link) {
      const a = document.createElement('a');
      a.href = i.link;
      a.target = '_blank';
      a.rel = 'noopener noreferrer nofollow';
      a.referrerPolicy = 'no-referrer';
      a.textContent = i.title;
      h.append(a);
    } else {
      h.append(i.title);
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

  const makeGroup = ({ key, label, count, className, defaultOpen, forceOpen, content }) => {
    const open = loadOpenState();
    const details = document.createElement('details');
    details.className = className;
    details.open = forceOpen || (key in open ? open[key] === true : defaultOpen);
    details.addEventListener('toggle', () => {
      if (forceOpen) return; // 絞り込み中の自動展開は保存しない
      const state = loadOpenState();
      state[key] = details.open;
      localStorage.setItem(KEY_OPEN, JSON.stringify(state));
    });

    const summary = document.createElement('summary');
    const name = document.createElement('span');
    name.textContent = label;
    const newBadge = document.createElement('span');
    newBadge.className = 'new-label';
    newBadge.hidden = true;
    const badge = document.createElement('span');
    badge.className = 'count';
    badge.textContent = String(count);
    summary.append(name, newBadge, badge);

    details.append(summary, content);
    return details;
  };

  const cardList = (list) => {
    const ul = document.createElement('ul');
    ul.className = 'cards';
    ul.append(...list.map(renderCard));
    return ul;
  };

  // 鉄道: 地域（JR / 関東 / 関西 …）→ 会社 の 2 階層。地域は初期状態で開き、会社は閉じる
  const renderRail = (list, filtering) => {
    const regions = new Map(RAIL_REGIONS.map(([r]) => [r, new Map()]));
    list.forEach((i) => {
      const company = i.source || OTHER;
      const region = regionOf(company);
      const companies = regions.get(region);
      if (!companies.has(company)) companies.set(company, []);
      companies.get(company).push(i);
    });

    const wrap = document.createElement('div');
    wrap.className = 'subgroups';
    for (const [region, companies] of regions) {
      if (companies.size === 0) continue;
      const order = (RAIL_REGIONS.find(([r]) => r === region) || [, []])[1];
      const sorted = [...companies].sort((a, b) => {
        const ia = order.indexOf(a[0]);
        const ib = order.indexOf(b[0]);
        return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
      });

      const inner = document.createElement('div');
      inner.className = 'subgroups';
      inner.append(
        ...sorted.map(([company, arr]) =>
          makeGroup({
            key: `${RAIL}/${region}/${company}`,
            label: company,
            count: arr.length,
            className: 'group sub',
            defaultOpen: false,
            forceOpen: filtering,
            content: cardList(arr),
          })
        )
      );
      wrap.append(
        makeGroup({
          key: `${RAIL}/${region}`,
          label: region,
          count: sorted.reduce((n, [, arr]) => n + arr.length, 0),
          className: 'group sub region',
          defaultOpen: true,
          forceOpen: filtering,
          content: inner,
        })
      );
    }
    return wrap;
  };

  const renderIt = (list, filtering) => {
    const bySource = new Map();
    list.forEach((i) => {
      const s = i.source || '';
      if (!bySource.has(s)) bySource.set(s, []);
      bySource.get(s).push(i);
    });
    const rank = (s) => {
      const idx = IT_ORDER.indexOf(normKey(s));
      return idx < 0 ? 999 : idx;
    };

    const wrap = document.createElement('div');
    wrap.className = 'subgroups';
    wrap.append(
      ...[...bySource]
        .sort((a, b) => rank(a[0]) - rank(b[0]))
        .map(([s, arr]) =>
          makeGroup({
            key: `${IT}/${s}`,
            label: s ? `${IT}（${s}）` : IT,
            count: arr.length,
            className: 'group sub',
            defaultOpen: true,
            forceOpen: filtering,
            content: cardList(arr),
          })
        )
    );
    return wrap;
  };

  const render = () => {
    const q = els.filter.value.trim().toLowerCase();
    const shown = q
      ? items.filter((i) => (i.title + ' ' + i.summary + ' ' + i.source).toLowerCase().includes(q))
      : items;

    const groups = CATEGORIES.map((cat) => {
      const list = shown.filter((i) => i.category === cat);
      if (list.length === 0) return null;

      let content;
      if (cat === RAIL) {
        content = renderRail(list, Boolean(q));
      } else if (cat === IT) {
        content = renderIt(list, Boolean(q));
      } else {
        content = cardList(list);
      }

      return makeGroup({ key: cat, label: cat, count: list.length, className: 'group', defaultOpen: true, content });
    }).filter(Boolean);

    els.groups.replaceChildren(...groups);
    updateNewBadges();
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
    const startedAt = performance.now();
    let lastSec = -1;
    let phase = '取得中';
    const tick = () => {
      const sec = (performance.now() - startedAt) / 1000;
      els.fetchBtn.textContent = `${phase}… ${sec.toFixed(1)}秒`;
      if (Math.floor(sec) !== lastSec) { // 読み上げ対象のステータスは1秒ごとに更新
        lastSec = Math.floor(sec);
        setStatus(`${phase}…（経過 ${lastSec}秒 / 最大 ${TIMEOUT_MS / 1000}秒。Logic Apps の実行に時間がかかる場合があります）`);
      }
    };
    tick();
    const ticker = setInterval(tick, 100);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    let result = '';
    let isError = false;
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
      phase = '受信中';
      const text = await res.text();
      if (!res.ok) {
        const detail = text.replace(/\s+/g, ' ').slice(0, 200);
        throw new Error(`HTTP ${res.status}${detail ? ' - ' + detail : ''}`);
      }
      if (text.length > MAX_BYTES) throw new Error('レスポンスが大きすぎます');
      phase = '解析中';
      items = normalize(JSON.parse(text));
      const added = markNew(items);
      try {
        localStorage.setItem(KEY_CACHE, JSON.stringify({ at: Date.now(), items }));
      } catch { /* 容量超過時はキャッシュを諦める（表示は継続） */ }
      result = `${items.length} 件取得・新着 ${added} 件（${fmtDate(Date.now())}・所要 ${((performance.now() - startedAt) / 1000).toFixed(1)}秒）`;
      render();
    } catch (e) {
      const msg = e.name === 'AbortError' ? 'タイムアウトしました' : e.message;
      result = `取得に失敗しました（${((performance.now() - startedAt) / 1000).toFixed(1)}秒）: ${msg}`;
      isError = true;
    } finally {
      clearInterval(ticker);
      clearTimeout(timer);
      els.fetchBtn.textContent = FETCH_LABEL;
      els.fetchBtn.disabled = false;
      setStatus(result, isError);
    }
  };

  const loadCache = () => {
    try {
      const c = JSON.parse(localStorage.getItem(KEY_CACHE) || 'null');
      if (c && Array.isArray(c.items)) {
        items = c.items.map((i) => {
          const link = safeHttpUrl(i.link);
          const title = str(i.title);
          return {
            title,
            link,
            summary: str(i.summary),
            source: str(i.source),
            category: toCategory(i.category),
            time: typeof i.time === 'number' ? i.time : null,
            key: itemKey({ link, title }),
          };
        });
        setStatus(`前回の取得結果を表示中（${fmtDate(c.at)}）`);
        render();
      }
    } catch { /* 破損したキャッシュは無視 */ }
  };

  els.fetchBtn.addEventListener('click', fetchNews);
  // リンクを開いたカードを既読にする（通常クリック・中クリック・長押しメニューは対象外）
  const onLinkOpen = (e) => {
    const a = e.target.closest?.('.card a');
    if (a) markRead(a.closest('.card').dataset.key);
  };
  els.groups.addEventListener('click', onLinkOpen);
  els.groups.addEventListener('auxclick', onLinkOpen);
  els.readAllBtn.addEventListener('click', () => {
    unread.clear();
    saveList(KEY_UNREAD, []);
    els.groups.querySelectorAll('.card.is-new').forEach((c) => {
      c.classList.remove('is-new');
      c.querySelector('.new-label')?.remove();
    });
    updateNewBadges();
  });
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
    localStorage.removeItem(KEY_KNOWN);
    localStorage.removeItem(KEY_UNREAD);
    unread.clear();
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
