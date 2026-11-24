// resume os arquivos grade-*.json: média (mín.–máx.) de 5 climas por aeração e data
const fs = require('fs'), path = require('path');
const dir = path.join(__dirname, 'resultados');
const m = a => a.reduce((s, x) => s + x, 0) / a.length;
const linhas = [];
for (const f of fs.readdirSync(dir).filter(f => f.startsWith(process.argv[2] || 'grade-')).sort()) {
  const rs = JSON.parse(fs.readFileSync(path.join(dir, f)));
  const [, aer, ...d] = f.replace('.json', '').split('-');
  const v = (l, c) => rs.map(r => r.fim[l][c]);
  const L = { aer, data: d.join('-') };
  for (const l of ['tabela', 'gemeo']) for (const c of ['dia', 'racao', 'desperdicio', 'CA', 'sobrev', 'horasAerador', 'odMin', 'WestimadoGemeo', 'alfa']) {
    const x = v(l, c).filter(y => y != null); if (!x.length) continue;
    L[l + '_' + c] = +m(x).toFixed(3); L[l + '_' + c + '_min'] = +Math.min(...x).toFixed(3); L[l + '_' + c + '_max'] = +Math.max(...x).toFixed(3);
  }
  L.difDias = rs.map(r => r.fim.tabela.dia - r.fim.gemeo.dia);
  L.economia = rs.map(r => +((r.fim.tabela.racao - r.fim.gemeo.racao) / r.fim.tabela.racao * 100).toFixed(1));
  linhas.push(L);
}
fs.writeFileSync(path.join(dir, (process.argv[2] ? 'resumo-estresse.json' : 'resumo.json')), JSON.stringify(linhas, null, 1));
for (const L of linhas) console.log(L.aer.padEnd(9), L.data, '| tab', L.tabela_dia.toFixed(1), L.tabela_racao.toFixed(0), 'CA', L.tabela_CA.toFixed(2), 'sob', L.tabela_sobrev.toFixed(3), '| gem', L.gemeo_dia.toFixed(1), '[' + L.gemeo_dia_min + '-' + L.gemeo_dia_max + ']', L.gemeo_racao.toFixed(0), 'CA', L.gemeo_CA.toFixed(2), 'desp', L.gemeo_desperdicio.toFixed(0), 'West', L.gemeo_WestimadoGemeo.toFixed(0), 'aerH', L.gemeo_horasAerador.toFixed(0), L.tabela_horasAerador.toFixed(0), 'odMin', L.gemeo_odMin_min, '| dif', L.difDias.join(','), '| eco', L.economia.join(','));
