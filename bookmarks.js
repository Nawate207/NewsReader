// ブックマークの保存（localStorage）。RSS ページと検索ページで共有する。
// 読み込み時は必ず sanitize を通し、改ざんされた保存データを画面に出さない。
(() => {
  'use strict';

  const KEY = 'rss.bookmarks';
  const MAX_ITEMS = 1000;
  const MAX_TEXT = 2000;
  const MAX_MEMO = 1000;
  const MAX_TAGS = 10;
  const MAX_TAG = 30;
  const MAX_IMAGES = 4;
  const IMAGE_HOSTS = new Set(['rts-pctr.c.yimg.jp', 'pbs.twimg.com']);
  const LINK_HOSTS = new Set(['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com']);
  const STAT_KEYS = ['replyCount', 'rtCount', 'qtCount', 'likesCount'];

  const text = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
  const finite = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const parseUrl = (v) => {
    if (typeof v !== 'string') return null;
    try { return new URL(v); } catch { return null; }
  };
  const hostUrl = (v, hosts) => {
    const u = parseUrl(v);
    return u && u.protocol === 'https:' && !u.username && !u.password && hosts.has(u.hostname) ? u.href : null;
  };
  const httpUrl = (v) => {
    const u = parseUrl(v);
    return u && (u.protocol === 'https:' || u.protocol === 'http:') ? u.href : null;
  };

  // タグは配列、または空白・カンマ（全角含む）区切りの文字列を受け付ける
  const cleanTags = (v) => {
    const raw = Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[,、，\s]+/) : [];
    const out = [];
    for (const t of raw) {
      const s = text(t, MAX_TAG).replace(/^#/, '').trim();
      if (s && !out.includes(s)) out.push(s);
      if (out.length >= MAX_TAGS) break;
    }
    return out;
  };

  const sanitize = (e) => {
    if (!e || typeof e !== 'object' || Array.isArray(e)) return null;
    const type = e.type;
    if ((type !== 'x' && type !== 'rss') || typeof e.id !== 'string' ||
        !e.id.startsWith(`${type}:`) || e.id.length > 300) return null;
    const out = {
      id: e.id,
      type,
      savedAt: finite(e.savedAt) ?? Date.now(),
      time: finite(e.time),
      memo: text(e.memo, MAX_MEMO),
      tags: cleanTags(e.tags),
    };
    if (type === 'x') {
      const stats = {};
      STAT_KEYS.forEach((k) => { stats[k] = finite(e.stats?.[k]); });
      Object.assign(out, {
        url: hostUrl(e.url, LINK_HOSTS),
        text: text(e.text, MAX_TEXT),
        name: text(e.name, 100),
        screenName: text(e.screenName, 50),
        userUrl: hostUrl(e.userUrl, LINK_HOSTS),
        profileImage: hostUrl(e.profileImage, IMAGE_HOSTS),
        images: (Array.isArray(e.images) ? e.images : []).map((u) => hostUrl(u, IMAGE_HOSTS)).filter(Boolean).slice(0, MAX_IMAGES),
        stats,
      });
    } else {
      Object.assign(out, {
        url: httpUrl(e.url),
        title: text(e.title, 500),
        summary: text(e.summary, 400),
        source: text(e.source, 100),
        category: text(e.category, 50),
      });
    }
    return out;
  };

  // Logic Apps の timeline.entry の 1 件を、表示・保存用の形に正規化する（id が無い投稿は id を空にする）
  const normalizeXPost = (p) => {
    if (!p || typeof p !== 'object' || Array.isArray(p)) return null;
    const rawId = typeof p.id === 'string' || typeof p.id === 'number' ? String(p.id) : '';
    const body = typeof p.displayText === 'string' ? p.displayText :
      typeof p.displayTextBody === 'string' ? p.displayTextBody : '';
    const images = Array.isArray(p.media)
      ? p.media.filter((m) => m && m.type === 'image' && m.item).map((m) => m.item.mediaUrl || m.item.thumbnailImageUrl)
      : [];
    const createdAt = finite(p.createdAt);
    const model = sanitize({
      id: `x:${rawId || 'none'}`,
      type: 'x',
      url: p.url,
      text: body.replace(/\t(?:START|END)\t/g, ''),
      name: p.name,
      screenName: p.screenName,
      userUrl: p.userUrl,
      profileImage: p.profileImage,
      images,
      stats: { replyCount: p.replyCount, rtCount: p.rtCount, qtCount: p.qtCount, likesCount: p.likesCount },
      time: createdAt === null ? null : createdAt * 1000,
    });
    if (model && !rawId) model.id = '';
    return model;
  };

  const read = () => {
    try {
      const v = JSON.parse(localStorage.getItem(KEY) || '[]');
      if (!Array.isArray(v)) return [];
      const seen = new Set();
      return v.map(sanitize).filter((e) => e && !seen.has(e.id) && seen.add(e.id));
    } catch {
      return [];
    }
  };
  const write = (list) => {
    try {
      localStorage.setItem(KEY, JSON.stringify(list));
      return true;
    } catch {
      return false;
    }
  };

  const listeners = new Set();
  const notify = () => listeners.forEach((fn) => fn());
  window.addEventListener('storage', (e) => {
    if (e.key === KEY || e.key === null) notify();
  });

  const STORAGE_ERROR = '保存できませんでした。ブラウザの保存容量や設定を確認してください。';

  window.Bookmarks = Object.freeze({
    MAX_ITEMS,
    MAX_MEMO,
    MAX_TAGS,
    cleanTags,
    normalizeXPost,
    list: read,
    ids: () => new Set(read().map((e) => e.id)),
    onChange: (fn) => { listeners.add(fn); },
    add(entry) {
      const e = sanitize({ ...entry, savedAt: Date.now(), memo: '', tags: [] });
      if (!e) return { ok: false, error: 'このデータはブックマークできません。' };
      const list = read();
      if (list.some((x) => x.id === e.id)) return { ok: true };
      if (list.length >= MAX_ITEMS) return { ok: false, error: `ブックマークは最大${MAX_ITEMS}件までです。` };
      if (!write([e, ...list])) return { ok: false, error: STORAGE_ERROR };
      notify();
      return { ok: true };
    },
    remove(id) {
      const list = read();
      const next = list.filter((x) => x.id !== id);
      if (next.length === list.length) return { ok: true };
      if (!write(next)) return { ok: false, error: STORAGE_ERROR };
      notify();
      return { ok: true };
    },
    update(id, { memo, tags }) {
      const list = read();
      const target = list.find((x) => x.id === id);
      if (!target) return { ok: false, error: 'ブックマークが見つかりません。' };
      target.memo = text(memo, MAX_MEMO);
      target.tags = cleanTags(tags);
      if (!write(list)) return { ok: false, error: STORAGE_ERROR };
      notify();
      return { ok: true };
    },
    clear() {
      try {
        localStorage.removeItem(KEY);
      } catch {
        return { ok: false, error: STORAGE_ERROR };
      }
      notify();
      return { ok: true };
    },
  });
})();
