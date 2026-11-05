// node render.js <url> <outdir> <fps> id1 id2 ...  — снимает кадры каждой модели в PNG
const { chromium } = require('playwright'); const fs = require('fs');
(async () => {
  const [url, outdir, fps, ...ids] = process.argv.slice(2);
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await b.newPage(); const errs = [];
  p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto(url); await p.waitForFunction(() => window.ready === true, null, { timeout: 60000 }).catch(() => {});
  if (errs.length) { console.log(errs.join('\n')); }
  for (const id of ids) {
    const t0 = Date.now(); const { dur } = await p.evaluate((id) => window.setup(id), id);
    const n = Math.round(dur * fps); fs.mkdirSync(`${outdir}/${id}`, { recursive: true });
    for (let i = 0; i < n; i++) {
      const d = await p.evaluate((t) => window.frame(t), i / fps);
      fs.writeFileSync(`${outdir}/${id}/${String(i).padStart(3, '0')}.png`, Buffer.from(d.split(',')[1], 'base64'));
    }
    console.log(id, n, 'frames', ((Date.now() - t0) / 1000).toFixed(1) + 's');
  }
  if (errs.length) console.log('ERRORS', errs.slice(0, 5).join('\n'));
  await b.close();
})();
