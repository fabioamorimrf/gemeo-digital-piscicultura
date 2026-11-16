/* =====================================================================
   Gêmeo digital do Viveiro 1 (tilápia-do-nilo, Goiânia) — ESP32 no Wokwi
   ---------------------------------------------------------------------
   O que este ESP32 faz:
   - lê os sensores do viveiro (no Wokwi, os sensores de OD, pH e amônia
     são potenciômetros; a água usa um DS18B20; o ar, um DHT22; a luz, um LDR);
   - classifica cada leitura nas zonas da tilápia (ideal / atenção / crítica),
     as mesmas do painel do gêmeo (ver ZONAS no site e a página Fontes);
   - controla o aerador (relé) sozinho, com o fallback local, ou obedece
     ao gêmeo quando o MQTT está ligado;
   - mostra tudo no display OLED e no monitor serial (JSON por linha).
//
   MQTT é OPCIONAL: com USAR_MQTT 0 o ESP32 funciona sozinho, sem rede.
   Com USAR_MQTT 1 ele publica em gemeo/viveiro1/... (mesmo contrato de
   tópicos do site) e recebe comando/aerador. O broker é configurável abaixo.
//
   Comandos pelo monitor serial (funcionam com ou sem MQTT):
     ligar | desligar | auto      -> aerador
     status                       -> imprime a leitura atual
   ===================================================================== */
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include <DHTesp.h>
#include <WiFi.h>
#include <PubSubClient.h>
//
String jsonLeitura();   // declarada antes do uso
//
/* ---------------- configuração ---------------- */
#define USAR_MQTT 0                          // 0 = sem broker (apresentação offline); 1 = publica/assina via MQTT
const char* WIFI_SSID    = "Wokwi-GUEST";    // rede do simulador Wokwi (sem senha)
const char* WIFI_SENHA   = "";
const char* MQTT_BROKER  = "broker.hivemq.com";  // troque pelo broker do grupo, se houver
const uint16_t MQTT_PORTA = 1883;
const char* TOPICO       = "gemeo/viveiro1/";
//
const uint32_t INTERVALO_LEITURA_MS = 2000;  // no Wokwi: leitura a cada 2 s
const uint32_t GEMEO_VALIDO_MS      = 60000; // sem comando do gêmeo por 60 s -> volta ao fallback local
//
/* ---------------- pinos ---------------- */
const int PINO_DS18B20 = 4;    // temperatura da água
const int PINO_DHT     = 15;   // ar: temperatura e umidade
const int PINO_OD      = 34;   // potenciômetro: oxigênio dissolvido
const int PINO_PH      = 35;   // potenciômetro: pH
const int PINO_TAN     = 32;   // potenciômetro: amônia total (NAT)
const int PINO_LDR     = 33;   // LDR: radiação solar (estimada)
const int PINO_RELE    = 26;   // relé do aerador
const int PINO_LED_AER = 27;   // LED azul: aerador ligado
const int PINO_LED_OK  = 25;   // LED verde: tudo ideal
const int PINO_LED_ATN = 14;   // LED amarelo: atenção
const int PINO_LED_CRT = 13;   // LED vermelho: crítico
const int PINO_BOTAO   = 18;   // troca a tela do OLED
//
/* ---------------- zonas da tilápia-do-nilo ----------------
   Temperatura: ideal 26–30 °C; atenção 20–26 e 30–32; crítica <20 e >32; risco de morte <=11
                (Nobrega et al., 2020; Rotta et al., 2023; SENAR, 2019)
   OD:          ideal >=5 mg/L; atenção 3–5; crítica 1–3; risco de morte <1
                (Tran-Duy et al., 2008; SENAR, 2019; Yi, 1998)
   pH:          ideal 5,5–9,0; atenção 5,0–5,5 e 9–11; crítica <5 (e >=11, dado geral)
                (Rebouças et al., 2016; Mustapha e Atolagbe, 2018; Boyd, 2018b)
   NH3-N:       ideal <0,07 mg/L; atenção 0,07–0,14; crítica >=0,14 (El-Shafai et al., 2004)
   Aerador sem o gêmeo: liga com OD < 3 mg/L (Boyd, 2018a), desliga com OD >= 5 (Tucker, 2005);
   segurança: OD < 2,5 liga em qualquer modo (escolha do protótipo, sem fonte).          */
enum Nivel { IDEAL = 0, ATENCAO = 1, CRITICO = 2, MORTE = 3 };
const char* NOME_NIVEL[] = { "ideal", "atencao", "critico", "morte" };
//
Nivel zonaTemp(float t) { if (t <= 11) return MORTE; if (t < 20 || t > 32) return CRITICO; if (t < 26 || t > 30) return ATENCAO; return IDEAL; }
Nivel zonaOD(float od)  { if (od < 1) return MORTE; if (od < 3) return CRITICO; if (od < 5) return ATENCAO; return IDEAL; }
Nivel zonaPH(float ph)  { if (ph < 5 || ph >= 11) return CRITICO; if (ph < 5.5 || ph > 9) return ATENCAO; return IDEAL; }
Nivel zonaNH3(float n)  { if (n >= 0.14) return CRITICO; if (n >= 0.07) return ATENCAO; return IDEAL; }
//
/* fração de amônia não ionizada (Emerson et al., 1975) */
float fracNH3(float T, float pH) { float pKa = 0.09018 + 2729.92 / (T + 273.15); return 1.0 / (1.0 + pow(10, pKa - pH)); }
//
/* fator de ração pela temperatura da água (SENAR, 2019, Tabela 3) */
float fatorRacao(float T) { if (T < 16) return 0; if (T < 20) return 0.6; if (T < 25) return 0.8; if (T < 30) return 1.0; if (T <= 32) return 0.8; return 0; }
//
/* ---------------- objetos ---------------- */
Adafruit_SSD1306 oled(128, 64, &Wire, -1);
OneWire umFio(PINO_DS18B20);
DallasTemperature sondaAgua(&umFio);
DHTesp dht;
WiFiClient wifi;
PubSubClient mqtt(wifi);
//
struct Leitura { float agua, od, ph, tan, nh3, ar, ur, rad; };
Leitura L;
bool aerador = false;
String origemAerador = "FALLBACK_LOCAL";
String modoAerador = "AUTO";            // AUTO = gêmeo ou fallback; MANUAL = comando fixo
bool comandoManual = false;
uint32_t ultimoComandoGemeo = 0;
bool gemeoAtivo = false;
int tela = 0;
uint32_t ultimaLeitura = 0, ultimoBotao = 0;
//
/* leituras guardadas enquanto o broker está fora (enviadas quando volta) */
const int MAX_FILA = 30;
String fila[MAX_FILA]; int nFila = 0;
//
/* ---------------- sensores ---------------- */
float lerPot(int pino, float min, float max) { return min + (max - min) * analogRead(pino) / 4095.0; }
//
float lerRadiacao() {
  // LDR do Wokwi -> lux (fórmula da documentação do Wokwi) -> W/m² (~120 lux por W/m² de luz solar; aproximação)
  const float GAMMA = 0.7, RL10 = 50;
  float v = analogRead(PINO_LDR) / 4095.0 * 3.3;
  if (v >= 3.29) return 0;
  float r = 2000 * v / (1 - v / 3.3);
  float lux = pow(RL10 * 1e3 * pow(10, GAMMA) / r, 1 / GAMMA);
  return lux / 120.0;
}
//
void lerSensores() {
  sondaAgua.requestTemperatures();
  float t = sondaAgua.getTempCByIndex(0);
  L.agua = (t == DEVICE_DISCONNECTED_C) ? NAN : t;
  L.od  = lerPot(PINO_OD, 0, 12);        // mg/L
  L.ph  = lerPot(PINO_PH, 4, 10);
  L.tan = lerPot(PINO_TAN, 0, 3);        // mg/L de N amoniacal total
  L.nh3 = isnan(L.agua) ? NAN : L.tan * fracNH3(L.agua, L.ph);
  TempAndHumidity th = dht.getTempAndHumidity();
  L.ar = th.temperature; L.ur = th.humidity;
  L.rad = lerRadiacao();
}
//
/* ---------------- aerador ---------------- */
void aplicarAerador(bool ligar, const char* origem) {
  if (ligar != aerador) Serial.printf("# aerador %s (%s)\n", ligar ? "LIGADO" : "DESLIGADO", origem);
  aerador = ligar; origemAerador = origem;
  digitalWrite(PINO_RELE, ligar ? HIGH : LOW);
  digitalWrite(PINO_LED_AER, ligar ? HIGH : LOW);
}
//
void controlarAerador() {
  gemeoAtivo = USAR_MQTT && mqtt.connected() && (millis() - ultimoComandoGemeo < GEMEO_VALIDO_MS) && ultimoComandoGemeo > 0;
  if (L.od < 2.5) { aplicarAerador(true, "SEGURANCA_LOCAL"); return; }       // em qualquer modo
  if (modoAerador == "MANUAL") { aplicarAerador(comandoManual, "MANUAL"); return; }
  if (gemeoAtivo) return;                                                     // o gêmeo decide (comando/aerador)
  if (!aerador && L.od < 3) aplicarAerador(true, "FALLBACK_LOCAL");          // Boyd (2018a)
  else if (aerador && L.od >= 5) aplicarAerador(false, "FALLBACK_LOCAL");    // Tucker (2005)
}
//
void tratarComando(String c) {
  c.trim(); c.toUpperCase();
  if (c == "LIGAR" || c == "LIGADO" || c == "ON") { modoAerador = "MANUAL"; comandoManual = true; }
  else if (c == "DESLIGAR" || c == "DESLIGADO" || c == "OFF") { modoAerador = "MANUAL"; comandoManual = false; }
  else if (c == "AUTO") { modoAerador = "AUTO"; }
  else if (c == "STATUS") { Serial.println(jsonLeitura()); return; }
  else { Serial.println("# comandos: ligar | desligar | auto | status"); return; }
  Serial.printf("# modo do aerador: %s\n", modoAerador.c_str());
  controlarAerador();
}
//
/* ---------------- MQTT (opcional) ---------------- */
void aoReceber(char* topico, byte* dados, unsigned int n) {
  String t(topico), v; for (unsigned int i = 0; i < n; i++) v += (char)dados[i];
  String rel = t.substring(strlen(TOPICO));
  if (rel == "comando/aerador") {
    v.trim(); v.toUpperCase();
    ultimoComandoGemeo = millis();
    if (v == "AUTO") { modoAerador = "AUTO"; return; }
    // comando do gêmeo em modo automático: o gêmeo decide, a segurança local continua valendo
    if (modoAerador == "AUTO") aplicarAerador(v == "LIGAR" || v == "LIGADO" || v == "ON", "GEMEO");
    else tratarComando(v);
  } else if (rel == "comando/racao") {
    Serial.printf("# ração recomendada pelo gêmeo: %s kg\n", v.c_str());
  } else if (rel == "servidor/status") {
    ultimoComandoGemeo = millis();
  }
}
//
void publicar(const char* sub, String valor) { mqtt.publish((String(TOPICO) + sub).c_str(), valor.c_str()); }
//
void conectarRede() {
#if USAR_MQTT
  if (WiFi.status() != WL_CONNECTED) { WiFi.begin(WIFI_SSID, WIFI_SENHA, 6); return; }
  if (!mqtt.connected()) {
    String id = "esp32-viveiro1-" + String((uint32_t)ESP.getEfuseMac(), HEX);
    if (mqtt.connect(id.c_str(), (String(TOPICO) + "status").c_str(), 1, true, "OFFLINE")) {
      publicar("status", "ONLINE");
      mqtt.subscribe((String(TOPICO) + "comando/#").c_str());
      mqtt.subscribe((String(TOPICO) + "servidor/status").c_str());
      Serial.println("# MQTT conectado");
    }
  }
#endif
}
//
/* ---------------- saída ---------------- */
String num(float x, int casas) { return isnan(x) ? String("null") : String(x, casas); }
//
String jsonLeitura() {
  return String("{\"agua_temperatura\":") + num(L.agua, 2) + ",\"agua_od\":" + num(L.od, 2) + ",\"agua_ph\":" + num(L.ph, 2) +
         ",\"agua_amonia_total\":" + num(L.tan, 2) + ",\"agua_nh3n\":" + num(L.nh3, 3) +
         ",\"clima_temperatura_ar\":" + num(L.ar, 1) + ",\"clima_umidade\":" + num(L.ur, 0) + ",\"clima_radiacao\":" + num(L.rad, 0) +
         ",\"aerador\":\"" + (aerador ? "LIGADO" : "DESLIGADO") + "\",\"origem\":\"" + origemAerador + "\",\"modo\":\"" + modoAerador +
         "\",\"zonas\":{\"temp\":\"" + NOME_NIVEL[isnan(L.agua) ? CRITICO : zonaTemp(L.agua)] + "\",\"od\":\"" + NOME_NIVEL[zonaOD(L.od)] +
         "\",\"ph\":\"" + NOME_NIVEL[zonaPH(L.ph)] + "\",\"nh3\":\"" + NOME_NIVEL[isnan(L.nh3) ? IDEAL : zonaNH3(L.nh3)] + "\"}}";
}
//
void publicarLeituras() {
#if USAR_MQTT
  if (!mqtt.connected()) {                      // guarda para enviar quando voltar
    if (nFila == MAX_FILA) { for (int i = 1; i < MAX_FILA; i++) fila[i - 1] = fila[i]; nFila--; }
    fila[nFila++] = jsonLeitura();
    return;
  }
  for (int i = 0; i < nFila; i++) publicar("historico", fila[i]);
  nFila = 0;
  publicar("agua/temperatura", num(L.agua, 2));
  publicar("agua/od", num(L.od, 2));
  publicar("agua/ph", num(L.ph, 2));
  publicar("agua/amonia_total", num(L.tan, 2));
  publicar("clima/temperatura_ar", num(L.ar, 1));
  publicar("clima/umidade", num(L.ur, 0));
  publicar("clima/radiacao", num(L.rad, 0));
  publicar("atuador/aerador", aerador ? "LIGADO" : "DESLIGADO");
  publicar("atuador/aerador_origem", origemAerador);
#endif
}
//
Nivel piorNivel() {
  Nivel n = zonaOD(L.od);
  Nivel o[] = { isnan(L.agua) ? CRITICO : zonaTemp(L.agua), zonaPH(L.ph), isnan(L.nh3) ? IDEAL : zonaNH3(L.nh3) };
  for (Nivel x : o) if (x > n) n = x;
  return n;
}
//
void atualizarLeds() {
  Nivel n = piorNivel();
  digitalWrite(PINO_LED_OK, n == IDEAL ? HIGH : LOW);
  digitalWrite(PINO_LED_ATN, n == ATENCAO ? HIGH : LOW);
  digitalWrite(PINO_LED_CRT, n >= CRITICO ? HIGH : LOW);
}
//
const char* marca(Nivel n) { return n == IDEAL ? " ok" : n == ATENCAO ? " !" : " !!"; }
//
void desenharOled() {
  oled.clearDisplay(); oled.setTextSize(1); oled.setTextColor(SSD1306_WHITE); oled.setCursor(0, 0);
  if (tela == 0) {
    oled.printf("VIVEIRO 1  %s\n", USAR_MQTT ? (mqtt.connected() ? "MQTT on" : "MQTT off") : "local");
    oled.printf("Agua %5.1f C%s\n", L.agua, marca(isnan(L.agua) ? CRITICO : zonaTemp(L.agua)));
    oled.printf("OD   %5.1f mg/L%s\n", L.od, marca(zonaOD(L.od)));
    oled.printf("pH   %5.2f%s\n", L.ph, marca(zonaPH(L.ph)));
    oled.printf("NH3N %5.3f%s\n", L.nh3, marca(isnan(L.nh3) ? IDEAL : zonaNH3(L.nh3)));
    oled.printf("Aerador %s\n", aerador ? "LIGADO" : "DESLIG.");
    oled.printf("%s", origemAerador.c_str());
  } else {
    float f = isnan(L.agua) ? 0 : fatorRacao(L.agua);
    bool alimentar = L.od > 3 && f > 0;           // SENAR (2019); Rotta et al. (2023)
    oled.printf("Ar  %4.1f C  UR %3.0f%%\n", L.ar, L.ur);
    oled.printf("Sol ~%4.0f W/m2\n", L.rad);
    oled.printf("NAT %4.2f mg/L\n\n", L.tan);
    oled.printf("Racao: %s\n", alimentar ? "pode alimentar" : "SUSPENSA");
    oled.printf("Fator temp.: %3.0f%%\n", f * 100);
    oled.printf("Modo: %s", modoAerador.c_str());
  }
  oled.display();
}
//
/* ---------------- setup e loop ---------------- */
void setup() {
  Serial.begin(115200);
  pinMode(PINO_RELE, OUTPUT); pinMode(PINO_LED_AER, OUTPUT);
  pinMode(PINO_LED_OK, OUTPUT); pinMode(PINO_LED_ATN, OUTPUT); pinMode(PINO_LED_CRT, OUTPUT);
  pinMode(PINO_BOTAO, INPUT_PULLUP);
  analogReadResolution(12);
  sondaAgua.begin();
  dht.setup(PINO_DHT, DHTesp::DHT22);
  if (!oled.begin(SSD1306_SWITCHCAPVCC, 0x3C)) Serial.println("# OLED não encontrado");
  oled.clearDisplay(); oled.setTextColor(SSD1306_WHITE); oled.setCursor(0, 0); oled.println("Gemeo digital\nViveiro 1\niniciando..."); oled.display();
#if USAR_MQTT
  WiFi.mode(WIFI_STA);
  mqtt.setServer(MQTT_BROKER, MQTT_PORTA);
  mqtt.setCallback(aoReceber);
  mqtt.setBufferSize(512);
#endif
  Serial.println("# ESP32 do Viveiro 1 pronto. Comandos: ligar | desligar | auto | status");
}
//
void loop() {
#if USAR_MQTT
  static uint32_t ultimaTentativa = 0;
  if (!mqtt.connected() && millis() - ultimaTentativa > 3000) { ultimaTentativa = millis(); conectarRede(); }
  mqtt.loop();
#endif
  if (Serial.available()) tratarComando(Serial.readStringUntil('\n'));
  if (digitalRead(PINO_BOTAO) == LOW && millis() - ultimoBotao > 300) { ultimoBotao = millis(); tela = 1 - tela; desenharOled(); }
  if (millis() - ultimaLeitura >= INTERVALO_LEITURA_MS) {
    ultimaLeitura = millis();
    lerSensores();
    controlarAerador();
    atualizarLeds();
    desenharOled();
    Serial.println(jsonLeitura());
    publicarLeituras();
  }
  delay(10);
}
