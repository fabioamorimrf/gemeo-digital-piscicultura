// Janela do celular com todos os brokers falhando e com sucesso, em tela larga e no celular
const { chromium, devices } = require('playwright');
(async () => {
  const b = await chromium.launch(); const errs = [];
  for (const [nome, opc, lista] of [
    ['falha-pc', { viewport: { width: 1917, height: 850 } }, ['ws://localhost:9/mqtt', 'ws://localhost:8765/mqtt', 'ws://localhost:9/a', 'ws://localhost:9/b']],
    ['ok-pc', { viewport: { width: 1917, height: 850 } }, ['ws://localhost:9/mqtt', 'ws://localhost:8100/mqtt', 'ws://localhost:9/a', 'ws://localhost:8101/mqtt']],
    ['falha-cel', { ...devices['Pixel 7'] }, ['ws://localhost:9/mqtt', 'ws://localhost:8765/mqtt', 'ws://localhost:9/a', 'ws://localhost:9/b']]]) {
    const ctx = await b.newContext(opc);
    await ctx.addInitScript(l => { window.GEMEO_BROKERS_TESTE = ['Eclipse', 'HiveMQ', 'EMQX', 'Mosquitto'].map((n, i) => ({ nome: n, url: l[i] })); }, lista);
    const p = await ctx.newPage(); p.on('pageerror', e => errs.push(nome + ' ' + e.message));
    await p.goto('http://localhost:8765/index.html'); await p.waitForTimeout(1500);
    await p.click('#bt-celular'); await p.click('#bt-mc-conectar'); await p.waitForTimeout(nome.startsWith('falha') ? 17000 : 3000);
    const cx = await p.$eval('.modal-caixa', e => { const r = e.getBoundingClientRect(); return [Math.round(r.width), e.scrollWidth <= e.clientWidth + 1]; });
    console.log(nome, '| caixa', cx, '| status:', (await p.textContent('#mc-estado')).slice(0, 160));
    await p.screenshot({ path: `test/modal-${nome}.png` }); await ctx.close();
  }
  console.log(errs.join('\n') || 'sem erros'); await b.close();
})();
