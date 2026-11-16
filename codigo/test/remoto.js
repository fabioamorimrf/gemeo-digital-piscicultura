// Controle remoto: painel (PC) é o único dono da simulação; o celular só manda ações e mostra o estado.
// Broker "na nuvem" = servidor.py na porta 8100; site pelo http.server 8765 (como no GitHub Pages).
const { chromium, devices } = require('playwright');
(async () => {
  const errs = []; const b = await chromium.launch();
  const cfg = Buffer.from(JSON.stringify({ url: 'ws://localhost:8100/mqtt', sala: 'tst' })).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const pc = await b.newContext({ viewport: { width: 1400, height: 950 } }), cel = await b.newContext({ ...devices['Pixel 7'] }), cel2 = await b.newContext({ ...devices['Pixel 7'] });
  const pg = (ctx, nome) => ctx.newPage().then(p => { p.on('pageerror', e => errs.push(nome + ' ' + e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(nome + ' ' + m.text()); }); return p; });
  // 1) celular abre ANTES do painel: deve esperar, sem simular sozinho
  const s = await pg(cel, 'cel'); await s.goto('http://localhost:8765/simulador.html#mqtt=' + cfg); await s.waitForTimeout(3000);
  console.log('1 celular sem painel:', await s.evaluate(() => window.__simPg().papel), '|', await s.textContent('#chip-painel'), '|', await s.textContent('#chip-rede'));
  await s.screenshot({ path: 'test/remoto-espera.png' });
  const p = await pg(pc, 'pc'); await p.goto('http://localhost:8765/index.html#mqtt=' + cfg); await p.waitForTimeout(5000);
  console.log('2 painel', await p.evaluate(() => window.__est.modo), '|', await p.textContent('#chip-fonte'), '| celular', await s.evaluate(() => window.__simPg().papel), '|', await s.textContent('#chip-painel'));
  // 2) segundo celular entra também
  const s2 = await pg(cel2, 'cel2'); await s2.goto('http://localhost:8765/simulador.html#mqtt=' + cfg); await s2.waitForTimeout(4000);
  console.log('3 cel2', await s2.evaluate(() => window.__simPg().papel), '| painel', await p.evaluate(() => window.__est.modo));
  // 3) relógio do painel só anda para frente (sem duas simulações disputando)
  const ts = []; for (let i = 0; i < 16; i++) { ts.push(await p.evaluate(() => window.__est.motor.sim.t)); await p.waitForTimeout(250); }
  console.log('4 relógio monotônico', ts.every((t, i) => i === 0 || t >= ts[i - 1]), '| passos', new Set(ts).size);
  // 4) ações do celular chegam ao painel
  await s.click('[data-vel="60"]'); await s.waitForTimeout(1200);
  console.log('5 vel no painel', await p.evaluate(() => window.__est.motor.vel), '| botão ativo no cel', await s.$eval('[data-vel="60"]', e => e.classList.contains('ativo')), await s.evaluate(() => [window.__simPg().estado.vel, window.__simPg().estado.pausado, document.querySelector('#hora').textContent]));
  await s.waitForTimeout(1500); console.log('  depois', await s.evaluate(() => [document.querySelector('[data-vel="60"]').className, document.querySelector('#hora').textContent]));
  await s.click('#c-pausa'); await s.waitForTimeout(1200);
  const tA = await p.evaluate(() => window.__est.motor.sim.t); await p.waitForTimeout(1500); const tB = await p.evaluate(() => window.__est.motor.sim.t);
  console.log('6 pausado', await p.evaluate(() => window.__est.motor.pausado), '| parado', tA === tB, '| cel2 mostra', await s2.textContent('#chip-vel'));
  await s.click('#c-pausa'); await s.waitForTimeout(800);
  await s.$eval('#c-dta', e => { e.value = '-6'; e.dispatchEvent(new Event('input')); e.dispatchEvent(new Event('change')); }); await s.waitForTimeout(1200);
  console.log('7 desvio do ar no painel', await p.evaluate(() => window.__est.motor.sim.ctl.deltaTempAr), '| cel2 slider', await s2.inputValue('#c-dta'));
  await s.click('[data-ev=algas]'); await s.waitForTimeout(1200);
  console.log('8 evento no painel', await p.evaluate(() => window.__est.motor.sim.temporarios.map(e => e.rotulo).filter(Boolean).join(',')), '| botão ativo cel', await s.$eval('[data-ev=algas]', e => e.classList.contains('ativo')));
  await s.click('#c-net'); await s.waitForTimeout(1200);
  console.log('9 internet no painel', await p.evaluate(() => window.__est.motor.sim.ctl.internet), '| cel', await s.isChecked('#c-net'));
  await s.click('#c-net'); await s.waitForTimeout(800);
  await s.screenshot({ path: 'test/remoto-cel.png' });
  console.log('10 chip painel', await p.textContent('#chip-fonte'), '| painel ainda dono', await p.evaluate(() => window.__est.modo));
  // 5) painel fecha: celular avisa e não assume a simulação
  await p.close(); await s.waitForTimeout(6500);
  console.log('11 sem painel:', await s.evaluate(() => window.__simPg().papel), '|', await s.textContent('#chip-painel'));
  console.log(errs.join('\n') || 'sem erros'); await b.close();
})();
