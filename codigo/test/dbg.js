const fs=require('fs'); const vm=require('vm');
const code=fs.readFileSync('src/modelo.js','utf8')+'\n'+fs.readFileSync('src/gemeo.js','utf8')+'\n;globalThis.__x={Simulador,Gemeo,preverOD};';
const ctx={console,Date,Math,JSON};vm.createContext(ctx);vm.runInContext(code,ctx);
const {Simulador,Gemeo,preverOD}=ctx.__x;
const sim=new Simulador('verao',7);
const p=preverOD(sim.historico,12); console.log(p&&p.min, p&&p.ajuste);
const g=new Gemeo(()=>{});g.sincronizar({historico:sim.historico,biometrias:sim.biometrias,refeicoes:sim.refeicoes,t:sim.t,cenario:'verao',N:4000});
sim.avancar(10); g.receber({t:sim.t,leituras:sim.leituras(),amostras:sim.historico.slice(-1),biometrias:[],refeicoes:[]});
console.log(g.prev&&g.prev.min);
