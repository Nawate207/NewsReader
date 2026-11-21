(() => {
  'use strict';

  const KEY_URL = 'xsearch.endpoint';
  const KEY_SAVED = 'xsearch.saved';
  const MAX_SAVED = 50;
  const PARAMETERS = ['p', 'md', 'results', 'mtype', 'start', 'oldestTweetId', 'since', 'until'];
  const TIMEOUT_MS = 120000;
  const MAX_RESPONSE = 20 * 1024 * 1024;
  const $ = (id) => document.getElementById(id);
  const form = $('searchForm');
  const status = $('status');
  const posts = $('posts');
  const endpoint = $('endpoint');
  const searchBtn = $('searchBtn');

  const setStatus = (message, error = false) => {
    status.textContent = message;
    status.classList.toggle('error', error);
  };
  const setBmStatus = (message, error = false) => {
    $('bmStatus').textContent = message;
    $('bmStatus').classList.toggle('error', error);
  };

  const parseEndpoint = (value) => {
    try {
      const url = new URL(value.trim());
      if (url.protocol !== 'https:' || !url.hostname.endsWith('.logic.azure.com') ||
          url.username || url.password || !url.searchParams.get('sig') ||
          !url.searchParams.get('api-version')) return null;
      return url.href;
    } catch {
      return null;
    }
  };

  const element = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  // 画像・リンクの URL は bookmarks.js の sanitize 済み（許可ホストの https のみ）
  const image = (url, className, alt) => {
    const img = element('img', className);
    img.src = url;
    img.alt = alt;
    img.loading = 'lazy';
    img.referrerPolicy = 'no-referrer';
    return img;
  };

  const link = (url, text, className) => {
    const a = element('a', className, text);
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    return a;
  };

  const timeElement = (ms) => {
    const date = new Date(ms);
    if (ms === null || Number.isNaN(date.getTime())) return null;
    const time = element('time', 'post-time', date.toLocaleString('ja-JP', { dateStyle: 'medium', timeStyle: 'short' }));
    time.dateTime = date.toISOString();
    return time;
  };

  // ---- ブックマークボタン ----
  let bmIds = Bookmarks.ids();
  const setBm = (btn, on) => {
    btn.textContent = on ? '★' : '☆';
    btn.classList.toggle('on', on);
    btn.setAttribute('aria-pressed', String(on));
    btn.title = on ? 'ブックマークを解除' : 'ブックマークに追加';
    btn.setAttribute('aria-label', btn.title);
  };
  const bmButton = (id) => {
    const b = element('button', 'bm-btn');
    b.type = 'button';
    b.dataset.id = id;
    setBm(b, bmIds.has(id));
    return b;
  };
  // メモ・タグがあるブックマークは、解除前に確認する
  const unbookmark = (id) => {
    const saved = Bookmarks.list().find((x) => x.id === id);
    if (saved && (saved.memo || saved.tags.length) && !confirm('メモ・タグも削除されます。ブックマークを解除しますか？')) {
      return { ok: true };
    }
    return Bookmarks.remove(id);
  };

  // メモ・タグの表示と編集ボタン（ブックマーク一覧のみ）
  const bmExtras = (entry) => {
    const box = element('div', 'bm-extras');
    if (entry.memo) box.append(element('p', 'bm-memo', entry.memo));
    if (entry.tags.length) {
      const tags = element('div', 'tags');
      entry.tags.forEach((t) => {
        const chip = element('button', 'tag', `#${t}`);
        chip.type = 'button';
        chip.dataset.tag = t;
        chip.title = `タグ「${t}」で絞り込み`;
        tags.append(chip);
      });
      box.append(tags);
    }
    const edit = element('button', 'bm-edit', 'メモ・タグを編集');
    edit.type = 'button';
    box.append(edit);
    return box;
  };

  const renderXPost = (m, entry) => {
    const card = element('li', 'post');
    if (m.id) card.dataset.id = m.id;
    if (m.profileImage) card.append(image(m.profileImage, 'avatar', ''));
    const content = element('div', 'post-content');
    const heading = element('div', 'post-heading');
    const name = m.name || '名前なし';
    heading.append(m.userUrl ? link(m.userUrl, name, 'post-name') : element('strong', 'post-name', name));
    if (m.screenName) heading.append(element('span', 'post-handle', `@${m.screenName}`));
    const time = timeElement(m.time);
    if (time) heading.append(time);
    content.append(heading, element('p', 'post-text', m.text));

    if (m.images.length) {
      const media = element('div', 'post-media');
      m.images.forEach((url) => media.append(image(url, '', '投稿の画像')));
      content.append(media);
    }

    const stats = element('div', 'post-stats');
    [['replyCount', '返信'], ['rtCount', 'リポスト'], ['qtCount', '引用'], ['likesCount', 'いいね']].forEach(([key, label]) => {
      if (m.stats[key] !== null) stats.append(element('span', '', `${label} ${m.stats[key].toLocaleString('ja-JP')}`));
    });
    if (stats.children.length) content.append(stats);
    if (m.url) content.append(link(m.url, 'Xで投稿を開く', 'post-link'));
    if (entry) content.append(bmExtras(entry));
    card.append(content);
    if (m.id) card.append(bmButton(m.id));
    return card;
  };

  const renderRssItem = (m, entry) => {
    const card = element('li', 'post');
    card.dataset.id = m.id;
    const content = element('div', 'post-content');
    const heading = element('div', 'post-heading');
    heading.append(element('span', 'type-badge', 'RSS'));
    if (m.source) heading.append(element('span', 'post-handle', m.source));
    const time = timeElement(m.time);
    if (time) heading.append(time);
    const title = element('p', 'post-title');
    title.append(m.url ? link(m.url, m.title || '(無題)', 'post-name') : element('strong', '', m.title || '(無題)'));
    content.append(heading, title);
    if (m.summary) content.append(element('p', 'post-text', m.summary));
    content.append(bmExtras(entry));
    card.append(content, bmButton(m.id));
    return card;
  };

  // フォームの入力値（日時は datetime-local の文字列のまま。送信時に validateParameters が Unix 秒へ変換する）
  const readForm = () => {
    const data = new FormData(form);
    const values = {};
    PARAMETERS.forEach((name) => { values[name] = String(data.get(name) || '').trim(); });
    return values;
  };
  let results = new Map();

  // 数値は範囲を検証し、日時（datetime-local）は Unix 秒に変換して送る。未指定は空文字のまま
  const validateParameters = (payload) => {
    if (payload.results && !/^[1-9]\d*$/.test(payload.results)) return '取得件数は1以上の整数で指定してください。';
    if (payload.start && (!/^[1-9]\d*$/.test(payload.start) || Number(payload.start) > 10000)) {
      return '取得開始位置は1〜10000の整数で指定してください。';
    }
    if (payload.oldestTweetId && !/^\d+$/.test(payload.oldestTweetId)) return 'ツイートIDは数字で指定してください。';
    for (const [name, label] of [['since', 'この時刻以降'], ['until', 'この時刻以前']]) {
      if (!payload[name]) continue;
      const ms = new Date(payload[name]).getTime();
      if (Number.isNaN(ms)) return `${label}の日時が正しくありません。`;
      payload[name] = String(Math.floor(ms / 1000));
    }
    if (payload.since && payload.until && Number(payload.since) > Number(payload.until)) {
      return '「この時刻以降」は「この時刻以前」より前の日時にしてください。';
    }
    return '';
  };

  const settings = $('settings');
  const settingsBtn = $('settingsBtn');
  const toggleSettings = (show) => {
    settings.hidden = !show;
    settingsBtn.setAttribute('aria-expanded', String(show));
  };
  settingsBtn.addEventListener('click', () => toggleSettings(settings.hidden));

  $('saveBtn').addEventListener('click', () => {
    const url = parseEndpoint(endpoint.value);
    if (!url) {
      setStatus('署名と api-version を含む完全な Logic Apps の HTTPS URL を入力してください。', true);
      return;
    }
    try {
      localStorage.setItem(KEY_URL, url);
      endpoint.value = '';
      toggleSettings(false);
      setStatus('検索用URLをこのブラウザに保存しました。');
    } catch {
      setStatus('URLを保存できませんでした。ブラウザのストレージ設定を確認してください。', true);
    }
  });

  $('clearBtn').addEventListener('click', () => {
    try {
      localStorage.removeItem(KEY_URL);
      endpoint.value = '';
      setStatus('検索用URLを削除しました。');
    } catch {
      setStatus('URLを削除できませんでした。ブラウザのストレージ設定を確認してください。', true);
    }
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (searchBtn.disabled) return;
    let url;
    try {
      url = parseEndpoint(localStorage.getItem(KEY_URL) || '');
    } catch {
      setStatus('保存されたURLを読み込めません。ブラウザのストレージ設定を確認してください。', true);
      return;
    }
    if (!url) {
      toggleSettings(true);
      setStatus('検索用 Logic Apps の完全な URL を設定してください。', true);
      return;
    }
    const payload = readForm();
    if (!payload.p) {
      setStatus('キーワードを入力してください。', true);
      return;
    }
    const invalid = validateParameters(payload);
    if (invalid) {
      setStatus(invalid, true);
      return;
    }
    searchBtn.disabled = true;
    setStatus('検索中…');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        credentials: 'omit',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
        redirect: 'error',
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const text = await response.text();
      if (text.length > MAX_RESPONSE) throw new Error('レスポンスが大きすぎます。');
      const data = JSON.parse(text);
      const entries = data?.timeline?.entry ?? data?.body?.timeline?.entry;
      if (!Array.isArray(entries) || entries.some((entry) => !entry || typeof entry !== 'object' || Array.isArray(entry))) {
        throw new Error('timeline.entry が投稿の配列ではありません。');
      }
      const models = entries.map(Bookmarks.normalizeXPost).filter(Boolean);
      results = new Map(models.filter((m) => m.id).map((m) => [m.id, m]));
      bmIds = Bookmarks.ids();
      posts.replaceChildren(...models.map((m) => renderXPost(m, null)));
      setStatus(models.length ? `${models.length}件のポストを表示しています。` : '該当するポストはありません。');
    } catch (error) {
      const message = error.name === 'AbortError' ? 'タイムアウトしました。' :
        error instanceof TypeError ? '通信に失敗しました。URL、ネットワーク、CORS設定を確認してください。' :
          error.message;
      setStatus(`検索に失敗しました: ${message} 以前の検索結果はそのまま表示しています。`, true);
    } finally {
      clearTimeout(timer);
      searchBtn.disabled = false;
    }
  });

  // ---- 検索結果のブックマーク操作 ----
  posts.addEventListener('click', (event) => {
    const btn = event.target.closest('.bm-btn');
    if (!btn) return;
    const id = btn.dataset.id;
    const result = bmIds.has(id) ? unbookmark(id) : (results.has(id) ? Bookmarks.add(results.get(id)) : { ok: false, error: 'ポストが見つかりません。' });
    if (!result.ok) setStatus(result.error, true);
  });

  // ---- 保存した検索条件 ----
  const MD_VALUES = ['', 'h'];
  const MTYPE_VALUES = ['', 'image', 'video'];
  const MTYPE_LABELS = { image: '画像のみ', video: '動画のみ' };
  const savedList = $('savedList');

  const cleanSaved = (s) => {
    if (!s || typeof s !== 'object' || !s.params || typeof s.params !== 'object') return null;
    const params = {};
    PARAMETERS.forEach((name) => { params[name] = typeof s.params[name] === 'string' ? s.params[name].slice(0, 200) : ''; });
    if (!params.p) return null;
    if (!MD_VALUES.includes(params.md)) params.md = '';
    if (!MTYPE_VALUES.includes(params.mtype)) params.mtype = '';
    return {
      id: typeof s.id === 'string' ? s.id.slice(0, 40) : '',
      name: typeof s.name === 'string' ? s.name.slice(0, 40) : '',
      params,
    };
  };
  const loadSaved = () => {
    try {
      const v = JSON.parse(localStorage.getItem(KEY_SAVED) || '[]');
      return Array.isArray(v) ? v.map(cleanSaved).filter((s) => s && s.id) : [];
    } catch {
      return [];
    }
  };
  const storeSaved = (list) => {
    try {
      localStorage.setItem(KEY_SAVED, JSON.stringify(list));
      return true;
    } catch {
      return false;
    }
  };
  const describeParams = (p) => [
    p.md === 'h' ? '人気順' : '',
    MTYPE_LABELS[p.mtype] || '',
    p.results ? `${p.results}件` : '',
    p.start ? `開始位置${p.start}` : '',
    p.oldestTweetId ? 'ツイートID指定' : '',
    p.since ? `${p.since.replace('T', ' ')}以降` : '',
    p.until ? `${p.until.replace('T', ' ')}以前` : '',
  ].filter(Boolean).join(' / ');

  const renderSaved = () => {
    const list = loadSaved();
    $('savedCount').textContent = String(list.length);
    if (!list.length) {
      savedList.replaceChildren(element('li', 'hint', '保存した条件はありません。'));
      return;
    }
    savedList.replaceChildren(...list.map((s) => {
      const li = element('li', 'saved-item');
      li.dataset.id = s.id;
      const main = element('div', 'saved-main');
      main.append(element('strong', '', s.name || s.params.p));
      main.append(element('span', 'hint', [`キーワード: ${s.params.p}`, describeParams(s.params)].filter(Boolean).join(' / ')));
      const actions = element('div', 'row');
      const run = element('button', 'saved-run primary', '実行');
      run.type = 'button';
      const del = element('button', 'saved-del', '削除');
      del.type = 'button';
      actions.append(run, del);
      li.append(main, actions);
      return li;
    }));
  };

  $('saveSearchBtn').addEventListener('click', () => {
    const params = readForm();
    if (!params.p) {
      setStatus('保存するキーワードを入力してください。', true);
      return;
    }
    const list = loadSaved();
    if (list.length >= MAX_SAVED) {
      setStatus(`保存できる検索条件は最大${MAX_SAVED}件です。不要な条件を削除してください。`, true);
      return;
    }
    const nameInput = $('saveName');
    const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    list.unshift({ id, name: nameInput.value.trim().slice(0, 40), params });
    if (!storeSaved(list)) {
      setStatus('検索条件を保存できませんでした。ブラウザの保存容量や設定を確認してください。', true);
      return;
    }
    nameInput.value = '';
    renderSaved();
    setStatus('検索条件を保存しました。');
  });

  savedList.addEventListener('click', (event) => {
    const button = event.target.closest('button');
    const item = event.target.closest('.saved-item');
    if (!button || !item) return;
    const list = loadSaved();
    if (button.classList.contains('saved-del')) {
      if (!storeSaved(list.filter((s) => s.id !== item.dataset.id))) {
        setStatus('検索条件を削除できませんでした。ブラウザの保存容量や設定を確認してください。', true);
        return;
      }
      renderSaved();
      return;
    }
    const saved = list.find((s) => s.id === item.dataset.id);
    if (!saved) return;
    PARAMETERS.forEach((name) => { form.elements[name].value = saved.params[name]; });
    if (PARAMETERS.slice(1).some((name) => saved.params[name])) form.querySelector('.parameters').open = true;
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });

  // ---- ブックマーク一覧 ----
  const bmEls = {
    query: $('bmQuery'), type: $('bmType'), tag: $('bmTag'), sort: $('bmSort'),
    image: $('bmImage'), memo: $('bmMemo'), list: $('bmList'), summary: $('bmSummary'),
  };

  const refreshTagOptions = (all) => {
    const counts = new Map();
    all.forEach((e) => e.tags.forEach((t) => counts.set(t, (counts.get(t) || 0) + 1)));
    const current = bmEls.tag.value;
    const options = [...counts].sort((a, b) => a[0].localeCompare(b[0], 'ja')).map(([t, n]) => {
      const o = element('option', '', `${t} (${n})`);
      o.value = t;
      return o;
    });
    const all0 = element('option', '', 'すべて');
    all0.value = '';
    bmEls.tag.replaceChildren(all0, ...options);
    bmEls.tag.value = counts.has(current) ? current : '';
  };

  const haystack = (e) => [e.text, e.title, e.summary, e.name, e.screenName, e.source, e.memo, ...e.tags]
    .filter(Boolean).join('\n').toLowerCase();

  const renderBookmarks = () => {
    const all = Bookmarks.list();
    bmIds = new Set(all.map((e) => e.id));
    $('bmCount').textContent = String(all.length);
    refreshTagOptions(all);

    const q = bmEls.query.value.trim().toLowerCase();
    const type = bmEls.type.value;
    const tag = bmEls.tag.value;
    const filtered = all.filter((e) =>
      (!type || e.type === type) &&
      (!tag || e.tags.includes(tag)) &&
      (!bmEls.image.checked || (e.type === 'x' && e.images.length > 0)) &&
      (!bmEls.memo.checked || e.memo) &&
      (!q || haystack(e).includes(q)));
    if (bmEls.sort.value === 'time') filtered.sort((a, b) => (b.time ?? 0) - (a.time ?? 0));

    bmEls.list.replaceChildren(...filtered.map((e) => (e.type === 'x' ? renderXPost(e, e) : renderRssItem(e, e))));
    bmEls.summary.textContent = all.length ? `${filtered.length}件表示 / 全${all.length}件` : '';
    $('bmClearBtn').hidden = all.length === 0;
    if (!all.length) {
      setBmStatus('ブックマークはまだありません。検索結果やRSS記事の ☆ を押すと追加できます。');
    } else if (!filtered.length) {
      setBmStatus('条件に一致するブックマークはありません。');
    } else {
      setBmStatus('');
    }
  };

  [bmEls.query, bmEls.type, bmEls.tag, bmEls.sort, bmEls.image, bmEls.memo].forEach((el) => {
    el.addEventListener(el === bmEls.query ? 'input' : 'change', renderBookmarks);
  });

  $('bmClearBtn').addEventListener('click', () => {
    if (!confirm('ブックマークをすべて削除します（メモ・タグも含みます）。よろしいですか？')) return;
    const result = Bookmarks.clear();
    if (!result.ok) setBmStatus(result.error, true);
  });

  const openEditor = (card) => {
    const entry = Bookmarks.list().find((x) => x.id === card.dataset.id);
    const box = card.querySelector('.bm-extras');
    if (!entry || !box) return;
    const editor = element('div', 'bm-editor');
    const memo = element('textarea');
    memo.rows = 3;
    memo.maxLength = Bookmarks.MAX_MEMO;
    memo.value = entry.memo;
    memo.placeholder = 'メモ';
    memo.setAttribute('aria-label', 'メモ');
    const tags = element('input');
    tags.type = 'text';
    tags.value = entry.tags.join(' ');
    tags.placeholder = `タグ（空白かカンマ区切り、最大${Bookmarks.MAX_TAGS}個）`;
    tags.setAttribute('aria-label', 'タグ');
    tags.autocomplete = 'off';
    const row = element('div', 'row');
    const save = element('button', 'primary', '保存');
    save.type = 'button';
    const cancel = element('button', '', 'キャンセル');
    cancel.type = 'button';
    save.addEventListener('click', () => {
      const result = Bookmarks.update(entry.id, { memo: memo.value.trim(), tags: tags.value });
      if (!result.ok) setBmStatus(result.error, true);
    });
    cancel.addEventListener('click', renderBookmarks);
    row.append(save, cancel);
    editor.append(memo, tags, row);
    box.replaceWith(editor);
    memo.focus();
  };

  bmEls.list.addEventListener('click', (event) => {
    const card = event.target.closest('.post');
    if (!card) return;
    if (event.target.closest('.bm-btn')) {
      const result = unbookmark(card.dataset.id);
      if (!result.ok) setBmStatus(result.error, true);
    } else if (event.target.closest('.bm-edit')) {
      openEditor(card);
    } else {
      const chip = event.target.closest('.tag');
      if (chip) {
        bmEls.tag.value = chip.dataset.tag;
        renderBookmarks();
      }
    }
  });

  Bookmarks.onChange(() => {
    bmIds = Bookmarks.ids();
    $('bmCount').textContent = String(bmIds.size);
    posts.querySelectorAll('.bm-btn').forEach((b) => setBm(b, bmIds.has(b.dataset.id)));
    if (!$('bookmarkView').hidden) renderBookmarks();
  });

  // ---- 表示切替（検索 / ブックマーク）----
  const showView = (name) => {
    const bookmarks = name === 'bookmarks';
    $('searchView').hidden = bookmarks;
    $('bookmarkView').hidden = !bookmarks;
    $('tabSearch').setAttribute('aria-pressed', String(!bookmarks));
    $('tabBookmarks').setAttribute('aria-pressed', String(bookmarks));
    $('pageTitle').textContent = bookmarks ? 'ブックマーク' : 'X検索';
    document.title = `${bookmarks ? 'ブックマーク' : 'X検索'} | RSS Reader`;
    if (bookmarks) renderBookmarks();
    history.replaceState(null, '', bookmarks ? '#bookmarks' : location.pathname + location.search);
  };
  $('tabSearch').addEventListener('click', () => showView('search'));
  $('tabBookmarks').addEventListener('click', () => showView('bookmarks'));
  window.addEventListener('hashchange', () => showView(location.hash === '#bookmarks' ? 'bookmarks' : 'search'));

  renderSaved();
  $('bmCount').textContent = String(bmIds.size);
  showView(location.hash === '#bookmarks' ? 'bookmarks' : 'search');

  const themeBtn = $('themeBtn');
  const updateThemeButton = () => {
    themeBtn.textContent = document.documentElement.dataset.theme === 'dark' ? '☀️' : '🌙';
    themeBtn.title = document.documentElement.dataset.theme === 'dark' ? 'ライトモードに切替' : 'ダークモードに切替';
  };
  themeBtn.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    updateThemeButton();
    try {
      localStorage.setItem('rss.theme', next);
    } catch {
      setStatus('テーマを保存できませんでした。ブラウザのストレージ設定を確認してください。', true);
    }
  });
  updateThemeButton();
})();
