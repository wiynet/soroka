const { chromium } = require('playwright'); const fs = require('fs');
(async () => {
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] }); const p = await b.newPage();
  await p.goto(process.argv[2]); await p.waitForFunction(() => window.ready === true);
  const views = JSON.parse(process.argv[4]);
  for (const [i, v] of views.entries()) { const d = await p.evaluate((v) => { window.DBG = v; window.setup('dbg'); return window.frame(0); }, v); fs.writeFileSync(`${process.argv[3]}_${i}.png`, Buffer.from(d.split(',')[1], 'base64')); }
  await b.close();
})();
