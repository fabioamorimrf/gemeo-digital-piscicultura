// Computador e celular como contextos separados (sem BroadcastChannel entre eles): só o MQTT do servidor.py liga os dois.
const { chromium, devices } = require('playwright');
const mqtt = require(process.env.MQTTJS);
(async () => {
  const URL = 'http://localhost:8100/'; const errs = [];
  // cliente MQTT por TCP, como o MQTT Explorer faria
  const tcp = mqtt.connect('mqtt://localhost:18830'); const vistos = {};
  tcp.on('connect', () => tcp.subscribe('gemeo/viveiro1/#')); tcp.on('message', (t, p) => { vistos[t] = p.toString(); });
  const b = await chromium.launch();
  const pc = await b.newContext({ viewport: { width: 1400, height: 950 } }), cel = await b.newContext({ ...devices['Pixel 7'] });
  const p = await pc.newPage(); p.on('pageerror', e => errs.push('pc ' + e.message)); p.on('console', m => { if (m.type() === 'error') errs.push('pc ' + m.text()); });
  await p.goto(URL); await p.waitForTimeout(3000);
  console.log('1 painel', await p.evaluate(() => window.__est.modo), '| botão celular visível', await p.isVisible('#bt-celular'));
  await p.click('#bt-celular'); await p.waitForTimeout(800); console.log('  url QR', await p.textContent('#mc-url'), '| svg', await p.$$eval('#mc-qr svg', x => x.length));
  await p.screenshot({ path: 'test/qr.png' }); await p.click('#bt-fechar-celular');
  const s = await cel.newPage(); s.on('pageerror', e => errs.push('cel ' + e.message)); s.on('console', m => { if (m.type() === 'error') errs.push('cel ' + m.text()); });
  await s.goto(URL + 'simulador.html'); await s.waitForTimeout(4000);
  console.log('2 painel', await p.evaluate(() => window.__est.modo), await p.textContent('#chip-fonte'), '| celular', await s.textContent('#chip-painel'), '|', await s.textContent('#chip-rede'));
  const t0 = await p.textContent('#hora'); await s.waitForTimeout(2000); console.log('  relógio do painel andando', t0, '->', await p.textContent('#hora'));
  await s.click('[data-ev=algas]'); await s.waitForTimeout(1500);
  await p.click('#bt-ligar'); await s.waitForTimeout(2000);
  console.log('3 aerador no celular:', await s.textContent('#c-aer'));
  await s.screenshot({ path: 'test/celular.png', fullPage: false });
  console.log('4 TCP viu', Object.keys(vistos).filter(k => !k.endsWith('_abas')).length, 'tópicos; od =', vistos['gemeo/viveiro1/agua/od'], '| comando =', vistos['gemeo/viveiro1/comando/aerador']);
  console.log('5 largura celular', await s.evaluate(() => document.documentElement.scrollWidth));
  console.log(errs.join('\n') || 'sem erros'); tcp.end(); await b.close();
})();
