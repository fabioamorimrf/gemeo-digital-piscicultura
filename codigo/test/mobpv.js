const { chromium } = require('playwright');
(async () => { const b = await chromium.launch(); const c = await b.newContext({ viewport: { width: 390, height: 800 } });
 await c.route('https://api.open-meteo.com/**', r => r.abort());
 for (const u of ['previsao.html', 'fontes.html']) { const p = await c.newPage(); await p.goto('http://localhost:8765/' + u); await p.waitForTimeout(2500);
  console.log(u, await p.evaluate(() => document.documentElement.scrollWidth)); }
 await b.close(); })();
