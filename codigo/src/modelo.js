/* =====================================================================
   GÊMEO DIGITAL · VIVEIRO 1 · TILÁPIA-DO-NILO · GOIÂNIA (GO)
   Parte 1: contraparte física virtual (clima, água, peixes, dispositivo)
   e modelos do gêmeo (crescimento de Yi 1998, previsão híbrida de OD,
   ração do dia, aeração e alertas). Roda no navegador e também no Node
   (para testes), sem servidor e sem bibliotecas.
   ===================================================================== */
'use strict';

/* ---------------- utilidades ---------------- */
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const H = 3600e3, MIN = 60e3, DIA = 24 * H;
function rng(seed) {                       // gerador pseudoaleatório reprodutível
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}
function gauss(r) { const u = Math.max(1e-9, r()), v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
// O relógio simulado guarda a hora local de Goiânia codificada como UTC.
const horaDe = t => { const d = new Date(t); return d.getUTCHours() + d.getUTCMinutes() / 60; };
const mesDe = t => new Date(t).getUTCMonth();
const diaDoAno = t => { const d = new Date(t); return Math.floor((t - Date.UTC(d.getUTCFullYear(), 0, 1)) / DIA) + 1; };
const p2 = n => String(n).padStart(2, '0');
const fmtHora = t => { const d = new Date(t); return p2(d.getUTCHours()) + ':' + p2(d.getUTCMinutes()); };
const fmtData = t => { const d = new Date(t); return p2(d.getUTCDate()) + '/' + p2(d.getUTCMonth() + 1) + '/' + d.getUTCFullYear(); };
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const fmtDiaMes = t => { const d = new Date(t); return d.getUTCDate() + ' ' + MESES[d.getUTCMonth()]; };

/* ---------------- clima de Goiânia ----------------
   Estação automática A002 Goiânia (GO) do INMET, dados horários de 01/01/2023 a 31/12/2025 [inmet].
   Médias calculadas pelo protótipo a partir dos três arquivos anuais do Banco de Dados Meteorológicos
   (2023.zip, 2024.zip, 2025.zip). Horas sem leitura (-9999) foram ignoradas; 2025 tem falhas de
   junho a dezembro, então esses meses pesam mais 2023 e 2024. Hora local = UTC − 3.
   tmax/tmin = média das máximas/mínimas diárias; chuva = total médio do mês; pchuva = fração de dias
   com 1 mm ou mais; rad = radiação global média em MJ/m²/dia; anomDP = desvio-padrão da temperatura
   média diária em torno da média do mês; anomAR1 = correlação de um dia com o seguinte. */
const NORMAIS = {
  tmax: [31.1, 32.1, 31.9, 31.8, 30.7, 30.4, 31.1, 32.8, 36.1, 34.6, 33.0, 32.2],
  tmin: [20.5, 20.0, 20.4, 19.9, 16.0, 14.7, 13.4, 15.4, 19.1, 21.2, 20.9, 20.6],
  tmed: [24.3, 24.6, 24.8, 24.5, 22.5, 21.7, 21.6, 23.5, 27.1, 26.7, 25.6, 25.0],
  chuva: [267.6, 236.2, 153.5, 151.7, 28.0, 5.7, 0.0, 7.8, 20.8, 179.4, 299.5, 235.4],
  pchuva: [0.60, 0.61, 0.46, 0.37, 0.01, 0.01, 0.00, 0.04, 0.13, 0.42, 0.62, 0.66],
  ur: [76, 73, 73, 73, 64, 60, 52, 44, 42, 61, 69, 72],
  vento: [0.8, 0.8, 0.8, 0.8, 0.9, 0.8, 0.9, 1.1, 1.1, 0.9, 0.8, 0.8],
  pressao: [930.8, 931.8, 932.0, 931.8, 934.1, 935.3, 936.0, 934.5, 932.3, 930.8, 930.3, 930.4],
  rad: [18.6, 19.3, 17.1, 16.3, 16.0, 14.5, 15.3, 15.9, 19.2, 18.3, 19.1, 19.4],
  anomDP: [1.26, 1.40, 1.33, 1.02, 1.42, 1.07, 1.25, 2.01, 1.54, 2.22, 2.02, 1.49],
  anomAR1: 0.69,
  // ciclo médio de cada hora local (0 a 23 h), um vetor por mês
  hT: [
    [21.9, 21.6, 21.4, 21.2, 21.0, 20.9, 20.9, 21.8, 23.6, 25.3, 26.8, 27.8, 28.4, 28.8, 28.8, 28.2, 27.4, 26.5, 25.4, 24.1, 23.5, 23.1, 22.6, 22.3],
    [21.8, 21.5, 21.2, 21.0, 20.8, 20.6, 20.4, 21.2, 23.2, 25.5, 27.6, 29.0, 29.4, 29.7, 29.5, 29.2, 28.4, 27.8, 26.1, 24.7, 23.6, 22.9, 22.5, 22.1],
    [22.2, 21.9, 21.6, 21.3, 21.1, 20.9, 20.8, 21.5, 23.6, 25.9, 27.4, 28.7, 29.3, 29.7, 29.6, 29.3, 28.4, 27.3, 26.0, 24.7, 24.0, 23.5, 23.0, 22.5],
    [21.7, 21.4, 21.1, 20.9, 20.7, 20.5, 20.3, 20.7, 23.2, 25.6, 27.5, 28.9, 29.6, 29.9, 30.1, 29.6, 28.7, 27.1, 25.3, 24.2, 23.5, 22.9, 22.4, 22.0],
    [18.9, 18.4, 17.8, 17.4, 16.9, 16.6, 16.3, 16.7, 19.9, 23.3, 25.9, 27.6, 28.7, 29.3, 29.8, 29.6, 28.8, 27.0, 24.6, 23.2, 22.0, 21.1, 20.3, 19.5],
    [18.1, 17.5, 16.8, 16.5, 16.0, 15.6, 15.2, 15.4, 17.9, 22.1, 25.1, 27.2, 28.3, 28.9, 29.3, 29.4, 28.0, 26.6, 24.2, 22.5, 21.3, 20.4, 19.5, 18.7],
    [17.7, 17.0, 16.2, 15.6, 14.9, 14.4, 13.9, 14.0, 17.0, 21.4, 25.2, 27.4, 28.6, 29.5, 30.0, 30.2, 29.0, 27.5, 24.8, 23.2, 21.6, 20.5, 19.5, 18.6],
    [19.7, 18.9, 18.1, 17.4, 16.8, 16.3, 16.2, 16.9, 20.5, 24.1, 27.1, 29.1, 30.4, 31.3, 31.5, 31.4, 30.8, 29.4, 26.9, 25.1, 23.5, 22.4, 21.1, 20.4],
    [23.2, 22.4, 21.9, 21.1, 20.6, 20.2, 20.0, 21.2, 24.7, 28.6, 31.2, 32.9, 33.9, 34.3, 34.6, 34.4, 33.9, 32.3, 29.9, 28.1, 26.9, 25.8, 25.0, 24.1],
    [23.6, 23.2, 22.8, 22.5, 22.1, 21.8, 21.7, 23.3, 25.6, 27.9, 29.9, 31.1, 32.1, 32.5, 32.5, 32.0, 31.3, 30.1, 28.4, 27.0, 26.0, 25.2, 24.7, 24.1],
    [22.7, 22.4, 22.1, 21.8, 21.6, 21.4, 21.6, 23.1, 25.3, 27.3, 28.8, 29.9, 30.4, 30.8, 30.6, 30.4, 29.5, 28.3, 26.5, 25.2, 24.6, 23.9, 23.5, 23.1],
    [22.3, 21.9, 21.6, 21.4, 21.3, 21.1, 21.2, 22.4, 24.3, 26.3, 27.6, 28.8, 29.6, 29.9, 30.1, 29.6, 28.7, 28.0, 26.2, 24.8, 24.0, 23.3, 22.9, 22.5]
  ],
  hUR: [
    [87, 88, 89, 90, 90, 90, 91, 88, 80, 71, 65, 61, 58, 56, 56, 59, 62, 65, 69, 76, 79, 81, 83, 84],
    [86, 86, 88, 89, 90, 90, 91, 89, 81, 71, 62, 55, 52, 51, 51, 52, 55, 58, 65, 72, 77, 80, 82, 84],
    [84, 86, 87, 88, 89, 90, 90, 88, 79, 68, 62, 57, 54, 52, 52, 53, 57, 60, 66, 72, 75, 79, 81, 83],
    [86, 88, 89, 89, 90, 90, 90, 90, 80, 69, 61, 54, 51, 50, 48, 50, 53, 59, 67, 73, 77, 80, 82, 85],
    [80, 82, 84, 86, 87, 88, 88, 88, 76, 62, 53, 46, 41, 38, 36, 36, 37, 44, 53, 59, 65, 70, 73, 77],
    [74, 76, 79, 81, 83, 84, 85, 85, 77, 60, 48, 40, 36, 33, 31, 30, 33, 37, 46, 52, 58, 62, 67, 71],
    [66, 68, 72, 74, 77, 79, 81, 82, 72, 54, 41, 33, 29, 26, 25, 24, 25, 29, 36, 41, 48, 53, 58, 62],
    [54, 57, 61, 64, 67, 70, 70, 68, 57, 44, 35, 29, 26, 23, 22, 22, 22, 24, 29, 34, 38, 43, 47, 51],
    [50, 53, 56, 60, 62, 64, 65, 64, 50, 37, 30, 26, 23, 23, 22, 23, 23, 26, 30, 35, 37, 41, 45, 48],
    [72, 74, 76, 78, 80, 81, 81, 76, 66, 56, 49, 45, 42, 40, 40, 41, 44, 46, 51, 57, 61, 65, 68, 71],
    [80, 82, 83, 85, 86, 86, 87, 81, 71, 62, 56, 52, 49, 48, 48, 48, 51, 56, 63, 68, 72, 76, 78, 79],
    [84, 86, 87, 88, 89, 89, 89, 86, 76, 67, 61, 56, 52, 51, 51, 51, 55, 58, 65, 71, 75, 78, 81, 83]
  ],
  hV: [
    [0.3, 0.3, 0.2, 0.3, 0.3, 0.2, 0.2, 0.4, 0.8, 1.1, 1.3, 1.4, 1.5, 1.6, 1.5, 1.6, 1.4, 1.2, 0.8, 0.6, 0.5, 0.5, 0.4, 0.5],
    [0.4, 0.3, 0.3, 0.3, 0.4, 0.3, 0.4, 0.4, 0.8, 1.1, 1.4, 1.5, 1.7, 1.5, 1.4, 1.4, 1.4, 1.2, 1.0, 0.6, 0.6, 0.6, 0.6, 0.4],
    [0.4, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.5, 0.8, 1.0, 1.3, 1.5, 1.6, 1.4, 1.5, 1.4, 1.2, 1.1, 0.7, 0.6, 0.4, 0.4, 0.5, 0.4],
    [0.3, 0.3, 0.3, 0.3, 0.3, 0.4, 0.4, 0.4, 0.7, 1.1, 1.3, 1.5, 1.4, 1.5, 1.4, 1.3, 1.3, 1.2, 0.9, 0.6, 0.5, 0.5, 0.4, 0.3],
    [0.4, 0.4, 0.3, 0.3, 0.4, 0.4, 0.4, 0.5, 0.8, 1.3, 1.8, 2.0, 1.8, 1.6, 1.6, 1.4, 1.3, 1.1, 0.6, 0.5, 0.4, 0.4, 0.5, 0.4],
    [0.5, 0.5, 0.4, 0.4, 0.4, 0.4, 0.4, 0.4, 0.6, 1.1, 1.7, 1.9, 1.7, 1.7, 1.5, 1.4, 1.2, 0.9, 0.6, 0.4, 0.5, 0.5, 0.5, 0.5],
    [0.5, 0.5, 0.5, 0.4, 0.4, 0.3, 0.4, 0.4, 0.6, 1.1, 1.8, 1.9, 1.9, 1.7, 1.6, 1.5, 1.3, 1.1, 0.5, 0.5, 0.5, 0.5, 0.6, 0.5],
    [0.7, 0.7, 0.6, 0.6, 0.6, 0.6, 0.6, 0.7, 1.0, 1.5, 1.8, 1.9, 1.9, 1.9, 1.7, 1.7, 1.6, 1.3, 0.8, 0.9, 0.8, 0.6, 0.7, 0.6],
    [0.4, 0.4, 0.4, 0.4, 0.5, 0.6, 0.6, 0.6, 1.0, 1.6, 1.8, 1.9, 1.9, 2.0, 2.0, 1.9, 1.7, 1.4, 1.0, 0.8, 0.7, 0.7, 0.6, 0.5],
    [0.5, 0.4, 0.4, 0.5, 0.4, 0.4, 0.4, 0.7, 1.0, 1.3, 1.5, 1.6, 1.5, 1.6, 1.6, 1.5, 1.5, 1.1, 0.9, 0.7, 0.7, 0.4, 0.5, 0.6],
    [0.4, 0.3, 0.3, 0.4, 0.3, 0.3, 0.3, 0.5, 0.8, 1.2, 1.4, 1.5, 1.5, 1.5, 1.6, 1.5, 1.5, 1.3, 1.0, 0.7, 0.7, 0.5, 0.5, 0.5],
    [0.4, 0.4, 0.2, 0.2, 0.3, 0.4, 0.3, 0.5, 0.9, 1.2, 1.4, 1.5, 1.5, 1.5, 1.5, 1.6, 1.3, 1.3, 0.9, 0.7, 0.6, 0.6, 0.5, 0.4]
  ],
  hP: [
    [931.6, 931.1, 930.6, 930.4, 930.3, 930.6, 931.1, 931.7, 932.2, 932.6, 932.6, 932.3, 931.6, 930.8, 930.0, 929.2, 928.7, 928.6, 928.9, 929.6, 930.3, 931.1, 931.7, 931.9],
    [932.5, 932.1, 931.7, 931.4, 931.4, 931.7, 932.0, 932.6, 933.2, 933.5, 933.5, 933.2, 932.7, 931.9, 931.0, 930.2, 929.6, 929.5, 929.8, 930.4, 931.2, 932.0, 932.7, 932.9],
    [932.6, 932.3, 931.9, 931.7, 931.6, 931.8, 932.2, 932.7, 933.4, 933.8, 933.8, 933.5, 932.9, 931.9, 931.0, 930.2, 929.9, 929.9, 930.2, 930.7, 931.4, 932.2, 932.7, 932.8],
    [932.4, 932.0, 931.7, 931.5, 931.4, 931.5, 932.0, 932.6, 933.2, 933.6, 933.7, 933.2, 932.4, 931.5, 930.6, 929.9, 929.7, 929.9, 930.3, 930.9, 931.5, 932.1, 932.4, 932.5],
    [934.5, 934.2, 933.8, 933.7, 933.6, 933.9, 934.4, 935.0, 935.6, 936.1, 936.0, 935.6, 934.8, 933.9, 933.0, 932.6, 932.5, 932.7, 933.0, 933.3, 933.9, 934.2, 934.6, 934.6],
    [935.7, 935.4, 935.1, 934.9, 934.9, 935.1, 935.5, 936.1, 936.9, 937.2, 937.1, 936.7, 935.9, 935.0, 934.1, 933.6, 933.5, 933.7, 934.1, 934.5, 935.0, 935.5, 935.7, 935.7],
    [936.5, 936.2, 935.8, 935.6, 935.5, 935.7, 936.2, 936.8, 937.5, 937.9, 938.0, 937.6, 936.8, 935.8, 934.9, 934.3, 934.2, 934.4, 934.8, 935.0, 935.7, 936.0, 936.5, 936.6],
    [935.1, 934.7, 934.4, 934.2, 934.2, 934.4, 935.0, 935.6, 936.1, 936.5, 936.5, 936.0, 935.1, 934.2, 933.2, 932.7, 932.5, 932.7, 933.1, 933.5, 934.1, 934.6, 934.9, 935.1],
    [932.9, 932.5, 932.0, 931.9, 931.9, 932.3, 933.1, 933.8, 934.3, 934.4, 934.3, 933.8, 932.9, 931.9, 930.9, 930.2, 930.0, 930.2, 930.6, 931.2, 931.8, 932.4, 932.8, 933.0],
    [931.3, 930.9, 930.4, 930.3, 930.4, 930.8, 931.3, 932.0, 932.6, 932.8, 932.7, 932.3, 931.4, 930.3, 929.3, 928.6, 928.3, 928.5, 929.1, 929.9, 930.6, 931.3, 931.8, 931.7],
    [930.9, 930.4, 929.9, 929.7, 929.9, 930.3, 930.8, 931.4, 931.9, 932.2, 932.0, 931.6, 930.9, 930.0, 929.0, 928.3, 928.0, 928.1, 928.6, 929.3, 930.2, 930.9, 931.3, 931.3],
    [930.9, 930.4, 930.0, 929.9, 930.0, 930.3, 930.9, 931.5, 931.9, 932.2, 932.2, 931.8, 931.1, 930.3, 929.4, 928.7, 928.2, 928.2, 928.6, 929.3, 930.1, 930.8, 931.3, 931.4]
  ],
  hChuva: [
    [15.9, 15.1, 4.5, 2.9, 1.1, 1.5, 3.7, 6.3, 5.2, 2.5, 10.6, 8.9, 10.8, 5.3, 8.9, 10.9, 21.9, 42.5, 17.7, 14.5, 11.2, 18.6, 19.1, 8.1],
    [10.2, 6.7, 5.4, 5.3, 5.0, 3.4, 1.8, 4.5, 2.0, 0.3, 0.3, 0.5, 0.6, 5.5, 18.7, 36.6, 23.2, 9.6, 3.5, 6.2, 31.4, 22.7, 16.9, 16.2],
    [1.8, 4.3, 4.7, 3.1, 14.4, 10.5, 1.8, 0.5, 2.0, 0.7, 6.1, 3.9, 8.8, 8.9, 9.2, 7.5, 23.0, 14.7, 3.7, 3.1, 3.5, 4.5, 5.4, 7.3],
    [0.7, 1.0, 1.8, 3.3, 8.7, 3.9, 4.5, 1.4, 2.9, 0.1, 0.4, 0.2, 0.7, 0.4, 13.7, 6.0, 10.9, 35.8, 14.5, 15.0, 7.7, 2.0, 6.1, 10.2],
    [0.0, 0.0, 0.0, 0.0, 0.1, 0.0, 0.1, 0.1, 0.0, 0.0, 0.0, 0.1, 0.0, 0.0, 0.0, 0.0, 0.0, 0.2, 21.8, 2.9, 0.2, 0.0, 0.0, 0.0],
    [1.9, 2.4, 0.1, 0.0, 3.0, 0.8, 0.3, 0.1, 0.0, 0.1, 0.0, 0.0, 0.0, 0.0, 0.1, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
    [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
    [0.0, 0.0, 0.0, 1.6, 0.2, 0.0, 0.0, 0.5, 0.0, 0.0, 0.0, 0.3, 0.1, 0.0, 0.0, 0.1, 0.1, 0.0, 0.0, 0.0, 0.0, 1.6, 2.0, 0.4],
    [0.1, 0.9, 0.1, 0.0, 1.6, 0.0, 0.2, 0.1, 0.4, 0.0, 0.1, 0.3, 0.1, 4.8, 2.4, 0.9, 0.7, 0.7, 4.2, 0.4, 0.0, 0.5, 0.1, 0.1],
    [8.3, 1.3, 4.1, 0.5, 14.9, 11.3, 3.3, 1.9, 0.6, 3.7, 3.0, 3.7, 11.2, 6.6, 4.1, 19.9, 16.4, 3.0, 7.5, 12.9, 17.7, 12.5, 3.5, 7.5],
    [19.9, 20.6, 14.4, 37.3, 6.5, 2.1, 4.9, 3.2, 0.8, 1.2, 1.7, 0.9, 1.6, 3.1, 1.6, 14.7, 22.9, 50.0, 36.3, 22.1, 11.0, 11.8, 4.6, 6.3],
    [2.1, 6.5, 11.0, 6.9, 13.1, 11.0, 8.7, 7.6, 6.0, 6.6, 4.2, 3.0, 2.8, 4.7, 4.9, 7.3, 25.1, 12.2, 23.9, 8.0, 13.6, 13.3, 15.1, 2.9]
  ],
  extremos: { tmax: 41.1, tmin: 6.2, chuvaDia: 91.2 },
  periodo: '2023–2025', estacao: 'A002 Goiânia'
};
// pressão média medida na estação (727 m de altitude), média dos 12 meses
const PRESSAO_LOCAL = NORMAIS.pressao.reduce((x, y) => x + y, 0) / 12;
// valor do ciclo horário no instante h (horas decimais), interpolando entre as horas
const cicloHora = (v, h) => { const i = Math.floor(h) % 24, f = h - Math.floor(h); return v[i] * (1 - f) + v[(i + 1) % 24] * f; };
// a média das horas suaviza os extremos; o formato do ciclo médio é esticado até a máxima e a mínima diárias médias
const cicloTemp = (m, h) => { const v = NORMAIS.hT[m], lo = Math.min(...v), hi = Math.max(...v); return NORMAIS.tmin[m] + (cicloHora(v, h) - lo) / (hi - lo) * (NORMAIS.tmax[m] - NORMAIS.tmin[m]); };
const LAT = -16.68 * Math.PI / 180;
function radiacaoCeuLimpo(t) {           // W/m², céu limpo, latitude de Goiânia
  const doy = diaDoAno(t), h = horaDe(t);
  const dec = 23.44 * Math.PI / 180 * Math.sin(2 * Math.PI * (284 + doy) / 365);
  const ang = (h - 12.2) * 15 * Math.PI / 180;
  const s = Math.sin(LAT) * Math.sin(dec) + Math.cos(LAT) * Math.cos(dec) * Math.cos(ang);
  return s > 0 ? 1080 * Math.pow(s, 1.2) : 0;
}

// razão média entre a radiação medida (INMET) e a de céu limpo, por mês: calibra a nebulosidade do simulador
const KT_MES = NORMAIS.rad.map((r, m) => {
  const t0 = Date.UTC(2025, m, 15); let cs = 0;
  for (let t = t0; t < t0 + DIA; t += 10 * MIN) cs += radiacaoCeuLimpo(t) * 600 / 1e6;
  return Math.min(0.95, r / cs);
});
class Clima {
  constructor(seed) { this.r = rng(seed); this.dia = -1; this.anom = 0; this.chuvoso = false; this.nuvemDia = 0.85; this.Ta = 24; this.UR = 70; this.rad = 0; this.chuva = 0; this.vento = 1; this.pressao = PRESSAO_LOCAL; this.nuvem = 0.85; this.ruidoVento = 0; }
  passo(t, ctl) {
    const m = mesDe(t), h = horaDe(t), dia = Math.floor(t / DIA);
    if (dia !== this.dia) {                // sorteios diários com as estatísticas do INMET A002 2023-2025
      this.dia = dia;
      // anomalia da média diária: AR(1) com o desvio-padrão e a autocorrelação medidos
      const rho = NORMAIS.anomAR1;
      this.anom = rho * this.anom + Math.sqrt(1 - rho * rho) * NORMAIS.anomDP[m] * gauss(this.r);
      const p = NORMAIS.pchuva[m];
      this.chuvoso = this.r() < p;
      // nebulosidade: média do mês igual à razão medida/céu limpo; dia de chuva com 65% dessa luz
      const kt = KT_MES[m], fSeco = p < 1 ? (1 - 0.65 * p) / (1 - p) : 1;
      this.nuvemDia = clamp(kt * (this.chuvoso ? 0.65 : fSeco) * (1 + 0.12 * gauss(this.r)), 0.1, 1);
      // hora de início da chuva sorteada pela distribuição horária da chuva no mês (linha h = chuva entre h-1 e h)
      const pesos = NORMAIS.hChuva[m], tot = pesos.reduce((x, y) => x + y, 0);
      let u = this.r() * tot, hh = 0; while (hh < 23 && u > pesos[hh]) { u -= pesos[hh]; hh++; }
      this.inicioChuva = (hh + 23) % 24 + this.r();
      this.mmDia = p > 0 ? NORMAIS.chuva[m] / (30.4 * p) : 0;
    }
    const dh = (h - this.inicioChuva + 24) % 24;
    const chovendoAgora = (ctl.chuvaForcada || (this.chuvoso && dh < 3));
    this.chuva = chovendoAgora ? (ctl.chuvaForcada ? 12 : this.mmDia / 3) : 0;
    this.nuvem = ctl.nuvemManual != null ? ctl.nuvemManual : (chovendoAgora ? 0.25 : this.nuvemDia);
    this.rad = radiacaoCeuLimpo(t) * this.nuvem;
    // ciclo horário médio do mês (INMET), mais a anomalia do dia; a chuva esfria o ar
    this.Ta = cicloTemp(m, h) + this.anom + ctl.deltaTempAr - (chovendoAgora ? 2.5 : 0);
    this.UR = clamp(cicloHora(NORMAIS.hUR[m], h) - 2.5 * this.anom + (chovendoAgora ? 20 : 0) - ctl.deltaTempAr * 1.2, 15, 100);
    this.ruidoVento = 0.9 * (this.ruidoVento || 0) + 0.1 * gauss(this.r);
    this.vento = Math.max(0, cicloHora(NORMAIS.hV[m], h) * (1 + 0.8 * this.ruidoVento) + ctl.ventoExtra + (chovendoAgora ? 2 : 0));
    this.pressao = cicloHora(NORMAIS.hP[m], h) - ctl.deltaTempAr * 0.3;
  }
}

/* ---------------- modelo de crescimento de Yi (1998) ----------------
   dW/dt = b(1-a)·h·τ(T)·δ(OD)·υ(NH3)·f·W^m − k(T)·W^n            [yi1998]
   Parâmetros conforme a tabela de Dampin et al. (2012), que cita a origem de cada um [dampin2012]. */
const YI = { h: 0.8, m: 0.67, n: 0.81, b: 0.62, a: 0.53, kmin: 0.00133, j: 0.0132, Tmin: 15, Topt: 33, Tmax: 41, DOcrit: 1.0, DOmin: 0.3, UIAcrit: 0.06, UIAmax: 1.4 };
function tau(T) {
  if (T <= YI.Tmin || T >= YI.Tmax) return 0;
  const x = T < YI.Topt ? (YI.Topt - T) / (YI.Topt - YI.Tmin) : (T - YI.Topt) / (YI.Tmax - YI.Topt);
  return Math.exp(-4.6 * Math.pow(x, 4));
}
const delta = od => od >= YI.DOcrit ? 1 : od <= YI.DOmin ? 0 : (od - YI.DOmin) / (YI.DOcrit - YI.DOmin);
const upsilon = u => u <= YI.UIAcrit ? 1 : u >= YI.UIAmax ? 0 : (YI.UIAmax - u) / (YI.UIAmax - YI.UIAcrit);
const kCatab = T => YI.kmin * Math.exp(YI.j * (T - YI.Tmin));
/* Yi (1998) foi feito para viveiros fertilizados (alimento natural). Para ração extrusada usamos um
   fator de equivalência E, derivado (não arbitrado) da conversão alimentar esperada da tabela SENAR
   (2019): CA 1,3 para peixes de 150–250 g com 3,0% do peso vivo/dia em água de 25–28 °C [senar2019].
   Resolve-se: ganho(W=200 g, T=26,5 °C, ração 3%) = ração / 1,3. */
const E_RACAO = (() => {
  const W = 200, T = 26.5, C = W * 0.030, CA = 1.3;
  return (C / CA + kCatab(T) * Math.pow(W, YI.n)) / (YI.b * (1 - YI.a) * C);
})();
// saciedade (g de ração/peixe/dia) = ração máxima de Yi convertida por E
const apetiteYi = (W, T, od, uia, alfa = 1) => alfa * YI.h * tau(T) * delta(od) * upsilon(uia) * Math.pow(W, YI.m) / E_RACAO;
// ganho diário (g/dia) dado o consumo de ração C (g/peixe/dia)
const ganhoYi = (W, T, C, alfa = 1) => YI.b * (1 - YI.a) * alfa * E_RACAO * C - kCatab(T) * Math.pow(W, YI.n);

/* ---------------- química da água ---------------- */
// saturação de O2 em água doce (mg/L), Benson e Krause (1984) [benson1984]; correção de pressão simplificada (proporcional)
function odSat(T, p = 1013.25) {
  const K = T + 273.15;
  const ln = -139.34411 + 1.575701e5 / K - 6.642308e7 / (K * K) + 1.2438e10 / (K * K * K) - 8.621949e11 / (K * K * K * K);
  return Math.exp(ln) * p / 1013.25;
}
// fração de amônia não ionizada: pKa = 0,09018 + 2729,92/T(K), Emerson et al. (1975) [emerson1975]
const fracNH3 = (T, pH) => 1 / (1 + Math.pow(10, 0.09018 + 2729.92 / (T + 273.15) - pH));

/* tabela de arraçoamento para viveiro escavado, SENAR (2019), Tabela 1 [senar2019]:
   [peso máximo da faixa (g), % do peso vivo/dia, refeições/dia, CA esperada] */
const TABELA_RACAO = [[5, 14.0, 5, 1.0], [10, 8.0, 4, 1.0], [20, 5.0, 3, 1.1], [50, 4.5, 3, 1.1], [150, 3.4, 3, 1.2], [250, 3.0, 3, 1.3],
  [400, 2.2, 2, 1.4], [600, 1.4, 2, 1.6], [800, 1.0, 2, 1.7], [Infinity, 0.8, 2, 1.8]];
const faixaTabela = W => TABELA_RACAO.find(([lim]) => W <= lim);
const pctTabela = W => faixaTabela(W)[1];
const refeicoesTabela = W => faixaTabela(W)[2];

/* consumo de O2 da tilápia-do-nilo (mg O2/kg/h) por peso e temperatura, Kim e Jo (1999) [kimjo1999];
   interpolação log-linear entre os pontos medidos (4, 40, 120, 400 g; 20, 25, 30 °C) */
const KJ = { W: [4, 40, 120, 400], T: [20, 25, 30], v: [[318.8, 435.2, 611.1], [214.9, 345.9, 538.4], [84.1, 151.5, 320.8], [69.4, 115.9, 236.0]] };
function consumoO2Tilapia(W, T) {
  const lw = Math.log(clamp(W, 4, 400));
  let i = 0; while (i < 2 && lw > Math.log(KJ.W[i + 1])) i++;
  const fw = (lw - Math.log(KJ.W[i])) / (Math.log(KJ.W[i + 1]) - Math.log(KJ.W[i]));
  const linha = KJ.T.map((_, k) => Math.log(KJ.v[i][k]) * (1 - fw) + Math.log(KJ.v[i + 1][k]) * fw);
  const Tc = clamp(T, 12, 34), k = Tc <= 25 ? 0 : 1;
  const ft = (Tc - KJ.T[k]) / 5;
  return Math.exp(linha[k] + (linha[k + 1] - linha[k]) * ft);
}
/* aerador de pás de 1 cv (0,75 kW) com eficiência padrão de 3,0 kg O2/kWh, no meio da faixa de
   2,7–3,4 kg O2/kWh de Tucker (2005) [tucker2005]: kLa = SOTR / (V · ODsat a 20 °C) */
const POTENCIA_AERADOR_KW = 0.75;

/* ---------------- viveiro (verdade simulada) ---------------- */
const VIVEIRO = { area: 1000, prof: 1.2, vol: 1200 };
const KLA_AERADOR = 3.0 * POTENCIA_AERADOR_KW * 1000 / (VIVEIRO.vol * odSat(20));   // ≈ 0,21 por hora
class Viveiro {
  constructor(nome, N, W, Tw) {
    Object.assign(this, { nome, N, N0: N, W, Tw, OD: 7, pH: 7.6, TAN: 0.4, carga: 10, intestino: 0, aerador: false, algas: 1 });
    this.ac = { racao: 0, consumida: 0, desperdicio: 0, horasAerador: 0, odMin: 99, mortos: 0, biomassa0: N * W / 1000 };
    this.ultimaBiometria = { t: 0, W };
  }
  get biomassa() { return this.N * this.W / 1000; }   // kg
  get uia() { return this.TAN * fracNH3(this.Tw, this.pH); }
  passo(dtMin, clima, ctl, verdade) {
    const dt = dtMin / 60;  // horas
    // temperatura da água: tende à temperatura do ar com atraso de ~10 h, de modo que a média diária
    // da água fica perto da média do ar (Rotta et al., 2023) [rotta2023]; o atraso é do simulador
    this.Tw += (clima.Ta - this.Tw) * dt / 10;
    const Tw = this.Tw, sat = odSat(Tw, clima.pressao);
    // balanço de oxigênio (mg/L/h): estrutura de Boyd et al. (1978) e Romaire e Boyd (1979) [boyd1978, romaire1979]:
    // fotossíntese ∝ radiação; respiração do plâncton e do fundo; respiração dos peixes; difusão; aerador.
    // Coeficientes de fotossíntese, respiração da água e difusão: calibrados no simulador (sem fonte).
    const P = 2.3 * this.algas * clima.rad / 1000 * Math.pow(1.036, Tw - 20);
    const Rw = (0.22 * Math.pow(1.07, Tw - 20)) * ctl.respExtra + 0.01 * this.carga;
    const cPeixe = consumoO2Tilapia(this.W, Tw) * clamp(this.OD / 2.5, 0, 1) * (1 + 0.6 * this.intestino / Math.max(1, this.W * 0.01));
    const Rf = this.biomassa / VIVEIRO.vol * cPeixe / 1000;
    const kSup = 0.03 + 0.015 * clima.vento;
    const aerando = this.aerador && !ctl.falhaAerador;
    const Aer = aerando ? KLA_AERADOR : 0;
    this.OD = clamp(this.OD + (P - Rw - Rf + (kSup + Aer) * (sat - this.OD)) * dt, 0, 25);
    if (aerando) this.ac.horasAerador += dt;
    // pH acompanha o CO2 (fotossíntese x respiração)
    const pHalvo = 7.4 + 0.9 * Math.log2(clamp(this.OD / sat, 0.3, 3));
    this.pH += (pHalvo - this.pH) * dt * 0.6;
    // digestão e crescimento (Yi 1998, com eficiência "real" diferente da literatura)
    const proc = this.intestino * Math.min(1, dt / 4);
    this.intestino -= proc;
    const T = Tw, uia = this.uia;
    const dW = verdade.alfa * YI.b * (1 - YI.a) * E_RACAO * proc - kCatab(T) * Math.pow(this.W, YI.n) * dt / 24;
    this.W = Math.max(1, this.W + dW);
    // nitrogênio amoniacal e carga orgânica
    const decomp = this.carga * 0.01 * dt;
    this.carga -= decomp;
    this.TAN = Math.max(0, this.TAN + decomp * 0.04 - this.TAN * 0.04 * dt * (0.8 + 0.5 * clima.rad / 800));
    // mortalidade por hipóxia, amônia e temperatura
    let mort = 0;
    // limiares: OD de 1,0–1,5 mg/L por algumas horas pode matar (Boyd, 2018a); abaixo de ~12 °C há risco de morte (Kubitza, 2011).
    // As taxas por hora são do simulador (sem fonte).
    if (this.OD < 1.0) mort += 0.03; else if (this.OD < 1.5) mort += 0.006;
    if (uia > 1.0) mort += 0.004;
    if (Tw <= 11) mort += 0.01;   // nobrega2020: mortalidade entre ~11 e 6 °C
    const mortos = this.N * mort * dt;
    this.N -= mortos; this.ac.mortos += mortos;
    this.ac.odMin = Math.min(this.ac.odMin, this.OD);
  }
  // uma refeição: os peixes comem até o apetite; o resto vira desperdício e carga orgânica
  alimentar(kg, fracaoDoDia, verdade) {
    if (kg <= 0) return { ofertado: 0, consumido: 0 };
    const comport = clamp((this.OD - 2.5) / 1.0, 0, 1);             // peixe com OD baixo come menos (SENAR: só alimentar com OD > 3); curva do simulador
    const apet = apetiteYi(this.W, this.Tw, this.OD, this.uia, verdade.alfa) * comport * fracaoDoDia * this.N / 1000 * 1.15;
    const cons = Math.min(kg, apet), desp = kg - cons;
    this.intestino += cons * 1000 / this.N;
    this.carga += (desp * 1.1 + cons * 0.25) * 1000 / VIVEIRO.vol;
    this.TAN += cons * 1000 * 0.03 / VIVEIRO.vol;
    Object.assign(this.ac, { racao: this.ac.racao + kg, consumida: this.ac.consumida + cons, desperdicio: this.ac.desperdicio + desp });
    return { ofertado: kg, consumido: cons };
  }
}

/* ---------------- cenários sazonais ---------------- */
const CENARIOS = {
  verao:   { nome: 'Verão chuvoso', detalhe: 'janeiro', inicio: Date.UTC(2027, 0, 12, 0), N: 4000, W: 110 },
  inverno: { nome: 'Inverno seco', detalhe: 'julho', inicio: Date.UTC(2027, 6, 8, 0), N: 4000, W: 110 },
  seca:    { nome: 'Fim da seca, calor', detalhe: 'setembro', inicio: Date.UTC(2027, 8, 14, 0), N: 4000, W: 110 }
};
const CONTROLES_PADRAO = () => ({ offsetOD: 0, deltaTempAr: 0, nuvemManual: null, chuvaForcada: false, ventoExtra: 0, respExtra: 1, falhaAerador: false, internet: true, manejo: 'gemeo', travas: {} });

/* ---------------- simulador: relógio, dois viveiros e o ESP32 virtual ----------------
   "principal" é o viveiro que o gêmeo acompanha e comanda.
   "sombra" recebe o mesmo clima com manejo tradicional, para comparação. */
const TOPICO = 'gemeo/viveiro1/';
const PREAQUECIMENTO_DIAS = 35;
class Simulador {
  constructor(cenario = 'verao', seed = 7) { this.reiniciar(cenario, seed); }
  reiniciar(cenario, seed = 7) {
    const c = CENARIOS[cenario];
    this.cenario = cenario; this.seed = seed;
    this.ctl = CONTROLES_PADRAO();
    this.clima = new Clima(seed);
    this.verdade = { alfa: 1.08 };                      // eficiência real do lote (o gêmeo não conhece)
    this.t = c.inicio - PREAQUECIMENTO_DIAS * DIA;
    const Tw0 = NORMAIS.tmed[mesDe(c.inicio)];
    this.v = new Viveiro('gemeo', c.N, c.W, Tw0);
    this.s = new Viveiro('tradicional', c.N, c.W, Tw0);
    this.historico = [];          // leituras a cada 10 min (o que o "banco" do gêmeo recebe)
    this.diario = [];             // resumo diário (médias), guardado por todo o ciclo
    this.acDia = null;
    this.biometrias = [];         // pesagens
    this.refeicoes = [];          // refeições do viveiro principal
    this.eventos = [];
    this.temporarios = [];        // efeitos de cenário com hora para acabar
    this.origemAerador = 'tradicional';
    this.modoAeracao = 'AUTO';
    this.ultimoComando = -Infinity; // último contato do gêmeo (tempo simulado)
    this.gemeoAtivo = false;       // há um painel do gêmeo conectado?
    this.planoRacao = null;
    this.r = rng(seed * 31 + 1);
    this.amostra = 0;
    // pré-aquecimento: 35 dias de histórico com manejo tradicional, para o painel abrir com dados
    const passoAntes = this.ctl.manejo; this.ctl.manejo = 'tradicional';
    this.preaquecendo = true;
    while (this.t < c.inicio) this.avancar(10);
    this.preaquecendo = false; this.ctl.manejo = passoAntes;
    this.v.ac = { racao: 0, consumida: 0, desperdicio: 0, horasAerador: 0, odMin: 99, mortos: 0, biomassa0: this.v.biomassa };
    this.s.ac = { racao: 0, consumida: 0, desperdicio: 0, horasAerador: 0, odMin: 99, mortos: 0, biomassa0: this.s.biomassa };
    this.inicioComparacao = this.t;
  }
  // leitura dos sensores com ruído (o que o ESP32 publicaria)
  leituras() {
    const r = this.r, v = this.v, c = this.clima, n = s => gauss(r) * s;
    const tr = this.ctl.travas;
    return {
      'agua/temperatura': +(tr.Tw ?? v.Tw + n(0.05)).toFixed(2),
      'agua/od': +Math.max(0, (tr.OD ?? v.OD + n(0.06)) + this.ctl.offsetOD).toFixed(2),
      'agua/ph': +(tr.pH ?? v.pH + n(0.02)).toFixed(2),
      'agua/amonia_total': +Math.max(0, tr.TAN ?? v.TAN + n(0.01)).toFixed(2),
      'clima/temperatura_ar': +(c.Ta + n(0.1)).toFixed(1),
      'clima/umidade': +c.UR.toFixed(0),
      'clima/radiacao': +c.rad.toFixed(0),
      'clima/chuva': +c.chuva.toFixed(1),
      'clima/vento': +c.vento.toFixed(1),
      'clima/pressao': +c.pressao.toFixed(1),
      'atuador/aerador': v.aerador ? 'LIGADO' : 'DESLIGADO',
      'atuador/aerador_origem': this.origemAerador.toUpperCase().replace(/ /g, '_'),
      'biomassa/quantidade': Math.round(v.N),
      'status': this.ctl.internet ? 'ONLINE' : 'OFFLINE'
    };
  }
  // aplica travas do apresentador no estado (o valor travado vira o estado real)
  aplicarTravas() {
    const tr = this.ctl.travas, v = this.v;
    if (tr.Tw != null) v.Tw = tr.Tw;
    if (tr.OD != null) v.OD = tr.OD;
    if (tr.pH != null) v.pH = tr.pH;
    if (tr.TAN != null) v.TAN = tr.TAN;
  }
  avancar(minutos) {
    const out = [];
    let resto = minutos;
    while (resto > 0) {
      const dt = Math.min(1, resto); resto -= dt;
      const t0 = this.t; this.t += dt * MIN;
      if (this.temporarios.length) this.expirarEfeitos();
      this.clima.passo(this.t, this.ctl);
      this.aplicarTravas();
      this.v.passo(dt, this.clima, this.ctl, this.verdade);
      this.s.passo(dt, this.clima, this.ctl, this.verdade);
      this.aplicarTravas();
      this.controleLocal(t0);
      this.manejoTradicional(t0);
      // biometria semanal às 07:00 (quinta-feira simulada) e amostragem do histórico a cada 10 min
      if (Math.floor(t0 / DIA) !== Math.floor(this.t / DIA)) this.virouDia();
      if (Math.floor(t0 / H) !== Math.floor(this.t / H) && Math.round(horaDe(this.t)) === 7 && new Date(this.t).getUTCDay() === 4) out.push(this.biometria());
      if (Math.floor(t0 / (10 * MIN)) !== Math.floor(this.t / (10 * MIN))) { const am = this.amostraHistorico(); this.historico.push(am); this.acumularDia(am); }
    }
    const limite = this.t - 3 * DIA;
    while (this.historico.length && this.historico[0].t < limite) this.historico.shift();
    return out;
  }
  amostraHistorico() {
    const L = this.leituras();
    return { t: this.t, Tw: L['agua/temperatura'], OD: L['agua/od'], pH: L['agua/ph'], TAN: L['agua/amonia_total'], Ta: L['clima/temperatura_ar'], UR: L['clima/umidade'], rad: L['clima/radiacao'], chuva: L['clima/chuva'], vento: L['clima/vento'], aer: this.v.aerador ? 1 : 0, online: this.ctl.internet ? 1 : 0 };
  }
  virouDia() {
    const a = this.acDia;
    if (a && a.n) this.diario.push({ t: a.t, Tw: +(a.Tw / a.n).toFixed(2), OD: +(a.OD / a.n).toFixed(2), ODmin: +a.ODmin.toFixed(2), Ta: +(a.Ta / a.n).toFixed(2) });
    this.acDia = { t: this.t, n: 0, Tw: 0, OD: 0, ODmin: 99, Ta: 0 };
  }
  acumularDia(am) {
    if (!this.acDia) this.acDia = { t: Math.floor(this.t / DIA) * DIA, n: 0, Tw: 0, OD: 0, ODmin: 99, Ta: 0 };
    const a = this.acDia; a.n++; a.Tw += am.Tw; a.OD += am.OD; a.Ta += am.Ta; a.ODmin = Math.min(a.ODmin, am.OD);
  }
  biometria() {
    const W = this.v.W * (1 + gauss(this.r) * 0.02);
    const b = { t: this.t, W: +W.toFixed(1), N: Math.round(this.v.N), Wsombra: +this.s.W.toFixed(1) };
    this.biometrias.push(b);
    this.v.ultimaBiometria = { t: this.t, W: b.W };
    this.s.ultimaBiometria = { t: this.t, W: this.s.W * (1 + gauss(this.r) * 0.03) };
    return { tipo: 'biometria', ...b };
  }
  // ESP32 virtual: sem o gêmeo (internet caída ou painel fechado) liga o aerador se OD < 3
  controleLocal(t0) {
    const gemeoPresente = this.ctl.internet && this.gemeoAtivo && (this.t - this.ultimoComando < 90 * MIN);
    const v = this.v;
    if (this.preaquecendo || (!gemeoPresente && this.ctl.manejo === 'gemeo') || this.ctl.manejo === 'tradicional') {
      if (this.ctl.manejo === 'tradicional' || this.preaquecendo) {
        // manejo tradicional: aerador ligado das 23h às 6h, mais o produtor ligando se o peixe boquejar
        const h = horaDe(this.t);
        const ligar = (h >= 23 || h < 6) || v.OD < 2;
        if (ligar !== v.aerador) { v.aerador = ligar; this.origemAerador = 'tradicional'; }
      } else {
        if (v.OD < 3 && !v.aerador) { v.aerador = true; this.origemAerador = 'fallback local'; this.registrar('Fallback local: OD abaixo de 3 mg/L sem contato com o gêmeo, aerador ligado'); }
        else if (v.OD > 5 && v.aerador) { v.aerador = false; this.origemAerador = 'fallback local'; this.registrar('Fallback local: OD acima de 5 mg/L, aerador desligado'); }
      }
    }
    // intertravamento de segurança do ESP32: OD abaixo de 2,5 mg/L liga o aerador em qualquer modo
    if (v.OD < 2.5 && !v.aerador) { v.aerador = true; this.origemAerador = 'seguranca local'; if (!this.preaquecendo) this.registrar('Segurança local: OD abaixo de 2,5 mg/L, aerador ligado'); }
    // sombra: sempre tradicional
    const h = horaDe(this.t), s = this.s;
    s.aerador = (h >= 23 || h < 6) || s.OD < 2;
  }
  // tratador seguindo a tabela: 2 refeições (8h e 16h) pelo peso da última biometria, sem ajuste
  manejoTradicional(t0) {
    const h0 = horaDe(t0), h1 = horaDe(this.t);
    const cruzou = hh => (h0 < hh && h1 >= hh) || (h1 < h0 && hh <= h1);
    for (const hh of [8, 16]) if (cruzou(hh)) {
      for (const viv of [this.s, this.v]) {
        if (viv === this.v && !this.preaquecendo && this.ctl.manejo === 'gemeo' && this.gemeoAtivo && this.ctl.internet) continue;
        const kg = viv.N * viv.ultimaBiometria.W * pctTabela(viv.ultimaBiometria.W) / 100 / 1000 / 2;
        const r = viv.alimentar(kg, 0.5, this.verdade);
        if (viv === this.v) this.refeicoes.push({ t: this.t, kg: +kg.toFixed(2), origem: 'tabela' });
      }
    }
  }
  // comando vindo do gêmeo (o que chegaria em gemeo/viveiro1/comando/...)
  comando(topico, valor) {
    if (!this.ctl.internet) return false;
    this.ultimoComando = this.t; this.gemeoAtivo = true;
    if (topico === 'servidor/status') return true;
    if (topico === 'comando/aerador') {
      const ligar = valor === 'LIGAR';
      if (ligar !== this.v.aerador) this.registrar('Comando do gêmeo: aerador ' + (ligar ? 'ligado' : 'desligado'));
      this.v.aerador = ligar; this.origemAerador = 'gemeo';
    } else if (topico === 'comando/racao' && this.ctl.manejo === 'gemeo') {
      const kg = +valor;
      const r = this.v.alimentar(kg, 1 / refeicoesTabela(this.v.W), this.verdade);   // fração do apetite do dia: uma das refeições da tabela
      this.refeicoes.push({ t: this.t, kg, origem: 'gemeo' });
      // a sombra já come pela tabela no manejoTradicional
    }
    return true;
  }
  // efeito temporário: muda um controle (ou o viveiro) e desfaz depois de "horas" simuladas
  efeito(chave, valor, horas, rotulo) {
    this.temporarios = this.temporarios.filter(e => { if (e.chave === chave) { this.setar(chave, e.normal); return false; } return true; });
    const normal = this.ler(chave);
    this.setar(chave, valor);
    if (horas) this.temporarios.push({ chave, normal, ate: this.t + horas * H, rotulo });
    if (rotulo) this.registrar(rotulo);
  }
  ler(chave) { const [o, k] = chave.split('.'); return o === 'v' ? this.v[k] : this.ctl[k]; }
  setar(chave, val) { const [o, k] = chave.split('.'); if (o === 'v') { this.v[k] = val; if (k === 'algas') this.s[k] = val; } else this.ctl[k] = val; }
  expirarEfeitos() {
    this.temporarios = this.temporarios.filter(e => { if (this.t >= e.ate) { this.setar(e.chave, e.normal); this.registrar('Fim do efeito: ' + (e.rotulo || e.chave)); return false; } return true; });
  }
  // previsão do tempo do mundo simulado: copia o estado e roda só o clima por N dias
  // (o sorteio diário é refeito, então a previsão não é igual ao que vai acontecer, como na vida real)
  previsaoClima(nDias = 7) {
    const c = Simulador.restaurar(this.snapshot());
    c.clima.r = rng((this.seed + 97) * 13 + Math.floor(this.t / DIA));
    const dias = [];
    const inicio = Math.floor(this.t / DIA) * DIA + DIA;
    while (c.t < inicio) { c.t += 10 * MIN; c.expirarEfeitos(); c.clima.passo(c.t, c.ctl); }
    for (let d = 0; d < nDias; d++) {
      const acc = { t: c.t, tmax: -99, tmin: 99, chuva: 0, rad: 0, vento: 0 };
      for (let k = 0; k < 144; k++) {
        c.t += 10 * MIN; c.expirarEfeitos(); c.clima.passo(c.t, c.ctl);
        acc.tmax = Math.max(acc.tmax, c.clima.Ta); acc.tmin = Math.min(acc.tmin, c.clima.Ta);
        acc.chuva += c.clima.chuva / 6; acc.rad += c.clima.rad * 600 / 1e6; acc.vento = Math.max(acc.vento, c.clima.vento);
      }
      dias.push({ t: acc.t, tmax: +acc.tmax.toFixed(1), tmin: +acc.tmin.toFixed(1), chuva: +acc.chuva.toFixed(1), rad: +acc.rad.toFixed(1), vento: +acc.vento.toFixed(1) });
    }
    return dias;
  }
  registrar(txt) { this.eventos.push({ t: this.t, txt }); if (this.eventos.length > 60) this.eventos.shift(); }
  comparacao() {
    const f = (v) => {
      const ganho = v.biomassa - v.ac.biomassa0;
      return { racao: v.ac.racao, desperdicio: v.ac.desperdicio, ganho, ca: ganho > 0.5 ? v.ac.racao / ganho : null, horasAerador: v.ac.horasAerador, odMin: v.ac.odMin, mortos: v.ac.mortos, W: v.W, N: v.N };
    };
    return { dias: (this.t - this.inicioComparacao) / DIA, gemeo: f(this.v), tradicional: f(this.s) };
  }
  snapshot() { return JSON.parse(JSON.stringify(this, (k, val) => (k === 'r' ? undefined : val))); }
  static restaurar(obj) {
    const s = Object.create(Simulador.prototype);
    Object.assign(s, obj);
    s.clima = Object.assign(Object.create(Clima.prototype), obj.clima); s.clima.r = rng(obj.seed + Math.floor(obj.t / DIA));
    s.v = Object.assign(Object.create(Viveiro.prototype), obj.v);
    s.s = Object.assign(Object.create(Viveiro.prototype), obj.s);
    s.r = rng(obj.seed * 31 + Math.floor(obj.t / MIN));
    return s;
  }
}

/* =====================================================================
   O GÊMEO DIGITAL (lado do servidor/painel): só enxerga as leituras,
   as biometrias e as refeições, nunca o estado interno do viveiro.
   ===================================================================== */

/* ---- previsão híbrida de OD ----
   Estrutura física: dOD/dt = P·(rad/1000)·1,036^(T−20) − R·1,07^(T−20) + k·(ODsat−OD) + kA·aer·(ODsat−OD)
   Parâmetros P, R, k, kA estimados dos dados das últimas 24 h (mínimos quadrados com prior). */
function resolver(A, b) {            // eliminação de Gauss
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let i = 0; i < n; i++) {
    let p = i; for (let k = i + 1; k < n; k++) if (Math.abs(M[k][i]) > Math.abs(M[p][i])) p = k;
    [M[i], M[p]] = [M[p], M[i]];
    if (Math.abs(M[i][i]) < 1e-12) return null;
    for (let k = i + 1; k < n; k++) { const f = M[k][i] / M[i][i]; for (let j = i; j <= n; j++) M[k][j] -= f * M[i][j]; }
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) { let s = M[i][n]; for (let j = i + 1; j < n; j++) s -= M[i][j] * x[j]; x[i] = s / M[i][i]; }
  return x;
}
const PRIOR_OD = [2.4, 0.55, 0.05, 0.25];
function ajustarOD(hist) {
  const dados = hist.slice(-144);                // últimas 24 h
  const feats = (p) => { const sat = odSat(p.Tw); return [p.rad / 1000 * Math.pow(1.036, p.Tw - 20), -Math.pow(1.07, p.Tw - 20), sat - p.OD, p.aer * (sat - p.OD)]; };
  const n = 4, AtA = Array.from({ length: n }, () => new Array(n).fill(0)), Atb = new Array(n).fill(0);
  let usados = 0; const res = [];
  for (let i = 0; i + 1 < dados.length; i++) {
    const a = dados[i], b = dados[i + 1], dh = (b.t - a.t) / H;
    if (dh <= 0 || dh > 0.5 || !a.online || !b.online) continue;
    const y = (b.OD - a.OD) / dh, x = feats(a);
    for (let r = 0; r < n; r++) { Atb[r] += x[r] * y; for (let c = 0; c < n; c++) AtA[r][c] += x[r] * x[c]; }
    usados++;
  }
  const lam = [3, 6, 40, 20];                     // força do prior (regularização)
  for (let r = 0; r < n; r++) { AtA[r][r] += lam[r]; Atb[r] += lam[r] * PRIOR_OD[r]; }
  const th = resolver(AtA, Atb) || PRIOR_OD.slice();
  th[0] = clamp(th[0], 0.3, 6); th[1] = clamp(th[1], 0.05, 2.5); th[2] = clamp(th[2], 0, 0.3); th[3] = clamp(th[3], 0.02, 0.8);
  // erro do ajuste (mg/L/h)
  let se = 0, k = 0;
  for (let i = 0; i + 1 < dados.length; i++) {
    const a = dados[i], b = dados[i + 1], dh = (b.t - a.t) / H; if (dh <= 0 || dh > 0.5) continue;
    const x = feats(a), yhat = x.reduce((s, xi, j) => s + xi * th[j], 0);
    se += Math.pow((b.OD - a.OD) / dh - yhat, 2); k++;
  }
  return { theta: th, sigma: k ? Math.sqrt(se / k) : 0.3, amostras: usados };
}
// nebulosidade estimada: radiação medida / céu limpo nas horas de sol recentes
function estimarNuvem(hist) {
  let m = 0, c = 0;
  for (let i = hist.length - 1; i >= 0 && i > hist.length - 145; i--) { const cs = radiacaoCeuLimpo(hist[i].t); if (cs > 250) { m += hist[i].rad; c += cs; } }
  return c > 0 ? clamp(m / c, 0.15, 1) : 0.8;
}
function preverOD(hist, horas = 12, planoAerador = null) {
  if (hist.length < 12) return null;
  const aj = ajustarOD(hist), [P, R, k, kA] = aj.theta;
  const nuvem = estimarNuvem(hist);
  const ult = hist[hist.length - 1];
  // temperatura da água prevista: ciclo diário (harmônico de 24 h ajustado nas últimas 24 h, sem tendência) somado ao valor atual
  const ult24 = hist.slice(-144), w = 2 * Math.PI / DIA;
  const AtA = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], Atb = [0, 0, 0, 0];
  for (const a of ult24) { const x = [1, Math.sin(w * a.t), Math.cos(w * a.t), (a.t - ult.t) / DIA]; for (let r = 0; r < 4; r++) { Atb[r] += x[r] * a.Tw; for (let c = 0; c < 4; c++) AtA[r][c] += x[r] * x[c]; } }
  for (let r = 0; r < 4; r++) AtA[r][r] += 1e-3;
  const hc = ult24.length > 72 ? resolver(AtA, Atb) : null;
  const harm = tt => hc ? hc[1] * Math.sin(w * tt) + hc[2] * Math.cos(w * tt) : 0;
  const passo = 10 * MIN, pts = [];
  let od = ult.OD;
  for (let t = ult.t + passo; t <= ult.t + horas * H; t += passo) {
    // temperatura prevista: perfil de ontem deslocado pela diferença atual (persistência)
    const Tw = ult.Tw + harm(t) - harm(ult.t);
    const rad = radiacaoCeuLimpo(t) * nuvem;
    const sat = odSat(Tw);
    const aer = planoAerador ? planoAerador(t, od) : 0;
    const dOD = P * rad / 1000 * Math.pow(1.036, Tw - 20) - R * Math.pow(1.07, Tw - 20) + k * (sat - od) + kA * aer * (sat - od);
    od = clamp(od + dOD * passo / H, 0, 22);
    pts.push({ t, OD: od, Tw, aer, sd: 0.1 + aj.sigma * 0.25 * Math.sqrt((t - ult.t) / H) });
  }
  let min = pts[0];
  for (const p of pts) if (p.OD < min.OD) min = p;
  const cruza = lim => pts.find(p => p.OD < lim) || null;
  return { pts, min, abaixo3: cruza(3), abaixo4: cruza(4), ajuste: aj, nuvem };
}

/* ---- crescimento: Yi (1998) calibrado pelas biometrias (fator α) ---- */
function ambienteEm(hist, diario) {
  // devolve (t) → {Tw, OD}: usa a leitura de 10 min mais próxima; antes disso, a média do dia
  return (t) => {
    if (hist.length && t >= hist[0].t) {
      let lo = 0, hi = hist.length - 1; while (lo < hi) { const mid = (lo + hi) >> 1; if (hist[mid].t < t) lo = mid + 1; else hi = mid; }
      return hist[lo];
    }
    for (let i = diario.length - 1; i >= 0; i--) if (diario[i].t <= t) return diario[i];
    return diario[0] || { Tw: 26, OD: 6 };
  };
}
function simularPeso(W0, t0, t1, amb, refeicoes, N, alfa) {
  // integra o modelo de Yi com a temperatura e o OD medidos e a ração ofertada
  let W = W0; const passo = 3 * H;
  let iR = 0;
  while (iR < refeicoes.length && refeicoes[iR].t < t0) iR++;
  for (let t = t0; t < t1; t += passo) {
    const a = amb(t);
    let racaoG = 0; while (iR < refeicoes.length && refeicoes[iR].t < t + passo) { racaoG += refeicoes[iR].kg * 1000 / N; iR++; }
    const apet = apetiteYi(W, a.Tw, Math.max(a.OD, 1.2), 0.02, alfa) * 0.5;   // refeição ≈ meio dia de apetite
    const C = Math.min(racaoG, apet * 1.15);
    W = Math.max(1, W + YI.b * (1 - YI.a) * alfa * E_RACAO * C - kCatab(a.Tw) * Math.pow(W, YI.n) * passo / DIA);
  }
  return W;
}
function calibrarCrescimento(biometrias, amb, refeicoes, N) {
  // α: razão entre a eficiência real do lote e a da literatura, ajustada por mínimos quadrados
  if (biometrias.length < 2) return { alfa: 1, rmse: null, n: biometrias.length };
  let melhor = { alfa: 1, erro: Infinity };
  for (let a = 0.7; a <= 1.4001; a += 0.01) {
    let e = 0;
    for (let i = 1; i < biometrias.length; i++) {
      const W = simularPeso(biometrias[i - 1].W, biometrias[i - 1].t, biometrias[i].t, amb, refeicoes, N, a);
      e += Math.pow(W - biometrias[i].W, 2);
    }
    if (e < melhor.erro) melhor = { alfa: +a.toFixed(2), erro: e };
  }
  return { alfa: melhor.alfa, rmse: Math.sqrt(melhor.erro / (biometrias.length - 1)), n: biometrias.length };
}
// projeção até o abate com as médias do INMET A002 2023-2025 (água ≈ média do ar, Rotta et al. 2023, mais o desvio atual medido)
function projetarCrescimento(W0, t0, alfa, desvioAgua, alvo = 800, diasMax = 240) {
  const pts = [{ t: t0, W: W0 }]; let W = W0, t = t0, abate = null;
  for (let d = 1; d <= diasMax; d++) {
    t += DIA;
    const Tw = NORMAIS.tmed[mesDe(t)] + desvioAgua * Math.exp(-d / 10);
    const racao = W * pctTabela(W) / 100 * fatorRacaoGemeo(Tw);
    const C = Math.min(racao, apetiteYi(W, Tw, 6, 0.02, alfa));
    W = Math.max(1, W + ganhoYi(W, Tw, C, alfa));
    if (d % 3 === 0) pts.push({ t, W });
    if (!abate && W >= alvo) abate = { t, W };
    if (abate && d > (abate.t - t0) / DIA + 6) break;
  }
  return { pts, abate };
}

/* ---- prescrição de ração ----
   Base: tabela de % do peso vivo. Ajustes: temperatura da água prevista, OD previsto na hora
   de cada refeição e um teto pelo apetite estimado pelo modelo de Yi calibrado. */
// fator de temperatura da água, SENAR (2019), Tabela 3 [senar2019]
function fatorTemperatura(T) {
  if (T < 16) return 0; if (T < 20) return 0.6; if (T < 25) return 0.8; if (T < 30) return 1; if (T <= 32) return 0.8; return 0;
}
/* regra de ração do gêmeo, calibrada no experimento de lotes comparativos (validacao/, 24/11/2026):
   mantém os limites de não alimentar do SENAR (abaixo de 16 °C e acima de 32 °C) e, entre eles, troca os
   degraus fixos de 60% e 80% pelo teto de apetite do modelo de Yi calibrado pelas biometrias (α).
   Com os degraus fixos, o gêmeo atrasava o abate em ~6 dias no verão chuvoso (água a 23–25 °C) sem
   economizar ração. Calibrada contra o simulador, não contra dados de viveiro. */
function fatorRacaoGemeo(T) { return T < 16 || T > 32 ? 0 : 1; }
// oxigênio: só alimentar com OD > 3 mg/L (SENAR, 2019; Rotta et al., 2023)
function fatorOD(od) { return od > 3 ? 1 : 0; }
function prescreverRacao({ W, N, alfa, prevOD, TwMedio, t }) {
  const nRef = refeicoesTabela(W);
  const base = N * W * pctTabela(W) / 100 / 1000;                // kg/dia pela tabela
  const fT = fatorRacaoGemeo(TwMedio);
  const teto = apetiteYi(W, TwMedio, 6, 0.02, alfa) * N / 1000;   // saciedade pelo modelo de Yi
  const dia0 = Math.floor(t / DIA) * DIA;
  const candidatas = [8, 9.5, 11, 12.5, 14, 15.5, 17];
  const odEm = (tt) => { if (!prevOD) return 6; let m = null; for (const p of prevOD.pts) if (Math.abs(p.t - tt) <= 10 * MIN) { m = p; break; } return m ? m.OD : (prevOD.pts.length ? prevOD.pts[prevOD.pts.length - 1].OD : 6); };
  const opcoes = candidatas.map(h => { const tt = dia0 + h * H; return { h, t: tt, od: tt > t ? odEm(tt) : null }; });
  // escolhe as horas com mais oxigênio previsto, evitando a madrugada e o início da manhã
  const futuras = opcoes.filter(o => o.od != null);
  const escolhidas = (futuras.length >= nRef ? futuras : opcoes).slice().sort((a, b) => (b.od ?? 6) - (a.od ?? 6)).slice(0, nRef).sort((a, b) => a.h - b.h);
  const totalAlvo = Math.min(base * fT, teto);
  const refeicoes = escolhidas.map(o => { const fo = o.od == null ? 1 : fatorOD(o.od); return { h: o.h, t: o.t, od: o.od, fator: fo, kg: totalAlvo / nRef * fo }; });
  const total = refeicoes.reduce((s, r) => s + r.kg, 0);
  let motivo;
  const Tt = TwMedio.toFixed(1).replace('.', ',');
  if (fT === 0) motivo = TwMedio < 16 ? `Água prevista a ${Tt} °C, abaixo de 16 °C: não alimentar (SENAR, 2019).` : `Água prevista a ${Tt} °C, acima de 32 °C: não alimentar (SENAR, 2019).`;
  else if (totalAlvo < base * fT - 1e-6) motivo = 'Limitado pelo apetite estimado pelo modelo de crescimento (Yi, 1998).';
  else motivo = `Água prevista a ${Tt} °C: tabela cheia (SENAR, 2019); o apetite estimado do lote (Yi, 1998, α = ${String(alfa).replace('.', ',')}) está acima dela.`;
  if (refeicoes.some(r => r.fator < 1)) motivo += ' Refeições com OD previsto até 3 mg/L ficam suspensas.';
  return { nRef, base, fT, teto, alvo: totalAlvo, total, refeicoes, motivo, pct: total / (N * W / 1000) * 100 };
}

/* ---- decisão de aeração (modo automático do gêmeo) ----
   Ligar com OD < 4 mg/L ou com OD previsto < 4 mg/L (Francis-Floyd, 2003) [francis2003];
   manter até depois do amanhecer, quando a fotossíntese volta a produzir oxigênio (Tucker, 2005),
   e desligar com OD ≥ 5 mg/L, o ótimo indicado por Francis-Floyd (2003). */
function decidirAerador(estadoAtual, odAtual, prev, ultimaTroca, t) {
  const proxMin = prev ? Math.min(...prev.pts.slice(0, 9).map(p => p.OD)) : odAtual;   // próximos 90 min
  if (!estadoAtual && (odAtual < 4 || proxMin < 4)) return { ligar: true, motivo: odAtual < 4 ? `OD em ${odAtual.toFixed(1)} mg/L` : `OD previsto de ${proxMin.toFixed(1)} mg/L nos próximos 90 min` };
  if (estadoAtual && odAtual >= 5 && proxMin >= 5 && radiacaoCeuLimpo(t) > 150 && t - ultimaTroca > 40 * MIN) return { ligar: false, motivo: `OD em ${odAtual.toFixed(1)} mg/L com sol` };
  return null;
}

/* =====================================================================
   Zonas de qualidade da água para a tilápia-do-nilo (ideal / atenção /
   crítica / risco de morte). Usadas nos alertas, nos blocos de leitura e
   como faixas sombreadas nos gráficos. Fontes: parametros-verificados.md, seção 8.
   ===================================================================== */
const ZONAS = {
  temp: { nome: 'Temperatura da água', unid: '°C', fonte: 'Nobrega et al. (2020); Rotta et al. (2023); SENAR (2019)',
    faixas: [
      { de: -Infinity, ate: 11, nivel: 'morte', r: 'risco de morte', base: 'Mortalidade entre ~11 e 6 °C, conforme a linhagem (Nobrega et al., 2020)' },
      { de: 11, ate: 20, nivel: 'critico', r: 'crítica', base: 'Abaixo de ~20 °C a alimentação pode parar; os estudos dão 13 a 20 °C (Nobrega et al., 2020)' },
      { de: 20, ate: 26, nivel: 'atencao', r: 'atenção', base: 'Dentro do conforto (20 a 32 °C, Rotta et al., 2023), mas a 22 °C o consumo cai 40 a 50% (Nobrega et al., 2020)' },
      { de: 26, ate: 30, nivel: 'ideal', r: 'ideal', base: 'Faixa ideal da tilápia (Nobrega et al., 2020); 27 a 30 °C em Rotta et al. (2023)' },
      { de: 30, ate: 32, nivel: 'atencao', r: 'atenção', base: 'Ração a 80% entre 30 e 32 °C (SENAR, 2019)' },
      { de: 32, ate: Infinity, nivel: 'critico', r: 'crítica', base: 'Acima de 32 °C, não alimentar (SENAR, 2019)' }] },
  od: { nome: 'Oxigênio dissolvido', unid: 'mg/L', fonte: 'Tran-Duy et al. (2008); SENAR (2019); Yi (1998)',
    faixas: [
      { de: -Infinity, ate: 1, nivel: 'morte', r: 'risco de morte', base: 'Abaixo de 1,0 mg/L o crescimento da tilápia cai até zero em 0,3 mg/L (Yi, 1998; Dampin et al., 2012)' },
      { de: 1, ate: 3, nivel: 'critico', r: 'crítica', base: 'Não alimentar abaixo de 3 mg/L (SENAR, 2019; Rotta et al., 2023)' },
      { de: 3, ate: 5, nivel: 'atencao', r: 'atenção', base: 'Tilápias comeram e cresceram menos a 3,0 do que a 5,6 mg/L (Tran-Duy et al., 2008)' },
      { de: 5, ate: Infinity, nivel: 'ideal', r: 'ideal', base: 'A 5,6 mg/L, maior consumo e crescimento (Tran-Duy et al., 2008)' }] },
  ph: { nome: 'pH', unid: '', fonte: 'Rebouças et al. (2016); Mustapha e Atolagbe (2018); Boyd (2018b, geral)',
    faixas: [
      { de: -Infinity, ate: 5, nivel: 'critico', r: 'crítica', base: 'Em 14 dias, 22% de mortalidade a pH 5 e 44% a pH 4 em juvenis (Mustapha e Atolagbe, 2018)' },
      { de: 5, ate: 5.5, nivel: 'atencao', r: 'atenção', base: 'A pH 6 por 14 dias, 12% de mortalidade em juvenis (Mustapha e Atolagbe, 2018)' },
      { de: 5.5, ate: 9, nivel: 'ideal', r: 'ideal', base: 'Faixa adequada para a tilápia em água eutrófica (Rebouças et al., 2016)' },
      { de: 9, ate: 11, nivel: 'atencao', r: 'atenção', base: 'A pH 9,2, o menor peso final do estudo (Rebouças et al., 2016)' },
      { de: 11, ate: Infinity, nivel: 'critico', r: 'crítica', base: 'Sem dado da espécie; em geral os peixes morrem perto de pH 11 (Boyd, 2018b; geral)' }] },
  nh3: { nome: 'Amônia não ionizada (NH₃-N)', unid: 'mg/L', fonte: 'El-Shafai et al. (2004); Emerson et al. (1975)',
    faixas: [
      { de: -Infinity, ate: 0.07, nivel: 'ideal', r: 'ideal', base: 'Sem efeito no crescimento até 0,068 mg/L (El-Shafai et al., 2004)' },
      { de: 0.07, ate: 0.14, nivel: 'atencao', r: 'atenção', base: 'Limiar tóxico entre 0,07 e 0,14 mg/L; manter abaixo de 0,1 (El-Shafai et al., 2004)' },
      { de: 0.14, ate: Infinity, nivel: 'critico', r: 'crítica', base: 'A 0,144 mg/L, crescimento menor e CA 1,6 vez maior (El-Shafai et al., 2004)' }] },
};
const faixaZona = (k, v) => v == null || !ZONAS[k] ? null : ZONAS[k].faixas.find(f => v >= f.de && v < f.ate) || null;
const nivelZona = (k, v) => { const f = faixaZona(k, v); return f ? f.nivel : null; };

/* ---- alertas ---- */
function avaliarAlertas(L, prev, extras) {
  const a = [];
  const od = L.od, T = L.temperatura, ph = L.ph, uia = L.uia;
  if (!extras.online) a.push({ id: 'offline', nivel: 'critico', titulo: 'Dispositivo offline', texto: 'Sem leituras do viveiro. O ESP32 segue com o fallback local do aerador.' });
  const vir = (v, c) => v.toFixed(c).replace('.', ',');
  const alerta = (id, k, v, txt, titulos) => {
    const f = faixaZona(k, v); if (!f || f.nivel === 'ideal') return;
    a.push({ id, nivel: f.nivel === 'atencao' ? 'atencao' : 'critico', titulo: titulos[f.nivel] + ': ' + txt, texto: f.base + '.' });
  };
  if (od != null) {
    alerta('od', 'od', od, `${vir(od, 1)} mg/L`, { morte: 'OD com risco de morte', critico: 'OD crítico', atencao: 'OD abaixo do ideal' });
    if (od < 4 && a.length && a[a.length - 1].id === 'od') a[a.length - 1].texto += ' Aerar abaixo de 4 mg/L (Francis-Floyd, 2003; geral).';
  }
  if (prev && prev.abaixo4 && !(od < 4)) a.push({ id: 'prev', nivel: prev.abaixo3 ? 'atencao' : 'info', titulo: `OD abaixo de 4 mg/L previsto às ${fmtHora(prev.abaixo4.t)}`, texto: `Sem aeração, o OD chegaria a ${vir(prev.min.OD, 1)} mg/L às ${fmtHora(prev.min.t)}. Aerar antes (Francis-Floyd, 2003; geral).` });
  if (T != null) alerta('temp', 'temp', T, `${vir(T, 1)} °C`, { morte: 'Água fria com risco de morte', critico: T < 20 ? 'Água fria demais' : 'Água quente demais', atencao: T < 26 ? 'Água abaixo do ideal' : 'Água acima do ideal' });
  if (ph != null) alerta('ph', 'ph', ph, vir(ph, 2), { critico: 'pH crítico', atencao: 'pH fora da faixa ideal' });
  if (uia != null) alerta('nh3', 'nh3', uia, `${vir(uia, 3)} mg/L de NH₃-N`, { critico: 'Amônia tóxica alta', atencao: 'Amônia tóxica acima do ideal' });
  if (extras.divergencia) a.push({ id: 'div', nivel: 'atencao', titulo: 'Leitura fora do esperado', texto: extras.divergencia });
  if (extras.anomaliaAr != null && extras.anomaliaAr < -4) a.push({ id: 'frio', nivel: 'atencao', titulo: 'Frente fria', texto: `Ar ${Math.abs(extras.anomaliaAr).toFixed(1)} °C abaixo da média de ${MESES[extras.mes]} (INMET 2023–2025). A água esfria e a frente fria pode misturar a coluna d'água (Araújo et al., 2017).` });
  if (extras.falhaAerador) a.push({ id: 'aer', nivel: 'critico', titulo: 'Aerador sem efeito', texto: 'O aerador está ligado, mas o OD continua caindo. Verificar o equipamento.' });
  return a;
}

/* =====================================================================
   Consequências da previsão de 7 dias para o viveiro (aba Previsão)
   dias: [{ t, tmax, tmin, chuva (mm), rad (MJ/m²), vento (m/s) }]
   est:  { W, N, alfa, theta (parâmetros de OD do gêmeo), Tw0, OD0 }
   ===================================================================== */
function consequenciasSemana(dias, est) {
  const [P, R, k, kA] = est.theta || PRIOR_OD;
  const passo = 10 * MIN, horas = [];
  let Tw = est.Tw0 ?? (dias[0].tmax + dias[0].tmin) / 2, od = est.OD0 ?? 6, od2 = od, aer = false, W = est.W, N = est.N;
  const dOD = (od, Tw, rad, a) => P * rad / 1000 * Math.pow(1.036, Tw - 20) - R * Math.pow(1.07, Tw - 20) + (k + (a ? kA : 0)) * (odSat(Tw, PRESSAO_LOCAL) - od);
  const saida = [];
  dias.forEach((d, i) => {
    const t0 = d.t;
    let somaCS = 0; for (let t = t0; t < t0 + DIA; t += passo) somaCS += radiacaoCeuLimpo(t) * 600;
    const fRad = somaCS > 0 ? clamp(d.rad * 1e6 / somaCS, 0.05, 1.15) : 1;
    const meio = (d.tmax + d.tmin) / 2, amp = (d.tmax - d.tmin) / 2;
    let somaTw = 0, n = 0, hAer = 0, minCom = 99, estado18 = null, twMin = 99, twMax = -99;
    const refeicoesH = [8, 9.5, 11, 12.5, 14, 15.5, 17]; const odRef = {};
    for (let t = t0; t < t0 + DIA; t += passo) {
      const h = horaDe(t), Ta = meio + amp * Math.sin(2 * Math.PI * (h - 9) / 24), rad = radiacaoCeuLimpo(t) * fRad;
      Tw += (Ta - Tw) * (passo / H) / 10;                         // água → média do ar (Rotta et al., 2023)
      if (!aer && od < 4) aer = true; else if (aer && od >= 5 && rad > 150) aer = false;   // Francis-Floyd (2003); Tucker (2005)
      od = clamp(od + dOD(od, Tw, rad, aer) * passo / H, 0, 22); od2 = clamp(od2 + dOD(od2, Tw, rad, false) * passo / H, 0, 22);
      if (aer) hAer += passo / H;
      minCom = Math.min(minCom, od); somaTw += Tw; n++; twMin = Math.min(twMin, Tw); twMax = Math.max(twMax, Tw);
      for (const rh of refeicoesH) if (Math.abs(h - rh) < 0.09) odRef[rh] = od;
      if (Math.abs(h - 18) < 0.09) estado18 = { t, od, Tw };
      horas.push({ t, Ta, Tw, rad, od, odSem: od2, aer: aer ? 1 : 0 });
    }
    // noite seguinte sem aeração, a partir das 18 h (método de projeção noturna de Boyd et al., 1978)
    let semAer = null;
    if (estado18) {
      let o = estado18.od, w = estado18.Tw, min = { od: 99, t: 0 };
      const prox = dias[i + 1] || d, meio2 = (prox.tmax + prox.tmin) / 2, amp2 = (prox.tmax - prox.tmin) / 2;
      for (let t = estado18.t; t < estado18.t + 15 * H; t += passo) {
        const h = horaDe(t), dd = t >= t0 + DIA ? prox : d;
        const Ta = (dd === d ? meio : meio2) + (dd === d ? amp : amp2) * Math.sin(2 * Math.PI * (h - 9) / 24);
        const rad = radiacaoCeuLimpo(t) * fRad;
        w += (Ta - w) * (passo / H) / 10; o = clamp(o + dOD(o, w, rad, false) * passo / H, 0, 22);
        if (o < min.od) min = { od: o, t };
      }
      semAer = min;
    }
    const TwMed = somaTw / n, fT = fatorRacaoGemeo(TwMed);
    const base = N * W * pctTabela(W) / 100 / 1000;
    const sac = apetiteYi(W, TwMed, 6, 0.02, est.alfa) * N / 1000;
    const nRef = refeicoesTabela(W);
    const melhores = Object.entries(odRef).sort((a, b) => b[1] - a[1]).slice(0, nRef);
    const suspensas = melhores.filter(([, o]) => o <= 3).length;
    const racao = Math.min(base * fT, sac) * (1 - suspensas / nRef);
    const ganho = racao > 0 ? ganhoYi(W, TwMed, racao * 1000 / N, est.alfa) : -kCatab(TwMed) * Math.pow(W, YI.n);
    const flags = [];
    const zT = faixaZona('temp', TwMed);
    if (zT.nivel === 'morte') flags.push({ nivel: 'critico', txt: `Água a ${fmtNum(TwMed, 1)} °C: risco de morte por frio.`, refs: ['nobrega2020'] });
    else if (TwMed < 20) flags.push({ nivel: 'critico', txt: `Água a ${fmtNum(TwMed, 1)} °C, abaixo do conforto da tilápia: a alimentação pode parar; ${fT > 0 ? 'ração limitada ao apetite estimado do lote' : 'não alimentar'}.`, refs: ['nobrega2020', 'rotta2023', 'senar2019', 'yi1998'] });
    else if (TwMed < 26) flags.push({ nivel: 'atencao', txt: `Água a ${fmtNum(TwMed, 1)} °C, abaixo da faixa ideal (26 a 30 °C): menos apetite e crescimento; ração da tabela limitada ao apetite estimado do lote.`, refs: ['nobrega2020', 'senar2019', 'yi1998'] });
    else if (TwMed > 32) flags.push({ nivel: 'critico', txt: 'Água acima de 32 °C: não alimentar e vigiar o OD.', refs: ['senar2019', 'boyd2018a'] });
    else if (TwMed >= 30) flags.push({ nivel: 'atencao', txt: 'Água acima da faixa ideal: menos oxigênio dissolvido e mais consumo; ração limitada ao apetite estimado, antes do pico de calor.', refs: ['senar2019', 'nobrega2020', 'boyd2018a'] });
    if (semAer && semAer.od < 4) {
      const zo = faixaZona('od', semAer.od).nivel;
      flags.push({ nivel: zo === 'atencao' ? 'atencao' : 'critico', txt: `Sem aeração, o OD chegaria a ${fmtNum(semAer.od, 1)} mg/L às ${fmtHora(semAer.t)}${zo === 'morte' ? ', com risco de morte' : zo === 'critico' ? ', na zona crítica' : ''}: programar aeração noturna.`, refs: zo === 'morte' ? ['yi1998', 'francis2003', 'boyd1978'] : zo === 'critico' ? ['senar2019', 'francis2003', 'boyd1978'] : ['trandy2008', 'francis2003', 'boyd1978'] });
    }
    if (fRad < 0.5) flags.push({ nivel: 'atencao', txt: `Dia nublado (${Math.round(fRad * 100)}% da radiação de céu limpo): menos fotossíntese e OD mais baixo na noite seguinte.`, refs: ['romaire1979', 'tucker2005', 'boyd2018a'] });
    const ant = dias[i - 1];
    if (ant && (ant.tmax - d.tmax >= 5 || (d.chuva >= 20 && ant.tmax - d.tmax >= 3) || d.vento >= 8)) flags.push({ nivel: 'atencao', txt: 'Frente fria, chuva fria ou vento forte: a água se mistura e o OD e o pH podem cair. Deixar o aerador de prontidão.', refs: ['araujo2017', 'francis2003'], limiar: true });
    if (d.tmax >= 32 && d.vento < 3) flags.push({ nivel: 'info', txt: 'Dia quente e sem vento: a água tende a estratificar; uma frente fria depois pode misturá-la de uma vez.', refs: ['araujo2017'], limiar: true });
    saida.push({ ...d, fRad, TwMed, twMin, twMax, fT, base, racao, sac, suspensas, nRef, semAer, minCom, hAer, ganho, W, flags });
    W = Math.max(1, W + ganho);
  });
  return { dias: saida, horas };
}
const fmtNum = (x, d) => x.toFixed(d).replace('.', ',');

if (typeof module !== 'undefined') module.exports = { ZONAS, faixaZona, nivelZona, consequenciasSemana, ambienteEm, simularPeso, Simulador, CENARIOS, preverOD, ajustarOD, calibrarCrescimento, projetarCrescimento, prescreverRacao, decidirAerador, avaliarAlertas, apetiteYi, ganhoYi, tau, odSat, fracNH3, pctTabela, fatorTemperatura, fatorRacaoGemeo, NORMAIS, fmtHora, fmtData, horaDe, DIA, H, MIN };
