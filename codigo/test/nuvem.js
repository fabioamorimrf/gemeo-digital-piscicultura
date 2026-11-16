// "Broker na internet" simulado pelo servidor.py na porta 8100; o site vem do http.server comum (8765), como no GitHub Pages.
const { chromium, devices } = require('playwright');
(async () => {
  const errs = []; const b = await chromium.launch();
  const pc = await b.newContext({ viewport: { width: 1400, height: 950 } }), cel = await b.newContext({ ...devices['Pixel 7'] });
  const p = await pc.newPage(); p.on('pageerror', e => errs.push('pc ' + e.message)); p.on('console', m => { if (m.type() === 'error') errs.push('pc ' + m.text()); });
  await p.goto('http://localhost:8765/index.html'); await p.waitForTimeout(2500);
  await p.click('#bt-celular'); await p.waitForTimeout(300);
  console.log('1 form visível', await p.isVisible('#mc-config'), '| broker padrão', await p.inputValue('#mc-broker'));
  await p.screenshot({ path: 'test/nuvem-form.png' });
  await p.fill('#mc-broker', 'ws://localhost:8100/mqtt'); await p.click('#bt-mc-conectar'); await p.waitForTimeout(2000);
  const link = await p.evaluate(() => window.__bus ? window.__bus.linkCelular() : null);
  console.log('2 estado', await p.textContent('#mc-estado'), '| link', link && link.slice(0, 70) + '...');
  await p.screenshot({ path: 'test/nuvem-qr.png' }); await p.click('#bt-fechar-celular');
  const s = await cel.newPage(); s.on('pageerror', e => errs.push('cel ' + e.message)); s.on('console', m => { if (m.type() === 'error') errs.push('cel ' + m.text()); });
  await s.goto(link); await s.waitForTimeout(4000);
  console.log('3 painel', await p.evaluate(() => window.__est.modo), await p.textContent('#chip-fonte'), '| celular', await s.textContent('#chip-painel'), '|', await s.textContent('#chip-rede'), '| hash limpo', !(await s.evaluate(() => location.hash)));
  await p.click('#bt-desligar'); await s.waitForTimeout(1500); console.log('4 aerador no celular:', await s.textContent('#c-aer'));
  // recarregar o painel mantém a sala
  await p.reload(); await p.waitForTimeout(4000); console.log('5 após recarregar', await p.evaluate(() => window.__est.modo), await p.textContent('#chip-fonte'));
  console.log(errs.join('\n') || 'sem erros'); await b.close();
})();
