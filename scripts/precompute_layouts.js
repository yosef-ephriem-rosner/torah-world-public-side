// Precompute the fixed tzuras hadaf layout numbers (spacer heights) once per amud and nikud variant.
// Run: node scripts/precompute_layouts.js [baseUrl]   (needs playwright + a running site, e.g. `wrangler dev --local`)
// Output: public/layouts.js (loaded by the site) and layouts.json (backup copy for the repo).
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const BASE = process.argv[2] || 'http://localhost:8787';
const root = path.join(__dirname, '..');
const secs = []; for (let n = 2; n <= 64; n++) { secs.push(n + 'a'); if (n < 64) secs.push(n + 'b'); }
(async () => {
  const out = fs.existsSync(path.join(root, 'layouts.json')) ? JSON.parse(fs.readFileSync(path.join(root, 'layouts.json'))) : {};
  const br = await chromium.launch(); const pg = await (await br.newContext({ viewport: { width: 1400, height: 1000 } })).newPage();
  await pg.addInitScript(() => { window.__PRECOMPUTE = true; });
  await pg.goto(BASE + '/#/read/mishnah/1'); await pg.waitForSelector('.mish');
  let bad = [];
  for (const nik of [0, 1]) for (const sec of secs) {
    const key = sec + '|' + nik; if (out[key]) continue;
    await pg.evaluate(([n]) => { localStorage.nikud = n ? '1' : '0'; localStorage.dafView = 'page'; window.__dafDone = null; }, [nik]);
    await pg.evaluate(s => { location.hash = '#/read/gemara/' + s; }, sec);
    try {
      await pg.waitForFunction(([s, n]) => window.__dafDone && window.__dafDone.sec === s && window.__dafDone.nikud === !!n, [sec, nik], { timeout: 20000 });
      const d = await pg.evaluate(() => window.__dafDone);
      if (!d.spacers || d.spacers.inner == null) { bad.push(key); continue; }
      out[key] = d.spacers; out[key].h = d.height;
    } catch (e) { bad.push(key); }
  }
  await br.close();
  const keys = Object.keys(out).sort();
  fs.writeFileSync(path.join(root, 'layouts.json'), JSON.stringify(out));
  fs.writeFileSync(path.join(root, 'public', 'layouts.js'), 'window.DAF_LAYOUTS = ' + JSON.stringify(out) + ';\n');
  console.log('layouts:', keys.length, 'failed:', bad.length, bad.slice(0, 10).join(','));
})();
