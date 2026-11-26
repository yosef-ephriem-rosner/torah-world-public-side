'use strict';
// ---------- helpers
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const h = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
async function api(path, opt = {}) {
  const o = { method: opt.body ? 'POST' : 'GET', headers: { 'content-type': 'application/json' }, credentials: 'same-origin', ...opt };
  if (opt.body && typeof opt.body !== 'string') o.body = JSON.stringify(opt.body);
  const r = await fetch('/api' + path, o); const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || r.statusText); return j;
}
function toast(m) { const t = $('#toast'); t.textContent = m; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, 3200); }
const GEM = ['', 'א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט'], TENS = ['', 'י', 'כ', 'ל', 'מ', 'נ', 'ס', 'ע', 'פ', 'צ'];
function gem(n) { if (n === 15) return 'טו'; if (n === 16) return 'טז'; let s = ''; if (n >= 100) { s += ['', 'ק', 'ר', 'ש', 'ת'][Math.floor(n / 100)]; n %= 100; if (n === 15) return s + 'טו'; if (n === 16) return s + 'טז'; } return s + TENS[Math.floor(n / 10)] + GEM[n % 10]; }
// ---------- i18n
const I = {
  en: { learn: 'Learn', tanach: 'Tanach', mishna: 'Mishna', gemara: 'Gemara', chavrusa: 'Chavrusa', search: 'Search', login: 'Log in', logout: 'Log out', commentary: 'Commentary', links: 'Links', notes: 'Notes & Q&A', addnote: 'Add note / question', add: 'Post', cancel: 'Cancel', answer: 'Answer', comment: 'Comment', accept: 'Accept', dup: 'Duplicate?', del: 'Delete', verse: 'Verse', seg: 'Segment' },
  he: { learn: 'לימוד', tanach: 'תנ״ך', mishna: 'משנה', gemara: 'גמרא', chavrusa: 'חברותא', search: 'חיפוש', login: 'התחברות', logout: 'התנתקות', commentary: 'מפרשים', links: 'קישורים', notes: 'הערות ושאלות', addnote: 'הוסף הערה / שאלה', add: 'פרסם', cancel: 'ביטול', answer: 'תשובה', comment: 'תגובה', accept: 'קבל', dup: 'כפילות?', del: 'מחק', verse: 'פסוק', seg: 'קטע' }
};
let lang = localStorage.lang || 'en';
const t = k => I[lang][k] || I.en[k] || k;
function applyLang() { document.documentElement.lang = lang; document.documentElement.dir = lang === 'he' ? 'rtl' : 'ltr'; $$('[data-t]').forEach(e => e.textContent = t(e.dataset.t)); $$('[data-ph]').forEach(e => e.placeholder = t(e.dataset.ph)); }
$('#lang').onclick = () => { lang = lang === 'en' ? 'he' : 'en'; localStorage.lang = lang; applyLang(); renderWho(); route(); };
// ---------- works
const WORKS = {
  shemos: { he: 'שמות', en: 'Shemos', kind: 'chapter', secs: Array.from({ length: 40 }, (_, i) => String(i + 1)), unit: 'פסוק', label: s => 'פרק ' + gem(+s), lab2: s => 'Chapter ' + s, num: i => gem(i), who: ['Rashi', 'Onkelos', 'Ibn Ezra', 'Ramban', 'Rashbam', 'Sforno', 'Or HaChaim'] },
  mishnah: { he: 'משנה ברכות', en: 'Mishnah Berakhos', kind: 'chapter', secs: Array.from({ length: 9 }, (_, i) => String(i + 1)), unit: 'משנה', label: s => 'פרק ' + gem(+s), lab2: s => 'Chapter ' + s, num: i => gem(i), who: ['Bartenura', 'Rambam', 'Tosafot Yom Tov', 'Ikar Tosafot Yom Tov'] },
  gemara: { he: 'גמרא ברכות', en: 'Gemara Berakhos', kind: 'daf', secs: (() => { const a = []; for (let n = 2; n <= 64; n++) { a.push(n + 'a'); if (n < 64) a.push(n + 'b'); } return a; })(), unit: 'שורה', label: s => 'דף ' + gem(parseInt(s)) + (s.endsWith('a') ? ' ע״א' : ' ע״ב'), lab2: s => 'Daf ' + s, num: i => i, who: ['Rashi', 'Tosafot', 'Rashba', 'Ritva', 'Meiri'] }
};
const HEWHO = { Rashi: 'רש״י', Onkelos: 'אונקלוס', 'Ibn Ezra': 'אבן עזרא', Ramban: 'רמב״ן', Rashbam: 'רשב״ם', Sforno: 'ספורנו', 'Or HaChaim': 'אור החיים', Bartenura: 'ברטנורא', Rambam: 'רמב״ם', 'Tosafot Yom Tov': 'תוספות יום טוב', 'Ikar Tosafot Yom Tov': 'עיקר תוספות יום טוב', Tosafot: 'תוספות', Rashba: 'רשב״א', Ritva: 'ריטב״א', Meiri: 'מאירי' };
const LEVELS = { student: 'Student', working_man: 'Working man (baal habayis)', avreich: 'Avreich / kollel', talmid_chacham: 'Talmid chacham', rav: 'Rav / posek', rosh_yeshiva: 'Rosh yeshiva' };
const PROS = ['avreich', 'rav', 'talmid_chacham', 'rosh_yeshiva'];
const secLabel = (w, s) => WORKS[w].he + ' · ' + WORKS[w].label(s);
const ago = ts => { const d = Math.floor(Date.now() / 1000) - ts; return d < 60 ? 'now' : d < 3600 ? Math.floor(d / 60) + 'm' : d < 86400 ? Math.floor(d / 3600) + 'h' : Math.floor(d / 86400) + 'd'; };
// ---------- auth
let ME = null;
async function loadMe() { try { ME = (await api('/me')).user; } catch { ME = null; } renderWho(); }
function renderWho() {
  const w = $('#who');
  w.innerHTML = ME ? `<a href="#/me">${esc(ME.name)}</a> <span class="pill">${esc(LEVELS[ME.level] || ME.level)}</span> <button class="ghost sm" id="lo">${t('logout')}</button>` : `<button id="li">${t('login')}</button>`;
  if (ME) $('#lo').onclick = async () => { await api('/logout', { method: 'POST', body: {} }); ME = null; renderWho(); route(); };
  else $('#li').onclick = () => authModal();
}
function modal(html, onclose) {
  const m = $('#modal'); m.innerHTML = '<div class="dlg">' + html + '</div>'; m.hidden = false;
  m.onmousedown = e => { if (e.target === m) closeModal(); }; m._onclose = onclose; return m.firstElementChild;
}
function closeModal() { const m = $('#modal'); m.hidden = true; m.innerHTML = ''; }
function authModal(msg) {
  return new Promise(res => {
    const d = modal(`<h3>${t('login')} / Register</h3>${msg ? `<p class="err">${esc(msg)}</p>` : ''}
    <div class="row"><label>Name</label><input id="an" autocomplete="username" maxlength="30"></div>
    <div class="row"><label>Passcode</label><input id="ap" type="password" autocomplete="current-password" placeholder="min 6 characters"></div>
    <div class="row"><label>My level</label><select id="al">${Object.entries(LEVELS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
    <p class="mut" style="font-size:12px">Level is self-declared (used for labels and "professionals only" notes). New here? Fill all and press Register.</p>
    <div class="row"><button id="alogin">${t('login')}</button><button id="areg" class="ghost">Register</button><span id="aerr" class="err"></span></div>`);
    const go = async (path) => {
      try { const j = await api(path, { body: { name: $('#an', d).value, pin: $('#ap', d).value, level: $('#al', d).value } }); ME = j.user; closeModal(); renderWho(); route(); res(true); }
      catch (e) { $('#aerr', d).textContent = e.message; }
    };
    $('#alogin', d).onclick = () => go('/login'); $('#areg', d).onclick = () => go('/register');
  });
}
async function needLogin() { if (ME) return true; await authModal('Please log in to do that.'); return !!ME; }
// ---------- text rendering
function wrapWords(html, start = 0) {
  const div = document.createElement('div'); div.innerHTML = html; let n = start;
  const walk = document.createTreeWalker(div, NodeFilter.SHOW_TEXT), nodes = []; while (walk.nextNode()) nodes.push(walk.currentNode);
  for (const tn of nodes) {
    const frag = document.createDocumentFragment();
    for (const part of tn.nodeValue.split(/(\s+)/)) {
      if (!part) continue;
      if (/^\s+$/.test(part)) { frag.append(' '); continue; }
      const sp = document.createElement('span'); sp.className = 'w'; sp.dataset.w = n++;
      if (part === '{פ}' || part === '{ס}') { sp.className = 'w ' + (part === '{פ}' ? 'pet' : 'set'); sp.textContent = part[1]; } else sp.textContent = part;
      frag.append(sp);
    }
    tn.replaceWith(frag);
  }
  return { html: div.innerHTML, next: n };
}

// ---------- dibur hamatchil (opening words) in bold, validated against the base text
const DH_WHO = new Set(['Rashi', 'Tosafot', 'Rashbam', 'Ibn Ezra', 'Or HaChaim', 'Sforno', 'Bartenura', 'Ikar Tosafot Yom Tov', 'Tosafot Yom Tov', 'Rashba', 'Ritva']);
const hnorm = s => s.replace(/<[^>]+>/g, ' ').replace(/[֑-ׇ]/g, '').replace(/[־]/g, ' ').replace(/[׳״'"“”‘’.,;:!?()\[\]{}–—-]/g, ' ').replace(/\s+/g, ' ').trim();
const stripPre = w => w.replace(/^[ובהלכמש]{1,2}(?=.{3,})/, '');
function baseWords() {
  if (S._bw) return S._bw;
  const set = new Set(); S.data.segments.forEach(sg => hnorm(sg.he).split(' ').forEach(w => { if (w) { set.add(w); set.add(stripPre(w)); } }));
  return S._bw = set;
}
function dhMatch(dhWords, base) {
  let ok = 0, n = 0;
  for (const w of dhWords) {
    if (w === 'וכו' || w === 'וגו' || w === 'כו') continue; n++;
    if (base.has(w) || base.has(stripPre(w))) ok++;
  }
  return n > 0 && ok / n >= 0.6;
}
function dhBold(html, who) {
  if (!DH_WHO.has(who) || /<b[ >]/i.test(html.slice(0, 200))) return html;
  const m = html.match(/^(\s*(?:\([^)]{1,4}\)\s*)?)([^<]{2,160}?)(\s[–—-]\s|[.:](?=\s|$))/);
  if (!m) return html;
  const words = hnorm(m[2]).split(' ').filter(Boolean);
  if (!words.length || words.length > 12 || !dhMatch(words, baseWords())) return html;
  return m[1] + '<b class="dh">' + m[2] + '</b>' + html.slice(m[1].length + m[2].length);
}

// ---------- router
const app = $('#app');
function route() {
  const hash = location.hash.replace(/^#\/?/, ''), [path, qs] = hash.split('?'), p = path.split('/');
  window.scrollTo(0, 0);
  if (p[0] === 'read') return readPage(p[1], decodeURIComponent(p[2] || ''), p[3] ? +p[3] : null);
  if (p[0] === 'chavrusa') return chavrusaPage();
  if (p[0] === 'search') return searchPage(new URLSearchParams(qs).get('q') || '');
  if (p[0] === 'me') return mePage();
  return home();
}
window.addEventListener('hashchange', route);
$('#sform').onsubmit = e => { e.preventDefault(); const q = $('#sq').value.trim(); if (q) location.hash = '#/search?q=' + encodeURIComponent(q); };
function home() {
  app.innerHTML = `<div class="hero"><h1>עולם התורה</h1><p class="mut">Learn the text. Add your notes and questions right on the words. See the mefarshim and links beside it.</p></div>
  <div class="grid">${Object.entries(WORKS).map(([k, w]) => `<a class="card tile" href="#/read/${k}/${w.secs[0]}"><b>${w.he}</b><div class="mut">${w.en}</div><div class="mut" style="font-size:13px">${w.who.map(x => HEWHO[x]).join(' · ')}</div></a>`).join('')}
  <a class="card tile" href="#/chavrusa"><b>חברותא</b><div class="mut">Find a learning partner — now or scheduled</div></a></div>
  <div class="card mut" style="font-size:13px"><b>How it works.</b> Click any verse/line to open its mefarshim, cross-references and the community notes. Select words to attach a note or a question to exactly those words. Notes can be private, public, professionals-only, or group-only. Anyone can answer, comment and vote.</div>`;
}
// ---------- reader
let S = null; // reader state
let navId = 0;
async function readPage(work, sec, sel) {
  const my = ++navId, W = WORKS[work]; if (!W) return home();
  if (!sec || !W.secs.includes(sec)) sec = W.secs[0];
  app.innerHTML = '<p class="mut">Loading…</p>';
  let data; try { data = await api(`/section?work=${work}&sec=${encodeURIComponent(sec)}`); } catch (e) { if (my === navId) app.innerHTML = '<p class="err">' + esc(e.message) + '</p>'; return; }
  if (my !== navId) return;
  const i = W.secs.indexOf(sec);
  S = { work, sec, W, data, sel: null, tab: 'commentary', notes: [], layers: { mk: true, hl: true } };
  app.innerHTML = `<div class="bar"><h2 class="he">${secLabel(work, sec)}</h2>
    <button class="ghost sm" id="prev" ${i ? '' : 'disabled'}>◀</button>
    <select id="secsel">${W.secs.map(s => `<option value="${s}" ${s === sec ? 'selected' : ''}>${W.label(s)} (${W.lab2(s)})</option>`).join('')}</select>
    <button class="ghost sm" id="next" ${i < W.secs.length - 1 ? '' : 'disabled'}>▶</button>
    <label><input type="checkbox" id="lmk" checked> markers</label><label><input type="checkbox" id="lhl" checked> highlights</label>
    <label><input type="checkbox" id="lsb" checked> sidebar</label>${work === 'shemos' ? `<label><input type="checkbox" id="ltg" ${localStorage.targum === '1' ? 'checked' : ''}> תרגום אונקלוס</label>` : ''}${work === 'gemara' ? `<select id="dview"><option value="page" ${localStorage.dafView !== 'live' ? 'selected' : ''}>צורת הדף · Page view</option><option value="live" ${localStorage.dafView === 'live' ? 'selected' : ''}>Live layout</option></select>` : ''}${work !== 'shemos' || true ? `<label><input type="checkbox" id="lnk" ${localStorage.nikud === '1' ? 'checked' : ''}> ניקוד</label>` : ''}</div>
    <div class="reader" id="rd"><div><div class="card" id="text"></div></div><div class="card" id="side"></div></div>`;
  $('#prev').onclick = () => location.hash = `#/read/${work}/${W.secs[i - 1]}`;
  $('#next').onclick = () => location.hash = `#/read/${work}/${W.secs[i + 1]}`;
  $('#secsel').onchange = e => location.hash = `#/read/${work}/${e.target.value}`;
  $('#lmk').onchange = e => $('#text').classList.toggle('hidemk', !e.target.checked);
  $('#lhl').onchange = e => $('#text').classList.toggle('hidehl', !e.target.checked);
  $('#lsb').onchange = e => { $('#rd').classList.toggle('nosb', !e.target.checked); if (work === 'gemara') renderText(); };
  if ($('#ltg')) $('#ltg').onchange = e => { localStorage.targum = e.target.checked ? '1' : '0'; renderText(); };
  if ($('#dview')) $('#dview').onchange = e => { localStorage.dafView = e.target.value; renderText().then(paintHighlights); };
  $('#lnk').onchange = e => { localStorage.nikud = e.target.checked ? '1' : '0'; renderText().then(paintHighlights); };
  await renderText();
  if (my !== navId) return;
  await loadSectionNotes();
  if (my !== navId) return;
  selectSeg(sel || null);
}
function counts() {
  const { data } = S, nc = {}, cc = {}; data.noteCounts.forEach(n => nc[n.idx] = n.c); data.comments.forEach(c => cc[c.idx] = (cc[c.idx] || 0) + 1); return { nc, cc };
}
const star = (nc, idx) => nc[idx] ? `<sup class="mk n" title="${nc[idx]} notes">★${nc[idx]}</sup>` : '';
function segHTML(sg, num, nc, lead) {
  const w = wrapWords(sg.he, 0);
  return `<span class="sg" data-idx="${sg.idx}">${lead || ''}${num ? `<sup class="vn">${num}</sup>` : ''}${w.html}${star(nc, sg.idx)}</span> `;
}
async function renderText() {
  const box = $('#text'); box.innerHTML = ''; box.className = 'card page ' + S.work;
  const { nc } = counts();
  if (S.work === 'gemara') await renderDaf(box, nc);
  else if (S.work === 'shemos') renderChumash(box, nc);
  else box.innerHTML = S.data.segments.map(sg => `<p class="mish">${segHTML(sg, '', nc, `<b class="mnum">${gem(sg.idx)}.</b> `)}</p>`).join('');
  box.onmouseup = onSelect;
  box.onclick = e => {
    if (getSelection().toString().trim()) return;
    const hl = e.target.closest('.w.hl'), cs = e.target.closest('.cs'), sg = e.target.closest('.sg');
    if (hl && sg) return selectSeg(+sg.dataset.idx, 'notes');
    if (cs) return selectSeg(+cs.dataset.idx, 'commentary', cs.dataset.who);
    if (sg) selectSeg(+sg.dataset.idx);
  };
  paintHighlights();
}
function renderChumash(box, nc) {
  const { data, W } = S, tg = localStorage.targum === '1';
  const al = {}; (data.align || []).forEach(a => { try { al[a.idx] = JSON.parse(a.pairs); } catch { } });
  const on = {}; data.comments.filter(c => c.who === 'Onkelos').forEach(c => on[c.idx] = (on[c.idx] ? on[c.idx] + ' ' : '') + c.he);
  let html = '<div class="flow">';
  for (const sg of data.segments) {
    if (!tg) { html += segHTML(sg, W.num(sg.idx), nc); continue; }
    const pairs = al[sg.idx] || [[sg.he, on[sg.idx] || '']];
    let n = 0, inner = '';
    for (const [he, ar] of pairs) { const w = wrapWords(he, n); n = w.next; inner += `<span class="pair"><span class="phe">${w.html}</span><span class="par">${ar}</span></span> `; }
    html += `<span class="sg" data-idx="${sg.idx}"><sup class="vn">${W.num(sg.idx)}</sup>${inner}${star(nc, sg.idx)}</span> `;
  }
  box.innerHTML = html + '</div>';
}
const PAGE_W = 1000; // design width of the tzuras hadaf; layout numbers are stored for this size and scaled proportionally to the screen
const PAGE_MIN = 0.62; // below this the page scrolls sideways instead of shrinking further
const NIK = /[֑-ׇ]/g;
async function renderDaf(box, nc) {
  const { data, sec } = S, amud = sec.endsWith('a') ? 'a' : 'b';
  const nikud = localStorage.nikud === '1', view = localStorage.dafView === 'live' ? 'live' : 'page';
  const strip = s => nikud ? s : s.replace(NIK, '');
  const main = data.segments.map(sg => segHTML({ idx: sg.idx, he: strip(sg.he) }, '', nc)).join('');
  const side = who => data.comments.filter(c => c.who === who).map(c => `<span class="cs" data-idx="${c.idx}" data-who="${who}">${dhBold(strip(c.he), who)}</span>`).join(' ');
  box.insertAdjacentHTML('afterbegin', `<div class="mut dafkey" style="text-align:center;font-size:12px">${view === 'page' ? 'צורת הדף' : 'Live layout'} · רש״י (פנים) · תוספות (חוץ) — click any part for notes &amp; the full commentary</div>`);
  const holder = document.createElement('div'); holder.id = 'daf';
  const wrap = document.createElement('div'); wrap.className = 'pagewrap'; wrap.append(holder); box.append(wrap);
  const fixed = view === 'page', avail = box.clientWidth - 12;
  const s = window.__PRECOMPUTE ? 1 : (fixed ? Math.max(PAGE_MIN, Math.min(1.15, avail / PAGE_W)) : 1);
  const width = fixed ? Math.round(PAGE_W * s) : Math.max(520, Math.min(960, box.clientWidth - 30));
  const stored = fixed && !window.__PRECOMPUTE && window.DAF_LAYOUTS ? window.DAF_LAYOUTS[sec + '|' + (nikud ? 1 : 0)] : null;
  const k = fixed ? s : 1, px = v => (v * k) + 'px';
  const opts = {
    contentWidth: width + 'px', mainWidth: '46%', padding: { vertical: px(8), horizontal: px(14) }, innerPadding: px(4), outerPadding: px(4),
    fontFamily: { main: '"Frank Ruhl Libre",serif', inner: '"Noto Rashi Hebrew","Frank Ruhl Libre",serif', outer: '"Noto Rashi Hebrew","Frank Ruhl Libre",serif' },
    fontSize: { main: px(19), side: px(13) }, lineHeight: { main: px(27), side: px(17) }
  };
  if (stored) opts.preSpacers = { start: stored.start * k, inner: stored.inner * k, outer: stored.outer * k, end: stored.end * k, exception: stored.exception };
  const r = dafRenderer(holder, opts);
  try { await document.fonts.load('19px "Frank Ruhl Libre"'); await document.fonts.load('700 19px "Frank Ruhl Libre"'); await document.fonts.load('13px "Noto Rashi Hebrew"'); await document.fonts.ready; } catch { }
  if (!holder.isConnected) return;
  r.render(main, side('Rashi'), side('Tosafot'), amud);
  window.__lastDaf = r;
  if (fixed) { wrap.classList.add('fixedpage'); S.fitW = avail; }
  window.__dafDone = { sec, nikud, view, spacers: r.spacerHeights, height: holder.offsetHeight, stored: !!stored, scale: k };
}
if (!window.__fitBound) {
  window.__fitBound = 1; let tm;
  window.addEventListener('resize', () => { clearTimeout(tm); tm = setTimeout(() => { if (S && S.work === 'gemara' && S.fitW && $('#daf') && Math.abs(($('#text').clientWidth - 12) - S.fitW) > 24) renderText().then(paintHighlights); }, 250); });
}
function paintHighlights() {
  $$('.w.hl').forEach(w => { w.classList.remove('hl', 'me'); w.removeAttribute('title'); });
  for (const n of S.notes) {
    if (n.ws == null || n.we == null || n.work !== S.work || n.sec !== S.sec) continue;
    const seg = $(`.sg[data-idx="${n.idx}"]`); if (!seg) continue;
    for (let k = n.ws; k <= n.we; k++) { const w = $(`.w[data-w="${k}"]`, seg); if (w) { w.classList.add('hl'); if (ME && n.user_id === ME.id) w.classList.add('me'); w.title = (n.title || n.body).slice(0, 80) + ' — ' + n.author; } }
  }
}
async function loadSectionNotes() {
  try { S.notes = (await api(`/notes?work=${S.work}&sec=${encodeURIComponent(S.sec)}&limit=200`)).notes; } catch { S.notes = []; }
  paintHighlights();
}
let selBtn = null;
function onSelect() {
  if (selBtn) { selBtn.remove(); selBtn = null; }
  const sel = getSelection(); if (!sel.rangeCount || sel.isCollapsed) return;
  const rg = sel.getRangeAt(0);
  const sa = $$('.sg').find(g => rg.intersectsNode(g)); if (!sa) return;   // first segment touched by the selection
  const words = $$('.w', sa).filter(w => !w.classList.contains('pet') && !w.classList.contains('set') && rg.intersectsNode(w) && rg.toString().includes(w.textContent.trim().slice(0, 2)));
  if (!words.length) return;
  const ws = +words[0].dataset.w, we = +words[words.length - 1].dataset.w, idx = +sa.dataset.idx;
  const quote = $$('.w', sa).filter(w => +w.dataset.w >= ws && +w.dataset.w <= we).map(w => w.textContent).join(' ');
  const r = sel.getRangeAt(0).getBoundingClientRect();
  selBtn = h(`<button class="selbtn sm">＋ ${t('addnote')}</button>`); selBtn.style.top = (window.scrollY + r.bottom + 6) + 'px'; selBtn.style.left = Math.max(8, window.scrollX + r.left) + 'px';
  selBtn.onmousedown = e => e.preventDefault();
  selBtn.onclick = () => { selBtn.remove(); selBtn = null; getSelection().removeAllRanges(); noteModal({ idx, ws, we, quote }); };
  document.body.append(selBtn);
}
document.addEventListener('mousedown', e => { if (selBtn && e.target !== selBtn) { selBtn.remove(); selBtn = null; } });
function selectSeg(idx, tab, who) {
  S.sel = idx; if (tab) S.tab = tab; S.openWho = who || null;
  $$('.sg').forEach(r => r.classList.toggle('sel', +r.dataset.idx === idx));
  if (idx) { const r = $(`.sg[data-idx="${idx}"]`); if (r && !tab) r.scrollIntoView({ block: 'nearest' }); }
  history.replaceState(null, '', `#/read/${S.work}/${S.sec}${idx ? '/' + idx : ''}`);
  renderSide();
}
function renderSide() {
  const { data, sel, W } = S, side = $('#side');
  if (!sel) { side.innerHTML = `<p class="mut">Click a ${t('seg').toLowerCase()} to see its commentary and links. Select words to attach a note to them.</p><h4>${t('notes')} — ${W.label(S.sec)}</h4><div id="nb"></div>`; notesBrowser($('#nb', side), { scope: 'page' }); return; }
  const cm = data.comments.filter(c => c.idx === sel), xr = data.xrefs.filter(x => x.idx === sel);
  side.innerHTML = `<div class="bar"><b class="he">${secLabel(S.work, S.sec)} · ${W.num(sel)}</b><button class="ghost sm" id="clr">✕</button></div>
  <div class="tabs"><button data-tab="commentary" class="${S.tab === 'commentary' ? 'on' : ''}">${t('commentary')} (${cm.length})</button><button data-tab="links" class="${S.tab === 'links' ? 'on' : ''}">${t('links')} (${xr.reduce((a, x) => a + x.items.length, 0)})</button><button data-tab="notes" class="${S.tab === 'notes' ? 'on' : ''}">${t('notes')}</button></div><div id="tb"></div>`;
  $('#clr', side).onclick = () => selectSeg(null);
  $$('.tabs button', side).forEach(b => b.onclick = () => { S.tab = b.dataset.tab; renderSide(); });
  const tb = $('#tb', side);
  if (S.tab === 'commentary') {
    if (!cm.length) tb.innerHTML = '<p class="mut">No imported commentary on this segment.</p>';
    const by = {}; cm.forEach(c => (by[c.who] = by[c.who] || []).push(c));
    for (const who of Object.keys(by).sort((a, b) => W.who.indexOf(a) - W.who.indexOf(b))) {
      const d = h(`<details class="cm" ${(S.openWho ? who === S.openWho : who === W.who[0]) ? 'open' : ''}><summary>${esc(HEWHO[who] || who)} <span class="mut">${esc(who)} · ${by[who].length}</span></summary></details>`);
      by[who].forEach(c => { const x = document.createElement('div'); x.className = 'cmt'; x.innerHTML = dhBold(c.he, who); d.append(x); }); tb.append(d);
    }
  } else if (S.tab === 'links') {
    if (!xr.length) tb.innerHTML = '<p class="mut">No cross-references imported for this segment.</p>';
    tb.insertAdjacentHTML('beforeend', '<p class="mut" style="font-size:12px">Imported from the Sefaria link graph. Opens the source on Sefaria.</p>');
    const order = ['Commentary', 'Talmud', 'Mishnah', 'Tosefta', 'Midrash', 'Halakhah', 'Tanakh', 'Targum', 'Kabbalah', 'Chasidut', 'Musar', 'Jewish Thought', 'Responsa', 'Liturgy'];
    xr.sort((a, b) => (order.indexOf(a.cat) + 1 || 99) - (order.indexOf(b.cat) + 1 || 99)).forEach(x => {
      tb.append(h(`<div><div class="xcat">${esc(x.cat)}</div>${x.items.map(i => `<a class="xi" target="_blank" rel="noopener" href="https://www.sefaria.org/${encodeURIComponent(i.r.replace(/ /g, '_'))}?lang=he" title="${esc(i.r)}">${esc(i.h || i.t)}${i.n > 1 ? ` <span class="mut">×${i.n}</span>` : ''}</a>`).join('')}</div>`));
    });
  } else {
    tb.append(h(`<div class="row"><button id="an">＋ ${t('addnote')}</button></div>`)); $('#an', tb).onclick = () => noteModal({ idx: sel });
    const nb = h('<div></div>'); tb.append(nb); notesBrowser(nb, { scope: 'verse' });
  }
}
// ---------- notes browser (filters + list)
async function notesBrowser(root, init) {
  const f = { scope: init.scope || 'verse', author: '', level: '', kind: '', answered: '', tag: '', q: '', sort: 'votes', mine: '' };
  let facets = { authors: [], levels: [], tags: [] }; try { facets = await api('/facets'); } catch { }
  root.innerHTML = `<div class="filters">
   <select data-f="scope"><option value="verse">This ${S.sel ? 'segment' : 'page'}</option><option value="page">This page</option><option value="work">Whole work</option></select>
   <select data-f="kind"><option value="">All types</option><option value="note">Notes</option><option value="question">Questions</option></select>
   <select data-f="answered"><option value="">Any answer state</option><option value="0">Unanswered</option><option value="1">Answered</option></select>
   <select data-f="level"><option value="">Any level</option>${facets.levels.map(l => `<option value="${l.level}">${esc(LEVELS[l.level] || l.level)} (${l.c})</option>`).join('')}</select>
   <select data-f="author"><option value="">Any author</option>${facets.authors.map(a => `<option>${esc(a.name)}</option>`).join('')}</select>
   <select data-f="tag"><option value="">Any topic</option>${facets.tags.map(a => `<option>${esc(a.tag)}</option>`).join('')}</select>
   <select data-f="sort"><option value="votes">Top voted</option><option value="new">Newest</option><option value="long">Longest</option><option value="idx">By position</option></select>
   <input data-f="q" placeholder="search notes"><label style="font-size:13px"><input type="checkbox" data-f="mine"> mine</label></div><div class="nl"></div>`;
  if (init.scope === 'page' && !S.sel) $('[data-f=scope]', root).value = 'page'; else if (S.sel) $('[data-f=scope]', root).value = 'verse';
  const load = async () => {
    $$('[data-f]', root).forEach(e => f[e.dataset.f] = e.type === 'checkbox' ? (e.checked ? '1' : '') : e.value);
    const p = new URLSearchParams({ work: S.work, sort: f.sort }); if (f.scope !== 'work') p.set('sec', S.sec);
    if (f.scope === 'verse' && S.sel) p.set('idx', S.sel);
    ['author', 'level', 'kind', 'answered', 'tag', 'q', 'mine'].forEach(k => f[k] && p.set(k, f[k]));
    const nl = $('.nl', root); nl.innerHTML = '<p class="mut">…</p>';
    try { const { notes } = await api('/notes?' + p); nl.innerHTML = notes.length ? '' : '<p class="mut">No notes here yet. Be the first!</p>'; notes.forEach(n => nl.append(noteCard(n, { onchange: load }))); }
    catch (e) { nl.innerHTML = '<p class="err">' + esc(e.message) + '</p>'; }
  };
  $$('[data-f]', root).forEach(e => e.onchange = load); $('[data-f=q]', root).oninput = (() => { let tm; return () => { clearTimeout(tm); tm = setTimeout(load, 350); }; })();
  load();
}
function noteCard(n, ctx) {
  const mine = ME && n.user_id === ME.id, isQ = n.kind === 'question';
  const el = h(`<div class="note ${isQ ? 'q' : ''} ${mine ? 'mine' : ''}" id="n${n.id}">
   <div class="meta"><b>${isQ ? '❓ Question' : n.kind === 'answer' ? '✔ Answer' : n.kind === 'comment' ? '💬' : '📝 Note'}</b><span>${esc(n.author)}</span>
   <span class="badge ${PROS.includes(n.level) ? 'pro' : ''}" title="self-declared">${esc(LEVELS[n.level] || n.level)}</span>
   ${n.visibility !== 'public' ? `<span class="badge priv">${esc(n.visibility)}</span>` : ''}<span>${ago(n.created)}</span>${n.accepted ? '<span class="badge pro">accepted ✓</span>' : ''}${n.dups ? `<span class="badge priv">duplicate? ×${n.dups}</span>` : ''}
   ${n.work !== S.work || n.sec !== S.sec ? `<a href="#/read/${n.work}/${n.sec}/${n.idx}">${esc(secLabel(n.work, n.sec))} · ${n.idx}</a>` : ''}</div>
   ${n.title ? `<div><b>${esc(n.title)}</b></div>` : ''}${n.quote ? `<div class="quote">${esc(n.quote)}</div>` : ''}<div class="body-t">${esc(n.body)}</div>
   <div>${(n.tags || '').split(',').filter(Boolean).map(x => `<span class="tag">${esc(x)}</span>`).join('')}</div>
   ${n.links?.length ? `<div class="mut" style="font-size:12px">↔ ${n.links.map(l => `<a href="#/read/${l.work}/${l.sec}/${l.idx}">${esc(WORKS[l.work].he)} ${esc(WORKS[l.work].label(l.sec))}${l.idx ? ' · ' + l.idx : ''}</a>`).join(' · ')}</div>` : ''}
   <div class="acts"><span class="vote"><button data-v="1" class="${n.myvote === 1 ? 'on' : ''}">▲</button><b class="sc">${n.score}</b><button data-v="-1" class="${n.myvote === -1 ? 'on' : ''}">▼</button></span>
   <button class="ghost sm" data-a="reply">${isQ ? t('answer') : t('comment')}</button>
   ${n.replies ? `<button class="ghost sm" data-a="open">${n.replies} ${n.replies === 1 ? 'reply' : 'replies'}</button>` : ''}
   ${isQ ? `<button class="ghost sm" data-a="dup">${t('dup')}</button>` : ''}${n.kind === 'answer' && ctx.asker && !n.accepted ? `<button class="ghost sm" data-a="acc">${t('accept')}</button>` : ''}
   ${mine ? `<button class="ghost sm" data-a="del">${t('del')}</button>` : ''}</div><div class="replies"></div></div>`);
  $$('[data-v]', el).forEach(b => b.onclick = async () => { if (!await needLogin()) return; try { const v = +b.dataset.v; const r = await api(`/notes/${n.id}/vote`, { body: { v: n.myvote === v ? 0 : v } }); ctx.onchange?.(); } catch (e) { toast(e.message); } });
  $$('.tag', el).forEach(tg => tg.onclick = () => { const s = $('[data-f=tag]'); if (s) { if (![...s.options].some(o => o.value === tg.textContent)) s.append(new Option(tg.textContent)); s.value = tg.textContent; s.onchange(); } });
  const open = async () => { const box = $('.replies', el); box.innerHTML = ''; const { notes } = await api('/notes?parent=' + n.id + '&sort=idx&limit=100'); notes.sort((a, b) => (b.accepted - a.accepted) || (b.score - a.score)); notes.forEach(r => box.append(noteCard(r, { onchange: open, asker: mine && isQ }))); };
  el.addEventListener('click', async e => {
    const b = e.target.closest('[data-a]'); if (!b) return; const a = b.dataset.a;
    if (a === 'open') open();
    if (a === 'reply') { if (!await needLogin()) return; replyModal(n, async () => { await open(); ctx.onchange?.(); }); }
    if (a === 'dup') { if (!await needLogin()) return; const of = prompt('Id of the original question (see its #id):'); if (of) try { await api(`/notes/${n.id}/dup`, { body: { of: +of } }); toast('Flagged'); ctx.onchange?.(); } catch (er) { toast(er.message); } }
    if (a === 'acc') try { await api(`/notes/${n.id}/accept`, { body: {} }); ctx.onchange?.(); } catch (er) { toast(er.message); }
    if (a === 'del' && confirm('Delete this note and its replies?')) try { await api(`/notes/${n.id}/delete`, { body: {} }); ctx.onchange?.(); S && loadSectionNotes(); } catch (er) { toast(er.message); }
  });
  if (n.answers) setTimeout(open, 0);
  return el;
}
function replyModal(n, done) {
  const isQ = n.kind === 'question';
  const d = modal(`<h3>${isQ ? t('answer') : t('comment')} <span class="mut" style="font-size:13px">→ #${n.id}</span></h3><textarea id="rb" maxlength="8000"></textarea>
    <div class="row"><label>Visible to</label><select id="rv"><option value="public">Everyone</option><option value="professionals">Professionals only</option></select>
    ${isQ ? '<label><input type="checkbox" id="rc"> comment only (not an answer)</label>' : ''}</div><div class="row"><button id="rs">${t('add')}</button><button class="ghost" id="rx">${t('cancel')}</button></div>`);
  $('#rx', d).onclick = closeModal;
  $('#rs', d).onclick = async () => { try { await api('/notes', { body: { parent_id: n.id, work: n.work, sec: n.sec, idx: n.idx, kind: $('#rc', d)?.checked ? 'comment' : (isQ ? 'answer' : 'comment'), body: $('#rb', d).value, visibility: $('#rv', d).value } }); closeModal(); done(); } catch (e) { toast(e.message); } };
}
async function noteModal(a) {
  if (!await needLogin()) return;
  let groups = []; try { groups = (await api('/groups')).groups; } catch { }
  const d = modal(`<h3>${t('addnote')} <span class="mut" style="font-size:13px">${esc(secLabel(S.work, S.sec))} · ${a.idx}</span></h3>
    ${a.quote ? `<div class="quote">${esc(a.quote)}</div>` : '<p class="mut" style="font-size:12px">Tip: select specific words in the text first to anchor the note to them.</p>'}
    <div class="row"><label>Type</label><select id="nk"><option value="note">📝 Note / insight</option><option value="question">❓ Question</option></select></div>
    <div class="row"><label>Title</label><input id="nt" maxlength="200" placeholder="optional short title"></div><textarea id="nb" maxlength="8000" placeholder="Write here…"></textarea>
    <div class="row"><label>Visible to</label><select id="nv"><option value="public">Everyone</option><option value="private">Only me (private)</option><option value="professionals">Professionals only (avreich+)</option><option value="group">A group</option></select>
    <select id="ng" hidden>${groups.map(g => `<option value="${g.id}">${esc(g.name)}</option>`).join('') || '<option value="">(no groups — join one in My page)</option>'}</select></div>
    <div class="row"><label>Topics</label><input id="ntg" placeholder="comma separated — topics are also added automatically"></div>
    <div class="row"><label>Also link to</label><select id="lw"><option value="">— nothing —</option>${Object.entries(WORKS).map(([k, w]) => `<option value="${k}">${w.he}</option>`).join('')}</select><select id="ls" hidden></select><input id="li" type="number" min="0" placeholder="# verse/line" hidden style="max-width:110px"></div>
    <div class="row"><button id="ns">${t('add')}</button><button class="ghost" id="nx">${t('cancel')}</button></div>`);
  $('#nv', d).onchange = e => $('#ng', d).hidden = e.target.value !== 'group';
  $('#lw', d).onchange = e => { const w = e.target.value, ls = $('#ls', d); ls.hidden = $('#li', d).hidden = !w; if (w) ls.innerHTML = WORKS[w].secs.map(s => `<option value="${s}">${WORKS[w].label(s)}</option>`).join(''); };
  $('#nx', d).onclick = closeModal;
  $('#ns', d).onclick = async () => {
    const lw = $('#lw', d).value, links = lw ? [{ work: lw, sec: $('#ls', d).value, idx: +$('#li', d).value || 0 }] : [];
    try {
      const r = await api('/notes', { body: { work: S.work, sec: S.sec, idx: a.idx, ws: a.ws, we: a.we, quote: a.quote, kind: $('#nk', d).value, title: $('#nt', d).value, body: $('#nb', d).value, visibility: $('#nv', d).value, group_id: $('#ng', d).value, tags: $('#ntg', d).value, links } });
      closeModal(); toast('Posted · topics: ' + r.tags.join(', ')); await loadSectionNotes(); const c = await api(`/section?work=${S.work}&sec=${encodeURIComponent(S.sec)}`); S.data.noteCounts = c.noteCounts; renderText(); selectSeg(a.idx, 'notes');
    } catch (e) { toast(e.message); }
  };
}
// ---------- search
async function searchPage(q) {
  $('#sq').value = q; app.innerHTML = `<h2>Search: ${esc(q)}</h2><p class="mut">…</p>`;
  try {
    const r = await api('/search?q=' + encodeURIComponent(q));
    app.innerHTML = `<h2>Search: ${esc(q)}</h2><h3>Text (${r.text.length})</h3>` + (r.text.map(x => `<div class="card"><a href="#/read/${x.work}/${x.sec}/${x.idx}">${esc(secLabel(x.work, x.sec))} · ${x.idx}</a><div class="he">${x.he.replace(/<[^>]+>/g, '')}</div></div>`).join('') || '<p class="mut">No matches in the text.</p>')
      + `<h3>Notes (${r.notes.length})</h3>` + (r.notes.map(n => `<div class="card"><a href="#/read/${n.work}/${n.sec}/${n.idx}">${esc(secLabel(n.work, n.sec))} · ${n.idx}</a> <span class="mut">${esc(n.author)} · ${esc(LEVELS[n.level] || n.level)}</span><div><b>${esc(n.title || '')}</b></div><div class="body-t">${esc(n.body.slice(0, 300))}</div></div>`).join('') || '<p class="mut">No matching notes.</p>');
  } catch (e) { app.innerHTML = '<p class="err">' + esc(e.message) + '</p>'; }
}
// ---------- chavrusa
async function chavrusaPage() {
  app.innerHTML = `<h2>חברותא · Chavrusa board</h2><div class="card"><b>Looking for a chavrusa?</b>
   <div class="row"><label>What</label><input id="ct" placeholder="e.g. Gemara Berakhos 2a, iyun" maxlength="100"></div>
   <div class="row"><label>Text</label><input id="cr" placeholder="optional: Berakhot 2a" maxlength="100"></div>
   <div class="row"><label>When</label><input id="cw" placeholder="Now / Sun–Thu 20:00–21:30" maxlength="100"><input id="ctz" value="${Intl.DateTimeFormat().resolvedOptions().timeZone}" style="max-width:190px"></div>
   <div class="row"><label>Language</label><select id="cl"><option>Hebrew</option><option>English</option><option>Yiddish</option></select><label>Wants</label><select id="cv"><option value="">any level</option>${Object.entries(LEVELS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
   <div class="row"><label>Details</label><input id="cd" placeholder="pace, style (iyun / bekius), notes" maxlength="500"></div><div class="row"><button id="cp">Post request</button><span class="mut" style="font-size:12px">A video room link (Jitsi) is created automatically.</span></div></div>
   <div class="row"><input id="cf" placeholder="filter by topic/text"><button class="ghost" id="cfb">Filter</button></div><div id="cl2"></div><div id="inb"></div>`;
  $('#cp').onclick = async () => { if (!await needLogin()) return; try { await api('/chavrusa', { body: { topic: $('#ct').value, ref_label: $('#cr').value, when_text: $('#cw').value, tz: $('#ctz').value, lang: $('#cl').value, level_wanted: $('#cv').value, details: $('#cd').value } }); toast('Posted'); chavrusaPage(); } catch (e) { toast(e.message); } };
  const load = async () => {
    const { posts } = await api('/chavrusa?topic=' + encodeURIComponent($('#cf').value));
    $('#cl2').innerHTML = posts.length ? '' : '<p class="mut">No open requests yet.</p>';
    posts.forEach(p => { const e = h(`<div class="card"><b>${esc(p.topic)}</b> ${p.ref_label ? `<span class="pill">${esc(p.ref_label)}</span>` : ''}<div class="mut">${esc(p.author)} · ${esc(LEVELS[p.level] || p.level)} · ${esc(p.lang || '')} · ${esc(p.when_text)} (${esc(p.tz || '')}) ${p.level_wanted ? '· wants ' + esc(LEVELS[p.level_wanted] || '') : ''}</div>${p.details ? `<div>${esc(p.details)}</div>` : ''}
      <div class="acts"><button class="sm" data-r>I'm in — message</button>${ME && ME.name === p.author ? '<button class="ghost sm" data-c>Close</button>' : ''}<a href="${esc(p.link)}" target="_blank" rel="noopener">Video room ↗</a><span class="mut">${p.responses} response(s)</span></div></div>`);
      $('[data-r]', e).onclick = async () => { if (!await needLogin()) return; const m = prompt('Message to ' + p.author + ' (when are you free?)'); if (m) try { await api(`/chavrusa/${p.id}/respond`, { body: { message: m } }); toast('Sent'); load(); } catch (er) { toast(er.message); } };
      const cb = $('[data-c]', e); if (cb) cb.onclick = async () => { await api(`/chavrusa/${p.id}/close`, { body: {} }); load(); };
      $('#cl2').append(e); });
  };
  $('#cfb').onclick = load; load();
  if (ME) { const { mine, sent } = await api('/inbox'); $('#inb').innerHTML = `<h3>Responses to my requests</h3>${mine.map(r => `<div class="card"><b>${esc(r.name)}</b> (${esc(LEVELS[r.level] || r.level)}) re “${esc(r.topic)}”: ${esc(r.message)} <a href="${esc(r.link)}" target="_blank" rel="noopener">Video room ↗</a></div>`).join('') || '<p class="mut">None yet.</p>'}<h3>Requests I answered</h3>${sent.map(r => `<div class="card">“${esc(r.topic)}”: ${esc(r.message)} <a href="${esc(r.link)}" target="_blank" rel="noopener">Video room ↗</a></div>`).join('') || '<p class="mut">None.</p>'}`; }
}
// ---------- my page
async function mePage() {
  if (!await needLogin()) return home();
  const { groups } = await api('/groups');
  app.innerHTML = `<h2>${esc(ME.name)}</h2><div class="card"><div class="row"><label>My level</label><select id="ml">${Object.entries(LEVELS).map(([k, v]) => `<option value="${k}" ${k === ME.level ? 'selected' : ''}>${v}</option>`).join('')}</select></div><p class="mut" style="font-size:12px">Self-declared. Older notes keep the level they were posted with.</p></div>
  <div class="card"><b>Groups</b> (for group-only notes)${groups.map(g => `<div>${esc(g.name)} — invite code: <code>${esc(g.code)}</code></div>`).join('') || '<p class="mut">None yet.</p>'}
  <div class="row"><input id="gn" placeholder="new group name"><button id="gc">Create</button></div><div class="row"><input id="gj" placeholder="invite code"><button id="gjb">Join</button></div></div>
  <div class="card"><b>My notes</b><div id="mn"></div></div>`;
  $('#ml').onchange = async e => { await api('/me/level', { body: { level: e.target.value } }); ME.level = e.target.value; renderWho(); toast('Saved'); };
  $('#gc').onclick = async () => { try { await api('/groups', { body: { name: $('#gn').value } }); mePage(); } catch (e) { toast(e.message); } };
  $('#gjb').onclick = async () => { try { await api('/groups/join', { body: { code: $('#gj').value } }); mePage(); } catch (e) { toast(e.message); } };
  S = { work: '', sec: '', notes: [], W: null }; const { notes } = await api('/notes?mine=1&sort=new&limit=100'); notes.forEach(n => $('#mn').append(noteCard(n, { onchange: mePage })));
}
// ---------- init
applyLang();
loadMe().then(route);
