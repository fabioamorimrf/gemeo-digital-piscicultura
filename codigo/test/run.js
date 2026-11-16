const fs=require('fs'); const vm=require('vm');
const code=fs.readFileSync('src/modelo.js','utf8')+'\n'+fs.readFileSync('src/gemeo.js','utf8').replace("if (typeof module !== 'undefined') module.exports.Gemeo = Gemeo;","")+'\n;globalThis.__x={Simulador,Gemeo,fmtHora,fmtData,DIA,H,MIN,preverOD,consequenciasSemana};';
const ctx={module:undefined,console,Date,Math,JSON};vm.createContext(ctx);vm.runInContext(code.replace(/if \(typeof module[^\n]*\n?$/m,''),ctx);
const {Simulador,Gemeo,fmtHora,fmtData,DIA,H,MIN}=ctx.__x;
const cen=process.argv[2]||'verao', dias=+(process.argv[3]||5);
let t0=Date.now(); const sim=new Simulador(cen,7); console.log('preaquecimento ms',Date.now()-t0, 'W',sim.v.W.toFixed(1),'N',sim.v.N.toFixed(0),'hist',sim.historico.length,'bio',sim.biometrias.map(b=>b.W).join(','));
const g=new Gemeo((top,val)=>sim.comando(top,val));
g.sincronizar({historico:sim.historico,diario:sim.diario,biometrias:sim.biometrias,refeicoes:sim.refeicoes,t:sim.t,cenario:cen,N:sim.v.N});
sim.gemeoAtivo=true; console.log('alfa',g.calib);
let lt=sim.t, nb=sim.biometrias.length, nr=sim.refeicoes.length, nd=sim.diario.length;
for(let k=0;k<dias*24*6;k++){
  sim.avancar(10);
  const am=sim.historico.filter(a=>a.t>lt); lt=sim.t; const dd=sim.diario.slice(nd); nd=sim.diario.length; const bi=sim.biometrias.slice(nb); nb=sim.biometrias.length; const rf=sim.refeicoes.slice(nr); nr=sim.refeicoes.length;
  g.receber({t:sim.t,leituras:sim.leituras(),amostras:am,biometrias:bi,refeicoes:rf,diario:dd});
  if(k%18===0){const L=sim.leituras(); console.log(fmtData(sim.t),fmtHora(sim.t),'Tw',L['agua/temperatura'],'OD',L['agua/od'],'pH',L['agua/ph'],'TAN',L['agua/amonia_total'],'Ta',L['clima/temperatura_ar'],'rad',L['clima/radiacao'],'aer',L['atuador/aerador'][0], 'sombraOD',sim.s.OD.toFixed(2),'prevMin',g.prev?g.prev.min.OD.toFixed(2)+'@'+fmtHora(g.prev.min.t):'-','alerts',g.alertas.map(a=>a.id).join('|'));}
}
console.log('plano',JSON.stringify(g.plano&&{total:g.plano.total.toFixed(1),base:g.plano.base.toFixed(1),fT:g.plano.fT,mot:g.plano.motivo,ref:g.plano.refeicoes.map(r=>r.h+':'+r.kg.toFixed(1))}));
console.log('theta',g.prev&&g.prev.ajuste.theta.map(x=>x.toFixed(3)),'sigma',g.prev&&g.prev.ajuste.sigma.toFixed(3));
console.log('comp',JSON.stringify(sim.comparacao(),(k,v)=>typeof v==='number'?+v.toFixed(2):v));
console.log('acoes',g.acoes.slice(0,8).map(a=>fmtHora(a.t)+' '+a.txt).join('\n'));
console.log('calib',g.calib, 'Westim',g.pesoEstimado().toFixed(1),'Wreal',sim.v.W.toFixed(1));
console.log('refeicoes plano', JSON.stringify(g.plano.refeicoes.map(r=>({h:r.h,kg:+r.kg.toFixed(1),ex:r.executado}))), 'total', g.plano.total.toFixed(1));
console.log('acoes ref', g.acoes.filter(a=>a.txt.startsWith('Refei')).slice(0,6).map(a=>fmtData(a.t)+' '+a.txt).join(' | '));
const prevC = sim.previsaoClima(7); console.log('clima sim', JSON.stringify(prevC.map(d=>[fmtData(d.t),d.tmax,d.tmin,d.chuva,d.rad,d.vento])));
const cq = ctx.__x.consequenciasSemana ? ctx.__x.consequenciasSemana(prevC, {W:g.pesoEstimado(),N:g.N,alfa:g.calib.alfa,theta:g.prev.ajuste.theta,Tw0:g.atual.temperatura,OD0:g.atual.od}) : null;
if (cq) for (const d of cq.dias) console.log(fmtData(d.t), 'Tw', d.TwMed.toFixed(1), 'fT', d.fT, 'racao', d.racao.toFixed(1), 'odMinSem', d.semAer&&d.semAer.od.toFixed(1), 'hAer', d.hAer.toFixed(1), 'ganho', d.ganho.toFixed(1), d.flags.map(f=>f.txt.slice(0,30)).join(' | '));
