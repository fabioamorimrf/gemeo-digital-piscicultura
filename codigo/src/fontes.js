/* =====================================================================
   Fontes do projeto: referências e a origem de cada valor usado.
   Status: 'especie' = literatura sobre a tilápia-do-nilo;
           'geral'   = literatura sobre peixes de água quente ou viveiros em geral;
           'derivado'= calculado a partir de valores com fonte;
           'sem'     = escolha ou calibração do protótipo, sem fonte.
   ===================================================================== */
const REFS = {
  senar2019: { c: 'SENAR (2019)', t: 'SENAR. Piscicultura: alimentação. Coleção SENAR 263. Brasília: SENAR, 2019.', esp: true },
  nobrega2020: { c: 'Nobrega et al. (2020)', t: 'NOBREGA, R. O. et al. Improving winter production of Nile tilapia: what can be done? Aquaculture Reports, v. 18, 100453, 2020.', doi: '10.1016/j.aqrep.2020.100453', esp: true },
  rotta2023: { c: 'Rotta et al. (2023)', t: 'ROTTA, M. A. et al. Manejo de inverno para a piscicultura no Sul do Brasil. Porto Alegre: SEAPI/DDPA, 2023.', esp: true },
  trandy2008: { c: 'Tran-Duy et al. (2008)', t: 'TRAN-DUY, A.; SCHRAMA, J. W.; VAN DAM, A. A.; VERRETH, J. A. J. Effects of oxygen concentration and body weight on maximum feed intake, growth and hematological parameters of Nile tilapia, Oreochromis niloticus. Aquaculture, v. 275, n. 1–4, p. 152–162, 2008.', doi: '10.1016/j.aquaculture.2007.12.024', esp: true },
  reboucas2016: { c: 'Rebouças et al. (2016)', t: 'REBOUÇAS, V. T. et al. Reassessment of the suitable range of water pH for culture of Nile tilapia Oreochromis niloticus L. in eutrophic water. Acta Scientiarum. Animal Sciences, v. 38, n. 4, p. 361–368, 2016.', doi: '10.4025/actascianimsci.v38i4.32051', esp: true },
  mustapha2018: { c: 'Mustapha e Atolagbe (2018)', t: 'MUSTAPHA, M. K.; ATOLAGBE, S. D. Tolerance level of different life stages of Nile tilapia Oreochromis niloticus (Linnaeus, 1758) to low pH and acidified waters. The Journal of Basic and Applied Zoology, v. 79, 46, 2018.', doi: '10.1186/s41936-018-0061-3', esp: true },
  elshafai2004: { c: 'El-Shafai et al. (2004)', t: 'EL-SHAFAI, S. A. et al. Chronic ammonia toxicity to duckweed-fed tilapia (Oreochromis niloticus). Aquaculture, v. 232, n. 1–4, p. 117–127, 2004.', esp: true },
  kubitza2026: { c: 'Kubitza (2026)', t: 'KUBITZA, F. Water quality impacts on health and performance of fish and shrimp, Part 3: the nitrogenous compounds ammonia, nitrite and nitrate. Responsible Seafood Advocate, Global Seafood Alliance, 2026.', esp: true },
  yi1998: { c: 'Yi (1998)', t: 'YI, Y. A bioenergetics growth model for Nile tilapia (Oreochromis niloticus) based on limiting nutrients and fish standing crop in fertilized ponds. Aquacultural Engineering, v. 18, n. 3, p. 157–173, 1998.', doi: '10.1016/S0144-8609(98)00028-4', esp: true },
  dampin2012: { c: 'Dampin et al. (2012)', t: 'DAMPIN, N. et al. Fish growth model for Nile tilapia (Oreochromis niloticus) in wastewater oxidation pond, Thailand. Procedia Environmental Sciences, v. 13, p. 513–524, 2012.', doi: '10.1016/j.proenv.2012.01.042', esp: true },
  kimjo1999: { c: 'Kim e Jo (1999)', t: 'KIM, I.-B.; JO, J.-Y. Oxygen consumption in Nile tilapia, Oreochromis niloticus, in relation to body weight and water temperature. Journal of Aquaculture (Coreia), v. 12, n. 3, p. 247–254, 1999.', esp: true },
  francis2003: { c: 'Francis-Floyd (2003)', t: 'FRANCIS-FLOYD, R. Dissolved oxygen for fish production. FA27. University of Florida, IFAS Extension, 2003.', esp: false },
  boyd2018a: { c: 'Boyd (2018a)', t: 'BOYD, C. E. Dissolved oxygen dynamics. Responsible Seafood Advocate, Global Seafood Alliance, 20 ago. 2018.', esp: false },
  boyd2018b: { c: 'Boyd (2018b)', t: 'BOYD, C. E. Constantly changing pH unavoidable, completely normal. Responsible Seafood Advocate, Global Seafood Alliance, 23 jul. 2018.', esp: false },
  tucker2005: { c: 'Tucker (2005)', t: 'TUCKER, C. Pond aeration. SRAC Publication 3700. Southern Regional Aquaculture Center, 2005.', esp: false },
  boyd1978: { c: 'Boyd et al. (1978)', t: 'BOYD, C. E.; ROMAIRE, R. P.; JOHNSTON, E. Predicting early morning dissolved oxygen concentrations in channel catfish ponds. Transactions of the American Fisheries Society, v. 107, n. 3, p. 484–492, 1978.', doi: '10.1577/1548-8659(1978)107<484:PEMDOC>2.0.CO;2', esp: false },
  romaire1979: { c: 'Romaire e Boyd (1979)', t: 'ROMAIRE, R. P.; BOYD, C. E. Effects of solar radiation on the dynamics of dissolved oxygen in channel catfish ponds. Transactions of the American Fisheries Society, v. 108, n. 5, p. 473–478, 1979.', esp: false },
  araujo2017: { c: 'Araújo et al. (2017)', t: 'ARAÚJO, C. A. S. et al. Effects of atmospheric cold fronts on stratification and water quality of a tropical reservoir: implications for aquaculture. Aquaculture Environment Interactions, v. 9, p. 385–403, 2017.', doi: '10.3354/aei00240', esp: false },
  benson1984: { c: 'Benson e Krause (1984)', t: 'BENSON, B. B.; KRAUSE, D. The concentration and isotopic fractionation of oxygen dissolved in freshwater and seawater in equilibrium with the atmosphere. Limnology and Oceanography, v. 29, n. 3, p. 620–632, 1984.', doi: '10.4319/lo.1984.29.3.0620', esp: false },
  emerson1975: { c: 'Emerson et al. (1975)', t: 'EMERSON, K. et al. Aqueous ammonia equilibrium calculations: effect of pH and temperature. Journal of the Fisheries Research Board of Canada, v. 32, p. 2379–2383, 1975.', doi: '10.1139/f75-274', esp: false },
  inmet: { c: 'INMET (A002 Goiânia, 2023–2025)', t: 'INMET – Instituto Nacional de Meteorologia. Banco de Dados Meteorológicos: dados históricos horários da estação automática A002 Goiânia (GO), 01/01/2023 a 31/12/2025 (arquivos anuais 2023, 2024 e 2025). Médias, ciclos horários e desvios calculados pelo protótipo.', url: 'https://portal.inmet.gov.br/dadoshistoricos', esp: false },
  openmeteo: { c: 'Open-Meteo', t: 'OPEN-METEO. Weather Forecast API. Previsão diária para Goiânia (−16,68; −49,25).', url: 'https://open-meteo.com/en/docs', esp: false },
};
const citar = ks => ks.map(k => REFS[k] ? REFS[k].c : k).join('; ');

const ITENS_FONTES = [
  ['Faixas de temperatura da água (ideal 26 a 30 °C; crítica abaixo de 20 e acima de 32; risco de morte até 11)', 'zonas nos gráficos e alertas', ['nobrega2020', 'rotta2023', 'senar2019'], 'especie'],
  ['Faixas de oxigênio dissolvido (ideal 5 ou mais; atenção 3 a 5; crítica 1 a 3; risco de morte abaixo de 1)', 'zonas nos gráficos e alertas', ['trandy2008', 'senar2019', 'yi1998', 'dampin2012'], 'especie'],
  ['Faixas de pH (ideal 5,5 a 9,0; crítica abaixo de 5)', 'zonas nos gráficos e alertas', ['reboucas2016', 'mustapha2018'], 'especie'],
  ['Limite alcalino de pH (crítico a partir de 11)', 'sem dado da espécie', ['boyd2018b'], 'geral'],
  ['Faixas de amônia não ionizada (ideal abaixo de 0,07; crítica a partir de 0,14 mg/L de NH₃-N)', 'zonas nos gráficos e alertas', ['elshafai2004'], 'especie'],
  ['NH₃ até 0,05 mg/L para a tilápia (≈ 0,04 de NH₃-N, dentro da zona ideal)', 'apoio', ['kubitza2026'], 'especie'],
  ['Fração de amônia não ionizada pela temperatura e pelo pH', 'fórmula', ['emerson1975'], 'geral'],
  ['Ração por faixa de peso, refeições por dia e conversão esperada', 'SENAR, Tabela 1', ['senar2019'], 'especie'],
  ['Não alimentar com a água abaixo de 16 °C ou acima de 32 °C', 'SENAR, Tabela 3', ['senar2019'], 'especie'],
  ['Entre 16 e 32 °C, ração da tabela limitada ao apetite do modelo de Yi calibrado pelas biometrias (avaliada no simulador, com lotes comparativos)', 'regra do gêmeo', ['yi1998', 'senar2019'], 'derivado'],
  ['Só alimentar com OD acima de 3 mg/L', 'regra de ração', ['senar2019', 'rotta2023'], 'especie'],
  ['Aerar com OD medido ou previsto abaixo de 4 mg/L', 'regra do gêmeo', ['francis2003'], 'geral'],
  ['Desligar o aerador com OD de 5 mg/L ou mais e sol', 'regra do gêmeo', ['tucker2005', 'francis2003'], 'geral'],
  ['Fallback do ESP32: liga abaixo de 3 mg/L', 'regra local', ['boyd2018a'], 'geral'],
  ['Segurança do ESP32 em 2,5 mg/L e desligar o fallback em 5 mg/L', 'escolha do protótipo', [], 'sem'],
  ['Modelo de crescimento bioenergético e seus parâmetros (Tmin 15, Topt 33, Tmax 41 °C; DOcrit 1,0; UIAcrit 0,06; kmin 0,00133 etc.)', 'Yi, com a tabela de Dampin', ['yi1998', 'dampin2012'], 'especie'],
  ['Eficiência do alimento no modelo (E ≈ 2,70)', 'resolvida para dar CA 1,3 a 200 g e 26,5 °C', ['senar2019', 'yi1998'], 'derivado'],
  ['Fator de calibração α pelas biometrias', 'mínimos quadrados, limitado a 0,7–1,4', ['dampin2012'], 'derivado'],
  ['Consumo de oxigênio dos peixes por peso e temperatura', 'tabela interpolada', ['kimjo1999'], 'especie'],
  ['Estrutura do balanço de oxigênio (fotossíntese, respiração, troca com o ar, aerador) e projeção noturna', 'modelo do viveiro e da previsão', ['boyd1978', 'romaire1979'], 'geral'],
  ['Saturação de oxigênio pela temperatura e pela pressão', 'fórmula', ['benson1984'], 'geral'],
  ['Pressão atmosférica local (930 a 936 hPa conforme o mês, com o ciclo horário)', 'saturação de oxigênio e clima simulado', ['inmet'], 'geral'],
  ['Eficiência do aerador (3,0 kg O₂/kWh) e potência de 0,75 kW (1 cv)', 'kLa ≈ 0,21 por hora', ['tucker2005'], 'derivado'],
  ['Clima mensal de Goiânia (máxima, mínima, média, chuva, dias com chuva, umidade, vento, radiação)', 'médias da estação A002 de 2023 a 2025; tabela na aba Previsão', ['inmet'], 'geral'],
  ['Ciclo de cada hora do dia (temperatura, umidade, vento, pressão) e horário típico da chuva', 'clima simulado hora a hora', ['inmet'], 'geral'],
  ['Variação de um dia para o outro (desvio-padrão por mês e correlação de 0,69 entre dias seguidos)', 'sorteio das ondas de calor e de frio do simulador', ['inmet'], 'derivado'],
  ['Nebulosidade do simulador calibrada pela radiação medida (razão entre a radiação do INMET e a de céu limpo)', 'radiação do clima simulado', ['inmet'], 'derivado'],
  ['Temperatura média diária da água ≈ média do ar', 'aquecimento da água', ['rotta2023'], 'especie'],
  ['Previsão do tempo real de 7 dias', 'máxima, mínima, chuva, radiação e vento', ['openmeteo'], 'geral'],
  ['Frente fria mistura a água e baixa OD e pH', 'consequência na aba Previsão', ['araujo2017'], 'geral'],
  ['Dia nublado reduz o OD da noite seguinte', 'consequência na aba Previsão', ['romaire1979', 'tucker2005', 'boyd2018a'], 'geral'],
  ['Limiares de frente fria (queda de 5 °C na máxima, 20 mm de chuva, vento de 8 m/s) e de estratificação (32 °C e vento abaixo de 3 m/s)', 'limiar do protótipo', [], 'sem'],
  ['Coeficientes do viveiro simulado (fotossíntese 2,3; respiração da água 0,22 mg/L/h; θ 1,036 e 1,07; troca com o ar 0,03 + 0,015·vento)', 'calibração do simulador', [], 'sem'],
  ['Constante de tempo da água (≈ 10 h), duração de 3 h de cada chuva e efeito da chuva no ar (−2,5 °C, +20% de umidade)', 'calibração do simulador', [], 'sem'],
  ['pH e amônia total do viveiro simulado (pH ≈ 7,4 + 0,9·log₂ da saturação de OD)', 'calibração do simulador', [], 'sem'],
  ['Taxas de mortalidade do simulador (os limiares de OD 1,0 mg/L e 11 °C têm fonte)', 'calibração do simulador', ['yi1998', 'nobrega2020'], 'sem'],
  ['Lote de 4.000 peixes em 1.000 m², peso de abate de 800 g, biometria semanal', 'cenário da apresentação', [], 'sem'],
  ['Manejo tradicional de comparação (aerador das 23 h às 6 h, ração às 8 h e às 16 h)', 'cenário da apresentação', [], 'sem'],
];
const STATUS_FONTE = { especie: ['ok', 'Tilápia'], geral: ['info', 'Geral'], derivado: ['warn', 'Derivado'], sem: ['crit', 'Sem fonte'] };
