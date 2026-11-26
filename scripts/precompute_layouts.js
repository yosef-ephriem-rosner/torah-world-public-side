// Precompute the fixed tzuras hadaf layout numbers (spacer heights) once per amud and nikud variant.
// Run: node scripts/precompute_layouts.js [baseUrl]   (needs playwright + a running site, e.g. `wrangler dev --local`)
// Output: public/layouts.js (loaded by the site) and layouts.json (backup copy for the repo).
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const BASE = process.argv[2] || 'http://localhost:8787';
const root = path.join(__dirname, '..');
const dafs = (first, last) => { const out = []; let n = parseInt(first), side = first.slice(-1); const end = [parseInt(last), last.slice(-1)]; for (;;) { out.push(n + side); if (n === end[0] && side === end[1]) break; if (side === 'a') side = 'b'; else { side = 'a'; n++; } } return out; };
let BOOKS = { 'bavli-berakhot': dafs('2a', '64a'), 'bavli-shabbat': dafs('2a', '51b') };
(async () => {
  const out = fs.existsSync(path.join(root, 'layouts.json')) ? JSON.parse(fs.readFileSync(path.join(root, 'layouts.json'))) : {};
  const only = process.argv[3] || ''; // optional: one book id
  const br = await chromium.launch(); const pg = await (await br.newContext({ viewport: { width: 1400, height: 1000 } })).newPage();
  await pg.addInitScript(() => { window.__PRECOMPUTE = true; });
  await pg.goto(BASE + '/#/'); await pg.waitForSelector('#app');
  if (only) { // sections of this book come from the site's catalog
    const cat = await pg.evaluate(async () => (await fetch('/api/catalog')).json()).catch(() => null);
    const b = cat && cat.books.find(x => x.id === only); if (b) BOOKS = { [only]: b.secs };
  }
  let bad = [];
  for (const [work, secs] of Object.entries(BOOKS)) { if (only && work !== only) continue; for (const nik of [0, 1]) for (const sec of secs) {
    const key = work + '|' + sec + '|' + nik; if (out[key]) continue;
    await pg.evaluate(([n]) => { localStorage.nikud = n ? '1' : '0'; localStorage.dafView = 'page'; window.__dafDone = null; }, [nik]);
    await pg.evaluate(s => { location.hash = '#/read/' + s; }, work + '/' + sec);
    try {
      await pg.waitForFunction(([s, n]) => window.__dafDone && window.__dafDone.work === s[0] && window.__dafDone.sec === s[1] && window.__dafDone.nikud === !!n, [[work, sec], nik], { timeout: 20000 });
      const d = await pg.evaluate(() => window.__dafDone);
      if (!d.spacers || d.spacers.inner == null) { bad.push(key); continue; }
      out[key] = d.spacers; out[key].h = d.height;
    } catch (e) { bad.push(key); }
  } }
  await br.close();
  const keys = Object.keys(out).sort();
  if (!process.env.CI_LAYOUTS) {
    fs.writeFileSync(path.join(root, 'layouts.json'), JSON.stringify(out));
    fs.writeFileSync(path.join(root, 'public', 'layouts.js'), 'window.DAF_LAYOUTS = ' + JSON.stringify(out) + ';\n');
  }
  if (only) { // per-book file for R2 (layouts/<book>.json), loaded by the site on demand
    const mine = Object.fromEntries(Object.entries(out).filter(([k]) => k.startsWith(only + '|')));
    fs.mkdirSync(path.join(root, 'out', 'layouts'), { recursive: true });
    fs.writeFileSync(path.join(root, 'out', 'layouts', only + '.json'), JSON.stringify(mine));
  }
  console.log('layouts:', keys.length, 'failed:', bad.length, bad.slice(0, 10).join(','));
})();
