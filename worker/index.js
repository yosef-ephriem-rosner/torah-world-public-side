import ASSETS from './assets.js';
const bin = {};
// Torah World API — Cloudflare Worker + D1
const PRO = ['avreich', 'rav', 'talmid_chacham', 'rosh_yeshiva'];
const LEVELS = ['student', 'working_man', 'avreich', 'talmid_chacham', 'rav', 'rosh_yeshiva'];
const KINDS = ['note', 'question', 'answer', 'comment'];
const VIS = ['public', 'private', 'professionals', 'group'];
const json = (o, s = 200, h = {}) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...h } });
const err = (m, s = 400) => json({ error: m }, s);
const now = () => Math.floor(Date.now() / 1000);
const enc = new TextEncoder();
const hex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
const rnd = n => hex(crypto.getRandomValues(new Uint8Array(n)));
async function sha(s) { return hex(await crypto.subtle.digest('SHA-256', enc.encode(s))); }
async function pbkdf(pin, salt) {
  const k = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits']);
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations: 100000 }, k, 256));
}
const cookie = (req, n) => (req.headers.get('cookie') || '').split(/;\s*/).map(c => c.split('=')).find(c => c[0] === n)?.[1];
async function me(req, env) {
  const t = cookie(req, 'tw'); if (!t) return null;
  return await env.DB.prepare('SELECT u.id,u.name,u.level FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=?').bind(await sha(t)).first();
}
async function login(env, user) {
  const t = rnd(24);
  await env.DB.prepare('INSERT INTO sessions(token_hash,user_id,created) VALUES(?,?,?)').bind(await sha(t), user.id, now()).run();
  return { 'set-cookie': `tw=${t}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=7776000` };
}
const s = (v, n) => String(v ?? '').slice(0, n);
const int = v => (Number.isFinite(+v) ? Math.trunc(+v) : null);
// any book id of the form <category>-<name> (tanakh-genesis, bavli-pesachim, yerushalmi-berakhot, midrash-..., halakhah-...) is valid (the data itself lives in R2; unknown ids simply 404)
const WORKS = new Proxy({}, { get: (_, k) => (typeof k === 'string' && /^[a-z]{3,14}-[a-z0-9-]{1,60}$/.test(k) ? 1 : undefined) });
// older D1 tables (cross-reference groups, Onkelos alignment) were keyed by the first three work ids
const LEGACY = { 'tanakh-exodus': 'shemos', 'mishnah-berakhot': 'mishnah', 'bavli-berakhot': 'gemara' };

// Visibility predicate for notes `n` for viewer `u` (may be null)
function visSql(u, groupIds) {
  const parts = ["n.visibility='public'"], binds = [];
  if (u) {
    parts.push('n.user_id=?'); binds.push(u.id);
    if (PRO.includes(u.level)) parts.push("n.visibility='professionals'");
    if (groupIds.length) { parts.push(`(n.visibility='group' AND n.group_id IN (${groupIds.map(() => '?').join(',')}))`); binds.push(...groupIds); }
  }
  return { sql: '(' + parts.join(' OR ') + ')', binds };
}
async function groupIds(env, u) {
  if (!u) return [];
  return (await env.DB.prepare('SELECT group_id FROM memberships WHERE user_id=?').bind(u.id).all()).results.map(r => r.group_id);
}
function autoTags(text) {
  const stop = new Set(('של על את לא הוא היא כי אם מה זה זו אבל גם כל או אל עם אני לי לו לה בין יש אין הם הן אנו אתה כך לפי אחר אחד שם מן אצל כמו לכן הרי ואם והוא והיא שהוא שהיא למה איך מדוע האם היה היתה יהיה ' + 'the and for that this with from have does what why how are was were not but can you your there their about into than then also when which where would could should only just like some any all one two ' + 'torah repeat list').split(' '));
  const c = {};
  for (const w of (text.toLowerCase().match(/[א-ת]{3,}|[a-z]{4,}/g) || [])) if (!stop.has(w)) c[w] = (c[w] || 0) + 1;
  return Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 5).map(e => e[0]);
}
async function aiTags(env, text) {
  if (!env.ANTHROPIC_API_KEY) return { tags: autoTags(text), ai: false };
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: env.TAG_MODEL || 'claude-haiku-5-5', max_tokens: 120, messages: [{ role: 'user', content: 'Give 3-6 short topic keywords (Hebrew or English, comma separated, no other text) for this Torah-learning note:\n\n' + text.slice(0, 1500) }] })
    });
    const j = await r.json();
    const out = (j.content?.[0]?.text || '').split(/[,\n،]/).map(x => x.trim().toLowerCase()).filter(x => x && x.length < 30).slice(0, 6);
    return out.length ? { tags: out, ai: true } : { tags: autoTags(text), ai: false };
  } catch { return { tags: autoTags(text), ai: false }; }
}
function normTags(a) { return [...new Set((Array.isArray(a) ? a : String(a || '').split(/[,،]/)).map(x => s(x, 30).trim().toLowerCase()).filter(Boolean))].slice(0, 12); }


// ---- sections live either as packs (packs/<book>/index.json + big .bin files, read with range requests) or as one file per section
const packIdx = new Map(); // book id -> { t, idx } (cached per isolate for 5 minutes; idx null = book has no packs)
async function getPackIndex(env, work) {
  const c = packIdx.get(work); if (c && Date.now() - c.t < 300000) return c.idx;
  const o = await env.R2.get('packs/' + work + '/index.json'); const idx = o ? await o.json() : null;
  packIdx.set(work, { t: Date.now(), idx }); return idx;
}
async function getSectionDoc(env, work, sec) {
  const idx = await getPackIndex(env, work), e = idx && idx.secs && idx.secs[sec];
  if (e) { const o = await env.R2.get('packs/' + work + '/' + idx.files[e[0]], { range: { offset: e[1], length: e[2] } }); if (o) return await o.json(); }
  const o = await env.R2.get('sections/' + work.replace('-', '/') + '/' + sec + '.json'); return o ? await o.json() : null;
}

// ---- links / linksin / placement: packed (linkpacks/<book>/<kind>.index.json + bin files named in the index) or one file per section
const kindIdx = new Map();
async function getKindIndex(env, work, kind) {
  const k = work + '|' + kind, c = kindIdx.get(k); if (c && Date.now() - c.t < 300000) return c.idx;
  const o = await env.R2.get('linkpacks/' + work + '/' + kind + '.index.json'); const idx = o ? await o.json() : null;
  kindIdx.set(k, { t: Date.now(), idx }); return idx;
}
async function getKindDoc(env, work, kind, sec) {
  const idx = await getKindIndex(env, work, kind), e = idx && idx.secs && idx.secs[sec];
  if (e) { const o = await env.R2.get('linkpacks/' + work + '/' + idx.files[e[0]], { range: { offset: e[1], length: e[2] } }); if (o) return await o.json(); }
  const o = await env.R2.get(kind + '/' + work + '/' + sec + '.json'); return o ? await o.json() : null;
}
const routes = [];
const R = (m, p, f) => routes.push([m, new RegExp('^' + p.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), f]);

// ---- auth
R('POST', '/api/register', async ({ req, env }) => {
  const b = await req.json(); const name = s(b.name, 30).trim(), pin = s(b.pin, 100);
  if (name.length < 2 || pin.length < 6) return err('Name ≥2 chars, passcode ≥6 chars');
  const level = LEVELS.includes(b.level) ? b.level : 'student';
  if (await env.DB.prepare('SELECT 1 FROM users WHERE name=?').bind(name).first()) return err('Name taken', 409);
  const salt = rnd(12), hash = await pbkdf(pin, salt);
  const r = await env.DB.prepare('INSERT INTO users(name,level,salt,hash,created) VALUES(?,?,?,?,?)').bind(name, level, salt, hash, now()).run();
  const u = { id: r.meta.last_row_id, name, level };
  return json({ user: u }, 200, await login(env, u));
});
R('POST', '/api/login', async ({ req, env }) => {
  const b = await req.json();
  const u = await env.DB.prepare('SELECT * FROM users WHERE name=?').bind(s(b.name, 30).trim()).first();
  if (!u || (await pbkdf(s(b.pin, 100), u.salt)) !== u.hash) return err('Wrong name or passcode', 401);
  return json({ user: { id: u.id, name: u.name, level: u.level } }, 200, await login(env, u));
});
R('POST', '/api/logout', async ({ req, env }) => {
  const t = cookie(req, 'tw'); if (t) await env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await sha(t)).run();
  return json({ ok: 1 }, 200, { 'set-cookie': 'tw=; Path=/; Max-Age=0' });
});
R('GET', '/api/me', async ({ u }) => json({ user: u }));
R('POST', '/api/me/level', async ({ req, env, u }) => {
  if (!u) return err('Login required', 401); const b = await req.json();
  if (!LEVELS.includes(b.level)) return err('Bad level');
  await env.DB.prepare('UPDATE users SET level=? WHERE id=?').bind(b.level, u.id).run(); return json({ ok: 1 });
});

// ---- text
R('GET', '/api/section', async ({ url, env }) => {
  const work = url.searchParams.get('work'), sec = url.searchParams.get('sec');
  if (!WORKS[work] || !sec || !/^[0-9A-Za-z.:_-]{1,30}$/.test(sec)) return err('bad ref');
  const [doc, pobj] = await Promise.all([getSectionDoc(env, work, sec), getKindDoc(env, work, 'placement', sec)]);
  if (!doc) return err('not found', 404);
  const pl = pobj || null; // corrections for commentaries whose own numbering is not the base-text segment numbering
  const segments = doc.text.segments.map((he, i) => ({ idx: i + 1, he })).filter(s => s.he);
  const comments = [];
  for (const c of doc.commentary) {
    const mv = (pl && pl.moves && pl.moves[c.who]) || null, pg = new Set((pl && pl.page && pl.page[c.who]) || []);
    for (const [seg, arr] of Object.entries(c.seg)) arr.forEach((he, n) => {
      const k = seg + ':' + (n + 1);
      if (mv && mv[k]) { if (mv[k].length) for (const t of mv[k]) comments.push({ idx: +t, who: c.who, n: n + 1, he }); else comments.push({ idx: 0, who: c.who, n: n + 1, he }); }
      else if (pg.has(k)) comments.push({ idx: 0, who: c.who, n: n + 1, he }); // idx 0 = the whole page
      else comments.push({ idx: +seg, who: c.who, n: n + 1, he });
    });
    if (Array.isArray(c.unplaced)) c.unplaced.forEach((he, n) => comments.push({ idx: 0, who: c.who, n: 1000 + n, he })); // section-level commentary (could not be tied to one line)
  }
  comments.sort((a, b) => a.idx - b.idx || a.who.localeCompare(b.who) || a.n - b.n);
  const lw = LEGACY[work] || '-';
  const [xr, nc, al] = await env.DB.batch([
    env.DB.prepare('SELECT idx,cat,items FROM xrefs WHERE work=? AND sec=?').bind(lw, sec),
    env.DB.prepare("SELECT idx,COUNT(*) c FROM notes WHERE work=? AND sec=? AND visibility='public' GROUP BY idx").bind(work, sec),
    env.DB.prepare('SELECT idx,pairs FROM align WHERE work=? AND sec=?').bind(lw, sec),
  ]);
  const sources = { text: { version: doc.text.version, license: doc.text.license, source: doc.text.source },
    commentary: doc.commentary.map(c => ({ who: c.who, title: c.title, version: c.version, license: c.license, source: c.source })) };
  return json({ segments, comments, xrefs: xr.results.map(r => ({ idx: r.idx, cat: r.cat, items: JSON.parse(r.items) })), noteCounts: nc.results, align: al.results, sources });
});
R('GET', '/api/catalog', async ({ env }) => {
  // catalog.json (core books) + every catalog/<group>.json (other sessions add their own group files without touching the core one)
  const books = new Map(); const add = async key => { const o = await env.R2.get(key); if (o) for (const b of (await o.json()).books || []) books.set(b.id, b); };
  await add('catalog.json');
  const list = await env.R2.list({ prefix: 'catalog/' });
  for (const o of list.objects.sort((x, y) => x.key.localeCompare(y.key))) await add(o.key);
  if (!books.size) return err('no catalog yet', 404);
  return json({ schema: 1, books: [...books.values()] }, 200, { 'cache-control': 'public, max-age=300' });
});
R('GET', '/api/links', async ({ url, env }) => {
  const work = url.searchParams.get('work'), sec = url.searchParams.get('sec');
  if (!WORKS[work] || !sec || !/^[0-9A-Za-z.:_-]{1,30}$/.test(sec)) return err('bad ref');
  const [a, b] = await Promise.all([getKindDoc(env, work, 'links', sec), getKindDoc(env, work, 'linksin', sec)]);
  const out = { links: a ? a.links : [], incoming: b ? b.links : [] };
  return json(out, 200, { 'cache-control': 'public, max-age=300' });
});
R('GET', '/api/layouts', async ({ url, env }) => {
  const work = url.searchParams.get('work'); if (!WORKS[work]) return err('bad book');
  const o = await env.R2.get('layouts/' + work + '.json'); if (!o) return json({}, 200, { 'cache-control': 'public, max-age=300' });
  return new Response(o.body, { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=3600' } });
});
R('GET', '/api/search', async ({ url, env, u }) => {
  const q = s(url.searchParams.get('q'), 60).replace(/[֑-ׇ]/g, '').trim();
  if (q.length < 2) return json({ text: [], notes: [] });
  const like = '%' + q.replace(/[%_]/g, '') + '%';
  const text = await env.DB.prepare('SELECT work,sec,idx,he FROM segments WHERE plain LIKE ? LIMIT 40').bind(like).all();
  const g = await groupIds(env, u), v = visSql(u, g);
  const notes = await env.DB.prepare(`SELECT n.id,n.work,n.sec,n.idx,n.kind,n.title,n.body,n.tags,n.level,n.score,us.name author FROM notes n JOIN users us ON us.id=n.user_id WHERE ${v.sql} AND (n.body LIKE ? OR n.title LIKE ? OR n.tags LIKE ? OR n.quote LIKE ?) ORDER BY n.score DESC,n.created DESC LIMIT 40`).bind(...v.binds, like, like, like, like).all();
  return json({ text: text.results, notes: notes.results });
});

// ---- notes
R('GET', '/api/notes', async ({ url, env, u }) => {
  const p = url.searchParams, g = await groupIds(env, u), v = visSql(u, g);
  const w = [v.sql], b = [...v.binds];
  const add = (c, val) => { w.push(c); b.push(val); };
  if (p.get('work') && p.get('sec')) {
    const wk = p.get('work'), sc = p.get('sec'), ix = p.get('idx') != null && p.get('idx') !== '' ? int(p.get('idx')) : null;
    if (ix != null) { w.push('((n.work=? AND n.sec=? AND n.idx=?) OR n.id IN (SELECT note_id FROM note_links WHERE work=? AND sec=? AND idx=?))'); b.push(wk, sc, ix, wk, sc, ix); }
    else { w.push('((n.work=? AND n.sec=?) OR n.id IN (SELECT note_id FROM note_links WHERE work=? AND sec=?))'); b.push(wk, sc, wk, sc); }
  } else if (p.get('work')) add('n.work=?', p.get('work'));
  if (p.get('author')) add('us.name=?', p.get('author'));
  if (p.get('level')) add('n.level=?', p.get('level'));
  if (p.get('kind')) add('n.kind=?', p.get('kind'));
  if (p.get('tag')) add('n.tags LIKE ?', '%' + s(p.get('tag'), 30).toLowerCase() + '%');
  if (p.get('q')) { const l = '%' + s(p.get('q'), 60) + '%'; w.push('(n.body LIKE ? OR n.title LIKE ? OR n.quote LIKE ?)'); b.push(l, l, l); }
  if (p.get('mine') && u) add('n.user_id=?', u.id);
  if (p.get('parent')) add('n.parent_id=?', int(p.get('parent'))); else w.push('n.parent_id IS NULL');
  if (p.get('answered') === '1') w.push("(n.kind='question' AND EXISTS(SELECT 1 FROM notes a WHERE a.parent_id=n.id AND a.kind='answer'))");
  if (p.get('answered') === '0') w.push("(n.kind='question' AND NOT EXISTS(SELECT 1 FROM notes a WHERE a.parent_id=n.id AND a.kind='answer'))");
  const order = { votes: 'n.score DESC,n.created DESC', new: 'n.created DESC', long: 'LENGTH(n.body) DESC', idx: 'n.idx,n.ws,n.created' }[p.get('sort')] || 'n.score DESC,n.created DESC';
  const rows = await env.DB.prepare(`SELECT n.id,n.user_id,n.work,n.sec,n.idx,n.ws,n.we,n.quote,n.kind,n.parent_id,n.title,n.body,n.visibility,n.tags,n.level,n.score,n.accepted,n.created,us.name author,
    (SELECT COUNT(*) FROM notes c WHERE c.parent_id=n.id) replies,
    (SELECT COUNT(*) FROM notes a WHERE a.parent_id=n.id AND a.kind='answer') answers,
    (SELECT COUNT(*) FROM dupflags d WHERE d.note_id=n.id) dups,
    ${u ? '(SELECT v FROM votes WHERE note_id=n.id AND user_id=' + u.id + ')' : 'NULL'} myvote
    FROM notes n JOIN users us ON us.id=n.user_id WHERE ${w.join(' AND ')} ORDER BY ${order} LIMIT ${Math.min(int(p.get('limit')) || 100, 200)}`).bind(...b).all();
  const ids = rows.results.map(r => r.id);
  let links = [];
  if (ids.length) links = (await env.DB.prepare(`SELECT note_id,work,sec,idx FROM note_links WHERE note_id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all()).results;
  return json({ notes: rows.results.map(r => ({ ...r, links: links.filter(l => l.note_id === r.id) })) });
});
R('POST', '/api/notes', async ({ req, env, u }) => {
  if (!u) return err('Login required', 401);
  const b = await req.json();
  if (!WORKS[b.work] || !b.sec) return err('bad ref');
  const kind = KINDS.includes(b.kind) ? b.kind : 'note', vis = VIS.includes(b.visibility) ? b.visibility : 'public';
  const body = s(b.body, 8000).trim(); if (body.length < 2) return err('Write something');
  let parent = int(b.parent_id), work = b.work, sec = s(b.sec, 8), idx = int(b.idx) ?? 0, groupId = null;
  if (parent) {
    const p = await env.DB.prepare('SELECT work,sec,idx,visibility,group_id FROM notes WHERE id=?').bind(parent).first();
    if (!p) return err('parent missing', 404); ({ work, sec, idx } = p); if (b.kind !== 'comment') b.kind = 'answer';
  }
  if (vis === 'group') {
    groupId = int(b.group_id); if (!groupId || !(await env.DB.prepare('SELECT 1 FROM memberships WHERE group_id=? AND user_id=?').bind(groupId, u.id).first())) return err('Choose one of your groups');
  }
  let tags = normTags(b.tags), aiUsed = false;
  if (!parent && body.length > 20) { const a = await aiTags(env, (b.title || '') + '\n' + body); tags = normTags([...tags, ...a.tags]); aiUsed = a.ai; }
  const r = await env.DB.prepare('INSERT INTO notes(user_id,work,sec,idx,ws,we,quote,kind,parent_id,title,body,visibility,group_id,tags,level,created) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .bind(u.id, work, sec, idx, int(b.ws), int(b.we), s(b.quote, 400), parent ? (b.kind === 'comment' ? 'comment' : 'answer') : kind, parent, s(b.title, 200), body, vis, groupId, tags.join(','), u.level, now()).run();
  const id = r.meta.last_row_id;
  for (const l of (Array.isArray(b.links) ? b.links : []).slice(0, 8))
    if (WORKS[l.work] && l.sec) await env.DB.prepare('INSERT INTO note_links(note_id,work,sec,idx) VALUES(?,?,?,?)').bind(id, l.work, s(l.sec, 8), int(l.idx) ?? 0).run();
  return json({ id, tags, aiTagged: aiUsed });
});
R('POST', '/api/notes/:id/vote', async ({ req, env, u, params }) => {
  if (!u) return err('Login required', 401);
  const id = int(params.id), v = int((await req.json()).v);
  const n = await env.DB.prepare('SELECT user_id FROM notes WHERE id=?').bind(id).first();
  if (!n) return err('missing', 404); if (n.user_id === u.id) return err("You can't vote on your own note");
  if (![1, -1, 0].includes(v)) return err('bad vote');
  if (v === 0) await env.DB.prepare('DELETE FROM votes WHERE note_id=? AND user_id=?').bind(id, u.id).run();
  else await env.DB.prepare('INSERT INTO votes(note_id,user_id,v) VALUES(?,?,?) ON CONFLICT(note_id,user_id) DO UPDATE SET v=excluded.v').bind(id, u.id, v).run();
  await env.DB.prepare('UPDATE notes SET score=(SELECT COALESCE(SUM(v),0) FROM votes WHERE note_id=?) WHERE id=?').bind(id, id).run();
  return json({ score: (await env.DB.prepare('SELECT score FROM notes WHERE id=?').bind(id).first()).score });
});
R('POST', '/api/notes/:id/accept', async ({ env, u, params }) => {
  if (!u) return err('Login required', 401);
  const a = await env.DB.prepare('SELECT parent_id FROM notes WHERE id=? AND kind=?').bind(int(params.id), 'answer').first();
  if (!a) return err('missing', 404);
  const q = await env.DB.prepare('SELECT user_id FROM notes WHERE id=?').bind(a.parent_id).first();
  if (!q || q.user_id !== u.id) return err('Only the asker can accept', 403);
  await env.DB.batch([env.DB.prepare('UPDATE notes SET accepted=0 WHERE parent_id=?').bind(a.parent_id), env.DB.prepare('UPDATE notes SET accepted=1 WHERE id=?').bind(int(params.id))]);
  return json({ ok: 1 });
});
R('POST', '/api/notes/:id/dup', async ({ req, env, u, params }) => {
  if (!u) return err('Login required', 401); const of = int((await req.json()).of);
  if (!of || of === int(params.id) || !(await env.DB.prepare("SELECT 1 FROM notes WHERE id=? AND kind='question'").bind(of).first())) return err('Give the id of the original question');
  await env.DB.prepare('INSERT OR REPLACE INTO dupflags(note_id,user_id,of_id) VALUES(?,?,?)').bind(int(params.id), u.id, of).run(); return json({ ok: 1 });
});
R('POST', '/api/notes/:id/delete', async ({ env, u, params }) => {
  if (!u) return err('Login required', 401); const id = int(params.id);
  const n = await env.DB.prepare('SELECT user_id FROM notes WHERE id=?').bind(id).first();
  if (!n || n.user_id !== u.id) return err('Not yours', 403);
  await env.DB.batch(['DELETE FROM notes WHERE id=? OR parent_id=?', 'DELETE FROM note_links WHERE note_id=?', 'DELETE FROM votes WHERE note_id=?'].map((q, i) => env.DB.prepare(q).bind(...(i ? [id] : [id, id]))));
  return json({ ok: 1 });
});
R('GET', '/api/facets', async ({ env, u }) => {
  const g = await groupIds(env, u), v = visSql(u, g);
  const [a, l, t] = await Promise.all([
    env.DB.prepare(`SELECT us.name,COUNT(*) c FROM notes n JOIN users us ON us.id=n.user_id WHERE ${v.sql} GROUP BY us.name ORDER BY c DESC LIMIT 50`).bind(...v.binds).all(),
    env.DB.prepare(`SELECT n.level,COUNT(*) c FROM notes n WHERE ${v.sql} GROUP BY n.level`).bind(...v.binds).all(),
    env.DB.prepare(`SELECT n.tags FROM notes n WHERE ${v.sql} AND n.tags!='' ORDER BY n.created DESC LIMIT 300`).bind(...v.binds).all()]);
  const tc = {}; for (const r of t.results) for (const x of r.tags.split(',')) tc[x] = (tc[x] || 0) + 1;
  return json({ authors: a.results, levels: l.results, tags: Object.entries(tc).sort((x, y) => y[1] - x[1]).slice(0, 40).map(([tag, c]) => ({ tag, c })) });
});

// ---- groups
R('GET', '/api/groups', async ({ env, u }) => {
  if (!u) return json({ groups: [] });
  return json({ groups: (await env.DB.prepare('SELECT g.id,g.name,g.code FROM groups g JOIN memberships m ON m.group_id=g.id WHERE m.user_id=?').bind(u.id).all()).results });
});
R('POST', '/api/groups', async ({ req, env, u }) => {
  if (!u) return err('Login required', 401); const name = s((await req.json()).name, 40).trim(); if (name.length < 2) return err('Name too short');
  const code = rnd(4); const r = await env.DB.prepare('INSERT INTO groups(name,code,owner) VALUES(?,?,?)').bind(name, code, u.id).run();
  await env.DB.prepare('INSERT INTO memberships(group_id,user_id) VALUES(?,?)').bind(r.meta.last_row_id, u.id).run(); return json({ id: r.meta.last_row_id, code });
});
R('POST', '/api/groups/join', async ({ req, env, u }) => {
  if (!u) return err('Login required', 401); const g = await env.DB.prepare('SELECT id,name FROM groups WHERE code=?').bind(s((await req.json()).code, 20).trim().toLowerCase()).first();
  if (!g) return err('No such group code', 404); await env.DB.prepare('INSERT OR IGNORE INTO memberships(group_id,user_id) VALUES(?,?)').bind(g.id, u.id).run(); return json({ group: g });
});

// ---- chavrusa
R('GET', '/api/chavrusa', async ({ url, env }) => {
  const t = url.searchParams.get('topic');
  const w = ["c.status='open'"], b = []; if (t) { w.push('(c.topic LIKE ? OR c.ref_label LIKE ? OR c.details LIKE ?)'); b.push(...Array(3).fill('%' + s(t, 40) + '%')); }
  const rows = await env.DB.prepare(`SELECT c.id,c.topic,c.ref_label,c.when_text,c.tz,c.lang,c.level_wanted,c.details,c.link,c.created,us.name author,us.level,(SELECT COUNT(*) FROM responses r WHERE r.chav_id=c.id) responses FROM chavrusa c JOIN users us ON us.id=c.user_id WHERE ${w.join(' AND ')} ORDER BY c.created DESC LIMIT 100`).bind(...b).all();
  return json({ posts: rows.results });
});
R('POST', '/api/chavrusa', async ({ req, env, u }) => {
  if (!u) return err('Login required', 401); const b = await req.json();
  const topic = s(b.topic, 100).trim(), when = s(b.when_text, 100).trim(); if (!topic || !when) return err('Topic and time required');
  const r = await env.DB.prepare('INSERT INTO chavrusa(user_id,topic,ref_label,when_text,tz,lang,level_wanted,details,link,created) VALUES(?,?,?,?,?,?,?,?,?,?)')
    .bind(u.id, topic, s(b.ref_label, 100), when, s(b.tz, 40), s(b.lang, 20), s(b.level_wanted, 20), s(b.details, 1000), '', now()).run();
  const id = r.meta.last_row_id;
  await env.DB.prepare('UPDATE chavrusa SET link=? WHERE id=?').bind('https://meet.jit.si/TorahWorld-' + id + '-' + rnd(3), id).run();
  return json({ id });
});
R('POST', '/api/chavrusa/:id/respond', async ({ req, env, u, params }) => {
  if (!u) return err('Login required', 401); const m = s((await req.json()).message, 500).trim(); if (!m) return err('Write a message');
  const c = await env.DB.prepare('SELECT user_id FROM chavrusa WHERE id=?').bind(int(params.id)).first(); if (!c) return err('missing', 404);
  if (c.user_id === u.id) return err("That's your own post");
  await env.DB.prepare('INSERT INTO responses(chav_id,user_id,message,created) VALUES(?,?,?,?)').bind(int(params.id), u.id, m, now()).run(); return json({ ok: 1 });
});
R('POST', '/api/chavrusa/:id/close', async ({ env, u, params }) => {
  if (!u) return err('Login required', 401);
  await env.DB.prepare("UPDATE chavrusa SET status='closed' WHERE id=? AND user_id=?").bind(int(params.id), u.id).run(); return json({ ok: 1 });
});
R('GET', '/api/inbox', async ({ env, u }) => {
  if (!u) return json({ mine: [], sent: [] });
  const mine = await env.DB.prepare('SELECT r.id,r.message,r.created,us.name,us.level,c.id chav_id,c.topic,c.link FROM responses r JOIN chavrusa c ON c.id=r.chav_id JOIN users us ON us.id=r.user_id WHERE c.user_id=? ORDER BY r.created DESC LIMIT 50').bind(u.id).all();
  const sent = await env.DB.prepare('SELECT r.id,r.message,r.created,c.id chav_id,c.topic,c.link FROM responses r JOIN chavrusa c ON c.id=r.chav_id WHERE r.user_id=? ORDER BY r.created DESC LIMIT 50').bind(u.id).all();
  return json({ mine: mine.results, sent: sent.results });
});

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (!url.pathname.startsWith('/api/')) {
      const a = ASSETS[url.pathname] || ASSETS['/index.html'];
      const font = url.pathname.startsWith('/fonts/');
      let body = a.body;
      if (a.b64) { bin[url.pathname] = bin[url.pathname] || Uint8Array.from(atob(a.b64), c => c.charCodeAt(0)); body = bin[url.pathname]; }
      return new Response(body, { headers: { 'content-type': a.type, 'cache-control': font ? 'public, max-age=31536000, immutable' : 'no-cache' } });
    }
    try {
      const u = await me(req, env);
      for (const [m, re, f] of routes) {
        if (m !== req.method) continue;
        const mt = re.exec(url.pathname);
        if (mt) {
          if (m === 'POST' && req.headers.get('origin') && new URL(req.headers.get('origin')).host !== url.host) return err('bad origin', 403);
          return await f({ req, env, url, u, params: mt.groups || {} });
        }
      }
      return err('not found', 404);
    } catch (e) { return err('Server error: ' + (e.message || e), 500); }
  }
};
