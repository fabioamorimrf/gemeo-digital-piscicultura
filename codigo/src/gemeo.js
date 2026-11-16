/* =====================================================================
   Parte 2: o gêmeo digital em execução (o que o servidor faria).
   Recebe as mensagens do viveiro, guarda o histórico, roda os modelos
   e devolve comandos (aerador e ração) pelo mesmo contrato de tópicos.
   ===================================================================== */
class Gemeo {
  constructor(enviar) {
    this.enviar = enviar;           // enviar(topico, valor): publica um comando para o ESP32
    this.hist = []; this.diario = []; this.biometrias = []; this.refeicoes = [];
    this.L = {}; this.t = null; this.online = false; this.ultimaMsgReal = 0;
    this.modoAeracao = 'AUTO'; this.aerador = false; this.origemAerador = '';
    this.ultimaTroca = -Infinity;
    this.prev = null; this.prevAnterior = null; this.calib = { alfa: 1, rmse: null, n: 0 };
    this.plano = null; this.refeicoesFeitas = new Set();
    this.alertas = []; this.logAlertas = []; this.acoes = [];
    this.divergencia = null; this.divergenciaAte = 0;
    this.N = 4000; this.cenario = '';
  }
  sincronizar(m) {
    this.hist = m.historico.slice(); this.diario = (m.diario || []).slice(); this.biometrias = m.biometrias.slice(); this.refeicoes = m.refeicoes.slice();
    this.t = m.t; this.cenario = m.cenario; this.N = m.N;
    this.plano = null; this.refeicoesFeitas = new Set(); this.prev = null; this.prevAnterior = null;
    this.logAlertas = []; this.acoes = []; this.alertas = [];
    this.recalibrar();
  }
  receber(m) {
    this.ultimaMsgReal = Date.now();
    this.t = m.t; this.L = m.leituras; this.N = m.leituras['biomassa/quantidade'];
    this.online = m.leituras.status === 'ONLINE';
    this.aerador = m.leituras['atuador/aerador'] === 'LIGADO';
    this.origemAerador = m.leituras['atuador/aerador_origem'];
    for (const a of m.amostras || []) { this.verificarDivergencia(a); this.hist.push(a); }
    const lim = this.t - 3 * DIA; while (this.hist.length && this.hist[0].t < lim) this.hist.shift();
    for (const r of m.refeicoes || []) if (r.origem === 'tabela') this.refeicoes.push(r);
    for (const d of m.diario || []) this.diario.push(d);
    if (m.biometrias && m.biometrias.length) { this.biometrias.push(...m.biometrias); this.recalibrar(); this.plano = null; }
    if ((m.amostras || []).length) this.ciclo();
  }
  // compara a leitura com o que o modelo previu 10 min antes: salto grande sugere sensor ou evento
  verificarDivergencia(a) {
    const p = this.prev && this.prev.pts.find(x => Math.abs(x.t - a.t) < 5 * MIN);
    if (p && a.online) {
      const lim = Math.max(1.2, 5 * p.sd);
      if (Math.abs(a.OD - p.OD) > lim) { this.divergencia = `OD medido ${a.OD.toFixed(1)} mg/L, esperado ${p.OD.toFixed(1)} mg/L pelo modelo. Pode ser sensor descalibrado ou um evento no viveiro.`; this.divergenciaAte = a.t + 2 * H; this.registrarAcao(a.t, 'Leitura de OD fora do esperado pelo modelo'); }
    }
    if (a.t > this.divergenciaAte) this.divergencia = null;
  }
  recalibrar() {
    const bs = this.biometrias.slice(-6);
    // usa as biometrias mais recentes; o histórico de 10 min cobre só 3 dias, então completa com temperatura média
    this.calib = calibrarCrescimento(bs, ambienteEm(this.hist, this.diario), this.refeicoes, this.N);
  }
  get atual() {
    const L = this.L;
    const T = L['agua/temperatura'], ph = L['agua/ph'], tan = L['agua/amonia_total'];
    return { od: L['agua/od'], temperatura: T, ph, tan, uia: T != null ? tan * fracNH3(T, ph) : null };
  }
  pesoEstimado() {
    const b = this.biometrias[this.biometrias.length - 1];
    if (!b) return 110;
    return simularPeso(b.W, b.t, this.t, ambienteEm(this.hist, this.diario), this.refeicoes, this.N, this.calib.alfa);
  }
  ciclo() {
    if (!this.hist.length) return;
    const t = this.t, ult = this.hist[this.hist.length - 1];
    this.prevAnterior = this.prev;
    this.prev = preverOD(this.hist, 12);
    // plano de ração do dia: feito às 06:00 ou quando ainda não existe para o dia
    // plano de ração do dia: refeito a cada hora com a previsão mais nova (refeições já feitas ficam)
    const dia = Math.floor(t / DIA), hora = Math.floor(t / H);
    if (!this.plano || this.plano.dia !== dia || this.plano.hora !== hora) this.montarPlano();
    // refeições: no horário, recalcula a quantidade com o OD atual e envia o comando
    if (this.plano && this.online) for (const r of this.plano.refeicoes) {
      const chave = dia + ':' + r.h;
      if (t >= r.t && t < r.t + 45 * MIN && !this.refeicoesFeitas.has(chave)) {
        this.refeicoesFeitas.add(chave);
        const fo = fatorOD(this.atual.od);
        const kg = +(this.plano.alvo / this.plano.nRef * fo).toFixed(2);
        r.executado = kg; r.odReal = this.atual.od;
        if (kg > 0) { this.enviar('comando/racao', kg.toFixed(2)); this.refeicoes.push({ t, kg, origem: 'gemeo' }); }
        this.registrarAcao(t, kg > 0 ? `Refeição das ${fmtHora(r.t)}: ${kg.toFixed(1)} kg liberados` : `Refeição das ${fmtHora(r.t)} suspensa: OD em ${this.atual.od.toFixed(1)} mg/L`);
      }
    }
    // aeração automática
    if (this.modoAeracao === 'AUTO' && this.online) {
      const d = decidirAerador(this.aerador && this.origemAerador === 'GEMEO' ? true : this.aerador, this.atual.od, this.prev, this.ultimaTroca, t);
      if (d) { this.comandarAerador(d.ligar, d.motivo); }
      else if (this.origemAerador !== 'GEMEO' && this.t - this.ultimaTroca > 30 * MIN) {
        // retoma o controle depois de um fallback local, mantendo o estado atual
        this.enviar('comando/aerador', this.aerador ? 'LIGAR' : 'DESLIGAR'); this.ultimaTroca = t;
      }
    }
    // detecção de aerador com falha: ligado há 1 h e o OD continua caindo abaixo de 5
    const ultimaHora = this.hist.slice(-7);
    this.falhaAerador = ultimaHora.length === 7 && ultimaHora.every(a => a.aer) && ultimaHora[6].OD < ultimaHora[0].OD - 0.25 && ultimaHora[6].OD < 5;
    // anomalia do ar nas últimas 24 h em relação à normal do mês
    const dia24 = this.hist.slice(-144);
    const mediaAr = dia24.reduce((s, a) => s + a.Ta, 0) / Math.max(1, dia24.length);
    this.anomaliaAr = dia24.length > 100 ? mediaAr - NORMAIS.tmed[mesDe(t)] : null;
    this.atualizarAlertas();
  }
  montarPlano() {
    const W = this.pesoEstimado();
    const TwMedio = this.prev ? this.prev.pts.reduce((s, p) => s + p.Tw, 0) / this.prev.pts.length : (this.atual.temperatura ?? 26);
    const p = prescreverRacao({ W, N: this.N, alfa: this.calib.alfa, prevOD: this.prev, TwMedio, t: this.t });
    p.dia = Math.floor(this.t / DIA); p.hora = Math.floor(this.t / H); p.W = W; p.TwMedio = TwMedio;
    // mantém as refeições que já passaram: o que foi executado não muda
    const antigo = this.plano && this.plano.dia === p.dia ? this.plano : null;
    if (antigo) {
      const feitas = antigo.refeicoes.filter(r => r.executado != null || r.t <= this.t);
      const futuras = p.refeicoes.filter(r => r.t > this.t && !feitas.some(f => f.h === r.h)).slice(0, Math.max(0, p.nRef - feitas.length));
      p.refeicoes = [...feitas, ...futuras].sort((a, b) => a.h - b.h);
      p.total = p.refeicoes.reduce((s, r) => s + (r.executado ?? r.kg), 0);
      p.pct = p.total / (this.N * W / 1000) * 100;
    }
    this.plano = p;
  }
  comandarAerador(ligar, motivo, manual = false) {
    this.enviar('comando/aerador', ligar ? 'LIGAR' : 'DESLIGAR');
    this.aerador = ligar; this.origemAerador = 'GEMEO'; this.ultimaTroca = this.t;
    this.registrarAcao(this.t, `${manual ? 'Comando do operador' : 'Gêmeo'}: aerador ${ligar ? 'ligado' : 'desligado'}${motivo ? ' (' + motivo + ')' : ''}`);
  }
  registrarAcao(t, txt) { this.acoes.unshift({ t, txt }); if (this.acoes.length > 40) this.acoes.pop(); }
  atualizarAlertas() {
    const novos = avaliarAlertas(this.atual, this.prev, { online: this.online, divergencia: this.divergencia, anomaliaAr: this.anomaliaAr, mes: mesDe(this.t), falhaAerador: this.falhaAerador });
    const antes = new Map(this.alertas.map(a => [a.id, a]));
    for (const a of novos) { const o = antes.get(a.id); if (!o || o.nivel !== a.nivel) this.logAlertas.unshift({ t: this.t, ...a }); }
    if (this.logAlertas.length > 50) this.logAlertas.length = 50;
    this.alertas = novos;
  }
  // aeração prevista: quando o gêmeo planeja ligar nas próximas 12 h
  janelaAeracao() {
    if (!this.prev) return null;
    const p = this.prev.pts.find(x => x.OD < 4);
    return p ? { t: p.t, od: p.OD } : null;
  }
}
if (typeof module !== 'undefined') module.exports.Gemeo = Gemeo;
