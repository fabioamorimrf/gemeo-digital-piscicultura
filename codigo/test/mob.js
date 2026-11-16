const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const errs=[];
  const c = await b.newContext({ viewport: { width: 400, height: 900 }, colorScheme: 'dark' });
  const p = await c.newPage(); p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8765/index.html'); await p.waitForTimeout(2500);
  await p.click('#bt-controles'); await p.waitForTimeout(800);
  const sw = await p.evaluate(() => document.documentElement.scrollWidth); console.log('scrollWidth', sw);
  await p.screenshot({ path: 'test/mob-gaveta.png' });
  await p.click('#bt-fechar-gaveta'); await p.screenshot({ path: 'test/mob.png', fullPage: true });
  console.log(errs.join('\n')||'sem erros'); await b.close();
})();
