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
const rng = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => String(a + i));
const dafs = (first, last) => { const out = []; let n = parseInt(first), side = first.slice(-1); const end = [parseInt(last), last.slice(-1)]; for (;;) { out.push(n + side); if (n === end[0] && side === end[1]) break; if (side === 'a') side = 'b'; else { side = 'a'; n++; } } return out; };
const chapLabel = s => 'פרק ' + gem(+s), dafLabel = s => 'דף ' + gem(parseInt(s)) + (s.endsWith('a') ? ' ע״א' : ' ע״ב');
const WORKS = {
  'tanakh-genesis': { cat: 'Tanakh', group: 'Torah', order: 0, he: 'בראשית (מוישלח ואילך)', en: 'Bereishis, Vayishlach onward', type: 'chumash', secs: rng(32, 50), label: chapLabel, lab2: s => 'Chapter ' + s, num: i => gem(i) },
  'tanakh-exodus': { cat: 'Tanakh', group: 'Torah', order: 1, he: 'שמות', en: 'Shemos', type: 'chumash', targum: true, secs: rng(1, 40), label: chapLabel, lab2: s => 'Chapter ' + s, num: i => gem(i) },
  'mishnah-berakhot': { cat: 'Mishnah', group: 'Seder Zeraim', order: 0, he: 'משנה ברכות', en: 'Mishnah Berakhos', type: 'mishnah', secs: rng(1, 9), label: chapLabel, lab2: s => 'Chapter ' + s, num: i => gem(i) },
  'mishnah-peah': { cat: 'Mishnah', group: 'Seder Zeraim', order: 1, he: 'משנה פאה', en: 'Mishnah Peah', type: 'mishnah', secs: rng(1, 8), label: chapLabel, lab2: s => 'Chapter ' + s, num: i => gem(i) },
  'bavli-berakhot': { cat: 'Talmud', group: 'Seder Zeraim', order: 0, he: 'גמרא ברכות', en: 'Gemara Berakhos', type: 'daf', secs: dafs('2a', '64a'), label: dafLabel, lab2: s => 'Daf ' + s, num: i => i },
  'bavli-shabbat': { cat: 'Talmud', group: 'Seder Moed', order: 1, he: 'גמרא שבת (פרקים א–ד)', en: 'Gemara Shabbos, chapters 1-4', type: 'daf', secs: dafs('2a', '51b'), label: dafLabel, lab2: s => 'Daf ' + s, num: i => i }
};
const ALIAS = { shemos: 'tanakh-exodus', mishnah: 'mishnah-berakhot', gemara: 'bavli-berakhot' }; // old links keep working
const WHO_ORDER = ['Rashi', 'Tosafot', 'Onkelos', 'Ibn Ezra', 'Ramban', 'Rashbam', 'Sforno', 'Or HaChaim', 'Bartenura', 'Rambam', 'Tosafot Yom Tov', 'Ikar Tosafot Yom Tov', 'Rashba', 'Ritva', 'Meiri'];
const whoRank = x => { const i = WHO_ORDER.indexOf(x); return i < 0 ? 100 : i; };
const whoSort = (a, b) => whoRank(a) - whoRank(b) || a.localeCompare(b);
const HEWHO = { Rashi: 'רש״י', Onkelos: 'אונקלוס', 'Ibn Ezra': 'אבן עזרא', Ramban: 'רמב״ן', Rashbam: 'רשב״ם', Sforno: 'ספורנו', 'Or HaChaim': 'אור החיים', Bartenura: 'ברטנורא', Rambam: 'רמב״ם', 'Tosafot Yom Tov': 'תוספות יום טוב', 'Ikar Tosafot Yom Tov': 'עיקר תוספות יום טוב', Tosafot: 'תוספות', Rashba: 'רשב״א', Ritva: 'ריטב״א', Meiri: 'מאירי' };
const LEVELS = { student: 'Student', working_man: 'Working man (baal habayis)', avreich: 'Avreich / kollel', talmid_chacham: 'Talmid chacham', rav: 'Rav / posek', rosh_yeshiva: 'Rosh yeshiva' };
const PROS = ['avreich', 'rav', 'talmid_chacham', 'rosh_yeshiva'];
const secLabel = (w, s) => { w = ALIAS[w] || w; const W = WORKS[w]; return W ? W.he + ' · ' + W.label(s) : w + ' ' + s; };
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
let modalReturnFocus = null;
function modal(html, onclose) {
  const m = $('#modal'); modalReturnFocus = document.activeElement; m.innerHTML = '<div class="dlg" role="dialog" aria-modal="true" tabindex="-1">' + html + '</div>'; m.hidden = false;
  const dlg = m.firstElementChild, hd = $('h2,h3', dlg); if (hd) { hd.id = 'dlgtitle'; dlg.setAttribute('aria-labelledby', 'dlgtitle'); }
  m.onmousedown = e => { if (e.target === m) closeModal(); }; m._onclose = onclose;
  setTimeout(() => { const f = $('input,select,textarea,button', dlg); (f || dlg).focus(); }, 30);
  return dlg;
}
function closeModal() { const m = $('#modal'); m.hidden = true; m.innerHTML = ''; if (modalReturnFocus && modalReturnFocus.focus) try { modalReturnFocus.focus(); } catch { } }
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


// ---------- catalog: the list of books comes from R2 (catalog.json); the six built-in books are the fallback
const HEGROUP = { Torah: 'תורה', Prophets: 'נביאים', Writings: 'כתובים', 'Seder Zeraim': 'סדר זרעים', 'Seder Moed': 'סדר מועד', 'Seder Nashim': 'סדר נשים', 'Seder Nezikin': 'סדר נזיקין', 'Seder Kodashim': 'סדר קדשים', 'Seder Tahorot': 'סדר טהרות' };
const CAT_TITLES = { Tanakh: 'Tanach · תנ״ך', Mishnah: 'Mishna · משנה', Talmud: 'Gemara · גמרא', Yerushalmi: 'Yerushalmi · ירושלמי', Tosefta: 'Tosefta · תוספתא', Midrash: 'Midrash · מדרש', Halakhah: 'Halakhah · הלכה', Kabbalah: 'Kabbalah · קבלה', Chasidut: 'Chasidut · חסידות', Musar: 'Musar · מוסר', Liturgy: 'Liturgy · תפילה' };
function catList() { const seen = []; for (const w of Object.values(WORKS)) if (!seen.includes(w.cat)) seen.push(w.cat); const base = ['Tanakh', 'Mishnah', 'Talmud']; return [...base.filter(c => seen.includes(c)), ...seen.filter(c => !base.includes(c))].map(c => [c, CAT_TITLES[c] || c]); }
async function loadCatalog() {
  try {
    const cat = await (await fetch('/api/catalog')).json(); if (!cat.books || !cat.books.length) return;
    for (const k of Object.keys(WORKS)) delete WORKS[k];
    for (const b of cat.books) {
      const daf = b.type === 'daf';
      WORKS[b.id] = { cat: b.cat, group: b.group, order: b.order, he: (b.cat === 'Talmud' ? 'גמרא ' : '') + b.he, en: (b.cat === 'Talmud' ? 'Gemara ' : '') + b.title, type: b.type, secs: b.secs,
        label: daf ? dafLabel : (s => { const r = b.secLabels && b.secLabels[s] != null ? String(b.secLabels[s]).trim() : s; return (b.secWord || 'פרק') + ' ' + (/^\d+$/.test(r) ? gem(+r) : r); }), lab2: daf ? (s => 'Daf ' + s) : (s => (b.secWordEn || 'Chapter') + ' ' + (b.secLabels && b.secLabels[s] != null ? String(b.secLabels[s]).trim() : s)), num: daf ? (i => i) : (i => gem(i)), targum: b.id === 'tanakh-exodus', commentaries: b.commentaries };
    }
  } catch { /* keep the built-in books */ }
}
function booksByCat() {
  const out = {}; for (const [id, w] of Object.entries(WORKS)) { ((out[w.cat] = out[w.cat] || {})[w.group] = out[w.cat][w.group] || []).push([id, w]); }
  for (const c of Object.values(out)) for (const g of Object.values(c)) g.sort((a, b) => a[1].order - b[1].order);
  return out;
}
function buildMenu() {
  const bc = booksByCat(), drop = $('.menu .drop'); if (!drop) return;
  drop.innerHTML = catList().filter(([c]) => bc[c]).map(([c, title]) => `<div class="col"><b>${title}</b>${Object.entries(bc[c]).map(([g, list]) => `<div class="grp">${HEGROUP[g] || g}</div>${list.map(([id, w]) => `<a href="#/read/${id}/${w.secs[0]}">${esc(w.he.replace(/^גמרא |^משנה /, ''))}</a>`).join('')}`).join('')}</div>`).join('');
}
const layoutsLoaded = {};
async function ensureLayouts(work) {
  if (layoutsLoaded[work]) return; layoutsLoaded[work] = 1;
  try { const l = await (await fetch('/api/layouts?work=' + work)).json(); window.DAF_LAYOUTS = Object.assign(window.DAF_LAYOUTS || {}, l); } catch { }
}


// ---------- connections (links) from R2: links/<book>/<sec>.json and linksin/<book>/<sec>.json
const LINK_TYPES = [['quotation', 'Quotations (pesukim, mishnayos, gemara)'], ['parallel', 'Parallel sources'], ['halakhah', 'Halakhah'], ['midrash', 'Midrash'], ['commentary', 'Commentary in other works'], ['suggested', 'Suggested connections']];
function linkTarget(t) {
  if (!t) return null;
  if (t.work && WORKS[ALIAS[t.work] || t.work]) { const id = ALIAS[t.work] || t.work; return { href: `#/read/${id}/${t.sec}${t.idx ? '/' + t.idx : ''}`, label: secLabel(id, t.sec) + (t.idx ? ' · ' + t.idx : ''), site: true }; }
  if (t.sefaria) return { href: 'https://www.sefaria.org/' + encodeURIComponent(t.sefaria.replace(/ /g, '_')) + '?lang=he', label: t.sefaria.length > 64 ? t.sefaria.slice(0, 62) + '…' : t.sefaria, site: false };
  return t.work ? { href: null, label: `${t.work} ${t.sec || ''}${t.idx ? ':' + t.idx : ''}`, site: false } : null;
}
function renderLinksTab(tb, sel) {
  const L = S.links || { links: [], incoming: [] }, noise = l => { const s = (l.to && l.to.sefaria) || (l.from && l.from.sefaria) || ''; return /Dictionary|Jastrow|Footnotes to the English|Lexicon|Klein Dictionary/i.test(s); }, okc = l => (l.confidence ?? 1) >= 0.6 && !noise(l);
  const mine = L.links.filter(l => (l.from && (l.from.idx || 0)) === sel && okc(l));
  const inc = L.incoming.filter(l => ((l.to && l.to.idx) || 0) === sel && okc(l)).map(l => ({ ...l, _inc: true, _tgt: l.from }));
  const all = [...mine.map(l => ({ ...l, _tgt: l.to })), ...inc];
  if (!all.length) return false;
  tb.insertAdjacentHTML('beforeend', '<p class="mut" style="font-size:12px">Connections from Sefaria\'s official links and from word-matching. “auto” = found by matching, not yet reviewed. ← marks a connection that points TO this line from elsewhere.</p>');
  for (const [type, title] of LINK_TYPES) {
    const items = all.filter(l => l.type === type); if (!items.length) continue;
    items.sort((a, b) => (linkTarget(b._tgt)?.site ? 1 : 0) - (linkTarget(a._tgt)?.site ? 1 : 0) || (b.confidence || 0) - (a.confidence || 0));
    const box = h(`<div><div class="xcat">${title} <span class="mut">(${items.length})</span></div><div class="chipbox"></div></div>`), cb = $('.chipbox', box);
    items.forEach((l, i) => {
      const g = linkTarget(l._tgt); if (!g) return;
      const tag = (l.source === 'model' ? ' <i class="mut">suggested</i>' : (l.source === 'string-match' ? ' <i class="mut">auto</i>' : '')) + (l._inc ? ' ←' : '');
      const el = g.href ? `<a class="xi ${g.site ? 'site' : ''}" ${g.site ? '' : 'target="_blank" rel="noopener"'} href="${esc(g.href)}" title="${esc(l.note || '')}">${esc(g.label)}${tag}</a>` : `<span class="xi" title="${esc(l.note || '')}">${esc(g.label)}${tag}</span>`;
      const node = h(el); if (i >= 14) node.hidden = true; cb.append(node);
    });
    if (items.length > 14) { const more = h(`<button class="ghost sm">show all ${items.length}</button>`); more.onclick = () => { $$('a,span', cb).forEach(x => x.hidden = false); more.remove(); }; box.append(more); }
    tb.append(box);
  }
  return true;
}


// ---------- preferences, theme, text flags
const pref = { get: (k, d) => { try { const v = localStorage.getItem('p:' + k); return v == null ? d : JSON.parse(v); } catch { return d; } }, set: (k, v) => { try { localStorage.setItem('p:' + k, JSON.stringify(v)); } catch { } } };
$('#theme').onclick = () => { const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'); const nx = cur === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = nx; try { localStorage.theme = nx; } catch { } };
const NIKUD_RE = /[ְ-ׇֽֿׁׂׅׄ]/g, TAAM_RE = /[֑-֯]/g;
function flags() { const type = S && S.W ? S.W.type : 'chumash', nk = localStorage.getItem('nikud:' + type) ?? (type === 'daf' ? localStorage.getItem('nikud') : null); return { nikud: nk == null ? type !== 'daf' : nk === '1', taamim: type === 'daf' ? false : pref.get('taamim', true) }; }
function stripT(s) { const f = flags(); if (!f.nikud) s = s.replace(NIKUD_RE, ''); if (!f.taamim) s = s.replace(TAAM_RE, ''); return s; }
// every control gets an accessible name (labels without `for`, selects with only a first option, placeholders)
let lblN = 0;
function autoLabel() {
  $$('label:not([for])').forEach(l => { const c = l.nextElementSibling; if (c && /^(INPUT|SELECT|TEXTAREA)$/.test(c.tagName) && !l.querySelector('input,select,textarea')) { if (!c.id) c.id = 'af' + (++lblN); l.setAttribute('for', c.id); } });
  $$('input,select,textarea').forEach(c => { if (c.type === 'hidden' || c.getAttribute('aria-label') || c.getAttribute('aria-labelledby') || (c.labels && c.labels.length)) return; const n = c.placeholder || (c.tagName === 'SELECT' && c.options[0] ? c.options[0].textContent : '') || c.name || c.dataset.f; if (n) c.setAttribute('aria-label', n); });
  $$('.scrollable,.pagewrap,.drop,#side').forEach(e => { if (e.scrollWidth > e.clientWidth || e.scrollHeight > e.clientHeight) e.tabIndex = 0; });
}
let alq = 0; new MutationObserver(() => { if (!alq) alq = requestAnimationFrame(() => { alq = 0; autoLabel(); }); }).observe(document.body, { childList: true, subtree: true });
// keyboard: / = search, arrows = next/previous section, Esc = close dialog or side sheet
document.addEventListener('keydown', e => {
  const tg = e.target, typing = tg && (/^(INPUT|TEXTAREA|SELECT)$/.test(tg.tagName) || tg.isContentEditable);
  if (e.key === 'Escape') { if (!$('#modal').hidden) { closeModal(); return; } if (S && S.sel && innerWidth <= 900) { selectSeg(null); return; } }
  if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === '/') { e.preventDefault(); $('#sq').focus(); return; }
  if (S && S.W && /^#\/read\//.test(location.hash) && $('#next')) {
    const rtl = document.documentElement.dir === 'rtl', nextKey = rtl ? 'ArrowLeft' : 'ArrowRight', prevKey = rtl ? 'ArrowRight' : 'ArrowLeft';
    if (e.key === nextKey && !$('#next').disabled) $('#next').click(); else if (e.key === prevKey && !$('#prev').disabled) $('#prev').click();
  }
});
window.addEventListener('scroll', () => { const b = $('#rbar'); if (b) b.classList.toggle('stuck', scrollY > 8); }, { passive: true });
function pushRecent(work, sec) { const r = pref.get('recent', []).filter(x => x.work !== work); r.unshift({ work, sec, t: Date.now() }); pref.set('recent', r.slice(0, 8)); }

// ---------- router
const app = $('#app');
function route() {
  const hash = location.hash.replace(/^#\/?/, ''), [path, qs] = hash.split('?'), p = path.split('/');
  window.scrollTo(0, 0);
  if (p[0] === 'read') { if (ALIAS[p[1]]) { location.replace('#/read/' + ALIAS[p[1]] + '/' + (p[2] || '') + (p[3] ? '/' + p[3] : '')); return; } return readPage(p[1], decodeURIComponent(p[2] || ''), p[3] ? +p[3] : null); }
  if (p[0] === 'chavrusa') return chavrusaPage();
  if (p[0] === 'about') return aboutPage(); if (p[0] === 'terms') return textPage('terms'); if (p[0] === 'privacy') return textPage('privacy');
  if (p[0] === 'bookmarks') return bookmarksPage();
  if (p[0] === 'shelf') return shelfPage(p[1], decodeURIComponent(p[2] || ''), decodeURIComponent(p[3] || ''));
  if (p[0] === 'search') return searchPage(new URLSearchParams(qs).get('q') || '');
  if (p[0] === 'me') return mePage();
  return home();
}
window.addEventListener('hashchange', route);
$('#sform').onsubmit = e => { e.preventDefault(); const q = $('#sq').value.trim(); if (q) location.hash = '#/search?q=' + encodeURIComponent(q); };
function home() {
  document.title = 'Torah World · עולם התורה';
  const bc = booksByCat(), recent = pref.get('recent', []).filter(r => WORKS[r.work]).slice(0, 6), total = Object.keys(WORKS).length;
  app.innerHTML = `<div class="hero"><h1>עולם התורה</h1><p class="mut">Learn the text. Add your notes and questions right on the words. See the mefarshim and links beside it.</p>
    <form class="finder" id="finder" role="search" aria-label="Find a book"><input id="bookq" type="search" placeholder="Find a book… (e.g. Berakhot, תהילים)" aria-label="Find a book" autocomplete="off"><button>Find</button></form>
    <div class="mut" style="font-size:13px">${total} books · press <kbd>/</kbd> to search the texts</div></div>
  ${bookmarks().filter(b => WORKS[b.work]).length ? `<section class="recent"><h2>Bookmarks</h2><div class="chips">${bookmarks().filter(b => WORKS[b.work]).slice(0, 8).map(b => `<a class="chip" href="#/read/${b.work}/${b.sec}">${esc(secLabel(b.work, b.sec))}</a>`).join('')}</div><p><a href="#/bookmarks">All bookmarks</a></p></section>` : ''}
  ${recent.length ? `<section class="recent"><h2>Continue reading</h2><div class="chips">${recent.map(r => `<a class="chip" href="#/read/${r.work}/${r.sec}">${esc(secLabel(r.work, r.sec))}</a>`).join('')}</div></section>` : ''}
  <div id="cats">${catList().filter(([c]) => bc[c]).map(([c, title], i) => { const n = Object.values(bc[c]).reduce((a, l) => a + l.length, 0); return `<details class="cat" ${i < 3 ? 'open' : ''}><summary>${title} <span class="count">${n} books</span></summary>${Object.entries(bc[c]).map(([g, list]) => `<div class="grpbox"><div class="mut" style="margin:8px 0 4px;font-size:13px">${HEGROUP[g] || g}</div><div class="chips">${list.map(([id, w]) => `<a class="chip" data-q="${esc((w.he + ' ' + w.en).toLowerCase())}" href="#/read/${id}/${w.secs[0]}">${esc(w.he.replace(/^גמרא |^משנה /, ''))}</a>`).join('')}</div></div>`).join('')}</details>`; }).join('')}</div>
  <h2 style="font-size:18px;margin:18px 0 6px">חברותא</h2><div class="grid"><a class="card tile" href="#/chavrusa"><b>חברותא</b><div class="mut">Find a learning partner — now or scheduled</div></a></div>
  <details class="card" style="font-size:14px"><summary><b>How it works</b></summary><p>Click any verse or line to open its mefarshim, cross-references and the community notes. Select words to attach a note or a question to exactly those words. Notes can be private, public, professionals-only, or group-only. Anyone can answer, comment and vote. Every text and commentary shows its source and license under the page.</p><p class="mut">Keyboard: <kbd>/</kbd> search · <kbd>←</kbd> <kbd>→</kbd> previous / next section · <kbd>Esc</kbd> close.</p></details>`;
  const q = $('#bookq'), chips = $$('#cats .chip'), cats = $$('#cats details.cat');
  q.oninput = () => { const v = q.value.trim().toLowerCase(); chips.forEach(c => c.hidden = !!v && !c.dataset.q.includes(v)); $$('#cats .grpbox').forEach(g => g.hidden = !!v && !$$('.chip:not([hidden])', g).length); cats.forEach(d => { if (v) d.open = true; d.hidden = !!v && !$$('.chip:not([hidden])', d).length; }); };
  $('#finder').onsubmit = e => { e.preventDefault(); const vis = chips.filter(c => !c.hidden); if (q.value.trim() && vis.length === 1) location.hash = vis[0].getAttribute('href'); else if (q.value.trim() && !vis.length) location.hash = '#/search?q=' + encodeURIComponent(q.value.trim()); else if (vis.length) vis[0].focus(); };
}
// ---------- reader
let S = null; // reader state
let navId = 0;
async function readPage(work, sec, sel) {
  const my = ++navId, W = WORKS[work]; if (!W) return home();
  if (!sec || !W.secs.includes(sec)) sec = W.secs[0];
  app.innerHTML = '<div class="skel" style="width:40%;height:28px"></div><div class="skel"></div><div class="skel"></div><div class="skel" style="width:80%"></div><div class="skel"></div><div class="skel" style="width:60%"></div>';
  let data; try { data = await api(`/section?work=${work}&sec=${encodeURIComponent(sec)}`); } catch (e) { if (my === navId) app.innerHTML = `<div class="empty"><h1>This section isn't available yet</h1><p>${esc(e.message)}</p><p><a href="#/read/${work}/${W.secs[0]}">Go to the beginning of ${esc(W.he)}</a> · <a href="#/">Home</a></p></div>`; return; }
  if (my !== navId) return;
  const i = W.secs.indexOf(sec), type = W.type;
  S = { work, sec, W, data, sel: null, tab: 'commentary', notes: [], layers: { mk: true, hl: true }, links: { links: [], incoming: [] } };
  document.title = `${W.he} · ${W.label(sec)} — Torah World`; pushRecent(work, sec);
  fetch(`/api/links?work=${work}&sec=${encodeURIComponent(sec)}`).then(r => r.ok ? r.json() : null).then(j => { if (j && my === navId && S.work === work && S.sec === sec) { S.links = j; if (S.sel) renderSide(); } }).catch(() => { });
  const catName = (CAT_TITLES[W.cat] || W.cat || '').split(' · ')[0], f = flags();
  const chk = (id, label, on) => `<label class="chk"><input type="checkbox" id="${id}" ${on ? 'checked' : ''}> ${label}</label>`;
  app.innerHTML = `<nav class="crumbs" aria-label="Breadcrumb"><a href="#/">Home</a> › <span>${esc(catName)}</span> › <span>${esc(W.group ? (HEGROUP[W.group] || W.group) : '')}</span></nav>
    <div class="rbar" id="rbar"><h1 class="he">${esc(W.he)} · ${esc(W.label(sec))}</h1>
      <div class="pager"><button class="ghost icon" id="prev" aria-label="Previous ${type === 'daf' ? 'page' : 'section'} (arrow key)" ${i ? '' : 'disabled'}>◀</button>
        <select id="secsel" aria-label="Go to ${type === 'daf' ? 'page' : 'chapter'}">${W.secs.map(s => `<option value="${s}" ${s === sec ? 'selected' : ''}>${W.label(s)} (${W.lab2(s)})</option>`).join('')}</select>
        <button class="ghost icon" id="next" aria-label="Next ${type === 'daf' ? 'page' : 'section'} (arrow key)" ${i < W.secs.length - 1 ? '' : 'disabled'}>▶</button></div>
      <button class="ghost icon" id="bm" aria-label="Bookmark this page" aria-pressed="${isBookmarked(work, sec)}" title="Bookmark">${isBookmarked(work, sec) ? '★' : '☆'}</button>
      <button class="ghost only-sheet" id="opensb" aria-label="Open commentary and notes panel">☰ Panel</button>
      <details class="view" id="viewmenu"><summary>⚙ View</summary><div class="viewpanel">
        ${type === 'daf' ? `<h4>Layout</h4><select id="dview" aria-label="Page layout"><option value="page" ${dafView() === 'page' ? 'selected' : ''}>צורת הדף · Printed page (fixed)</option><option value="live" ${dafView() === 'live' ? 'selected' : ''}>Adaptive layout (fits window)</option><option value="simple" ${dafView() === 'simple' ? 'selected' : ''}>Simple text (best on phones)</option></select>` : ''}
        <h4>Text</h4>${chk('lnk', 'ניקוד · Nikud (vowels)', f.nikud)}${type === 'chumash' ? chk('ltaam', 'טעמים · Cantillation marks', f.taamim) : ''}${W.targum ? chk('ltg', 'תרגום אונקלוס · Onkelos', localStorage.targum === '1') : ''}
        <div class="sizer" id="sizer1"><span class="mut" style="font-size:13px;flex:1">Text size</span><button class="ghost sm" id="tdown" aria-label="Smaller text">A−</button><button class="ghost sm" id="tup" aria-label="Larger text">A+</button></div>
        <div class="sizer"><span class="mut" style="font-size:13px;flex:1">Commentary size</span><button class="ghost sm" id="cdown" aria-label="Smaller commentary text">A−</button><button class="ghost sm" id="cup" aria-label="Larger commentary text">A+</button></div>
        <h4>Show</h4>${chk('lmk', 'Markers (◆ commentary, ★ notes)', pref.get('mk', true))}${chk('lhl', 'Highlights of notes', pref.get('hl', true))}${chk('lsb', 'Side panel', pref.get('sb', true))}
      </div></details></div>
    <div class="reader" id="rd"><div><div class="card" id="text"></div><div class="bottompager"><button class="ghost" id="prev2" ${i ? '' : 'disabled'}>◀ ${W.label(W.secs[i - 1] || sec)}</button><button class="ghost" id="next2" ${i < W.secs.length - 1 ? '' : 'disabled'}>${W.label(W.secs[i + 1] || sec)} ▶</button></div></div>
      <aside class="card" id="side" aria-label="Commentary, links and notes"></aside></div><div class="backdrop" id="bd" hidden></div>`;
  const go = k => { if (W.secs[k] != null) location.hash = `#/read/${work}/${W.secs[k]}`; };
  $('#prev').onclick = $('#prev2').onclick = () => go(i - 1); $('#next').onclick = $('#next2').onclick = () => go(i + 1);
  $('#secsel').onchange = e => location.hash = `#/read/${work}/${e.target.value}`;
  const applyView = () => {
    const tx = $('#text'); if (!tx) return; tx.classList.toggle('hidemk', !pref.get('mk', true)); tx.classList.toggle('hidehl', !pref.get('hl', true));
    $('#rd').classList.toggle('nosb', !pref.get('sb', true)); tx.style.setProperty('--ts', pref.get('ts', 1)); $('#side').style.setProperty('--cs', pref.get('cs', 1));
    const fixedPage = type === 'daf' && dafView() === 'page'; $('#sizer1').style.display = fixedPage ? 'none' : '';
  };
  $('#lmk').onchange = e => { pref.set('mk', e.target.checked); applyView(); }; $('#lhl').onchange = e => { pref.set('hl', e.target.checked); applyView(); };
  $('#lsb').onchange = e => { pref.set('sb', e.target.checked); applyView(); if (type === 'daf') renderText().then(paintHighlights); };
  const step = (k, d, lo, hi) => { pref.set(k, Math.max(lo, Math.min(hi, +(pref.get(k, 1) + d).toFixed(2)))); applyView(); };
  $('#tdown').onclick = () => step('ts', -0.1, 0.7, 1.8); $('#tup').onclick = () => step('ts', 0.1, 0.7, 1.8); $('#cdown').onclick = () => step('cs', -0.1, 0.7, 1.8); $('#cup').onclick = () => step('cs', 0.1, 0.7, 1.8);
  if ($('#ltg')) $('#ltg').onchange = e => { localStorage.targum = e.target.checked ? '1' : '0'; renderText().then(paintHighlights); };
  if ($('#ltaam')) $('#ltaam').onchange = e => { pref.set('taamim', e.target.checked); renderText().then(paintHighlights); };
  if ($('#dview')) $('#dview').onchange = e => { localStorage.dafView = e.target.value; applyView(); renderText().then(paintHighlights); };
  $('#lnk').onchange = e => { localStorage.setItem('nikud:' + type, e.target.checked ? '1' : '0'); renderText().then(paintHighlights); };
  $('#bm').onclick = () => { const on = toggleBookmark(work, sec); $('#bm').textContent = on ? '★' : '☆'; $('#bm').setAttribute('aria-pressed', on); toast(on ? 'Bookmarked' : 'Bookmark removed'); };
  $('#opensb').onclick = () => { $('#side').classList.add('open'); $('#bd').hidden = false; };
  $('#bd').onclick = () => { if (S.sel) selectSeg(null); $('#side').classList.remove('open'); $('#bd').hidden = true; };
  applyView();
  await renderText();
  if (my !== navId) return;
  if (data.sources) {
    const s = data.sources, lic = x => `${esc(x.license)}${x.source ? ` · <a href="${esc(x.source)}" target="_blank" rel="noopener">source</a>` : ''}`;
    $('#text').parentElement.insertAdjacentHTML('beforeend', `<details class="card src" style="font-size:12px"><summary>Sources &amp; licenses</summary><div><b>Text:</b> ${esc(s.text.version)} — ${lic(s.text)}</div>${s.commentary.slice().sort((a, b) => whoSort(a.who, b.who)).map(c => `<div><b>${esc(c.who)}:</b> ${esc(c.version)} — ${lic(c)}</div>`).join('')}<div class="mut" style="margin-top:6px">Texts come from <a href="https://www.sefaria.org" target="_blank" rel="noopener">Sefaria</a> and keep their own licenses. Non-commercial use; attribution required.</div></details>`);
  }
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
  if (S.W.type === 'daf' && dafView() === 'simple') renderSimple(box, nc);
  else if (S.W.type === 'daf') await renderDaf(box, nc);
  else if (S.W.type === 'chumash') renderChumash(box, nc);
  else box.innerHTML = S.data.segments.map(sg => `<p class="mish">${segHTML({ idx: sg.idx, he: stripT(sg.he) }, '', nc, `<b class="mnum">${gem(sg.idx)}.</b> `)}</p>`).join('');
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
    if (!tg) { html += segHTML({ idx: sg.idx, he: stripT(sg.he) }, W.num(sg.idx), nc); continue; }
    const pairs = (al[sg.idx] || [[sg.he, on[sg.idx] || '']]).map(([he, ar]) => [stripT(he), stripT(ar)]);
    let n = 0, inner = '';
    for (const [he, ar] of pairs) { const w = wrapWords(he, n); n = w.next; inner += `<span class="pair"><span class="phe">${w.html}</span><span class="par">${ar}</span></span> `; }
    html += `<span class="sg" data-idx="${sg.idx}"><sup class="vn">${W.num(sg.idx)}</sup>${inner}${star(nc, sg.idx)}</span> `;
  }
  box.innerHTML = html + '</div>';
}
const dafView = () => localStorage.dafView || (innerWidth < 760 ? 'simple' : 'page');
const PAGE_W = 1000; // design width of the tzuras hadaf; layout numbers are stored for this size and scaled proportionally to the screen
const PAGE_MIN = 0.62; // below this the page scrolls sideways instead of shrinking further
const NIK = /[֑-ׇ]/g;
function renderSimple(box, nc) {
  const nikud = flags().nikud, strip = stripT;
  box.innerHTML = '<div class="mut dafkey" style="text-align:center;font-size:12px">Simple text · tap a line for Rashi, Tosafot and the other mefarshim</div><div class="flow simple">' + S.data.segments.map(sg => segHTML({ idx: sg.idx, he: strip(sg.he) }, S.W.num(sg.idx), nc)).join('') + '</div>';
  window.__dafDone = { work: S.work, sec: S.sec, nikud, view: 'simple', stored: false, scale: 1, spacers: null, height: 0 };
}
async function renderDaf(box, nc) {
  const { data, sec } = S, amud = sec.endsWith('a') ? 'a' : 'b';
  const nikud = flags().nikud, view = dafView() === 'live' ? 'live' : 'page';
  const strip = stripT;
  const main = data.segments.map(sg => segHTML({ idx: sg.idx, he: strip(sg.he) }, '', nc)).join('');
  const side = who => data.comments.filter(c => c.who === who).map(c => `<span class="cs" data-idx="${c.idx}" data-who="${who}">${dhBold(strip(c.he), who)}</span>`).join(' ');
  box.insertAdjacentHTML('afterbegin', `<div class="mut dafkey" style="text-align:center;font-size:12px">${view === 'page' ? 'צורת הדף' : 'Live layout'} · רש״י (פנים) · תוספות (חוץ) — click any part for notes &amp; the full commentary</div>`);
  const holder = document.createElement('div'); holder.id = 'daf';
  const wrap = document.createElement('div'); wrap.className = 'pagewrap'; wrap.append(holder); box.append(wrap);
  if (view === 'page') await ensureLayouts(S.work);
  const fixed = view === 'page', avail = box.clientWidth - 12;
  const s = window.__PRECOMPUTE ? 1 : (fixed ? Math.max(PAGE_MIN, Math.min(1.15, avail / PAGE_W)) : 1);
  const width = fixed ? Math.round(PAGE_W * s) : Math.max(520, Math.min(960, box.clientWidth - 30));
  const stored = fixed && !window.__PRECOMPUTE && window.DAF_LAYOUTS ? window.DAF_LAYOUTS[S.work + '|' + sec + '|' + (nikud ? 1 : 0)] : null;
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
  window.__dafDone = { work: S.work, sec, nikud, view, spacers: r.spacerHeights, height: holder.offsetHeight, stored: !!stored, scale: k };
}
if (!window.__fitBound) {
  window.__fitBound = 1; let tm;
  window.addEventListener('resize', () => { clearTimeout(tm); tm = setTimeout(() => { if (S && S.W && S.W.type === 'daf' && S.fitW && $('#daf') && Math.abs(($('#text').clientWidth - 12) - S.fitW) > 24) renderText().then(paintHighlights); }, 250); });
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
  if (innerWidth <= 900 && $('#side')) { $('#side').classList.toggle('open', !!idx); const bd = $('#bd'); if (bd) bd.hidden = !idx; }
}
function linkCount(sel, xr) {
  const L = S.links || { links: [], incoming: [] }, noise = l => { const s = (l.to && l.to.sefaria) || (l.from && l.from.sefaria) || ''; return /Dictionary|Jastrow|Footnotes to the English|Lexicon|Klein Dictionary/i.test(s); }, okc = l => (l.confidence ?? 1) >= 0.6 && !noise(l);
  const n = L.links.filter(l => ((l.from && l.from.idx) || 0) === sel && okc(l)).length + L.incoming.filter(l => ((l.to && l.to.idx) || 0) === sel && okc(l)).length;
  return n || xr.reduce((a, x) => a + x.items.length, 0);
}
function renderSide() {
  const { data, sel, W } = S, side = $('#side');
  const hidden = new Set(pref.get('hiddenWho', []));
  const whoBlock = (who, list, open) => { const d = h(`<details class="cm" ${open ? 'open' : ''}><summary>${esc(HEWHO[who] || who)} <span class="mut">${esc(who)} · ${list.length}</span></summary><div class="cmt-tools"><a href="#/shelf/${S.work}/${encodeURIComponent(S.sec)}/${encodeURIComponent(who)}">Read ${esc(who)} on its own page ↗</a></div></details>`); list.forEach(c => { const x = document.createElement('div'); x.className = 'cmt'; x.innerHTML = dhBold(c.he, who); d.append(x); }); return d; };
  if (!sel) {
    side.innerHTML = `<div class="inner"><p class="mut">Click a ${t('seg').toLowerCase()} to see its commentary and links. Select words to attach a note to them.</p><div id="pgc"></div><h2 style="font-size:17px">${t('notes')} — ${W.label(S.sec)}</h2><div id="nb"></div></div>`;
    const pg = data.comments.filter(c => c.idx === 0);
    if (pg.length) {
      const by = {}; pg.forEach(c => (by[c.who] = by[c.who] || []).push(c));
      const box = $('#pgc', side); box.innerHTML = '<h2 style="margin:6px 0;font-size:17px">Commentary on the whole page</h2><p class="mut" style="font-size:12px">These mefarshim are organized by their own sections, so they are not tied to a single line here.</p>';
      Object.keys(by).sort(whoSort).forEach(who => box.append(whoBlock(who, by[who], false)));
    }
    notesBrowser($('#nb', side), { scope: 'page' }); return;
  }
  const cm = data.comments.filter(c => c.idx === sel), xr = data.xrefs.filter(x => x.idx === sel);
  const tabBtn = (k, label) => `<button role="tab" aria-selected="${S.tab === k}" data-tab="${k}" class="${S.tab === k ? 'on' : ''}">${label}</button>`;
  side.innerHTML = `<div class="sidehead"><div class="bar"><b class="he">${esc(secLabel(S.work, S.sec))} · ${W.num(sel)}</b><button class="ghost sm" id="clr" aria-label="Close panel">✕</button></div>
    <div class="tabs" role="tablist">${tabBtn('commentary', `${t('commentary')} (${cm.length})`)}${tabBtn('links', `${t('links')} (${linkCount(sel, xr)})`)}${tabBtn('notes', t('notes'))}</div></div><div class="inner" id="tb" role="tabpanel"></div>`;
  $('#clr', side).onclick = () => selectSeg(null);
  $$('.tabs button', side).forEach(b => b.onclick = () => { S.tab = b.dataset.tab; renderSide(); });
  const tb = $('#tb', side);
  if (S.tab === 'commentary') {
    if (!cm.length) tb.innerHTML = '<p class="mut">No imported commentary on this segment.</p>';
    const by = {}; cm.forEach(c => (by[c.who] = by[c.who] || []).push(c));
    const whos = Object.keys(by).sort(whoSort);
    if (whos.length > 3) {
      const chips = h(`<div class="who-chips" role="group" aria-label="Choose which mefarshim to show">${whos.map(w => `<button class="ghost" data-w="${esc(w)}" aria-pressed="${!hidden.has(w)}" title="Show or hide ${esc(w)}">${esc(HEWHO[w] || w)}</button>`).join('')}</div>`);
      chips.onclick = e => { const b = e.target.closest('[data-w]'); if (!b) return; const w = b.dataset.w, hs = new Set(pref.get('hiddenWho', [])); hs.has(w) ? hs.delete(w) : hs.add(w); pref.set('hiddenWho', [...hs]); renderSide(); };
      tb.append(chips);
      const tools = h('<div class="sidetools"><button class="ghost sm" id="expall">Expand all</button><button class="ghost sm" id="colall">Collapse all</button><button class="ghost sm" id="showall">Show all mefarshim</button></div>');
      tb.append(tools); $('#expall', tools).onclick = () => $$('details.cm', tb).forEach(d => d.open = true); $('#colall', tools).onclick = () => $$('details.cm', tb).forEach(d => d.open = false);
      $('#showall', tools).onclick = () => { pref.set('hiddenWho', []); renderSide(); };
    }
    const shown = whos.filter(w => !hidden.has(w));
    shown.forEach((who, k) => tb.append(whoBlock(who, by[who], S.openWho ? who === S.openWho : k === 0)));
    if (whos.length && !shown.length) tb.insertAdjacentHTML('beforeend', '<p class="mut">All mefarshim are hidden. Use "Show all mefarshim".</p>');
  } else if (S.tab === 'links') {
    if (renderLinksTab(tb, sel)) { /* new connections shown */ } else if (!xr.length) tb.innerHTML = '<p class="mut">No cross-reference links for this segment yet. Links for the newer books (everything except Shemos, Mishnah Berakhos and Gemara Berakhos) are still being imported and checked.</p>';
    if (xr.length) tb.insertAdjacentHTML('beforeend', '<p class="mut" style="font-size:12px">Imported from the Sefaria link graph. Opens the source on Sefaria.</p>');
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
  root.innerHTML = `<div class="filters"><input data-f="q" type="search" placeholder="Search these notes" aria-label="Search these notes"><select data-f="sort" aria-label="Sort notes"><option value="votes">Top voted</option><option value="new">Newest</option><option value="long">Longest</option><option value="idx">By position</option></select></div>
   <details class="fl"><summary>Filters</summary><div class="filters">
   <select data-f="scope" aria-label="Where"><option value="verse">This ${S.sel ? 'segment' : 'page'}</option><option value="page">This page</option><option value="work">Whole book</option></select>
   <select data-f="kind" aria-label="Type"><option value="">All types</option><option value="note">Notes</option><option value="question">Questions</option></select>
   <select data-f="answered" aria-label="Answer state"><option value="">Any answer state</option><option value="0">Unanswered</option><option value="1">Answered</option></select>
   <select data-f="level" aria-label="Author level"><option value="">Any level</option>${facets.levels.map(l => `<option value="${l.level}">${esc(LEVELS[l.level] || l.level)} (${l.c})</option>`).join('')}</select>
   <select data-f="author" aria-label="Author"><option value="">Any author</option>${facets.authors.map(a => `<option>${esc(a.name)}</option>`).join('')}</select>
   <select data-f="tag" aria-label="Topic"><option value="">Any topic</option>${facets.tags.map(a => `<option>${esc(a.tag)}</option>`).join('')}</select>
   <label class="chk"><input type="checkbox" data-f="mine"> Only my notes</label></div></details><div class="nl" aria-live="polite"></div>`;
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
   ${(ALIAS[n.work] || n.work) !== S.work || n.sec !== S.sec ? `<a href="#/read/${ALIAS[n.work] || n.work}/${n.sec}/${n.idx}">${esc(secLabel(n.work, n.sec))} · ${n.idx}</a>` : ''}</div>
   ${n.title ? `<div><b>${esc(n.title)}</b></div>` : ''}${n.quote ? `<div class="quote">${esc(n.quote)}</div>` : ''}<div class="body-t">${esc(n.body)}</div>
   <div>${(n.tags || '').split(',').filter(Boolean).map(x => `<span class="tag">${esc(x)}</span>`).join('')}</div>
   ${n.links?.length ? `<div class="mut" style="font-size:12px">↔ ${n.links.map(l => `<a href="#/read/${ALIAS[l.work] || l.work}/${l.sec}/${l.idx}">${esc(secLabel(l.work, l.sec))}${l.idx ? ' · ' + l.idx : ''}</a>`).join(' · ')}</div>` : ''}
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
  const o = window._so || (window._so = { layer: 'all', pref: false, phrase: false, cat: '', book: '', who: '' });
  const bookOpts = Object.keys(WORKS || {}).map(id => `<option value="${esc(id)}">${esc(WORKS[id].he || id)}</option>`).join('');
  const card = x => `<div class="card"><a href="#/read/${ALIAS[x.work] || x.work}/${x.sec}/${x.idx}">${esc(secLabel(x.work, x.sec))} · ${x.idx}</a>${x.kind === 'comm' ? ` <span class="pill">${esc(x.who)}</span>` : ''}<div class="he">${x.kind ? x.he : esc(String(x.he).replace(/<[^>]+>/g, ''))}</div></div>`;
  async function run(after) {
    const qs = new URLSearchParams({ q, layer: o.layer }); if (o.pref) qs.set('pref', '1'); if (o.phrase) qs.set('phrase', '1');
    if (o.cat) qs.set('cat', o.cat); if (o.book) qs.set('book', o.book); if (o.who) qs.set('who', o.who); if (after) qs.set('after', after);
    return api('/search?' + qs);
  }
  $('#sq').value = q; app.innerHTML = `<h1 style="font-size:28px">Search: ${esc(q)}</h1><p class="mut">…</p>`;
  try {
    const r = await run('');
    app.innerHTML = `<h1 style="font-size:28px">Search: ${esc(q)}</h1>
      <div class="card" style="font-size:13px"><div class="row"><label>In</label><select id="so-l"><option value="all">text + commentary</option><option value="base">text only</option><option value="comm">commentary only</option></select>
      <select id="so-c"><option value="">all categories</option><option value="tanakh">Tanakh</option><option value="mishnah">Mishnah</option><option value="bavli">Talmud Bavli</option><option value="yerushalmi">Yerushalmi</option><option value="tosefta">Tosefta</option><option value="midrash">Midrash</option><option value="halakhah">Halakhah</option><option value="kabbalah">Kabbalah</option><option value="chasidut">Chasidut</option><option value="musar">Musar</option><option value="liturgy">Liturgy</option></select>
      <select id="so-b"><option value="">all books</option>${bookOpts}</select><input id="so-w" placeholder="commentator (e.g. Rashi)" style="max-width:170px" value="${esc(o.who)}"></div>
      <div class="row"><label><input type="checkbox" id="so-p" ${o.pref ? 'checked' : ''}> ignore prefixes (ו ה ב כ ל מ ש)</label><label><input type="checkbox" id="so-x" ${o.phrase ? 'checked' : ''}> exact phrase</label><button class="sm" id="so-g">Search</button><span class="mut">Nikud, trop, punctuation and final letters are ignored.</span></div></div>
      <h2 style="font-size:20px">Text &amp; commentary (${r.text.length}${r.more ? '+' : ''})</h2><div id="so-r">${r.text.map(card).join('') || '<p class="mut">No matches in the text.</p>'}</div>${r.more ? '<button class="ghost" id="so-m">More results</button>' : ''}
      <h2 style="font-size:20px">Notes (${r.notes.length})</h2>` + (r.notes.map(n => `<div class="card"><a href="#/read/${ALIAS[n.work] || n.work}/${n.sec}/${n.idx}">${esc(secLabel(n.work, n.sec))} · ${n.idx}</a> <span class="mut">${esc(n.author)} · ${esc(LEVELS[n.level] || n.level)}</span><div><b>${esc(n.title || '')}</b></div><div class="body-t">${esc(n.body.slice(0, 300))}</div></div>`).join('') || '<p class="mut">No matching notes.</p>');
    $('#so-l').value = o.layer; $('#so-c').value = o.cat; $('#so-b').value = o.book;
    $('#so-g').onclick = () => { o.layer = $('#so-l').value; o.cat = $('#so-c').value; o.book = $('#so-b').value; o.who = $('#so-w').value.trim(); o.pref = $('#so-p').checked; o.phrase = $('#so-x').checked; searchPage(q); };
    const mb = $('#so-m'); let nxt = r.next;
    if (mb) mb.onclick = async () => { mb.disabled = true; try { const r2 = await run(nxt); $('#so-r').insertAdjacentHTML('beforeend', r2.text.map(card).join('')); nxt = r2.next; if (!r2.more) mb.remove(); else mb.disabled = false; } catch (e) { toast(e.message); mb.disabled = false; } };
  } catch (e) { app.innerHTML = '<p class="err">' + esc(e.message) + '</p>'; }
}

// ---------- about / licenses, terms, privacy
async function aboutPage() {
  document.title = 'About & licenses — Torah World';
  const opts = Object.entries(WORKS).sort((a, b) => (a[1].order ?? 0) - (b[1].order ?? 0)).map(([id, w]) => `<option value="${esc(id)}">${esc(w.he)} — ${esc(w.en)}</option>`).join('');
  app.innerHTML = `<h1 style="font-size:30px">About &amp; licenses</h1>
  <div class="card"><h2 style="font-size:19px">What this is</h2><p>Torah World is a free, non-commercial site for learning Tanach, Mishnah, Gemara and many other sefarim with their mefarshim, with notes, questions and answers anchored to exact words, and a chavrusa board.</p>
  <h2 style="font-size:19px">Where the texts come from</h2><p>All texts and commentaries come from <a href="https://www.sefaria.org" target="_blank" rel="noopener">Sefaria</a>'s official open data export. Every text keeps its own license (Public Domain, CC0, CC-BY, CC-BY-SA or CC-BY-NC) and its own credit, shown below for each book and also under every page you read. Texts whose license is unknown or restricted are not copied. Because some texts are CC-BY-NC, the whole site is <b>non-commercial</b>.</p>
  <h2 style="font-size:19px">Code</h2><p>The site's code is published at <a href="https://github.com/yosef-ephriem-rosner/torah-world-public-side" target="_blank" rel="noopener">github.com/yosef-ephriem-rosner/torah-world-public-side</a> under the PolyForm Noncommercial License. The Vilna-style page layout uses the open-source <a href="https://github.com/TalmudLab/daf-renderer" target="_blank" rel="noopener">daf-renderer</a> (MIT); fonts are Frank Ruhl Libre and Noto Rashi Hebrew (SIL Open Font License).</p>
  <p class="mut"><a href="#/terms">Terms</a> · <a href="#/privacy">Privacy</a></p></div>
  <div class="card"><h2 style="font-size:19px">Sources &amp; licenses by book</h2><div class="row"><label for="abook">Book</label><select id="abook">${opts}</select></div><div id="alic" class="mut">Choose a book.</div></div>`;
  const show = async () => {
    const id = $('#abook').value, box = $('#alic'); box.innerHTML = 'Loading…';
    try {
      const m = await api('/manifest?work=' + encodeURIComponent(id)), lic = x => `${esc(x.license)}${x.source ? ` · <a href="${esc(x.source)}" target="_blank" rel="noopener">source</a>` : ''}`;
      box.innerHTML = `<table class="lic"><thead><tr><th>Text</th><th>Version</th><th>License</th></tr></thead><tbody><tr><td><b>${esc(m.book || id)}</b></td><td>${esc(m.base.version)}</td><td>${lic(m.base)}</td></tr>${m.commentaries.map(c => `<tr><td>${esc(c.who)}</td><td>${esc(c.version || '')}</td><td>${lic(c)}</td></tr>`).join('')}</tbody></table>${m.skipped.length ? `<p class="mut" style="font-size:13px">Not included (no allowed license): ${esc([...new Set(m.skipped.map(s => s.title))].join(', '))}</p>` : ''}`;
    } catch (e) { box.textContent = 'No license list is available for this book yet (' + e.message + ').'; }
  };
  $('#abook').onchange = show; show();
}
const TEXTS = {
  terms: ['Terms of use (draft)', ['These terms are a draft and not legal advice; they will be finalized before a public launch.', 'Torah World is free and non-commercial. Do not use it, or its texts, for commercial purposes.', 'The texts come from Sefaria and keep their own licenses and credits (see About &amp; licenses). You may use them only as those licenses allow.', 'Notes, questions and answers are written by users. They are opinions of their authors, labelled with a self-declared level, and are not rabbinic rulings (psak). For a halachic question ask your rav.', 'By posting a public note you allow other users to read it on this site. You can delete your own notes at any time. Private notes are visible only to you.', 'Do not post unlawful, abusive or misleading content, spam, or other people\'s private information. We may remove content or accounts that break these rules.', 'The site is provided as is, without any warranty.']],
  privacy: ['Privacy (draft)', ['This page is a draft and not legal advice.', 'What we store: your chosen username, your self-declared level, a salted hash of your passcode (we cannot read your passcode), your notes, questions, answers, votes, groups you join, and your chavrusa posts and messages.', 'We do not ask for your email or real name and we use no advertising or tracking cookies. One sign-in cookie keeps you logged in (90 days). Your reading preferences (text size, dark mode, recent pages, bookmarks) are stored only in your own browser.', 'Cloudflare hosts the site and processes the web requests, which can include technical data such as IP addresses.', 'Private notes are visible only to you; public notes are visible to everyone; "professionals only" and "group only" notes are visible to the people those labels allow.', 'To delete an account or notes, delete your notes in the site or ask the site owner.']]
};
function textPage(k) {
  const [title, paras] = TEXTS[k]; document.title = title + ' — Torah World';
  app.innerHTML = `<h1 style="font-size:30px">${title}</h1><div class="card">${paras.map(p => `<p>${p}</p>`).join('')}<p class="mut"><a href="#/about">About &amp; licenses</a> · <a href="#/terms">Terms</a> · <a href="#/privacy">Privacy</a></p></div>`;
}

// ---------- bookmarks (kept in this browser)
const bookmarks = () => pref.get('bookmarks', []);
const isBookmarked = (w, s) => bookmarks().some(b => b.work === w && b.sec === s);
function toggleBookmark(w, s) { const b = bookmarks(); const i = b.findIndex(x => x.work === w && x.sec === s); if (i >= 0) b.splice(i, 1); else b.unshift({ work: w, sec: s, t: Date.now() }); pref.set('bookmarks', b.slice(0, 200)); return i < 0; }
function bookmarksPage() {
  document.title = 'Bookmarks — Torah World'; const b = bookmarks().filter(x => WORKS[x.work]);
  app.innerHTML = `<h1 style="font-size:30px">Bookmarks</h1><p class="mut">Saved pages are kept in this browser.</p>${b.length ? `<div class="chips">${b.map(x => `<a class="chip" href="#/read/${x.work}/${x.sec}">${esc(secLabel(x.work, x.sec))}</a>`).join('')}</div>` : '<div class="empty">No bookmarks yet. Use the ☆ button on any page.</div>'}`;
}

// ---------- one mefaresh on its own page
async function shelfPage(work, sec, who) {
  const my = ++navId, W = WORKS[work]; if (!W) return home();
  if (!sec || !W.secs.includes(sec)) sec = W.secs[0];
  app.innerHTML = '<div class="skel" style="width:40%;height:28px"></div><div class="skel"></div><div class="skel"></div>';
  let data; try { data = await api(`/section?work=${work}&sec=${encodeURIComponent(sec)}`); } catch (e) { if (my === navId) app.innerHTML = `<div class="empty"><h1>Not available yet</h1><p>${esc(e.message)}</p><p><a href="#/read/${work}/${W.secs[0]}">Back to the book</a></p></div>`; return; }
  if (my !== navId) return;
  S = null; const whos = [...new Set(data.comments.map(c => c.who))].sort(whoSort); if (!who || !whos.includes(who)) who = whos[0] || '';
  const mine = data.comments.filter(c => c.who === who).sort((a, b) => (a.idx || 0) - (b.idx || 0) || a.n - b.n);
  const seg = Object.fromEntries(data.segments.map(s => [s.idx, s.he])), i = W.secs.indexOf(sec), go = k => W.secs[k] != null ? `#/shelf/${work}/${encodeURIComponent(W.secs[k])}/${encodeURIComponent(who)}` : null;
  const snippet = idx => { const he = (seg[idx] || '').replace(/<[^>]+>/g, '').replace(/[֑-ׇ]/g, ''); const w = he.split(/\s+/).slice(0, 10).join(' '); return w ? w + (he.split(/\s+/).length > 10 ? ' …' : '') : ''; };
  document.title = `${who} on ${W.he} ${W.label(sec)} — Torah World`;
  app.innerHTML = `<nav class="crumbs" aria-label="Breadcrumb"><a href="#/">Home</a> › <a href="#/read/${work}/${sec}">${esc(W.he)} ${esc(W.label(sec))}</a> › <span>${esc(who)}</span></nav>
   <div class="rbar" id="rbar"><h1 class="he">${esc(HEWHO[who] || who)} · ${esc(W.he)} · ${esc(W.label(sec))}</h1>
   <div class="pager">${go(i - 1) ? `<a class="ghost icon" style="display:inline-flex;align-items:center;border:1px solid var(--line);border-radius:8px;padding:6px 12px;text-decoration:none" href="${go(i - 1)}" aria-label="Previous section">◀</a>` : ''}
   <select id="swho" aria-label="Choose a mefaresh">${whos.map(x => `<option value="${esc(x)}" ${x === who ? 'selected' : ''}>${esc(HEWHO[x] || x)} (${data.comments.filter(c => c.who === x).length})</option>`).join('')}</select>
   ${go(i + 1) ? `<a class="ghost icon" style="display:inline-flex;align-items:center;border:1px solid var(--line);border-radius:8px;padding:6px 12px;text-decoration:none" href="${go(i + 1)}" aria-label="Next section">▶</a>` : ''}</div></div>
   <div class="card" style="--cs:${pref.get('cs', 1)}">${mine.length ? mine.map(c => `<div class="shelfc"><div class="mut" style="font-size:12px">${c.idx ? `<a href="#/read/${work}/${sec}/${c.idx}">${W.num(c.idx)} · ${esc(snippet(c.idx))}</a>` : 'whole page'}</div><div class="cmt">${dhBold(c.he, who)}</div></div>`).join('') : `<p class="mut">No comments by ${esc(who)} on this section.</p>`}</div>`;
  $('#swho').onchange = e => location.hash = `#/shelf/${work}/${encodeURIComponent(sec)}/${encodeURIComponent(e.target.value)}`;
  S = { work, sec, W, data, sel: null, notes: [], links: { links: [], incoming: [] } }; S.W = W;
}

// ---------- chavrusa
async function chavrusaPage() {
  app.innerHTML = `<h1 style="font-size:28px">חברותא · Chavrusa board</h1><div class="card"><b>Looking for a chavrusa?</b>
   <div class="row"><label>What</label><input id="ct" placeholder="e.g. Gemara Berakhos 2a, iyun" maxlength="100"></div>
   <div class="row"><label>Text</label><input id="cr" placeholder="optional: Berakhot 2a" maxlength="100"></div>
   <div class="row"><label>When</label><input id="cw" placeholder="Now / Sun–Thu 20:00–21:30" maxlength="100"><input id="ctz" aria-label="Time zone" value="${Intl.DateTimeFormat().resolvedOptions().timeZone}" style="max-width:190px"></div>
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
  app.innerHTML = `<h1 style="font-size:28px">${esc(ME.name)}</h1><div class="card"><div class="row"><label>My level</label><select id="ml">${Object.entries(LEVELS).map(([k, v]) => `<option value="${k}" ${k === ME.level ? 'selected' : ''}>${v}</option>`).join('')}</select></div><p class="mut" style="font-size:12px">Self-declared. Older notes keep the level they were posted with.</p></div>
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
loadCatalog().then(() => { buildMenu(); return loadMe(); }).then(route);
