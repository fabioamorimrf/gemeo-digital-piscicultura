// Vários brokers ao mesmo tempo: os brokers públicos são redirecionados para dois servidor.py locais.
// PC: HiveMQ "não responde" (connack timeout simulado), EMQX ok (8100), Mosquitto ok (8101).
// Celular: HiveMQ não responde, EMQX não responde, Mosquitto ok (8101). Só o Mosquitto é comum.
const { chromium, devices } = require('playwright');
(async () => {
  const errs = []; const b = await chromium.launch();
  // nos testes a lista de brokers públicos é trocada por locais; "fora do ar" = porta sem nada (erro) e o http.server (não fala MQTT)
  const rotear = (ctx, mapa) => ctx.addInitScript(m => { window.GEMEO_BROKERS_TESTE = [
    { nome: 'HiveMQ', url: m.hivemq || 'ws://localhost:8765/mqtt' }, { nome: 'EMQX', url: m.emqx || 'ws://localhost:9/mqtt' }, { nome: 'Mosquitto', url: m.mosq || 'ws://localhost:9/mqtt' }]; }, mapa);
  const pc = await b.newContext({ viewport: { width: 1400, height: 950 } }), cel = await b.newContext({ ...devices['Pixel 7'] });
  await rotear(pc, { emqx: 'ws://localhost:8100/mqtt', mosq: 'ws://localhost:8101/mqtt' });
  await rotear(cel, { mosq: 'ws://localhost:8101/mqtt' });
  const pg = (ctx, nome) => ctx.newPage().then(p => { p.on('pageerror', e => errs.push(nome + ' ' + e.message)); return p; });
  const p = await pg(pc, 'pc'); await p.goto('http://localhost:8765/index.html'); await p.waitForTimeout(2000);
  await p.click('#bt-celular'); await p.waitForTimeout(300);
  console.log('1 campo do broker vazio:', JSON.stringify(await p.inputValue('#mc-broker')), '| placeholder', await p.getAttribute('#mc-broker', 'placeholder'));
  await p.click('#bt-mc-conectar'); await p.waitForTimeout(3000);
  console.log('2 painel:', await p.textContent('#mc-estado'));
  const link = await p.evaluate(() => window.__bus.linkCelular());
  await p.screenshot({ path: 'test/brokers-qr.png' }); await p.click('#bt-fechar-celular');
  const s = await pg(cel, 'cel'); await s.goto(link); await s.waitForTimeout(5000);
  console.log('3 celular:', await s.evaluate(() => window.__simPg().papel), '|', await s.textContent('#chip-painel'), '|', await s.textContent('#chip-rede'));
  await s.click('#c-pausa'); await s.waitForTimeout(1500);
  console.log('4 pausa pelo celular chegou:', await p.evaluate(() => window.__est.motor.pausado), '|', await p.textContent('#chip-fonte'));
  // QR antigo (url do HiveMQ) também entra no modo automático
  const antigo = link.replace(/#mqtt=.*/, '') + '#mqtt=' + Buffer.from(JSON.stringify({ url: 'wss://broker.hivemq.com:8884/mqtt', sala: await p.evaluate(() => window.__bus.cfg.sala) })).toString('base64').replace(/=+$/, '');
  const s2 = await pg(cel, 'cel2'); await s2.goto(antigo); await s2.waitForTimeout(5000);
  console.log('5 QR antigo:', await s2.evaluate(() => window.__simPg().papel), '|', await s2.textContent('#chip-rede'));
  console.log(errs.join('\n') || 'sem erros'); await b.close();
})();
