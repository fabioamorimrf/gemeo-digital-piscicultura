const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1400, height: 1000 } });
  const errs = [];
  const p = await ctx.newPage(); p.on('pageerror', e => errs.push('painel ' + e.message));
  await p.goto('http://localhost:8765/index.html'); await p.waitForTimeout(1500);
  const s = await ctx.newPage(); s.on('pageerror', e => errs.push('sim ' + e.message));
  await s.goto('http://localhost:8765/simulador.html'); await s.waitForTimeout(1500);
  const info = async (rot) => { const r = await p.evaluate(() => ({ t: document.querySelector('#hora').textContent + ' ' + document.querySelector('#data').textContent, od: __gemeo.atual.od, aer: __gemeo.aerador + '/' + __gemeo.origemAerador, al: __gemeo.alertas.map(a => a.titulo).join(' | '), ac: __gemeo.acoes.slice(0, 3).map(a => a.txt).join(' || '), rac: __gemeo.plano && __gemeo.plano.total.toFixed(1) + ' kg ' + __gemeo.plano.motivo })); console.log('['+rot+']', JSON.stringify(r)); };
  await s.click('text=1 h/s');
  await s.click('[data-ev=algas]'); for (let i=0;i<4;i++){ await s.waitForTimeout(4000); await info('algas'); }
  await s.click('[data-ev=normal]'); await s.click('[data-ev=internet]'); await s.waitForTimeout(1500); await info('internet'); await s.waitForTimeout(2500); await info('internet+');
  await s.waitForTimeout(3000); await info('volta');
  await s.click('[data-ev=sensor]'); await s.waitForTimeout(1200); await info('sensor');
  await s.click('[data-ev=normal]'); await s.click('[data-ev=frio]'); await s.waitForTimeout(16000); await info('frio');
  await p.bringToFront(); await p.screenshot({ path: 'test/painel3.png', fullPage: true });
  await s.bringToFront(); await s.screenshot({ path: 'test/sim3.png', fullPage: false });
  // arquivo local (file://)
  const f1 = await ctx.newPage(); await f1.goto('file://' + process.cwd() + '/dist/site/index.html'); await f1.waitForTimeout(1500);
  const f2 = await ctx.newPage(); await f2.goto('file://' + process.cwd() + '/dist/site/simulador.html'); await f2.waitForTimeout(2500);
  console.log('file:// painel modo', await f1.evaluate(() => __est.modo), await f2.textContent('#chip-painel'));
  console.log(errs.join('\n') || 'sem erros'); await b.close();
})();
