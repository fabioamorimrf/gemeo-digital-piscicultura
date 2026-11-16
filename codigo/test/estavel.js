const { chromium } = require('playwright');
(async () => { const b = await chromium.launch();
 for (const w of [1400, 1180, 1000, 820, 390]) {
  const p = await b.newPage({ viewport: { width: w, height: 900 } }); await p.goto('http://localhost:8765/index.html'); await p.waitForTimeout(1500);
  await p.evaluate(() => { const b = [...document.querySelectorAll('[data-vel]')]; });
  const alt = new Set(), tops = new Set(), wraps = new Set();
  for (let i = 0; i < 40; i++) { const r = await p.evaluate(() => ({ h: document.querySelector('.leituras').getBoundingClientRect().height, top: document.querySelector('main.grade').getBoundingClientRect().top + scrollY, w: [...document.querySelectorAll('.tile .linha2')].map(e => e.getBoundingClientRect().height).join(',') })); alt.add(r.h); tops.add(r.top); wraps.add(r.w); await p.waitForTimeout(250); }
  console.log(w, 'alturas', [...alt], 'topo grade', [...tops], 'rodapés', wraps.size); await p.close(); }
 await b.close(); })();
