const { chromium } = require('playwright');
(async () => { const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1400, height: 1000 } });
 await ctx.route('https://api.open-meteo.com/**', r => r.abort()); const errs = [];
 const p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message));
 p.on('popup', () => errs.push('abriu popup')); p.on('framenavigated', f => { if (f === p.mainFrame()) errs.push('navegou ' + f.url()); });
 await p.goto('http://localhost:8765/index.html'); await p.waitForTimeout(2500); errs.length = 0;
 await p.click('.abas [data-vista=previsao]'); await p.waitForTimeout(2500);
 console.log('previsão', await p.isVisible('#vista-previsao'), await p.isHidden('#vista-painel'), await p.textContent('#pv-chip-fonte'), '|', await p.textContent('#pv-chip-lote'), '| linhas', await p.$$eval('#pv-tab tr', x => x.length));
 await p.screenshot({ path: 'test/abas-prev.png' });
 await p.click('.abas [data-vista=fontes]'); await p.waitForTimeout(500);
 console.log('fontes', await p.isVisible('#vista-fontes'), await p.$$eval('#ft-itens tr', x => x.length));
 await p.click('.abas [data-vista=painel]'); await p.waitForTimeout(800);
 console.log('painel', await p.isVisible('#vista-painel'), await p.textContent('#chip-fonte'));
 // externo: simulador aberto
 const s = await ctx.newPage(); await s.goto('http://localhost:8765/simulador.html'); await s.waitForTimeout(2500);
 await p.click('.abas [data-vista=previsao]'); await p.click('#pv-sim'); await p.waitForTimeout(2000);
 console.log('externo', await p.evaluate(() => window.__est.modo), await p.textContent('#pv-chip-fonte'), await p.$$eval('#pv-tab tr', x => x.length));
 console.log(errs.join('\n') || 'sem erros'); await b.close(); })();
