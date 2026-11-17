/* =====================================================================
   Parte 3: interface. Duas abas do mesmo site:
   - Painel (o gêmeo digital): leituras, previsões, prescrição, comandos
   - Simulador (a contraparte física): onde o apresentador mexe nos valores
   As abas conversam por BroadcastChannel (com reserva em localStorage),
   no papel que o broker MQTT faria na arquitetura real.
   ===================================================================== */
const $ = (sel, raiz = document) => raiz.querySelector(sel);
const fmt = (x, d = 1) => x == null || Number.isNaN(x) ? '--' : Number(x).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const cor = nome => getComputedStyle(document.documentElement).getPropertyValue('--' + nome).trim();

/* ---------------- barramento entre abas (no lugar do broker MQTT) ---------------- */
// Canal das abas por MQTT. Duas formas:
//  - servidor local (servidor.py): broker na própria máquina, tópicos gemeo/viveiro1/...
//  - broker na internet (padrão: broker público da HiveMQ): tópicos gemeo/viveiro1/<sala>/..., com um código de sala aleatório
const BROKER_PADRAO = 'wss://broker.hivemq.com:8884/mqtt';
/* Brokers públicos usados juntos no modo automático: as duas pontas conectam em todos e publicam
   em todos, e as mensagens repetidas são descartadas pelo id. Basta um broker funcionar dos dois lados.
   (O HiveMQ público às vezes não responde ao CONNECT: "connack timeout"; redes de universidade costumam
   bloquear portas fora da 443.) */
const BROKERS_PUBLICOS = [
  // Eclipse usa a porta 443 (a mesma do HTTPS), que passa por redes que bloqueiam as portas 8084/8884/8081
  { nome: 'Eclipse', url: 'wss://mqtt.eclipseprojects.io:443/mqtt' },
  { nome: 'HiveMQ', url: 'wss://broker.hivemq.com:8884/mqtt' },
  { nome: 'EMQX', url: 'wss://broker.emqx.io:8084/mqtt' },
  { nome: 'Mosquitto', url: 'wss://test.mosquitto.org:8081/mqtt' },
];
const brokerAuto = url => !url || url === 'auto' || url === BROKER_PADRAO;
function carregarScript(src) { return new Promise((ok, erro) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = erro; document.head.appendChild(s); }); }
const codificar = o => btoa(unescape(encodeURIComponent(JSON.stringify(o)))).replace(/=+$/, '');
const decodificar = t => JSON.parse(decodeURIComponent(escape(atob(t))));
const novaSala = () => Array.from(crypto.getRandomValues(new Uint8Array(4)), b => 'abcdefghjkmnpqrstuvwxyz23456789'[b % 31]).join('');
class Barramento {
  constructor() {
    this.id = Math.random().toString(36).slice(2); this.vistos = new Set(); this.ouvintes = [];
    this.mqtt = null; this.clientes = []; this.mqttOk = false; this.info = null; this.cfg = null; this.modoRede = null; this.prefixo = TOPICO;
    this.fila = []; this.aoMudarRede = () => {}; this.aoConectar = []; this.ultEspelho = 0;
    try { this.bc = new BroadcastChannel('gemeo-viveiro1'); this.bc.onmessage = e => this.chegou(e.data); } catch (e) { this.bc = null; }
    window.addEventListener('storage', e => { if (e.key === 'gemeo-viveiro1' && e.newValue) { try { this.chegou(JSON.parse(e.newValue)); } catch (_) {} } });
    this.pronto = this.iniciarMqtt().catch(() => {}).then(() => { const f = this.fila; this.fila = null; if (this.mqttOk) for (const m of f) this.publicar(m); });
  }
  get topicoAbas() { return this.prefixo + '_abas'; }
  static configSalva() { try { return JSON.parse(localStorage.getItem('gemeo-mqtt')); } catch (_) { return null; } }
  async iniciarMqtt() {
    if (window.GEMEO_SERVIDOR && /^https?:$/.test(location.protocol)) {
      const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 1500);
      let info; try { const r = await fetch('/api/info', { cache: 'no-store', signal: ctl.signal }); if (!r.ok) return; info = await r.json(); } catch (_) { return; } finally { clearTimeout(to); }
      if (!info || !info.gemeo) return;
      this.info = info; this.modoRede = 'local';
      return this.conectar((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/mqtt', {}, TOPICO);
    }
    // configuração vinda do QR code (#mqtt=...) ou guardada neste navegador
    let cfg = null;
    const m = location.hash.match(/[#&]mqtt=([A-Za-z0-9+/_-]+)/);
    if (m) { try { cfg = decodificar(m[1]); localStorage.setItem('gemeo-mqtt', JSON.stringify(cfg)); } catch (_) {} history.replaceState(null, '', location.pathname + location.search); }
    if (!cfg) cfg = Barramento.configSalva();
    if (cfg && cfg.sala) return this.usarNuvem(cfg);
  }
  async usarNuvem(cfg) {
    this.cfg = cfg; this.modoRede = 'nuvem';
    try { localStorage.setItem('gemeo-mqtt', JSON.stringify(cfg)); } catch (_) {}
    const alvos = brokerAuto(cfg.url) ? (window.GEMEO_BROKERS_TESTE || BROKERS_PUBLICOS) : [{ nome: cfg.url.replace(/^wss?:\/\//, '').replace(/[:/].*$/, ''), url: cfg.url }];
    return this.conectar(alvos, cfg.usuario ? { username: cfg.usuario, password: cfg.senha || '' } : {}, TOPICO + cfg.sala + '/');
  }
  desligarNuvem() {
    try { localStorage.removeItem('gemeo-mqtt'); } catch (_) {}
    this.encerrarClientes();
    this.mqttOk = false; this.cfg = null; this.modoRede = null; this.prefixo = TOPICO; this.aoMudarRede();
  }
  encerrarClientes() { for (const k of this.clientes) { try { k.c.end(true); } catch (_) {} } this.clientes = []; this.mqtt = null; }
  // conecta em um ou mais brokers ao mesmo tempo; "pronto" quando o primeiro responde (ou depois de 15 s)
  async conectar(alvos, extra, prefixo) {
    if (typeof alvos === 'string') alvos = [{ nome: 'MQTT', url: alvos }];
    if (!window.mqtt) await carregarScript('mqtt.min.js');
    this.encerrarClientes();
    this.prefixo = prefixo; this.mqttOk = false; this.erroRede = null;
    const atualizar = () => {
      const ok = this.clientes.filter(k => k.ok);
      this.mqttOk = ok.length > 0; this.mqtt = ok.length ? ok[0].c : null;
      const erros = this.clientes.filter(k => !k.ok && k.erro);
      this.erroRede = this.mqttOk ? null : erros.length ? erros.map(k => `${k.nome}: ${k.erro}`).join('; ') : null;
      this.aoMudarRede();
    };
    await new Promise(pronto => {
      const fim = setTimeout(pronto, 15000);
      for (const alvo of alvos) {
        const k = { nome: alvo.nome, url: alvo.url, ok: false, erro: null };
        const c = window.mqtt.connect(alvo.url, { clientId: 'gemeo-' + this.id + '-' + Math.random().toString(36).slice(2, 6), protocolVersion: 4, reconnectPeriod: 3000, keepalive: 30, connectTimeout: 15000, clean: true, ...extra });
        k.c = c; this.clientes.push(k);
        c.on('connect', () => {
          k.ok = true; k.erro = null;
          c.subscribe(this.topicoAbas, { qos: 1 }, () => { for (const f of this.aoConectar) { try { f(); } catch (_) {} } });
          clearTimeout(fim); pronto(); atualizar();
        });
        c.on('error', e => { k.erro = (e && e.message) || 'erro'; atualizar(); });
        c.on('offline', () => { k.ok = false; atualizar(); });
        c.on('close', () => { if (k.ok) { k.ok = false; atualizar(); } else if (!k.erro) { k.erro = 'conexão recusada'; atualizar(); } });
        setTimeout(() => { if (!k.ok && !k.erro && this.clientes.includes(k)) { k.erro = 'sem resposta'; atualizar(); } }, 16000);
        c.on('message', (t, pl) => { if (t === this.topicoAbas) { try { this.chegou(JSON.parse(pl.toString())); } catch (_) {} } });
      }
    });
  }
  brokersOk() { return this.clientes.filter(k => k.ok).map(k => k.nome); }
  todosFalharam() { return !this.mqttOk && this.clientes.length > 0 && this.clientes.every(k => k.erro); }
  descricaoRede() { return !this.modoRede ? '' : this.modoRede === 'local' ? 'MQTT local' : `MQTT · sala ${this.cfg.sala}`; }
  textoBrokers() { const ok = this.brokersOk(); return ok.length ? ` (${ok.join(', ')})` : ''; }
  linkCelular() {
    const base = location.href.replace(/[#?].*$/, '').replace(/[^/]*$/, '');
    if (this.modoRede === 'local') return `http://${this.info.ips[0]}:${this.info.porta}/simulador.html`;
    return this.cfg ? base + 'simulador.html#mqtt=' + codificar(this.cfg) : '';
  }
  // ações do controle remoto vão com QoS 1 (entrega garantida); o resto é estado periódico, QoS 0
  publicar(m) { const txt = JSON.stringify(m); for (const k of this.clientes) if (k.ok) { try { k.c.publish(this.topicoAbas, txt, { qos: m.tipo === 'acao' ? 1 : 0 }); } catch (_) {} } }
  textoRede() { return this.mqttOk ? this.descricaoRede() + ' conectado' + this.textoBrokers() : this.erroRede ? this.descricaoRede() + ': sem conexão, tentando de novo' : this.descricaoRede() + ': conectando...'; }
  // espelha as leituras nos tópicos do contrato (…/agua/od etc.), para ver num cliente MQTT
  espelhar(leituras, t) {
    if (!this.mqttOk || !leituras || Date.now() - this.ultEspelho < 1000) return; this.ultEspelho = Date.now();
    for (const [k, v] of Object.entries(leituras)) this.mqtt.publish(this.prefixo + k, String(v), { retain: this.modoRede === 'local' });
    this.mqtt.publish(this.prefixo + 'simulacao/tempo', fmtData(t) + ' ' + fmtHora(t));
  }
  comandoContrato(topico, valor) { if (this.mqttOk && topico !== 'servidor/status') this.mqtt.publish(this.prefixo + topico, String(valor)); }
  on(fn) { this.ouvintes.push(fn); }
  enviar(m) {
    m.de = this.id; m.mid = this.id + ':' + Math.random().toString(36).slice(2);
    if (this.bc) { try { this.bc.postMessage(m); } catch (_) {} }
    try { localStorage.setItem('gemeo-viveiro1', JSON.stringify(m)); } catch (_) {}
    if (this.fila) this.fila.push(m); else if (this.mqttOk) this.publicar(m);
  }
  chegou(m) {
    if (!m || m.de === this.id || this.vistos.has(m.mid)) return;
    this.vistos.add(m.mid); if (this.vistos.size > 400) this.vistos = new Set([...this.vistos].slice(-200));
    for (const f of this.ouvintes) f(m);
  }
}

// quadro de status da conexão na janela do celular: uma linha por broker e, se nenhum responder, o que fazer
function statusRede(bus) {
  if (!bus.modoRede) return '';
  const titulo = bus.mqttOk ? `Conectado · sala ${esc(bus.cfg ? bus.cfg.sala : 'local')}` : bus.todosFalharam() ? 'Nenhum broker respondeu' : 'Conectando...';
  const itens = bus.clientes.map(k => `<li data-ok="${k.ok ? 1 : k.erro ? 0 : ''}"><i></i>${esc(k.nome)}<span>${k.ok ? 'conectado' : k.erro ? 'sem resposta' : 'tentando'}</span></li>`).join('');
  const dica = bus.todosFalharam() ? `<p class="mc-dica">A rede deste computador parece bloquear a conexão com os brokers (todos deram "${esc(bus.clientes[0].erro)}"). Ligue o computador no roteador do celular (dados móveis 4G) ou em outra rede e clique em <b>Desconectar e trocar de sala</b>. O site continua tentando sozinho.</p>` : '';
  return `<b>${titulo}</b>${itens ? `<ul>${itens}</ul>` : ''}${dica}`;
}

/* ---------------- motor: roda o simulador e monta as mensagens do ESP32 ---------------- */
const VELOCIDADES = [[1 / 60, 'Tempo real'], [1, '1 min/s'], [5, '5 min/s'], [15, '15 min/s'], [60, '1 h/s']];
class Motor {
  constructor(sim, vel = 5) { this.sim = sim; this.vel = vel; this.pausado = false; this.logMsgs = []; this.marcarEnviado(); }
  marcarEnviado() { const s = this.sim; this.ult = { t: s.t, bio: s.biometrias.length ? s.biometrias[s.biometrias.length - 1].t : 0, ref: s.t, dia: s.diario.length ? s.diario[s.diario.length - 1].t : 0 }; }
  avancar(segReais) { if (!this.pausado) this.sim.avancar(this.vel * segReais); }
  sync() {
    const s = this.sim; this.marcarEnviado();
    return { tipo: 'sync', t: s.t, cenario: s.cenario, N: Math.round(s.v.N), historico: s.historico, diario: s.diario, biometrias: s.biometrias, refeicoes: s.refeicoes.filter(r => r.origem === 'tabela'), vel: this.vel, pausado: this.pausado };
  }
  mensagem() {
    const s = this.sim, base = { tipo: 'tick', t: s.t, vel: this.vel, pausado: this.pausado, cenario: s.cenario };
    if (!s.ctl.internet) return { ...base, offline: true };
    const u = this.ult;
    const m = { ...base, leituras: s.leituras(),
      amostras: s.historico.filter(a => a.t > u.t),
      biometrias: s.biometrias.filter(b => b.t > u.bio),
      refeicoes: s.refeicoes.filter(r => r.t > u.ref && r.origem === 'tabela'),
      diario: s.diario.filter(d => d.t > u.dia) };
    this.marcarEnviado();
    // registro do que iria para o broker, no formato do contrato de tópicos
    const hora = fmtHora(s.t);
    for (const [k, v] of Object.entries(m.leituras)) this.logMsgs.push(`${hora}  ${TOPICO}${k}  ${v}`);
    for (const b of m.biometrias) this.logMsgs.push(`${hora}  ${TOPICO}biomassa/peso_medio  ${b.W}`);
    for (const r of m.refeicoes) this.logMsgs.push(`${hora}  ${TOPICO}manejo/racao_ofertada  ${r.kg}`);
    if (this.logMsgs.length > 160) this.logMsgs.splice(0, this.logMsgs.length - 160);
    return m;
  }
  comando(topico, valor) {
    const ok = this.sim.comando(topico, valor);
    if (topico !== 'servidor/status') this.logMsgs.push(`${fmtHora(this.sim.t)}  ← ${TOPICO}${topico}  ${valor}${ok ? '' : '  (não entregue: sem internet)'}`);
    return ok;
  }
}

/* ---------------- gráficos em canvas ---------------- */
function prepararCanvas(cv) {
  const r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  const w = Math.max(10, Math.round(r.width)), h = Math.max(10, Math.round(r.height));
  if (cv.width !== w * dpr || cv.height !== h * dpr) { cv.width = w * dpr; cv.height = h * dpr; }
  const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
  return { g, w, h };
}
function passoBonito(faixa, alvo) { const bruto = faixa / alvo, p = Math.pow(10, Math.floor(Math.log10(bruto))), n = bruto / p; return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * p; }
function grafico(cv, o) {
  const { g, w, h } = prepararCanvas(cv);
  const m = { l: 40, r: 12, t: 10, b: 24 };
  const X = t => m.l + (t - o.x0) / (o.x1 - o.x0) * (w - m.l - m.r);
  const Y = v => m.t + (1 - (v - o.y0) / (o.y1 - o.y0)) * (h - m.t - m.b);
  const linha = cor('line'), ink2 = cor('ink-2'), ink3 = cor('ink-3');
  g.font = '11px ' + getComputedStyle(document.body).fontFamily; g.textBaseline = 'middle';
  // faixas de fundo (ex.: aerador ligado, faixa ótima)
  for (const f of o.faixasX || []) { g.fillStyle = f.cor; g.globalAlpha = f.alfa ?? 0.14; g.fillRect(X(f.t0), m.t, Math.max(1, X(f.t1) - X(f.t0)), h - m.t - m.b); g.globalAlpha = 1; }
  for (const f of o.faixasY || []) {
    const ya = Y(Math.min(f.y1, o.y1)), yb = Y(Math.max(f.y0, o.y0)); if (yb - ya <= 0) continue;
    g.fillStyle = f.cor; g.globalAlpha = f.alfa ?? 0.1; g.fillRect(m.l, ya, w - m.l - m.r, yb - ya); g.globalAlpha = 1;
    if (f.r && yb - ya >= 14) { g.fillStyle = f.cor; g.globalAlpha = 0.85; g.textAlign = 'right'; g.textBaseline = 'top'; g.fillText(f.r, w - m.r - 4, ya + 2); g.globalAlpha = 1; g.textBaseline = 'middle'; }
  }
  // grade horizontal
  const py = passoBonito(o.y1 - o.y0, 5);
  g.strokeStyle = linha; g.lineWidth = 1; g.fillStyle = ink2; g.textAlign = 'right';
  for (let v = Math.ceil(o.y0 / py) * py; v <= o.y1 + 1e-9; v += py) { const y = Math.round(Y(v)) + 0.5; g.beginPath(); g.moveTo(m.l, y); g.lineTo(w - m.r, y); g.stroke(); g.fillText(fmt(v, o.casas ?? (py < 0.1 ? 2 : py < 1 ? 1 : 0)), m.l - 6, y); }
  // eixo do tempo
  g.textAlign = 'center'; g.textBaseline = 'top';
  for (const tk of o.ticksX(X)) { g.fillStyle = ink2; g.fillText(tk.r, tk.x, h - m.b + 6); g.strokeStyle = linha; g.beginPath(); g.moveTo(Math.round(tk.x) + 0.5, h - m.b); g.lineTo(Math.round(tk.x) + 0.5, h - m.b + 4); g.stroke(); }
  // limites horizontais rotulados
  for (const l of o.limites || []) {
    const y = Math.round(Y(l.y)) + 0.5; g.strokeStyle = l.cor; g.setLineDash([2, 3]); g.beginPath(); g.moveTo(m.l, y); g.lineTo(w - m.r, y); g.stroke(); g.setLineDash([]);
    g.fillStyle = l.cor; g.textAlign = l.dir ? 'right' : 'left'; g.textBaseline = 'bottom'; g.fillText(l.r, l.dir ? w - m.r - 4 : m.l + 4, y - 2);
  }
  // bandas de incerteza
  for (const b of o.bandas || []) {
    if (b.pts.length < 2) continue; g.fillStyle = b.cor; g.globalAlpha = 0.16; g.beginPath();
    b.pts.forEach((p, i) => i ? g.lineTo(X(p.t), Y(clamp(p.hi, o.y0, o.y1))) : g.moveTo(X(p.t), Y(clamp(p.hi, o.y0, o.y1))));
    for (let i = b.pts.length - 1; i >= 0; i--) g.lineTo(X(b.pts[i].t), Y(clamp(b.pts[i].lo, o.y0, o.y1)));
    g.closePath(); g.fill(); g.globalAlpha = 1;
  }
  // séries
  for (const s of o.series) {
    if (!s.pts.length) continue;
    g.strokeStyle = s.cor; g.lineWidth = s.larg || 2; g.setLineDash(s.tracejado ? [5, 4] : []); g.lineJoin = 'round';
    if (s.area) {
      g.fillStyle = s.cor; g.globalAlpha = 0.09; g.beginPath(); g.moveTo(X(s.pts[0].t), Y(o.y0));
      for (const p of s.pts) g.lineTo(X(p.t), Y(clamp(p.v, o.y0, o.y1))); g.lineTo(X(s.pts[s.pts.length - 1].t), Y(o.y0)); g.closePath(); g.fill(); g.globalAlpha = 1;
    }
    if (s.pontos) { g.fillStyle = s.cor; for (const p of s.pts) { g.beginPath(); g.arc(X(p.t), Y(p.v), 3.5, 0, 7); g.fill(); } continue; }
    g.beginPath(); let ant = null;
    for (const p of s.pts) { const x = X(p.t), y = Y(clamp(p.v, o.y0, o.y1)); if (ant && p.t - ant.t > (s.gap || Infinity)) g.moveTo(x, y); else if (!ant) g.moveTo(x, y); else g.lineTo(x, y); ant = p; }
    g.stroke(); g.setLineDash([]);
    if (s.ponta) { const p = s.pts[s.pts.length - 1]; g.fillStyle = s.cor; g.beginPath(); g.arc(X(p.t), Y(clamp(p.v, o.y0, o.y1)), 4, 0, 7); g.fill(); }
  }
  // linha de "agora"
  if (o.agora) { const x = Math.round(X(o.agora)) + 0.5; g.strokeStyle = ink3; g.lineWidth = 1; g.beginPath(); g.moveTo(x, m.t); g.lineTo(x, h - m.b); g.stroke(); g.fillStyle = ink2; g.textAlign = 'center'; g.textBaseline = 'top'; g.fillText('agora', x, m.t); }
  for (const mk of o.marcas || []) { g.fillStyle = mk.cor; g.beginPath(); g.arc(X(mk.t), Y(mk.v), 5, 0, 7); g.fill(); g.textAlign = 'center'; g.textBaseline = 'bottom'; g.fillText(mk.r, X(mk.t), Y(mk.v) - 7); }
}
const ticksHoras = (x0, x1, cada) => X => { const out = []; for (let t = Math.ceil(x0 / (cada * H)) * cada * H; t <= x1; t += cada * H) out.push({ x: X(t), r: fmtHora(t) === '00:00' ? fmtDiaMes(t) : fmtHora(t) }); return out; };
const faixaTexto = (f, u) => { const n = v => String(v).replace('.', ','); const uu = u ? ' ' + u : '';
  return f.de === -Infinity ? `abaixo de ${n(f.ate)}${uu}` : f.ate === Infinity ? `${n(f.de)}${uu} ou mais` : `${n(f.de)} a ${n(f.ate)}${uu}`; };
const ESCALA_REGUA = { temp: [8, 36], od: [0, 12], ph: [4, 11.5], nh3: [0, 0.2] };
const COR_ZONA = { ideal: ['ok', 0.09], atencao: ['warn', 0.11], critico: ['crit', 0.10], morte: ['crit', 0.24] };
const faixasDeZona = (k, rotulos = true) => ZONAS[k].faixas.map(f => ({ y0: f.de, y1: f.ate, cor: cor(COR_ZONA[f.nivel][0]), alfa: COR_ZONA[f.nivel][1], r: rotulos ? f.r : null }));
function sparkline(cv, pts, c, y0, y1, zona) {
  const { g, w, h } = prepararCanvas(cv); pts = pts.filter(v => v != null && isFinite(v)); if (pts.length < 2) return;
  let lo = y0 ?? Math.min(...pts), hi = y1 ?? Math.max(...pts); if (hi - lo < 1e-6) { hi += 1; lo -= 1; }
  const X = i => i / (pts.length - 1) * (w - 4) + 2, Y = v => 3 + (1 - (v - lo) / (hi - lo)) * (h - 6);
  if (zona) for (const f of faixasDeZona(zona, false)) { const ya = Math.max(0, Y(Math.min(f.y1, hi + (hi - lo)))), yb = Math.min(h, Y(Math.max(f.y0, lo - (hi - lo)))); if (yb > ya) { g.fillStyle = f.cor; g.globalAlpha = f.alfa * 1.6; g.fillRect(0, ya, w, yb - ya); g.globalAlpha = 1; } }
  g.strokeStyle = c; g.lineWidth = 1.5; g.beginPath(); pts.forEach((v, i) => i ? g.lineTo(X(i), Y(v)) : g.moveTo(X(i), Y(v))); g.stroke();
  g.fillStyle = c; g.beginPath(); g.arc(X(pts.length - 1), Y(pts[pts.length - 1]), 2.5, 0, 7); g.fill();
}

/* ---------------- controles do simulador (aba própria ou gaveta do painel) ---------------- */
const EVENTOS = [
  { id: 'algas', titulo: 'Colapso das algas', texto: 'A fotossíntese cai 70% por 24 h e a matéria orgânica sobe. O OD despenca na noite seguinte.', aplicar: s => { s.efeito('v.algas', 0.3, 24, 'Colapso das algas'); s.v.carga += 12; s.s.carga += 12; } },
  { id: 'frio', titulo: 'Onda de frio', texto: 'Ar 9 °C abaixo do normal por 3 dias. A água esfria, o apetite cai e o gêmeo corta a ração.', aplicar: s => s.efeito('ctl.deltaTempAr', -9, 72, 'Onda de frio') },
  { id: 'calor', titulo: 'Calor extremo', texto: 'Ar 6 °C acima do normal por 2 dias. Água quente segura menos oxigênio.', aplicar: s => s.efeito('ctl.deltaTempAr', 6, 48, 'Calor extremo') },
  { id: 'chuva', titulo: 'Dia nublado e chuvoso', texto: 'Céu fechado e chuva por 8 h. Pouca luz, pouca fotossíntese.', aplicar: s => { s.efeito('ctl.nuvemManual', 0.2, 8, 'Dia nublado e chuvoso'); s.efeito('ctl.chuvaForcada', true, 8); } },
  { id: 'amonia', titulo: 'Pico de amônia', texto: 'A amônia total sobe 2,5 mg/L, como depois de sobra de ração acumulada.', aplicar: s => { s.v.TAN += 2.5; s.s.TAN += 2.5; s.registrar('Pico de amônia'); } },
  { id: 'internet', titulo: 'Queda de internet', texto: 'O ESP32 fica 3 h sem conexão. O fallback local assume o aerador e os dados ficam guardados.', aplicar: s => s.efeito('ctl.internet', false, 3, 'Queda de internet') },
  { id: 'aerador', titulo: 'Falha do aerador', texto: 'Por 4 h o motor liga, mas não aera. O gêmeo percebe pelo OD que não sobe.', aplicar: s => s.efeito('ctl.falhaAerador', true, 4, 'Falha do aerador') },
  { id: 'sensor', titulo: 'Sonda de OD descalibrada', texto: 'Por 2 h a sonda lê 2,5 mg/L a menos. O gêmeo compara com o modelo e desconfia.', aplicar: s => s.efeito('ctl.offsetOD', -2.5, 2, 'Sonda de OD descalibrada') },
  { id: 'normal', titulo: 'Voltar ao normal', texto: 'Encerra os efeitos ativos e destrava os sensores.', aplicar: s => { const manejo = s.ctl.manejo; s.temporarios = []; s.ctl = CONTROLES_PADRAO(); s.ctl.manejo = manejo; s.v.algas = 1; s.s.algas = 1; s.registrar('Condições normais restauradas'); } }
];
const SENSORES = [
  { k: 'Tw', nome: 'Temperatura da água', un: '°C', min: 10, max: 38, passo: 0.1, d: 1 },
  { k: 'OD', nome: 'Oxigênio dissolvido', un: 'mg/L', min: 0, max: 20, passo: 0.1, d: 1 },
  { k: 'pH', nome: 'pH', un: '', min: 5, max: 10, passo: 0.05, d: 2 },
  { k: 'TAN', nome: 'Amônia total (NAT)', un: 'mg/L', min: 0, max: 6, passo: 0.05, d: 2 }
];
/* Cada mexida nos controles vira uma ação {a, ...}. Na aba dona da simulação a ação é aplicada direto;
   no celular (controle remoto) ela é enviada ao dono, que aplica e devolve o estado. As ações são
   absolutas (ex.: "pausado = true", não "inverter"), então repetir uma ação não muda o resultado. */
function aplicarAcao(motor, ac) {
  const s = motor.sim;
  switch (ac.a) {
    case 'vel': motor.vel = +ac.v; break;
    case 'pausa': motor.pausado = !!ac.v; break;
    case 'evento': { const e = EVENTOS.find(x => x.id === ac.id); if (e) e.aplicar(s); break; }
    case 'sensor': if (SENSORES.some(x => x.k === ac.k)) { s.v[ac.k] = +ac.v; if (ac.trava) s.ctl.travas[ac.k] = +ac.v; } break;
    case 'trava': if (ac.on) s.ctl.travas[ac.k] = +ac.v; else delete s.ctl.travas[ac.k]; break;
    case 'dta': s.ctl.deltaTempAr = +ac.v; break;
    case 'nuvem': s.ctl.nuvemManual = ac.v == null ? null : +ac.v; break;
    case 'vento': s.ctl.ventoExtra = +ac.v; break;
    case 'chuva': s.ctl.chuvaForcada = !!ac.on; break;
    case 'net': if (s.ctl.internet !== !!ac.on) { s.temporarios = s.temporarios.filter(t => t.chave !== 'ctl.internet'); s.ctl.internet = !!ac.on; s.registrar(ac.on ? 'Internet do ESP32 restabelecida' : 'Internet do ESP32 desligada'); } break;
    case 'falha': s.temporarios = s.temporarios.filter(t => t.chave !== 'ctl.falhaAerador'); s.ctl.falhaAerador = !!ac.on; break;
    case 'manejo': { const m = ac.on ? 'gemeo' : 'tradicional'; if (s.ctl.manejo !== m) { s.ctl.manejo = m; s.registrar(ac.on ? 'Viveiro passa a seguir o gêmeo' : 'Viveiro passa ao manejo tradicional'); } break; }
    case 'biometria': { const b = s.biometria(); s.registrar(`Biometria: peso médio ${fmt(b.W, 1)} g`); break; }
  }
}
// executor da aba dona: aplica a ação; "reiniciar" troca o motor (trocar(novoMotor))
function executorLocal(obterMotor, trocar, depois) {
  return ac => {
    if (ac.a === 'reiniciar') { if (CENARIOS[ac.cen]) trocar(new Motor(new Simulador(ac.cen), obterMotor().vel)); }
    else aplicarAcao(obterMotor(), ac);
    depois(ac);
  };
}
// estado compacto que o dono envia ao celular (só o que a tela de controles mostra)
function estadoRemoto(motor) {
  const s = motor.sim, v = s.v, c = s.clima;
  return { tipo: 'estado', t: s.t, cenario: s.cenario, vel: motor.vel, pausado: motor.pausado,
    v: { Tw: v.Tw, OD: v.OD, pH: v.pH, TAN: v.TAN, aerador: v.aerador, W: v.W, N: v.N },
    clima: { Ta: c.Ta, UR: c.UR, rad: c.rad, nuvem: c.nuvem }, ctl: s.ctl,
    temporarios: s.temporarios.map(e => ({ chave: e.chave, rotulo: e.rotulo })), eventos: s.eventos.slice(-12),
    biometrias: s.biometrias.slice(-1), origemAerador: s.origemAerador, comp: s.comparacao(), log: motor.logMsgs.slice(-40) };
}
// "motor" de leitura montado com o estado recebido, para reaproveitar atualizarControles no celular
function motorDeEstado(e) {
  return { vel: e.vel, pausado: e.pausado, logMsgs: e.log || [],
    sim: { t: e.t, cenario: e.cenario, v: e.v, clima: e.clima, ctl: e.ctl, temporarios: e.temporarios, eventos: e.eventos, biometrias: e.biometrias, origemAerador: e.origemAerador, comparacao: () => e.comp } };
}
// a aba dona atende os controles remotos: responde a quem procura, aplica as ações e manda o estado
function servirRemotos(bus, obterMotor, executar) {
  const remotos = new Map(); let ultEnvio = 0;
  const enviarEstado = (forcar) => {
    const agora = Date.now();
    for (const [id, visto] of remotos) if (agora - visto > 15000) remotos.delete(id);
    if (!remotos.size || !obterMotor() || (!forcar && agora - ultEnvio < 500)) return;
    ultEnvio = agora; bus.enviar(estadoRemoto(obterMotor()));
  };
  bus.on(m => {
    if (!obterMotor()) return;
    if (m.tipo === 'procurar-dono' || m.tipo === 'oi-remoto') { remotos.set(m.de, Date.now()); if (m.tipo === 'procurar-dono') bus.enviar({ tipo: 'dono', para: m.de }); enviarEstado(true); }
    else if (m.tipo === 'acao' && m.acao) { remotos.set(m.de, Date.now()); executar(m.acao); enviarEstado(true); }
  });
  return { enviarEstado, remotos };
}
function montarControles(raiz, obterMotor, executar) {
  raiz.innerHTML = `
  <section class="card s12">
    <header><h2>Tempo e cenário</h2><span class="sutil" id="c-relogio"></span></header>
    <div class="velocidades" id="c-vel">${VELOCIDADES.map(([v, r]) => `<button class="btn" data-vel="${v}">${r}</button>`).join('')}<button class="btn" id="c-pausa">Pausar</button></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
      <label class="rotulo" for="c-cenario">Estação</label>
      <select id="c-cenario" class="btn">${Object.entries(CENARIOS).map(([k, c]) => `<option value="${k}">${c.nome} (${c.detalhe})</option>`).join('')}</select>
      <button class="btn" id="c-reiniciar">Reiniciar neste cenário</button>
    </div>
  </section>
  <section class="card s12">
    <header><h2>Cenários para a apresentação</h2><span class="sutil">Um clique dispara o evento no viveiro simulado</span></header>
    <div class="eventos">${EVENTOS.map(e => `<button class="evento" data-ev="${e.id}"><b>${e.titulo}</b><span>${e.texto}</span></button>`).join('')}</div>
  </section>
  <section class="card s6">
    <header><h2>Sensores do viveiro</h2><span class="sutil">Arraste para mudar; trave para segurar o valor</span></header>
    <div>${SENSORES.map(x => `<div class="slider"><label for="c-s-${x.k}">${x.nome}</label><output id="c-o-${x.k}">--</output>
      <input type="range" id="c-s-${x.k}" min="${x.min}" max="${x.max}" step="${x.passo}">
      <div class="opcoes"><label><input type="checkbox" id="c-t-${x.k}"> Travar neste valor</label><span>${x.un}</span></div></div>`).join('')}</div>
  </section>
  <section class="card s6">
    <header><h2>Clima</h2><span class="sutil" id="c-clima"></span></header>
    <div>
      <div class="slider"><label for="c-dta">Desvio da temperatura do ar</label><output id="c-o-dta">0 °C</output><input type="range" id="c-dta" min="-12" max="8" step="0.5"></div>
      <div class="slider"><label for="c-nuvem">Luz do sol (100% = céu limpo)</label><output id="c-o-nuvem">auto</output><input type="range" id="c-nuvem" min="0.1" max="1" step="0.05">
        <div class="opcoes"><label><input type="checkbox" id="c-nuvem-auto" checked> Automático pelo clima do dia</label></div></div>
      <div class="slider"><label for="c-vento">Vento extra</label><output id="c-o-vento">0 m/s</output><input type="range" id="c-vento" min="-2" max="8" step="0.5"></div>
      <div class="alternar"><label for="c-chuva">Chuva agora<small>Nuvens e queda de temperatura do ar</small></label><input type="checkbox" class="troca" id="c-chuva"></div>
    </div>
  </section>
  <section class="card s6">
    <header><h2>Dispositivo e manejo</h2><span class="sutil" id="c-aer"></span></header>
    <div>
      <div class="alternar"><label for="c-net">Internet do ESP32<small>Desligada, o painel fica sem dados e o ESP32 decide sozinho</small></label><input type="checkbox" class="troca" id="c-net"></div>
      <div class="alternar"><label for="c-falha">Aerador com defeito<small>Liga, mas não oxigena a água</small></label><input type="checkbox" class="troca" id="c-falha"></div>
      <div class="alternar"><label for="c-manejo">Viveiro seguindo o gêmeo<small>Desligado, o tratador usa a tabela fixa (8h e 16h)</small></label><input type="checkbox" class="troca" id="c-manejo"></div>
      <div class="alternar"><label>Biometria<small id="c-bio">Pesagem de amostra com a balança</small></label><button class="btn" id="c-biometria">Pesar agora</button></div>
    </div>
  </section>
  <section class="card s6">
    <header><h2>Gêmeo x manejo tradicional</h2><span class="sutil" id="c-comp-dias"></span></header>
    <p class="sutil" style="margin:0;font-size:.84rem">Um segundo viveiro, igual e sob o mesmo clima, segue a tabela fixa de ração e o aerador das 23h às 6h.</p>
    <div class="tabela-rolagem"><table class="comp"><thead><tr><th>Indicador</th><th>Gêmeo</th><th>Tradicional</th></tr></thead><tbody id="c-comp"></tbody></table></div>
  </section>
  <section class="card s12">
    <header><h2>Mensagens do ESP32</h2><span class="sutil">O que seria publicado no broker, tópico por tópico</span></header>
    <div class="mensagens" id="c-msgs"></div>
  </section>
  <section class="card s12">
    <header><h2>Eventos no viveiro</h2></header>
    <ul class="log" id="c-eventos"></ul>
  </section>`;
  const M = obterMotor, fazer = executar;
  raiz.querySelectorAll('[data-vel]').forEach(b => b.onclick = () => fazer({ a: 'vel', v: +b.dataset.vel }));
  $('#c-pausa', raiz).onclick = () => fazer({ a: 'pausa', v: !M().pausado });
  $('#c-reiniciar', raiz).onclick = () => fazer({ a: 'reiniciar', cen: $('#c-cenario', raiz).value });
  raiz.querySelectorAll('[data-ev]').forEach(b => b.onclick = () => fazer({ a: 'evento', id: b.dataset.ev }));
  // sliders: no máximo uma ação a cada 120 ms enquanto arrasta, e sempre a última ao soltar
  const limitado = (fn) => { let ult = 0, tmr = null; return (final) => { clearTimeout(tmr); const agora = Date.now(); if (final || agora - ult > 120) { ult = agora; fn(); } else tmr = setTimeout(() => { ult = Date.now(); fn(); }, 120); }; };
  for (const x of SENSORES) {
    const sl = $('#c-s-' + x.k, raiz), tr = $('#c-t-' + x.k, raiz);
    sl.addEventListener('pointerdown', () => sl.dataset.mexendo = '1');
    window.addEventListener('pointerup', () => delete sl.dataset.mexendo);
    const mandar = limitado(() => fazer({ a: 'sensor', k: x.k, v: +sl.value, trava: tr.checked }));
    sl.oninput = () => { $('#c-o-' + x.k, raiz).textContent = fmt(+sl.value, x.d) + ' ' + x.un; mandar(false); };
    sl.onchange = () => mandar(true);
    tr.onchange = () => fazer({ a: 'trava', k: x.k, on: tr.checked, v: +sl.value });
  }
  const dta = $('#c-dta', raiz), mDta = limitado(() => fazer({ a: 'dta', v: +dta.value }));
  dta.oninput = () => mDta(false); dta.onchange = () => mDta(true);
  const nv = $('#c-nuvem', raiz), na = $('#c-nuvem-auto', raiz), mNv = limitado(() => fazer({ a: 'nuvem', v: +nv.value }));
  nv.oninput = () => { na.checked = false; mNv(false); }; nv.onchange = () => mNv(true);
  na.onchange = () => fazer({ a: 'nuvem', v: na.checked ? null : +nv.value });
  const ve = $('#c-vento', raiz), mVe = limitado(() => fazer({ a: 'vento', v: +ve.value }));
  ve.oninput = () => mVe(false); ve.onchange = () => mVe(true);
  $('#c-chuva', raiz).onchange = e => fazer({ a: 'chuva', on: e.target.checked });
  $('#c-net', raiz).onchange = e => fazer({ a: 'net', on: e.target.checked });
  $('#c-falha', raiz).onchange = e => fazer({ a: 'falha', on: e.target.checked });
  $('#c-manejo', raiz).onchange = e => fazer({ a: 'manejo', on: e.target.checked });
  $('#c-biometria', raiz).onclick = () => fazer({ a: 'biometria' });
}
function atualizarControles(raiz, motor) {
  if (!raiz.firstElementChild) return;
  const s = motor.sim, v = s.v, c = s.clima;
  $('#c-relogio', raiz).textContent = `${fmtData(s.t)} · ${fmtHora(s.t)} · ${CENARIOS[s.cenario].nome}`;
  raiz.querySelectorAll('[data-vel]').forEach(b => b.classList.toggle('ativo', +b.dataset.vel === motor.vel && !motor.pausado));
  $('#c-pausa', raiz).textContent = motor.pausado ? 'Continuar' : 'Pausar'; $('#c-pausa', raiz).classList.toggle('ativo', motor.pausado);
  if (document.activeElement !== $('#c-cenario', raiz)) $('#c-cenario', raiz).value = s.cenario;
  const ativos = new Set(s.temporarios.map(e => e.rotulo).filter(Boolean));
  raiz.querySelectorAll('[data-ev]').forEach(b => { const e = EVENTOS.find(x => x.id === b.dataset.ev); b.classList.toggle('ativo', ativos.has(e.titulo)); });
  for (const x of SENSORES) {
    const sl = $('#c-s-' + x.k, raiz), tr = $('#c-t-' + x.k, raiz);
    const val = s.ctl.travas[x.k] ?? v[x.k];
    if (!sl.dataset.mexendo && document.activeElement !== sl) { sl.value = val; $('#c-o-' + x.k, raiz).textContent = fmt(val, x.d) + (x.un ? ' ' + x.un : ''); }
    tr.checked = s.ctl.travas[x.k] != null;
  }
  const dta = $('#c-dta', raiz); if (document.activeElement !== dta) dta.value = s.ctl.deltaTempAr;
  $('#c-o-dta', raiz).textContent = (s.ctl.deltaTempAr > 0 ? '+' : '') + fmt(s.ctl.deltaTempAr, 1) + ' °C';
  const na = $('#c-nuvem-auto', raiz), nv = $('#c-nuvem', raiz); na.checked = s.ctl.nuvemManual == null;
  if (document.activeElement !== nv) nv.value = s.ctl.nuvemManual ?? c.nuvem;
  $('#c-o-nuvem', raiz).textContent = Math.round((s.ctl.nuvemManual ?? c.nuvem) * 100) + '%' + (na.checked ? ' (auto)' : '');
  const ve = $('#c-vento', raiz); if (document.activeElement !== ve) ve.value = s.ctl.ventoExtra; $('#c-o-vento', raiz).textContent = fmt(s.ctl.ventoExtra, 1) + ' m/s';
  $('#c-chuva', raiz).checked = !!s.ctl.chuvaForcada;
  $('#c-clima', raiz).textContent = `Ar ${fmt(c.Ta, 1)} °C · ${Math.round(c.UR)}% · ${Math.round(c.rad)} W/m²`;
  $('#c-net', raiz).checked = s.ctl.internet; $('#c-falha', raiz).checked = !!s.ctl.falhaAerador; $('#c-manejo', raiz).checked = s.ctl.manejo === 'gemeo';
  const origem = { gemeo: 'pelo gêmeo', 'fallback local': 'pelo fallback local', 'seguranca local': 'pela segurança local', tradicional: 'pelo horário fixo' }[s.origemAerador] || '';
  $('#c-aer', raiz).textContent = `Aerador ${v.aerador ? 'ligado' : 'desligado'} ${origem}`;
  const ub = s.biometrias[s.biometrias.length - 1];
  $('#c-bio', raiz).textContent = `Peso real ${fmt(v.W, 1)} g · ${Math.round(v.N).toLocaleString('pt-BR')} peixes` + (ub ? ` · última pesagem ${fmtDiaMes(ub.t)}: ${fmt(ub.W, 1)} g` : '');
  // comparação
  const cp = s.comparacao(), G = cp.gemeo, T = cp.tradicional;
  $('#c-comp-dias', raiz).textContent = cp.dias < 0.05 ? 'começa agora' : `há ${fmt(cp.dias, 1)} dias simulados`;
  const linha = (nome, a, b, d, un, menorMelhor = true) => {
    const melhorA = a != null && b != null && Math.abs(a - b) > 1e-6 && (menorMelhor ? a < b : a > b);
    const melhorB = a != null && b != null && Math.abs(a - b) > 1e-6 && !melhorA;
    return `<tr><td>${nome}</td><td class="${melhorA ? 'melhor' : ''}">${a == null ? '--' : fmt(a, d) + un}</td><td class="${melhorB ? 'melhor' : ''}">${b == null ? '--' : fmt(b, d) + un}</td></tr>`;
  };
  $('#c-comp', raiz).innerHTML = linha('Ração ofertada', G.racao, T.racao, 1, ' kg') + linha('Ração desperdiçada', G.desperdicio, T.desperdicio, 1, ' kg')
    + linha('Ganho de biomassa', G.ganho, T.ganho, 1, ' kg', false) + linha('Conversão alimentar', G.ca, T.ca, 2, '')
    + linha('Aerador ligado', G.horasAerador, T.horasAerador, 1, ' h') + linha('OD mínimo', G.odMin > 90 ? null : G.odMin, T.odMin > 90 ? null : T.odMin, 1, ' mg/L', false)
    + linha('Peixes mortos', G.mortos, T.mortos, 0, '') + linha('Peso médio', G.W, T.W, 1, ' g', false);
  const msgs = $('#c-msgs', raiz), noFim = msgs.scrollTop + msgs.clientHeight >= msgs.scrollHeight - 30;
  msgs.innerHTML = motor.logMsgs.slice(-60).map(l => esc(l).replace(/(gemeo\/viveiro1\/\S+)/, '<span class="top">$1</span>')).join('\n');
  if (noFim) msgs.scrollTop = msgs.scrollHeight;
  $('#c-eventos', raiz).innerHTML = s.eventos.slice(-12).reverse().map(e => `<li><time>${fmtHora(e.t)}</time><span>${esc(e.txt)}</span></li>`).join('') || '<li class="sutil">Nenhum evento ainda.</li>';
}

/* ---------------- painel do gêmeo ---------------- */
const ORIGEM = { GEMEO: 'Gêmeo digital', FALLBACK_LOCAL: 'Fallback local do ESP32', SEGURANCA_LOCAL: 'Segurança local do ESP32', TRADICIONAL: 'Horário fixo do tratador' };
function iniciarPainel() {
  const bus = new Barramento();
  const est = { modo: 'procurando', motor: null, ultimoTick: 0, vel: 5, pausado: false, ticks: 0, offlineDesde: null };
  const enviar = (topico, valor) => {
    bus.comandoContrato(topico, valor);
    if (est.modo === 'interno') est.motor.comando(topico, valor);
    else bus.enviar({ tipo: 'comando', topico, valor });
  };
  const gemeo = new Gemeo(enviar);
  window.__gemeo = gemeo; window.__est = est; window.__bus = bus;
  const gav = $('#gaveta'), ctlInt = $('#controles-internos');

  function iniciarInterno(snapshot) {
    const sim = snapshot ? Simulador.restaurar(snapshot.estado) : new Simulador(gemeo.cenario || 'verao');
    est.motor = new Motor(sim, snapshot ? snapshot.vel : est.vel); est.modo = 'interno';
    gemeo.sincronizar(est.motor.sync()); sim.gemeoAtivo = true; sim.ultimoComando = sim.t;
    montarControles(ctlInt, () => est.motor, est.executar);
    render();
  }
  // ações dos controles (gaveta desta aba ou celular): só valem quando a simulação roda aqui
  est.executar = executorLocal(() => est.motor, novo => { est.motor = novo; gemeo.sincronizar(novo.sync()); novo.sim.gemeoAtivo = true; }, () => passo(0));
  // o painel é o único dono da simulação: o celular só manda ações e recebe o estado
  const remoto = servirRemotos(bus, () => est.modo === 'interno' ? est.motor : null, ac => { if (est.modo === 'interno') est.executar(ac); });
  est.remotos = remoto.remotos;
  function passo(seg) {
    if (est.modo !== 'interno') return;
    est.motor.avancar(seg);
    const m = est.motor.mensagem();
    bus.espelhar(m.leituras, m.t);
    tratar(m);
    atualizarControles(ctlInt, est.motor);
    remoto.enviarEstado(false);
  }
  function tratar(m) {
    if (est.modo === 'interno' && !m.offline) bus.enviar({ ...m, tipo: 'tick-espelho' });
    est.ultimoTick = Date.now(); est.vel = m.vel; est.pausado = m.pausado;
    if (m.offline) { gemeo.t = m.t; gemeo.online = false; if (!est.offlineDesde) est.offlineDesde = m.t; gemeo.atualizarAlertas(); }
    else { est.offlineDesde = null; gemeo.receber(m); }
    if (++est.ticks % 4 === 0) enviar('servidor/status', 'ONLINE');
    if (pv) pv.tick(m.t);
    render();
  }
  bus.on(m => {
    if (m.tipo === 'sync') { if (est.modo === 'interno' || (m.para && m.para !== bus.id)) return; est.modo = 'externo'; est.fonte = m.de; gemeo.sincronizar(m); est.ultimoTick = Date.now(); render(); }
    else if (m.tipo === 'tick') {
      if (est.modo === 'interno') return;
      // segue um único simulador: ticks de outra origem são ignorados enquanto a fonte atual estiver viva
      if (est.modo === 'externo' && est.fonte && m.de !== est.fonte) { if (Date.now() - est.ultimoTick > 5000) { est.fonte = null; est.modo = 'procurando'; bus.enviar({ tipo: 'pedir-sync' }); } return; }
      if (est.modo !== 'externo') { est.modo = 'externo'; bus.enviar({ tipo: 'pedir-sync' }); return; }
      tratar(m);
    }
    else if (m.tipo === 'tchau' && est.modo === 'externo' && m.de === est.fonte) { est.ultimoTick = 0; render(); }
    else if (m.tipo === 'pedir-sync' && est.modo === 'interno') bus.enviar({ ...est.motor.sync(), para: m.de });
    else if (m.tipo === 'pedir-previsao' && est.modo === 'interno') bus.enviar({ tipo: 'previsao', para: m.de, t: est.motor.sim.t, cenario: est.motor.sim.cenario, dias: est.motor.sim.previsaoClima(7) });
  });
  bus.pronto.then(() => { bus.enviar({ tipo: 'pedir-sync' }); setTimeout(() => { if (est.modo === 'procurando') iniciarInterno(); }, 900); });
  setInterval(() => passo(0.25), 250);
  setInterval(() => { if (est.modo === 'externo' && Date.now() - est.ultimoTick > 4000) render(); }, 1000);

  // controle pelo celular: servidor local (servidor.py) ou broker MQTT na internet com código de sala
  let emIframe0 = false; try { emIframe0 = window.self !== window.top; } catch (_) { emIframe0 = true; }
  $('#bt-celular').hidden = emIframe0;
  bus.aoMudarRede = () => { render(); if (!$('#modal-celular').hidden) mostrarCelular(); };
  async function mostrarCelular() {
    $('#modal-celular').hidden = false;
    const hospedado = /^https?:$/.test(location.protocol);
    $('#mc-config').hidden = !!bus.modoRede || !hospedado; $('#mc-conectado').hidden = !bus.modoRede;
    $('#mc-arquivo').hidden = hospedado || !!bus.modoRede;
    $('#mc-estado').innerHTML = statusRede(bus);
    $('#mc-estado').dataset.estado = bus.mqttOk ? 'ok' : bus.todosFalharam() ? 'crit' : 'warn';
    $('#bt-mc-desligar').hidden = bus.modoRede !== 'nuvem';
    if (!bus.modoRede) return;
    const url = bus.linkCelular();
    try { if (!window.qrcode) await carregarScript('qrcode.js'); const q = qrcode(0, 'L'); q.addData(url); q.make(); $('#mc-qr').innerHTML = q.createSvgTag({ cellSize: 6, margin: 2, scalable: true }); } catch (_) { $('#mc-qr').textContent = ''; }
    $('#mc-url').textContent = bus.modoRede === 'local' ? url : url.split('#')[0];
    const outros = bus.modoRede === 'local' ? bus.info.ips.slice(1).map(ip => `http://${ip}:${bus.info.porta}/simulador.html`) : [];
    $('#mc-outros').textContent = outros.length ? 'Se não abrir, tente: ' + outros.join(' · ') : '';
  }
  $('#bt-celular').onclick = () => mostrarCelular();
  $('#bt-mc-conectar').onclick = async () => {
    const cfg = { url: $('#mc-broker').value.trim() || 'auto', sala: novaSala() };
    const u = $('#mc-usuario').value.trim(); if (u) { cfg.usuario = u; cfg.senha = $('#mc-senha').value; }
    bus.usarNuvem(cfg); mostrarCelular();
  };
  $('#bt-mc-desligar').onclick = () => { bus.desligarNuvem(); mostrarCelular(); };
  $('#bt-fechar-celular').onclick = () => { $('#modal-celular').hidden = true; };
  $('#modal-celular').onclick = e => { if (e.target.id === 'modal-celular') $('#modal-celular').hidden = true; };

  // abas internas: Painel, Previsão 7 dias e Fontes na mesma página
  let vista = 'painel';
  const pv = iniciarPrevisao({ bus, gemeo, visivel: () => vista === 'previsao', simDireto: () => est.modo === 'interno' ? est.motor.sim.previsaoClima(7) : null });
  iniciarFontes();
  function mostrar(v) {
    vista = v;
    document.querySelectorAll('.abas [data-vista]').forEach(b => { if (b.dataset.vista === v) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
    ['painel', 'previsao', 'fontes'].forEach(k => { $('#vista-' + k).hidden = k !== v; });
    window.scrollTo(0, 0);
    if (v === 'previsao') pv.abrir(); else if (v === 'painel') render();
  }
  document.querySelectorAll('.abas [data-vista]').forEach(b => b.onclick = () => mostrar(b.dataset.vista));
  // dentro da versão publicada (iframe), abrir outra aba levaria ao navegador externo: usa a gaveta de controles
  let emIframe = false; try { emIframe = window.self !== window.top; } catch (_) { emIframe = true; }
  if (emIframe) $('#bt-abrir-sim').hidden = true;
  window.__mostrar = mostrar;

  // botões
  $('#bt-ligar').onclick = () => { gemeo.modoAeracao = 'MANUAL'; gemeo.comandarAerador(true, null, true); render(); };
  $('#bt-desligar').onclick = () => { gemeo.modoAeracao = 'MANUAL'; gemeo.comandarAerador(false, null, true); render(); };
  $('#bt-auto').onclick = () => { gemeo.modoAeracao = 'AUTO'; gemeo.registrarAcao(gemeo.t, 'Aeração devolvida ao modo automático'); gemeo.ciclo(); render(); };
  $('#bt-controles').onclick = () => { if (est.modo === 'interno') gav.hidden = !gav.hidden; };
  $('#bt-fechar-gaveta').onclick = () => gav.hidden = true;
  $('#bt-rodar-aqui').onclick = () => iniciarInterno();
  window.addEventListener('resize', () => render());
  const mq = window.matchMedia('(prefers-color-scheme: dark)'); if (mq.addEventListener) mq.addEventListener('change', () => render());

  function estadoValor(k, v) {
    const n = nivelZona(k, v);
    return n == null ? '' : n === 'ideal' ? 'ok' : n === 'atencao' ? 'atencao' : 'critico';
  }
  document.querySelectorAll('.fonte-zona[data-zona]').forEach(el => { const z = ZONAS[el.dataset.zona]; el.innerHTML = `<b>Zonas para a tilápia-do-nilo:</b> ${z.faixas.map(f => `${f.r} ${faixaTexto(f, z.unid)}`).join(' · ')}. Fontes: ${z.fonte}.`; });
  function render() {
    const g = gemeo, L = g.L, a = g.atual, t = g.t;
    if (t == null) return;
    const semSinal = est.modo === 'externo' && Date.now() - est.ultimoTick > 4000;
    // topo
    $('#hora').textContent = fmtHora(t); $('#data').textContent = fmtData(t) + ' · ' + (CENARIOS[g.cenario] ? CENARIOS[g.cenario].nome : '');
    const online = g.online && !semSinal;
    $('#chip-disp').className = 'chip ' + (online ? 'ok' : 'crit');
    $('#chip-disp').textContent = online ? 'ESP32 online' : semSinal ? 'Simulador parado' : 'ESP32 offline';
    $('#chip-fonte').textContent = est.modo === 'interno' ? 'Simulação nesta aba' + (est.remotos && est.remotos.size ? ' · celular conectado' : '') : est.modo === 'externo' ? (bus.mqttOk ? 'Simulador via ' + bus.descricaoRede() : 'Simulador em outra aba') : 'Procurando simulador';
    $('#chip-aer').className = 'chip ' + (g.modoAeracao === 'AUTO' ? 'ok' : 'warn');
    $('#chip-aer').textContent = 'Aeração ' + (g.modoAeracao === 'AUTO' ? 'automática' : 'manual');
    $('#chip-vel').textContent = est.pausado ? 'Pausado' : (VELOCIDADES.find(v => v[0] === est.vel) || [0, ''])[1];
    $('#bt-controles').hidden = est.modo !== 'interno';
    $('#aviso-parado').hidden = !semSinal;
    $('#aviso-offline').hidden = !(est.offlineDesde && !semSinal);
    if (est.offlineDesde) $('#aviso-offline-txt').textContent = `Sem dados do ESP32 desde ${fmtHora(est.offlineDesde)}. O dispositivo segue com o fallback local e guarda as leituras para enviar quando voltar.`;

    // leituras
    const h24 = g.hist.filter(x => x.t > t - DIA);
    const tile = (id, estado, valor, sub, serie, c, zona) => {
      const el = $('#' + id); el.dataset.estado = estado || '';
      $('.valor', el).innerHTML = valor; $('.linha2 span:last-child', el).textContent = sub; $('.linha2 span:last-child', el).title = sub;
      sparkline($('canvas', el), serie, cor(c));
      const rg = $('.regua', el);
      if (rg && zona) {
        const [lo, hi] = ESCALA_REGUA[zona], pos = v => clamp((v - lo) / (hi - lo) * 100, 0, 100);
        if (!rg.dataset.pronto) {
          const corN = { ideal: 'var(--ok)', atencao: 'var(--warn)', critico: 'var(--crit)', morte: 'var(--crit)' };
          rg.style.background = 'linear-gradient(90deg,' + ZONAS[zona].faixas.map(f => `${corN[f.nivel]} ${pos(f.de)}% ${pos(f.ate)}%`).join(',') + ')';
          rg.title = ZONAS[zona].faixas.map(f => `${f.r}: ${faixaTexto(f, ZONAS[zona].unid)}`).join(' · '); rg.dataset.pronto = 1;
        }
        const val = valorZona[zona]; $('b', rg).style.left = val == null ? '-20px' : pos(val) + '%';
        const fz = faixaZona(zona, val); const se = $('.selo', el); se.textContent = fz ? fz.r : ''; se.dataset.nivel = fz ? fz.nivel : '';
      }
    };
    const valorZona = { temp: a.temperatura, od: a.od, ph: a.ph, nh3: a.uia };
    const peso = g.pesoEstimado(), biomassa = peso * g.N / 1000;
    tile('t-temp', estadoValor('temp', a.temperatura), `${fmt(a.temperatura, 1)}<small>°C</small>`, tendencia(h24, 'Tw', 1, '°C/h'), h24.map(x => x.Tw), 'accent', 'temp');
    tile('t-od', estadoValor('od', a.od), `${fmt(a.od, 1)}<small>mg/L</small>`, `sat. ${fmt(a.temperatura != null ? a.od / odSat(a.temperatura) * 100 : null, 0)}%`, h24.map(x => x.OD), 'accent', 'od');
    tile('t-ph', estadoValor('ph', a.ph), `${fmt(a.ph, 2)}`, tendencia(h24, 'pH', 2, '/h'), h24.map(x => x.pH), 'accent', 'ph');
    tile('t-nh3', estadoValor('nh3', a.uia), `${fmt(a.uia, 3)}<small>mg/L</small>`, `NAT ${fmt(a.tan, 2)} mg/L`, h24.map(x => x.TAN * fracNH3(x.Tw, x.pH)), 'accent', 'nh3');
    tile('t-ar', '', `${fmt(L['clima/temperatura_ar'], 1)}<small>°C</small>`, `UR ${fmt(L['clima/umidade'], 0)}% · vento ${fmt(L['clima/vento'], 1)} m/s`, h24.map(x => x.Ta), 'ar');
    tile('t-sol', '', `${fmt(L['clima/radiacao'], 0)}<small>W/m²</small>`, L['clima/chuva'] > 0 ? `chuva ${fmt(L['clima/chuva'], 1)} mm/h` : `pressão ${fmt(L['clima/pressao'], 0)} hPa`, h24.map(x => x.rad), 'racao');
    tile('t-peixe', '', `${fmt(peso, 0)}<small>g</small>`, `${fmt(biomassa, 0)} kg · ${(g.N || 0).toLocaleString('pt-BR')} peixes`, g.biometrias.map(b => b.W), 'racao');

    // OD: medido, previsto sem aeração e previsto com o plano do gêmeo
    const x0 = t - DIA, x1 = t + 12 * H;
    const prev = g.prev;
    let comPlano = null;
    if (prev) { let lig = g.aerador; comPlano = preverOD(g.hist, 12, (tt, od) => { if (od < 4) lig = true; else if (od >= 5 && radiacaoCeuLimpo(tt) > 150) lig = false; return lig ? 1 : 0; }); }
    const serieOD = h24.map(x => ({ t: x.t, v: x.OD }));
    const faixasAer = []; let ini = null;
    for (const x of h24) { if (x.aer && ini == null) ini = x.t; if (!x.aer && ini != null) { faixasAer.push({ t0: ini, t1: x.t, cor: cor('accent'), alfa: 0.12 }); ini = null; } }
    if (ini != null) faixasAer.push({ t0: ini, t1: t, cor: cor('accent'), alfa: 0.12 });
    const yMax = Math.max(10, ...serieOD.map(p => p.v), ...(prev ? prev.pts.map(p => p.OD + p.sd) : [])) + 0.5;
    const series = [{ pts: serieOD, cor: cor('accent'), larg: 2.2, area: true, ponta: true, gap: 40 * MIN }];
    if (prev) series.push({ pts: prev.pts.map(p => ({ t: p.t, v: p.OD })), cor: cor('crit'), tracejado: true, larg: 1.8 });
    if (comPlano) series.push({ pts: comPlano.pts.map(p => ({ t: p.t, v: p.OD })), cor: cor('accent'), tracejado: true, larg: 1.8 });
    grafico($('#g-od'), { x0, x1, y0: 0, y1: Math.ceil(yMax), agora: t, ticksX: ticksHoras(x0, x1, 6), faixasX: faixasAer,
      faixasY: faixasDeZona('od'), limites: [{ y: 4, cor: cor('ink-2'), r: 'aerar abaixo de 4 mg/L (Francis-Floyd, 2003)' }],
      bandas: prev ? [{ pts: prev.pts.map(p => ({ t: p.t, lo: p.OD - p.sd, hi: p.OD + p.sd })), cor: cor('crit') }] : [], series,
      marcas: prev && prev.min.OD < 4 ? [{ t: prev.min.t, v: prev.min.OD, cor: cor('crit'), r: fmt(prev.min.OD, 1) }] : [] });
    if (prev) {
      const [P, R, k, kA] = prev.ajuste.theta;
      $('#od-min').textContent = `${fmt(prev.min.OD, 1)} mg/L às ${fmtHora(prev.min.t)}`;
      $('#od-plano').textContent = comPlano ? `${fmt(comPlano.min.OD, 1)} mg/L` : '--';
      $('#od-cruza').textContent = prev.abaixo3 ? fmtHora(prev.abaixo3.t) : 'não cruza em 12 h';
      $('#od-modelo').textContent = `Fotossíntese ${fmt(P, 2)} · respiração ${fmt(R, 2)} mg/L/h · aerador ${fmt(kA, 2)}/h · ${prev.ajuste.amostras} pontos`;
    }

    // aerador
    const box = $('#aerador');
    box.classList.toggle('ligado', g.aerador);
    $('#aer-estado').textContent = g.aerador ? 'LIGADO' : 'DESLIGADO';
    $('#aer-origem').textContent = 'Comando: ' + (ORIGEM[g.origemAerador] || '--');
    ['#bt-ligar', '#bt-desligar', '#bt-auto'].forEach(s => $(s).classList.remove('ativo'));
    if (g.modoAeracao === 'AUTO') $('#bt-auto').classList.add('ativo'); else $(g.aerador ? '#bt-ligar' : '#bt-desligar').classList.add('ativo');
    ['#bt-ligar', '#bt-desligar', '#bt-auto'].forEach(s => $(s).disabled = !online);
    const jan = g.janelaAeracao();
    let rec;
    if (!online) rec = '<strong>Sem conexão com o ESP32</strong>Os comandos não chegam ao viveiro. O fallback local liga o aerador se o OD cair abaixo de 3 mg/L.';
    else if (g.aerador) rec = `<strong>Manter ligado</strong>Desligar depois do amanhecer, com o OD acima de 5 mg/L (Tucker, 2005; Francis-Floyd, 2003).`;
    else if (jan) rec = `<strong>Ligar por volta das ${fmtHora(jan.t - 20 * MIN)}</strong>Sem aeração, o OD chega a ${fmt(prev.min.OD, 1)} mg/L às ${fmtHora(prev.min.t)}. Regra: aerar quando o OD previsto fica abaixo de 4 mg/L (Francis-Floyd, 2003).`;
    else rec = '<strong>Sem necessidade nas próximas 12 h</strong>O OD previsto fica acima de 4 mg/L.';
    $('#aer-rec').innerHTML = rec;
    const hoje = g.hist.filter(x => x.t >= Math.floor(t / DIA) * DIA);
    const hAer = hoje.filter(x => x.aer).length / 6;
    $('#aer-horas').textContent = `${fmt(hAer, 1)} h hoje · ${fmt(hAer * 0.75, 1)} kWh (aerador de 1 cv)`;

    // ração
    const p = g.plano;
    if (p) {
      $('#rac-total').textContent = fmt(p.total, 1);
      $('#rac-pct').textContent = `${fmt(p.pct, 2)}% do peso vivo`;
      const dif = p.base > 0 ? (p.total / p.base - 1) * 100 : 0;
      $('#rac-base').textContent = `Tabela fixa: ${fmt(p.base, 1)} kg (${dif <= 0 ? '' : '+'}${fmt(dif, 0)}%)`;
      $('#rac-barra').style.width = clamp(p.base > 0 ? p.total / p.base * 100 : 0, 0, 100) + '%';
      $('#rac-motivo').textContent = p.motivo;
      $('#rac-ref').innerHTML = p.refeicoes.map(r => {
        let sit;
        if (r.executado != null) sit = r.executado > 0 ? `<span class="pill ok">liberada ${fmt(r.executado, 1)} kg</span>` : '<span class="pill crit">suspensa</span>';
        else if (t > r.t + 45 * MIN) sit = '<span class="pill">não executada</span>';
        else sit = r.fator < 1 ? `<span class="pill warn">reduzida ${Math.round(r.fator * 100)}%</span>` : '<span class="pill">programada</span>';
        return `<tr><td class="num">${fmtHora(r.t)}</td><td class="num">${fmt(r.kg, 1)} kg</td><td class="num">${r.od == null ? '--' : fmt(r.od, 1) + ' mg/L'}</td><td>${sit}</td></tr>`;
      }).join('');
      $('#rac-calib').textContent = `Peso médio estimado ${fmt(p.W, 0)} g · água prevista ${fmt(p.TwMedio, 1)} °C · modelo de crescimento calibrado com α = ${fmt(g.calib.alfa, 2)} (${g.calib.n} biometrias${g.calib.rmse != null ? `, erro ${fmt(g.calib.rmse, 1)} g` : ''})`;
    }

    // temperatura
    const sT = h24.map(x => ({ t: x.t, v: x.Tw })), sA = h24.map(x => ({ t: x.t, v: x.Ta }));
    const prT = prev ? prev.pts.map(q => ({ t: q.t, v: q.Tw })) : [];
    const todosT = [...sT, ...sA, ...prT].map(q => q.v);
    const ty0 = Math.floor(Math.min(14, ...todosT) - 1), ty1 = Math.ceil(Math.max(33, ...todosT) + 1);
    grafico($('#g-temp'), { x0, x1, y0: ty0, y1: ty1, agora: t, ticksX: ticksHoras(x0, x1, 6), faixasY: faixasDeZona('temp'),
      series: [{ pts: sA, cor: cor('ar'), larg: 1.5, gap: 40 * MIN }, { pts: sT, cor: cor('accent'), larg: 2.2, ponta: true, gap: 40 * MIN }, { pts: prT, cor: cor('accent'), tracejado: true, larg: 1.6 }] });

    // pH e amônia, com as zonas da espécie
    const sPH = h24.map(x => ({ t: x.t, v: x.pH })), sN = h24.map(x => ({ t: x.t, v: x.TAN * fracNH3(x.Tw, x.pH) }));
    const phv = sPH.map(q => q.v);
    grafico($('#g-ph'), { x0, x1: t + 2 * H, y0: Math.min(4.5, Math.floor(Math.min(...phv, 9))), y1: Math.max(10, Math.ceil(Math.max(...phv, 5))), agora: t, ticksX: ticksHoras(x0, t, 6), faixasY: faixasDeZona('ph'),
      series: [{ pts: sPH, cor: cor('accent'), larg: 2.2, ponta: true, gap: 40 * MIN }] });
    const nMax = Math.max(0.2, ...sN.map(q => q.v)) * 1.1;
    grafico($('#g-nh3'), { x0, x1: t + 2 * H, y0: 0, y1: Math.ceil(nMax * 20) / 20, agora: t, ticksX: ticksHoras(x0, t, 6), faixasY: faixasDeZona('nh3'), casas: 2,
      series: [{ pts: sN, cor: cor('accent'), larg: 2.2, ponta: true, gap: 40 * MIN }] });

    // crescimento
    if (g.biometrias.length) {
      const b0 = g.biometrias[0], amb = ambienteEm(g.hist, g.diario);
      const ajuste = []; let W = b0.W;
      for (let tt = b0.t; tt <= t; tt += DIA) { ajuste.push({ t: tt, v: W }); W = simularPeso(W, tt, Math.min(t, tt + DIA), amb, g.refeicoes, g.N, g.calib.alfa); }
      ajuste.push({ t, v: peso });
      const desvio = (a.temperatura ?? 26) - NORMAIS.tmed[mesDe(t)];
      const proj = projetarCrescimento(peso, t, g.calib.alfa, desvio, 800, 300);
      const fim = proj.abate ? proj.abate.t + 5 * DIA : t + 120 * DIA;
      const ys = [...g.biometrias.map(b => b.W), ...proj.pts.map(q => q.W)];
      const cx0 = b0.t - 2 * DIA;
      grafico($('#g-cresc'), { x0: cx0, x1: fim, y0: 0, y1: Math.ceil((Math.max(850, ...ys)) / 100) * 100, agora: t,
        ticksX: X => { const out = []; const d = new Date(cx0); let tt = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1); while (tt < fim) { out.push({ x: X(tt), r: MESES[mesDe(tt)] }); tt = Date.UTC(new Date(tt).getUTCFullYear(), new Date(tt).getUTCMonth() + 1, 1); } return out; },
        limites: [{ y: 800, cor: cor('ink-3'), r: 'peso de abate escolhido: 800 g', dir: 1 }],
        series: [{ pts: ajuste, cor: cor('racao'), larg: 2 }, { pts: proj.pts.map(q => ({ t: q.t, v: q.W })), cor: cor('racao'), tracejado: true, larg: 1.8 }, { pts: g.biometrias.map(b => ({ t: b.t, v: b.W })), cor: cor('ink'), pontos: true }] });
      $('#cr-abate').textContent = proj.abate ? `${fmtData(proj.abate.t)} · em ${Math.round((proj.abate.t - t) / DIA)} dias` : 'acima de 300 dias';
      $('#cr-ganho').textContent = g.biometrias.length > 1 ? `${fmt((g.biometrias[g.biometrias.length - 1].W - g.biometrias[g.biometrias.length - 2].W) / ((g.biometrias[g.biometrias.length - 1].t - g.biometrias[g.biometrias.length - 2].t) / DIA), 1)} g/dia` : '--';
      $('#cr-alfa').textContent = fmt(g.calib.alfa, 2);
    }

    // alertas e ações
    $('#alertas').innerHTML = g.alertas.length ? g.alertas.map(x => `<li class="alerta ${x.nivel}"><i class="marcador"></i><b>${esc(x.titulo)}</b><span>${esc(x.texto)}</span></li>`).join('') : '<li class="vazio">Nenhum alerta ativo. Todas as variáveis dentro das faixas de referência.</li>';
    $('#n-alertas').textContent = g.alertas.length ? `${g.alertas.length} ativo${g.alertas.length > 1 ? 's' : ''}` : 'tudo certo';
    $('#n-alertas').className = 'pill ' + (g.alertas.some(x => x.nivel === 'critico') ? 'crit' : g.alertas.length ? 'warn' : 'ok');
    $('#acoes').innerHTML = g.acoes.slice(0, 14).map(x => `<li><time>${fmtHora(x.t)}</time><span>${esc(x.txt)}</span></li>`).join('') || '<li class="sutil">O gêmeo ainda não agiu nesta sessão.</li>';
  }
}
function tendencia(h, k, d, un) {
  if (h.length < 7) return '';
  const v = (h[h.length - 1][k] - h[h.length - 7][k]);
  return (v > 0 ? '▲ ' : v < 0 ? '▼ ' : '') + fmt(Math.abs(v), d) + ' ' + un;
}

/* ---------------- aba do simulador ---------------- */
function iniciarSimulador() {
  const bus = new Barramento();
  // papel desta página: 'procurando' → 'remoto' (o painel simula, aqui só se controla) ou 'dono' (sem painel: simula aqui)
  let papel = 'procurando', motor = null, ultimoContatoPainel = 0, ultEstado = 0, estado = null, seguraAte = 0, loop = null;
  const raiz = $('#controles');
  window.__simPg = () => ({ papel, motor, estado });
  const nuvem = () => bus.modoRede === 'nuvem';

  // ---- modo dono: a simulação roda nesta página (sem painel aberto)
  const executarDono = executorLocal(() => motor, novo => { motor = novo; bus.enviar(motor.sync()); }, () => { atualizarControles(raiz, motor); atualizarTopo(); });
  const servico = servirRemotos(bus, () => papel === 'dono' ? motor : null, ac => executarDono(ac));
  function virarDono(sim, vel) {
    if (papel === 'dono') return;
    papel = 'dono'; motor = new Motor(sim, vel);
    montarControles(raiz, () => motor, executarDono);
    bus.enviar(motor.sync());
    loop = setInterval(() => { motor.avancar(0.25); const m = motor.mensagem(); bus.enviar(m); bus.espelhar(m.leituras, m.t); atualizarControles(raiz, motor); atualizarTopo(); servico.enviarEstado(false); }, 250);
  }

  // ---- modo remoto: o painel é o dono; cada mexida vira uma ação enviada a ele
  function virarRemoto() {
    if (papel === 'remoto') return;
    papel = 'remoto';
    montarControles(raiz, () => motorDeEstado(estado), ac => { seguraAte = Date.now() + 700; bus.enviar({ tipo: 'acao', acao: ac }); });
    if (estado) desenharRemoto();
  }
  function desenharRemoto() { if (Date.now() >= seguraAte) atualizarControles(raiz, motorDeEstado(estado)); atualizarTopo(); }

  function esperando() {
    if (papel !== 'procurando') return;
    raiz.innerHTML = `<section class="card s12 espera-painel"><header><h2>Procurando o painel${nuvem() ? ` na sala ${esc(bus.cfg.sala)}` : ''}</h2></header>
      <p>Este aparelho funciona como controle remoto: a simulação roda no painel, aberto no computador. Deixe o painel aberto e conectado à mesma sala; os controles aparecem aqui sozinhos.</p>
      <div class="acoes-topo"><button class="btn" id="bt-sim-aqui">Simular só neste aparelho</button></div></section>`;
    $('#bt-sim-aqui').onclick = () => virarDono(new Simulador('verao'), 5);
  }
  function atualizarTopo() {
    const fonte = papel === 'dono' ? motor : papel === 'remoto' && estado ? motorDeEstado(estado) : null;
    const painelOk = papel === 'remoto' ? Date.now() - ultEstado < 5000 : Date.now() - ultimoContatoPainel < 4000;
    const chP = $('#chip-painel');
    chP.className = 'chip ' + (painelOk ? 'ok' : papel === 'procurando' ? 'neutro' : 'warn');
    chP.textContent = papel === 'remoto' ? (painelOk ? 'Controlando o painel' : 'Painel sem resposta') : papel === 'procurando' ? 'Procurando o painel' : painelOk ? 'Painel conectado' : 'Painel não aberto';
    if (!fonte) { $('#chip-net').hidden = true; $('#chip-vel').hidden = true; return; }
    const s = fonte.sim; $('#chip-net').hidden = false; $('#chip-vel').hidden = false;
    $('#hora').textContent = fmtHora(s.t); $('#data').textContent = fmtData(s.t) + ' · ' + CENARIOS[s.cenario].nome;
    $('#chip-net').className = 'chip ' + (s.ctl.internet ? 'ok' : 'crit'); $('#chip-net').textContent = s.ctl.internet ? 'Internet ok' : 'Sem internet';
    $('#chip-vel').textContent = fonte.pausado ? 'Pausado' : (VELOCIDADES.find(v => v[0] === fonte.vel) || [0, ''])[1];
  }

  bus.on(m => {
    if (m.para && m.para !== bus.id) return;
    if ((m.tipo === 'dono' || m.tipo === 'estado') && papel !== 'dono') {
      ultEstado = Date.now();
      if (m.tipo === 'estado') { estado = m; virarRemoto(); desenharRemoto(); }
      return;
    }
    if (papel !== 'dono') return;
    if (m.tipo === 'pedir-sync') { bus.enviar({ ...motor.sync(), para: m.de }); if (!m.previsao) ultimoContatoPainel = Date.now(); }
    else if (m.tipo === 'pedir-previsao') bus.enviar({ tipo: 'previsao', para: m.de, t: motor.sim.t, cenario: motor.sim.cenario, dias: motor.sim.previsaoClima(7) });
    else if (m.tipo === 'comando') { ultimoContatoPainel = Date.now(); motor.comando(m.topico, m.valor); }
  });
  window.addEventListener('beforeunload', () => bus.enviar({ tipo: 'tchau' }));
  const procurar = () => { if (papel !== 'dono') bus.enviar({ tipo: papel === 'remoto' ? 'oi-remoto' : 'procurar-dono' }); };
  bus.aoConectar.push(procurar);           // a cada (re)conexão com o broker, procura o painel de novo
  bus.pronto.then(() => {
    esperando(); procurar(); atualizarRede(); atualizarTopo();
    // sem sala na nuvem e sem painel nesta máquina, a página simula sozinha (como antes)
    setTimeout(() => { if (papel === 'procurando' && !nuvem()) virarDono(new Simulador('verao'), 5); }, 1200);
  });
  setInterval(procurar, 3000);
  setInterval(() => { if (papel !== 'dono') atualizarTopo(); }, 1000);
  bus.aoMudarRede = () => atualizarRede();
  function atualizarRede() { const ch = $('#chip-rede'); if (!ch) return; ch.hidden = !bus.modoRede; ch.className = 'chip ' + (bus.mqttOk ? 'ok' : bus.erroRede ? 'crit' : 'neutro'); ch.textContent = bus.textoRede(); }
}

/* ---------------- aba Previsão de 7 dias ---------------- */
const OPEN_METEO = 'https://api.open-meteo.com/v1/forecast?latitude=-16.68&longitude=-49.25&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,shortwave_radiation_sum,wind_speed_10m_max&timezone=America%2FSao_Paulo&forecast_days=7&wind_speed_unit=ms';
const DIAS_SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const refsTxt = ks => `<span class="ref">(${esc(citar(ks))})</span>`;
async function buscarOpenMeteo() {
  const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await fetch(OPEN_METEO, { signal: ctl.signal }); if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json(), d = j.daily;
    return d.time.map((dia, i) => { const [y, mo, da] = dia.split('-').map(Number);
      return { t: Date.UTC(y, mo - 1, da), tmax: d.temperature_2m_max[i], tmin: d.temperature_2m_min[i], chuva: d.precipitation_sum[i] ?? 0, rad: d.shortwave_radiation_sum[i], vento: d.wind_speed_10m_max[i] }; })
      .filter(x => x.tmax != null && x.tmin != null && x.rad != null);
  } finally { clearTimeout(to); }
}
function iniciarPrevisao(ctx = null) {   // ctx: aba embutida no painel ({ bus, gemeo, simDireto, visivel })
  const bus = ctx ? ctx.bus : new Barramento();
  const gemeo = ctx ? ctx.gemeo : new Gemeo(() => {});
  const st = { fonte: 'real', dias: null, origemSim: ctx ? 'aba' : null, local: null, diaSim: null, iniciado: false, falhaReal: null, sincronizado: !!ctx };
  window.__pv = st; window.__gemeoPv = gemeo;
  document.querySelectorAll('.fonte-zona[data-zona]').forEach(el => { const z = ZONAS[el.dataset.zona]; el.innerHTML = `<b>Zonas para a tilápia-do-nilo:</b> ${z.faixas.map(f => `${f.r} ${faixaTexto(f, z.unid)}`).join(' · ')}. Fontes: ${z.fonte}.`; });

  function viveiroLocal() {   // nenhuma aba do viveiro aberta: roda um viveiro simulado só nesta página
    const sim = new Simulador('verao'), motor = new Motor(sim);
    gemeo.sincronizar(motor.sync()); motor.avancar(0.01); gemeo.receber(motor.mensagem());
    st.local = sim; st.sincronizado = true; st.origemSim = 'local';
  }
  bus.on(m => {
    if (m.para && m.para !== bus.id) return;
    if (ctx && m.tipo !== 'previsao') return;
    if (m.tipo === 'sync') { gemeo.sincronizar(m); st.sincronizado = true; st.origemSim = 'aba'; }
    else if ((m.tipo === 'tick' || m.tipo === 'tick-espelho') && !m.offline && st.sincronizado && st.origemSim === 'aba') {
      gemeo.receber(m);
      const d = Math.floor(m.t / DIA);
      if (st.fonte === 'sim' && st.diaSim != null && d !== st.diaSim) bus.enviar({ tipo: 'pedir-previsao' });
    }
    else if (m.tipo === 'previsao' && m.para === bus.id && st.fonte === 'sim') { st.dias = m.dias; st.diaSim = Math.floor(m.t / DIA); st.origemSim = 'aba'; desenhar(); }
  });
  function pedirSim() {
    st.dias = null;
    if (st.origemSim === 'local') { st.dias = st.local.previsaoClima(7); desenhar(); return; }
    const direto = ctx && ctx.simDireto();
    if (direto) { st.dias = direto; st.origemSim = 'aba'; st.diaSim = Math.floor(gemeo.t / DIA); desenhar(); return; }
    bus.enviar({ tipo: 'pedir-previsao' });
    setTimeout(() => { if (st.fonte === 'sim' && !st.dias) { if (!st.local) viveiroLocal(); st.origemSim = 'local'; st.dias = st.local.previsaoClima(7); desenhar(); } }, 1000);
  }
  async function usarReal() {
    st.fonte = 'real'; st.dias = null; marcarBotoes(); desenhar();
    try { st.dias = await buscarOpenMeteo(); st.falhaReal = null; if (st.dias.length < 2) throw new Error('resposta incompleta'); }
    catch (e) { st.falhaReal = e.name === 'AbortError' ? 'tempo esgotado' : (e.message || 'bloqueado'); st.fonte = 'sim'; marcarBotoes(); pedirSim(); return; }
    desenhar();
  }
  function marcarBotoes() { $('#pv-real').classList.toggle('ativo', st.fonte === 'real'); $('#pv-sim').classList.toggle('ativo', st.fonte === 'sim'); }
  $('#pv-real').onclick = () => usarReal();
  $('#pv-sim').onclick = () => { st.fonte = 'sim'; st.falhaReal = null; marcarBotoes(); pedirSim(); };

  function estado() {
    const a = gemeo.atual; let theta = null;
    try { if (gemeo.hist.length > 20) theta = preverOD(gemeo.hist, 1).ajuste.theta; } catch (_) {}
    return { W: gemeo.pesoEstimado(), N: gemeo.N || 4000, alfa: gemeo.calib.alfa || 1, theta,
      Tw0: st.fonte === 'sim' ? a.temperatura : null, OD0: st.fonte === 'sim' ? a.od : null };
  }
  function desenhar() {
    if (ctx && !ctx.visivel()) return;
    marcarBotoes();
    const real = st.fonte === 'real';
    $('#pv-chip-fonte').textContent = !st.dias ? 'Carregando previsão' : real ? 'Previsão real · Open-Meteo' : st.origemSim === 'aba' ? 'Clima simulado · da simulação aberta' : 'Clima simulado · viveiro desta página';
    $('#pv-chip-fonte').className = 'chip ' + (st.dias ? (real ? 'ok' : 'neutro') : 'neutro');
    const av = $('#pv-aviso');
    av.hidden = !st.falhaReal;
    if (st.falhaReal) $('#pv-aviso-txt').textContent = `Não foi possível buscar a previsão real (${st.falhaReal}). Isso acontece sem internet ou quando a página roda num ambiente que bloqueia sites externos; aberto pelos arquivos locais do site, com internet, ele busca normalmente. Mostrando o clima simulado.`;
    if (!st.dias) return;
    if (!st.sincronizado) { setTimeout(desenhar, 400); return; }
    const est = estado();
    $('#pv-chip-lote').textContent = `Lote: ${fmt(est.W, 0)} g · ${(est.N).toLocaleString('pt-BR')} peixes · α ${fmt(est.alfa, 2)}`;
    const r = consequenciasSemana(st.dias, est);
    const nivelDia = d => d.flags.some(f => f.nivel === 'critico') ? 'critico' : d.flags.some(f => f.nivel === 'atencao') ? 'atencao' : 'ok';
    // cartões dos dias
    $('#pv-dias').innerHTML = r.dias.map(d => {
      const z = faixaZona('temp', d.TwMed);
      return `<div class="dia" data-estado="${nivelDia(d)}"><span class="nome">${DIAS_SEMANA[new Date(d.t).getUTCDay()]}<small>${fmtDiaMes(d.t)}</small></span>
        <span class="temps">${fmt(d.tmax, 0)}°<small> / ${fmt(d.tmin, 0)}°</small></span>
        <span class="det"><span>chuva ${fmt(d.chuva, 1)} mm</span><span>sol ${fmt(d.rad, 1)} MJ/m² (${Math.round(d.fRad * 100)}%)</span><span>vento até ${fmt(d.vento, 1)} m/s</span></span>
        <span class="agua">água ≈ ${fmt(d.TwMed, 1)} °C · <span style="color:var(--${z.nivel === 'ideal' ? 'ok' : z.nivel === 'atencao' ? 'warn' : 'crit'})">${z.r}</span></span></div>`;
    }).join('');
    // gráficos
    const H0 = r.horas, x0 = H0[0].t, x1 = H0[H0.length - 1].t;
    const ticks = X => r.dias.map(d => ({ x: X(d.t + 12 * H), r: `${DIAS_SEMANA[new Date(d.t).getUTCDay()]} ${fmtDiaMes(d.t)}` }));
    const sep = r.dias.slice(1).map(d => ({ t0: d.t, t1: d.t + 6 * MIN, cor: cor('line'), alfa: 1 }));
    const vals = H0.flatMap(h => [h.Ta, h.Tw]);
    grafico($('#pv-g-temp'), { x0, x1, y0: Math.floor(Math.min(14, ...vals) - 1), y1: Math.ceil(Math.max(34, ...vals) + 1), ticksX: ticks, faixasX: sep, faixasY: faixasDeZona('temp'),
      series: [{ pts: H0.map(h => ({ t: h.t, v: h.Ta })), cor: cor('ar'), larg: 1.4 }, { pts: H0.map(h => ({ t: h.t, v: h.Tw })), cor: cor('accent'), larg: 2.4 }] });
    const aerF = []; let ini = null;
    for (const h of H0) { if (h.aer && ini == null) ini = h.t; if (!h.aer && ini != null) { aerF.push({ t0: ini, t1: h.t, cor: cor('accent'), alfa: 0.13 }); ini = null; } }
    if (ini != null) aerF.push({ t0: ini, t1: x1, cor: cor('accent'), alfa: 0.13 });
    const odMax = Math.max(10, ...H0.map(h => Math.max(h.od, h.odSem))) + 0.5;
    grafico($('#pv-g-od'), { x0, x1, y0: 0, y1: Math.ceil(odMax), ticksX: ticks, faixasX: [...sep, ...aerF], faixasY: faixasDeZona('od'),
      limites: [{ y: 4, cor: cor('ink-2'), r: 'aerar abaixo de 4 mg/L (Francis-Floyd, 2003)' }],
      series: [{ pts: H0.map(h => ({ t: h.t, v: h.odSem })), cor: cor('crit'), tracejado: true, larg: 1.8 }, { pts: H0.map(h => ({ t: h.t, v: h.od })), cor: cor('accent'), larg: 2.2 }] });
    // tabela
    $('#pv-tab').innerHTML = r.dias.map(d => {
      const zo = d.semAer ? faixaZona('od', d.semAer.od) : null;
      const itens = d.flags.length ? d.flags.map(f => `<li class="${f.nivel}">${esc(f.txt)} ${refsTxt(f.refs)}${f.limiar ? ' <span class="limiar">limiar do protótipo</span>' : ''}</li>`).join('') : `<li>Água e oxigênio dentro das faixas ideais. Ração normal da tabela ${refsTxt(['senar2019'])}</li>`;
      return `<tr><td><b>${DIAS_SEMANA[new Date(d.t).getUTCDay()]}</b> ${fmtDiaMes(d.t)}</td>
        <td class="num">${fmt(d.twMin, 1)}–${fmt(d.twMax, 1)} °C</td>
        <td class="num">${d.semAer ? `${fmt(d.semAer.od, 1)} mg/L <span class="pill ${zo.nivel === 'ideal' ? 'ok' : zo.nivel === 'atencao' ? 'warn' : 'crit'}">${zo.r}</span>` : '--'}</td>
        <td class="num">${fmt(d.hAer, 1)} h</td>
        <td class="num">${fmt(d.racao, 1)} kg${d.suspensas ? `<br><span class="sutil" style="font-size:.76rem">${d.suspensas} refeição(ões) suspensa(s)</span>` : ''}</td>
        <td><ul>${itens}</ul></td></tr>`;
    }).join('');
    // resumo
    const soma = k => r.dias.reduce((s, d) => s + d[k], 0);
    const racao = soma('racao'), base = soma('base'), hAer = soma('hAer'), ganhoKg = r.dias.reduce((s, d) => s + d.ganho * est.N / 1000, 0);
    const Wfim = r.dias[r.dias.length - 1].W + r.dias[r.dias.length - 1].ganho;
    const crit = r.dias.filter(d => nivelDia(d) === 'critico').length, aten = r.dias.filter(d => nivelDia(d) === 'atencao').length;
    const piorOD = r.dias.filter(d => d.semAer).reduce((p, d) => !p || d.semAer.od < p.semAer.od ? d : p, null);
    $('#pv-resumo').innerHTML = `
      <div class="kv"><span class="rotulo">Ração prevista na semana</span><b>${fmt(racao, 0)} kg</b><span class="sutil" style="font-size:.8rem">tabela sem ajuste: ${fmt(base, 0)} kg ${refsTxt(['senar2019'])}</span></div>
      <div class="kv"><span class="rotulo">Aerador</span><b>${fmt(hAer, 0)} h · ${fmt(hAer * POTENCIA_AERADOR_KW, 0)} kWh</b><span class="sutil" style="font-size:.8rem">regra: ligar abaixo de 4 mg/L, desligar com 5 mg/L e sol ${refsTxt(['francis2003', 'tucker2005'])}</span></div>
      <div class="kv"><span class="rotulo">Noite mais arriscada sem aeração</span><b>${piorOD ? `${DIAS_SEMANA[new Date(piorOD.t).getUTCDay()]} ${fmtDiaMes(piorOD.t)} · ${fmt(piorOD.semAer.od, 1)} mg/L` : '--'}</b></div>
      <div class="kv"><span class="rotulo">Crescimento esperado</span><b>${fmt(est.W, 0)} → ${fmt(Wfim, 0)} g</b><span class="sutil" style="font-size:.8rem">≈ ${fmt(ganhoKg, 0)} kg de biomassa ${refsTxt(['yi1998', 'dampin2012'])}</span></div>
      <div class="kv"><span class="rotulo">Dias com alerta</span><b>${crit} crítico${crit === 1 ? '' : 's'} · ${aten} de atenção</b></div>`;
    // clima de referência (INMET A002, 2023-2025) e comparação da semana com o mês
    const mRef = mesDe(r.dias[0].t), nD = r.dias.length;
    const media = k => r.dias.reduce((s, d) => s + d[k], 0) / nD;
    const dTx = media('tmax') - NORMAIS.tmax[mRef], dTn = media('tmin') - NORMAIS.tmin[mRef];
    const chuvaSem = soma('chuva'), chuvaEsp = NORMAIS.chuva[mRef] / 30.4 * nD;
    const sinal = x => (x >= 0 ? '+' : '−') + fmt(Math.abs(x), 1);
    $('#pv-ref-semana').innerHTML = `<b>Semana prevista contra a referência de ${MESES[mRef]}:</b> máximas ${sinal(dTx)} °C e mínimas ${sinal(dTn)} °C em relação à média; chuva de ${fmt(chuvaSem, 0)} mm, contra ${fmt(chuvaEsp, 0)} mm esperados em ${nD} dias. ${Math.abs(dTx) > 2 * NORMAIS.anomDP[mRef] ? 'A semana foge bastante do normal do mês (mais de 2 desvios-padrão).' : 'Dentro da variação comum do mês.'} ${refsTxt(['inmet'])}`;
    $('#pv-ref').innerHTML = MESES.map((nome, m) => `<tr${m === mRef ? ' class="atual"' : ''}><td><b>${nome}</b></td><td class="num">${fmt(NORMAIS.tmax[m], 1)} °C</td><td class="num">${fmt(NORMAIS.tmin[m], 1)} °C</td><td class="num">${fmt(NORMAIS.tmed[m], 1)} °C</td><td class="num">± ${fmt(NORMAIS.anomDP[m], 1)} °C</td><td class="num">${fmt(NORMAIS.chuva[m], 0)} mm</td><td class="num">${Math.round(NORMAIS.pchuva[m] * 100)}%</td><td class="num">${fmt(NORMAIS.ur[m], 0)}%</td><td class="num">${fmt(NORMAIS.vento[m], 1)} m/s</td><td class="num">${fmt(NORMAIS.rad[m], 1)} MJ/m²</td><td class="num">${fmt(NORMAIS.pressao[m], 0)} hPa</td></tr>`).join('');
    $('#pv-ref-nota').textContent = `Calculado pelo protótipo com os dados horários de ${NORMAIS.estacao} de 2023 a 2025 (hora local = UTC − 3). Máxima e mínima são médias das máximas e mínimas de cada dia; "dias com chuva" conta dias com 1 mm ou mais; "variação diária" é o desvio-padrão da temperatura média de um dia em torno da média do mês. 2025 tem falhas na estação de junho a dezembro. Extremos do período: ${fmt(NORMAIS.extremos.tmax, 1)} °C, ${fmt(NORMAIS.extremos.tmin, 1)} °C e ${fmt(NORMAIS.extremos.chuvaDia, 0)} mm num só dia. Vento medido a 10 m. O clima simulado usa estes números e o ciclo médio de cada hora.`;
    $('#pv-metodo').innerHTML = `Como é calculado: a água segue a média do ar ${refsTxt(['rotta2023'])}; o OD vem do balanço de oxigênio ${refsTxt(['boyd1978', 'romaire1979'])} com os parâmetros que o gêmeo ajustou nas últimas 24 h${est.theta ? '' : ' (sem dados ainda: valores iniciais)'} e a radiação prevista; a ração usa a tabela e o fator de temperatura ${refsTxt(['senar2019'])} limitados ao apetite do modelo de Yi; o lote vem das biometrias do viveiro.`;
  }
  window.addEventListener('resize', () => st.dias && desenhar());
  const api = {
    abrir() { if (!st.iniciado) { st.iniciado = true; usarReal(); } else desenhar(); },
    tick(t) { const d = Math.floor(t / DIA); if (st.iniciado && st.fonte === 'sim' && st.diaSim != null && d !== st.diaSim) { st.diaSim = d; pedirSim(); } },
  };
  if (!ctx) { bus.pronto.then(() => { bus.enviar({ tipo: 'pedir-sync', previsao: true }); setTimeout(() => { if (!st.sincronizado) viveiroLocal(); }, 1000); }); api.abrir(); }
  return api;
}

/* ---------------- aba Fontes ---------------- */
function iniciarFontes() {
  const nivelPill = { ideal: 'ok', atencao: 'warn', critico: 'crit', morte: 'crit' };
  $('#ft-zonas').innerHTML = Object.values(ZONAS).map(z => z.faixas.map((f, i) => `<tr>${i === 0 ? `<td rowspan="${z.faixas.length}"><b>${esc(z.nome)}</b></td>` : ''}<td><span class="pill ${nivelPill[f.nivel]}">${f.r}</span></td><td class="num">${faixaTexto(f, z.unid)}</td><td>${esc(f.base)}</td></tr>`).join('')).join('');
  $('#ft-leg').innerHTML = Object.entries(STATUS_FONTE).map(([k, [c, r]]) => `<span><span class="pill ${c}">${r}</span> ${{ especie: 'literatura sobre a tilápia', geral: 'literatura geral (peixes de água quente, viveiros, química)', derivado: 'calculado de valores com fonte', sem: 'escolha ou calibração do protótipo' }[k]}</span>`).join('');
  $('#ft-itens').innerHTML = ITENS_FONTES.map(([item, uso, refs, stt]) => `<tr><td>${esc(item)}</td><td class="sutil">${esc(uso)}</td><td>${refs.length ? esc(citar(refs)) : stt === 'sem' ? '<span class="sutil">sem fonte</span>' : '<span class="sutil">fórmula padrão</span>'}</td><td><span class="pill ${STATUS_FONTE[stt][0]}">${STATUS_FONTE[stt][1]}</span></td></tr>`).join('');
  const conta = k => ITENS_FONTES.filter(x => x[3] === k).length;
  $('#ft-conta').textContent = `${ITENS_FONTES.length} itens: ${conta('especie')} com fonte sobre a tilápia, ${conta('geral')} com fonte geral, ${conta('derivado')} derivados e ${conta('sem')} sem fonte (escolhas da simulação, marcadas como tal).`;
  $('#ft-refs').innerHTML = Object.values(REFS).sort((a, b) => a.t.localeCompare(b.t, 'pt')).map(r => `<li>${esc(r.t)}${r.doi ? ` DOI: <a href="https://doi.org/${encodeURI(r.doi)}" target="_blank" rel="noopener">${esc(r.doi)}</a>.` : ''}${r.url ? ` <a href="${r.url}" target="_blank" rel="noopener">${esc(r.url)}</a>` : ''}${r.esp ? ' <span class="pill ok">Tilápia</span>' : ''}</li>`).join('');
}

/* ---------------- tema claro / escuro (lembrado neste navegador) ---------------- */
function aplicarTema(t) { if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme; }
try { aplicarTema(localStorage.getItem('gemeo-tema')); } catch (_) {}
function ligarBotaoTema() {
  const b = document.getElementById('bt-tema'); if (!b) return;
  b.onclick = () => {
    const atual = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const novo = atual === 'dark' ? 'light' : 'dark'; aplicarTema(novo);
    try { localStorage.setItem('gemeo-tema', novo); } catch (_) {}
    window.dispatchEvent(new Event('resize'));   // redesenha os gráficos com as cores novas
  };
}

/* ---------------- início ---------------- */
document.addEventListener('DOMContentLoaded', () => {
  ligarBotaoTema();
  const modo = window.MODO_GEMEO || (location.hash === '#simulador' ? 'simulador' : 'painel');
  if (modo === 'simulador') iniciarSimulador(); else if (modo === 'previsao') iniciarPrevisao(); else if (modo === 'fontes') iniciarFontes(); else iniciarPainel();
});
