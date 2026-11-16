const { chromium } = require('playwright');
const mock = { daily: { time: ['2026-11-17','2026-11-18','2026-11-19','2026-11-20','2026-11-21','2026-11-22','2026-11-23'],
  temperature_2m_max: [31.2, 32.5, 33.1, 27.0, 25.4, 28.9, 30.2], temperature_2m_min: [20.1, 21.0, 21.4, 19.2, 18.0, 18.9, 19.8],
  precipitation_sum: [0, 2.1, 0, 28.4, 12.0, 0.4, 0], shortwave_radiation_sum: [26.1, 24.8, 27.0, 9.5, 12.2, 22.0, 25.3], wind_speed_10m_max: [3.1, 2.4, 2.0, 8.6, 5.2, 3.4, 3.0] } };
(async () => {
  const b = await chromium.launch(); const errs = [];
  const nova = async (ctx, url, nome) => { const p = await ctx.newPage(); p.on('pageerror', e => errs.push(nome + ' ' + e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(nome + ' ' + m.text()); }); await p.goto(url); return p; };
  // 1) previsão real (mock) sozinha
  let ctx = await b.newContext({ viewport: { width: 1400, height: 1000 } });
  await ctx.route('https://api.open-meteo.com/**', r => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(mock) }));
  let p = await nova(ctx, 'http://localhost:8765/previsao.html', 'pv1'); await p.waitForTimeout(2500);
  console.log('1', await p.textContent('#pv-chip-fonte'), '|', await p.textContent('#pv-chip-lote'));
  console.log('  ', (await p.textContent('#pv-tab')).replace(/\s+/g, ' ').slice(0, 600));
  await p.screenshot({ path: 'test/previsao1.png', fullPage: true }); await ctx.close();
  // 2) bloqueado, sem outras abas
  ctx = await b.newContext({ viewport: { width: 1400, height: 1000 } });
  await ctx.route('https://api.open-meteo.com/**', r => r.abort());
  p = await nova(ctx, 'http://localhost:8765/previsao.html', 'pv2'); await p.waitForTimeout(3000);
  console.log('2', await p.textContent('#pv-chip-fonte'), '|', await p.isHidden('#pv-aviso'), '|', await p.textContent('#pv-chip-lote'));
  await ctx.close();
  // 3) simulador + painel + previsão
  ctx = await b.newContext({ viewport: { width: 1400, height: 1000 } });
  await ctx.route('https://api.open-meteo.com/**', r => r.abort());
  const s = await nova(ctx, 'http://localhost:8765/simulador.html', 'sim'); await s.waitForTimeout(1500);
  const pn = await nova(ctx, 'http://localhost:8765/index.html', 'painel'); await pn.waitForTimeout(2000);
  p = await nova(ctx, 'http://localhost:8765/previsao.html', 'pv3'); await p.waitForTimeout(3500);
  console.log('3', await p.textContent('#pv-chip-fonte'), '|', await p.textContent('#pv-chip-lote'), '| painel', await pn.evaluate(() => window.__est.modo), await s.textContent('#chip-painel'));
  await p.screenshot({ path: 'test/previsao3.png', fullPage: true });
  // 4) painel interno + previsão
  await ctx.close(); ctx = await b.newContext({ viewport: { width: 1400, height: 1000 } });
  await ctx.route('https://api.open-meteo.com/**', r => r.abort());
  const pi = await nova(ctx, 'http://localhost:8765/index.html', 'painelI'); await pi.waitForTimeout(2000);
  p = await nova(ctx, 'http://localhost:8765/previsao.html', 'pv4'); await p.waitForTimeout(3500);
  console.log('4', await p.textContent('#pv-chip-fonte'), '|', await p.textContent('#pv-chip-lote'), '| painel', await pi.evaluate(() => window.__est.modo));
  const f = await nova(ctx, 'http://localhost:8765/fontes.html', 'fontes'); await f.waitForTimeout(800);
  console.log('fontes', await f.textContent('#ft-conta'));
  await f.screenshot({ path: 'test/fontes.png', fullPage: true });
  console.log(errs.join('\n') || 'sem erros'); await b.close();
})();
