/* =====================================================================
   Experimento de validação: dois lotes idênticos de tilápia-do-nilo
   no mesmo clima, um com a ração da tabela fixa e outro com a ração
   prescrita pelo gêmeo digital. Usa o modelo do protótipo sem mudanças
   (src/modelo.js e src/gemeo.js).

   Uso (dentro de codigo/):
     node validacao/experimento.js                 -> experimento principal
     node validacao/experimento.js --robustez      -> 4 datas x 5 sementes
   ===================================================================== */
'use strict';
const fs = require('fs'), vm = require('vm'), path = require('path');
const raiz = path.join(__dirname, '..');
const code = fs.readFileSync(path.join(raiz, 'src/modelo.js'), 'utf8') + '\n' +
  fs.readFileSync(path.join(raiz, 'src/gemeo.js'), 'utf8') +
  '\n;globalThis.__x={Simulador,Gemeo,Viveiro,CENARIOS,NORMAIS,fmtData,DIA,H,MIN,horaDe,radiacaoCeuLimpo,fatorTemperatura,pctTabela};';
const ctx = { module: undefined, console, Date, Math, JSON }; vm.createContext(ctx);
vm.runInContext(code.replace(/if \(typeof module !== 'undefined'\)[^\n]*\n/g, ''), ctx);
const X = ctx.__x, { Simulador, Gemeo, Viveiro, CENARIOS, DIA, H, MIN, fmtData, horaDe, radiacaoCeuLimpo } = X;

// contabilidade de toda a ração desde o povoamento (o simulador zera os acumulados após a adaptação)
const alimOrig = Viveiro.prototype.alimentar;
Viveiro.prototype.alimentar = function (kg, f, verd) {
  const r = alimOrig.call(this, kg, f, verd);
  this.tot = this.tot || { racao: 0, consumida: 0, desperdicio: 0, refeicoes: 0, suspensas: 0 };
  this.tot.racao += r.ofertado; this.tot.consumida += r.consumido; this.tot.desperdicio += r.ofertado - r.consumido;
  return r;
};

/* aeração "isolada": nos dois lotes a mesma regra reativa, sobre o OD de cada lote
   (liga com OD < 4 mg/L; desliga com OD >= 5 mg/L e sol; Francis-Floyd, 2003; Tucker, 2005),
   mais o intertravamento do ESP32 (OD < 2,5 liga). Assim só a ração muda entre os lotes. */
class SimIsolado extends Simulador {
  controleLocal(t0) {
    if (this.preaquecendo) return super.controleLocal(t0);
    const sol = radiacaoCeuLimpo(this.t) > 150;
    for (const v of [this.v, this.s]) {
      if (!v.aerador && v.OD < 4) v.aerador = true;
      else if (v.aerador && v.OD >= 5 && sol) v.aerador = false;
      if (v.OD < 2.5) v.aerador = true;
    }
    this.origemAerador = 'gemeo';
  }
}

const POVOAMENTO_ADAPT = 35; // dias de adaptação comuns (PREAQUECIMENTO_DIAS do simulador)

const fTOriginal = ctx.fatorTemperatura;
// variante de sensibilidade: entre 20 e 30 °C o gêmeo não corta a tabela e deixa o teto de apetite de Yi limitar
const fTVariante = T => (T >= 20 && T < 30) ? 1 : fTOriginal(T);
function rodar({ povoamento, W0 = 30, N = 4000, seed = 7, aeracao = 'isolada', alvo = 800, diasMax = 400, variante = false }) {
  ctx.fatorTemperatura = variante ? fTVariante : fTOriginal;
  const nome = 'exp_' + povoamento + '_' + W0;
  const [a, m, d] = povoamento.split('-').map(Number);
  CENARIOS[nome] = { nome, detalhe: '', inicio: Date.UTC(a, m - 1, d) + POVOAMENTO_ADAPT * DIA, N, W: W0 };
  const Classe = aeracao === 'isolada' ? SimIsolado : Simulador;
  const sim = new Classe(nome, seed);
  const tAdapt = sim.t;
  const g = new Gemeo((top, val) => sim.comando(top, val));
  if (aeracao === 'isolada') g.modoAeracao = 'MANUAL';
  g.sincronizar({ historico: sim.historico, diario: sim.diario, biometrias: sim.biometrias, refeicoes: sim.refeicoes, t: sim.t, cenario: nome, N: sim.v.N });
  sim.gemeoAtivo = true;
  const lotes = { tabela: sim.s, gemeo: sim.v };
  const fim = {}; const serie = [];
  const adapt = { W: sim.v.W, racao: sim.v.tot.racao, N: sim.v.N };
  let lt = sim.t, nb = sim.biometrias.length, nr = sim.refeicoes.length, nd = sim.diario.length;
  const mensal = {}; // ração por mês e lote
  let racAnt = { tabela: sim.s.tot.racao, gemeo: sim.v.tot.racao };
  for (let k = 0; k < diasMax * 144; k++) {
    sim.avancar(10);
    const am = sim.historico.filter(x => x.t > lt); lt = sim.t;
    const dd = sim.diario.slice(nd); nd = sim.diario.length; const bi = sim.biometrias.slice(nb); nb = sim.biometrias.length; const rf = sim.refeicoes.slice(nr); nr = sim.refeicoes.length;
    g.receber({ t: sim.t, leituras: sim.leituras(), amostras: am, biometrias: bi, refeicoes: rf, diario: dd });
    if (k % 144 === 143) {
      const dia = Math.round((sim.t - (tAdapt - POVOAMENTO_ADAPT * DIA)) / DIA);
      const ms = fmtData(sim.t).slice(3);
      for (const [n, v] of Object.entries(lotes)) if (!fim[n]) {
        mensal[ms] = mensal[ms] || { Tw: 0, n: 0 };
        mensal[ms][n] = (mensal[ms][n] || 0) + v.tot.racao - racAnt[n]; racAnt[n] = v.tot.racao;
      }
      mensal[ms].Tw += sim.v.Tw; mensal[ms].n++;
      serie.push({ dia, data: fmtData(sim.t), Tw: +sim.v.Tw.toFixed(2), Wtab: +sim.s.W.toFixed(1), Wgem: +sim.v.W.toFixed(1), Rtab: +sim.s.tot.racao.toFixed(1), Rgem: +sim.v.tot.racao.toFixed(1), WgemEstimado: +g.pesoEstimado().toFixed(1), alfa: g.calib.alfa });
      for (const [n, v] of Object.entries(lotes)) if (!fim[n] && v.W >= alvo) {
        const biom = v.N * v.W / 1000, biom0 = N * W0 / 1000;
        fim[n] = { dia, data: fmtData(sim.t), W: v.W, N: v.N, sobrev: v.N / N, racao: v.tot.racao, consumida: v.tot.consumida, desperdicio: v.tot.desperdicio,
          biomassa: biom, ganho: biom - biom0, CA: v.tot.racao / (biom - biom0), CAconsumida: v.tot.consumida / (biom - biom0),
          horasAerador: v.ac.horasAerador, odMin: v.ac.odMin, WestimadoGemeo: n === 'gemeo' ? g.pesoEstimado() : null, alfa: g.calib.alfa };
        // lote despescado: para de comer (o outro continua no mesmo clima)
        v.alimentar = function () { return { ofertado: 0, consumido: 0 }; };
      }
      if (fim.tabela && fim.gemeo) break;
    }
  }
  return { povoamento, W0, N, seed, aeracao, adapt, fim, serie, mensal };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const out = path.join(__dirname, 'resultados');
  fs.mkdirSync(out, { recursive: true });
  if (args.includes('--variante')) {
    const res = [];
    for (const pov of ['2027-03-01', '2027-06-01', '2027-09-01', '2027-12-01']) for (const seed of [7, 11, 23, 42, 101]) {
      const r = rodar({ povoamento: pov, seed, aeracao: 'isolada', variante: true }); delete r.serie;
      console.log(pov, seed, 'dias', r.fim.tabela.dia, r.fim.gemeo.dia, 'racao', r.fim.tabela.racao.toFixed(0), r.fim.gemeo.racao.toFixed(0));
      res.push(r);
    }
    fs.writeFileSync(path.join(out, 'variante.json'), JSON.stringify(res, null, 1));
  } else if (args.includes('--robustez')) {
    const res = [];
    for (const pov of ['2027-03-01', '2027-06-01', '2027-09-01', '2027-12-01']) for (const seed of [7, 11, 23, 42, 101]) for (const aer of ['isolada', 'completa']) {
      const t0 = Date.now(); const r = rodar({ povoamento: pov, seed, aeracao: aer });
      const f = r.fim; delete r.serie;
      console.log(pov, seed, aer, 'dias', f.tabela && f.tabela.dia, f.gemeo && f.gemeo.dia, 'racao', f.tabela && f.tabela.racao.toFixed(0), f.gemeo && f.gemeo.racao.toFixed(0), ((Date.now() - t0) / 1000).toFixed(1) + 's');
      res.push(r);
    }
    fs.writeFileSync(path.join(out, 'robustez.json'), JSON.stringify(res, null, 1));
  } else {
    for (const aer of ['isolada', 'completa']) {
      const t0 = Date.now(); const r = rodar({ povoamento: '2027-09-01', seed: 7, aeracao: aer });
      fs.writeFileSync(path.join(out, 'principal-' + aer + '.json'), JSON.stringify(r, null, 1));
      console.log(aer, JSON.stringify(r.fim, (k, v) => typeof v === 'number' ? +v.toFixed(3) : v, 1), 'adapt', JSON.stringify(r.adapt), ((Date.now() - t0) / 1000).toFixed(1) + 's');
    }
  }
}
module.exports = { rodar };
