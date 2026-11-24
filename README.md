# Gêmeo digital do Viveiro 1 (tilápia-do-nilo, Goiânia)

Site sem servidor para apresentar o gêmeo digital. Painel, Previsão 7 dias e Fontes são abas da mesma página; o simulador abre em outra aba:

- **Painel** (`site/index.html`): o gêmeo. Leituras ao vivo, previsão de oxigênio dissolvido (OD) para 12 h, ração do dia, comando do aerador, crescimento do lote, pH, amônia e alertas. Os gráficos e os blocos de leitura têm as zonas ideal, atenção e crítica da tilápia sombreadas.
- **Previsão 7 dias** (`site/previsao.html`): o tempo dos próximos 7 dias em Goiânia e as consequências para o viveiro (água estimada, OD de cada noite com e sem aeração, horas de aerador, ração e crescimento), cada uma com a fonte.
- **Simulador** (`site/simulador.html`): a contraparte física virtual, onde se mexe nos sensores e no clima durante a apresentação.
- **Fontes** (`site/fontes.html`): a origem de cada faixa, regra, fórmula e parâmetro, com a referência e o tipo de fonte (tilápia, geral, derivado ou sem fonte).

## Como abrir

1. Abra `site/index.html` no Chrome ou no Edge (duplo clique funciona).
2. Clique em **Abrir o simulador**. A simulação passa para a nova aba sem perder o estado.
3. Deixe o painel no projetor e o simulador no notebook (arraste a aba para outra janela).
4. Pelo menu, abra **Previsão 7 dias** e **Fontes** quando for falar delas.

Se abrir só o painel, ele roda a simulação sozinho (**Controles aqui** abre os controles numa gaveta lateral). O botão de sol e lua no canto de cima troca entre tema claro e escuro.

**Previsão 7 dias:** no arquivo local, a página busca a previsão real do Open-Meteo para Goiânia (precisa de internet). O botão **Clima simulado** troca para o clima do simulador aberto, que acompanha os cenários e os dias simulados. Sem internet, ou na versão publicada (que bloqueia sites externos), a página avisa e usa o clima simulado sozinha.

Versão publicada: https://claude.ai/artifact/WNrph3FsMBnePVup81PJMP (privada; compartilhe pelo menu Share se o grupo precisar).

## Roteiro sugerido para a apresentação (6 a 9 min)

1. **Estado normal** (5 min/s): leituras com as zonas da tilápia, OD previsto sem aeração (vermelho) e com o plano do gêmeo (verde), ração do dia.
2. **Colapso das algas** (15 min/s): o OD previsto despenca à noite; o gêmeo liga o aerador antes de sair da zona de atenção.
3. **Onda de frio** (1 h/s): a água sai da faixa ideal (26 a 30 °C), a ração do gêmeo cai junto com o apetite estimado dos peixes e o simulador mostra o desperdício do manejo tradicional.
4. **Previsão 7 dias**: mostrar as noites de risco sem aeração, os dias nublados e a frente fria, cada consequência com a fonte entre parênteses.
5. **Queda de internet**: o painel fica offline; o ESP32 liga o aerador sozinho abaixo de 3 mg/L.
6. **Sonda de OD descalibrada**: o gêmeo compara a leitura com o modelo e acusa "leitura fora do esperado".
7. **Fontes**: fechar mostrando que cada valor tem referência, e quais são escolhas da simulação.

## Zonas de qualidade da água (tilápia-do-nilo)

| Parâmetro | Ideal | Atenção | Crítica | Fontes |
|---|---|---|---|---|
| Temperatura (°C) | 26–30 | 20–26 e 30–32 | 11–20 e acima de 32 (risco de morte até 11) | Nobrega et al. 2020; Rotta et al. 2023; SENAR 2019 |
| OD (mg/L) | 5 ou mais | 3–5 | 1–3 (risco de morte abaixo de 1) | Tran-Duy et al. 2008; SENAR 2019; Yi 1998 |
| pH | 5,5–9,0 | 5,0–5,5 e 9–11 | abaixo de 5 (e 11 ou mais, dado geral) | Rebouças et al. 2016; Mustapha e Atolagbe 2018; Boyd 2018b |
| NH₃-N (mg/L) | abaixo de 0,07 | 0,07–0,14 | 0,14 ou mais | El-Shafai et al. 2004 |

A amônia aparece como NH₃-N (nitrogênio da amônia não ionizada). Em mg/L de NH₃, multiplique por 1,216.

## O que está por trás

| Parte | O que faz | Base |
|---|---|---|
| Clima | Médias da estação automática A002 Goiânia do INMET (dados horários de 2023 a 2025): máxima, mínima, chuva, dias com chuva, umidade, vento, radiação e pressão por mês, ciclo médio de cada hora, horário típico da chuva e variação de um dia para o outro | INMET |
| Viveiro | Água segue a média do ar; balanço de O₂ (fotossíntese, respiração, troca com o ar, aerador); pH, amônia, mortalidade | Rotta 2023; Boyd 1978; Romaire e Boyd 1979; Kim e Jo 1999; Benson e Krause 1984; Emerson 1975 |
| Previsão de OD (híbrida) | Balanço de O₂ com 4 parâmetros reestimados nas últimas 24 h | Boyd 1978; Romaire e Boyd 1979 |
| Crescimento | Modelo de Yi com α calibrado pelas biometrias | Yi 1998; Dampin 2012 |
| Ração | Tabela por peso limitada ao apetite do modelo de Yi calibrado; não alimentar abaixo de 16 °C, acima de 32 °C nem com OD de 3 mg/L ou menos (regra calibrada no experimento de lotes comparativos, `codigo/validacao/`) | SENAR 2019; Rotta 2023; Yi 1998 |
| Aeração | Liga com OD medido ou previsto abaixo de 4; desliga com 5 ou mais e sol | Francis-Floyd 2003; Tucker 2005 |
| Previsão 7 dias | Open-Meteo (ou clima simulado) passado pelos mesmos modelos | Open-Meteo; Araújo 2017 para frente fria |

A lista completa, com 34 itens e o tipo de fonte de cada um, está na página **Fontes**. Itens sem fonte (coeficientes do viveiro simulado, limiares de frente fria, tamanho do lote etc.) estão marcados como escolhas do protótipo.

## Referências

- ARAÚJO, C. A. S. et al. Effects of atmospheric cold fronts on stratification and water quality of a tropical reservoir: implications for aquaculture. Aquaculture Environment Interactions, v. 9, p. 385–403, 2017. DOI 10.3354/aei00240.
- BENSON, B. B.; KRAUSE, D. The concentration and isotopic fractionation of oxygen dissolved in freshwater and seawater in equilibrium with the atmosphere. Limnology and Oceanography, v. 29, n. 3, p. 620–632, 1984.
- BOYD, C. E. Dissolved oxygen dynamics. Responsible Seafood Advocate, Global Seafood Alliance, 2018a.
- BOYD, C. E. Constantly changing pH unavoidable, completely normal. Responsible Seafood Advocate, Global Seafood Alliance, 2018b.
- BOYD, C. E.; ROMAIRE, R. P.; JOHNSTON, E. Predicting early morning dissolved oxygen concentrations in channel catfish ponds. Transactions of the American Fisheries Society, v. 107, n. 3, p. 484–492, 1978.
- DAMPIN, N. et al. Fish growth model for Nile tilapia (Oreochromis niloticus) in wastewater oxidation pond, Thailand. Procedia Environmental Sciences, v. 13, p. 513–524, 2012. DOI 10.1016/j.proenv.2012.01.042.
- EL-SHAFAI, S. A. et al. Chronic ammonia toxicity to duckweed-fed tilapia (Oreochromis niloticus). Aquaculture, v. 232, p. 117–127, 2004.
- EMERSON, K. et al. Aqueous ammonia equilibrium calculations: effect of pH and temperature. Journal of the Fisheries Research Board of Canada, v. 32, p. 2379–2383, 1975.
- FRANCIS-FLOYD, R. Dissolved oxygen for fish production. FA27. University of Florida, IFAS Extension, 2003.
- INMET. Banco de Dados Meteorológicos: dados horários da estação automática A002 Goiânia (GO), 2023 a 2025. https://portal.inmet.gov.br/dadoshistoricos
- KIM, I.-B.; JO, J.-Y. Oxygen consumption in Nile tilapia, Oreochromis niloticus, in relation to body weight and water temperature. Journal of Aquaculture (Coreia), v. 12, n. 3, p. 247–254, 1999.
- KUBITZA, F. Water quality impacts on health and performance of fish and shrimp, Part 3: the nitrogenous compounds. Responsible Seafood Advocate, Global Seafood Alliance, 2026.
- MUSTAPHA, M. K.; ATOLAGBE, S. D. Tolerance level of different life stages of Nile tilapia to low pH and acidified waters. The Journal of Basic and Applied Zoology, v. 79, 46, 2018. DOI 10.1186/s41936-018-0061-3.
- NOBREGA, R. O. et al. Improving winter production of Nile tilapia: what can be done? Aquaculture Reports, v. 18, 100453, 2020.
- OPEN-METEO. Weather Forecast API. https://open-meteo.com
- REBOUÇAS, V. T. et al. Reassessment of the suitable range of water pH for culture of Nile tilapia in eutrophic water. Acta Scientiarum. Animal Sciences, v. 38, n. 4, p. 361–368, 2016.
- ROMAIRE, R. P.; BOYD, C. E. Effects of solar radiation on the dynamics of dissolved oxygen in channel catfish ponds. Transactions of the American Fisheries Society, v. 108, n. 5, p. 473–478, 1979.
- ROTTA, M. A. et al. Manejo de inverno para a piscicultura no Sul do Brasil. Porto Alegre: SEAPI/DDPA, 2023.
- SENAR. Piscicultura: alimentação. Coleção SENAR 263. Brasília: SENAR, 2019.
- TRAN-DUY, A. et al. Effects of oxygen concentration and body weight on maximum feed intake, growth and hematological parameters of Nile tilapia. Aquaculture, v. 275, p. 152–162, 2008.
- TUCKER, C. Pond aeration. SRAC Publication 3700, 2005.
- YI, Y. A bioenergetics growth model for Nile tilapia based on limiting nutrients and fish standing crop in fertilized ponds. Aquacultural Engineering, v. 18, n. 3, p. 157–173, 1998.

Todos os dados do viveiro são simulados. O viveiro "real" usa α = 1,08 de propósito, para o gêmeo ter algo a calibrar.

## Controlar a simulação pelo celular (site hospedado + broker MQTT público)

O computador mostra o painel no projetor e o celular controla a simulação. Os dois trocam mensagens por brokers MQTT públicos, sem conta. Com o campo do broker em branco (automático), cada aparelho conecta ao mesmo tempo em quatro: Eclipse (`wss://mqtt.eclipseprojects.io:443/mqtt`, na porta 443, que passa por redes que bloqueiam as outras), HiveMQ (`wss://broker.hivemq.com:8884/mqtt`), EMQX (`wss://broker.emqx.io:8084/mqtt`) e Mosquitto (`wss://test.mosquitto.org:8081/mqtt`), e publica em todos; as mensagens repetidas são descartadas. Basta um deles funcionar nos dois aparelhos. O HiveMQ público às vezes não responde ("connack timeout"), e por isso existe essa redundância. Se nenhum conectar, a rede do computador provavelmente bloqueia essas conexões: ligue o computador no roteador do celular e gere um QR novo. Cada apresentação usa um código de sala aleatório nos tópicos (`gemeo/viveiro1/<sala>/...`), para ninguém interferir. Os dados são simulados; quem souber o código da sala consegue ver as mensagens.

**Site publicado:** https://fabioamorimrf.github.io/gemeo-digital-piscicultura/ (repositório `fabioamorimrf/gemeo-digital-piscicultura`, GitHub Pages na branch `main`, pasta raiz).

**No dia**
1. No computador, abra o endereço do GitHub Pages e clique em **Controlar pelo celular → Conectar e gerar o QR code**.
2. Leia o QR com a câmera do celular. O simulador abre no celular já na mesma sala e vira um controle remoto: a simulação continua rodando só no painel do computador, o celular manda cada ajuste para o painel e mostra o estado que o painel devolve. Se o celular abrir antes do painel, ele espera o painel aparecer.
   Feche abas antigas do simulador no celular antes de começar.
3. Os dois aparelhos precisam de internet, mas não precisam estar na mesma rede.

Para trocar de sala, use **Desconectar e trocar de sala**. Se for usar um broker com senha, preencha usuário e senha em "Usuário e senha". Crie uma credencial só para a demo, porque ela vai no QR code e fica visível no navegador.

A versão publicada no Claude não consegue se conectar a sites externos, então o controle pelo celular só funciona no GitHub Pages (ou pelo `servidor.py`, abaixo).

## Plano B sem internet: servidor local (`servidor.py`)

Com o `servidor.py`, o computador roda o site e um broker MQTT só para a apresentação. O celular vira o controle remoto da simulação.

**No Windows, uma vez só:** instale o Python 3 em https://www.python.org/downloads/ e marque **Add python.exe to PATH** na instalação. Não precisa instalar mais nada.

**No dia:**
1. Ligue o computador e o celular na mesma rede Wi-Fi. Se a rede da sala bloquear (algumas redes da universidade isolam os aparelhos), ligue o roteador do celular e conecte o computador nele. Não precisa de dados móveis: a conexão fica só entre os dois.
2. Dê dois cliques em `iniciar-servidor.bat`. Na primeira vez o Windows pergunta se libera o Python na rede: marque **Redes privadas** e clique em **Permitir**.
3. O painel abre no navegador do computador. Clique em **Controlar pelo celular** e leia o QR code com a câmera do celular.
4. O simulador abre no celular como controle remoto; a simulação continua no computador. O painel no projetor mostra "Simulador via MQTT local".
5. Ao terminar, feche a janela preta do servidor.

As telas conversam por MQTT de verdade: a porta 8000 serve o site e o MQTT por WebSocket, e a porta 1883 o MQTT por TCP. O simulador publica as leituras nos tópicos do contrato (`gemeo/viveiro1/agua/od`, `clima/...`, `atuador/...`), e os comandos do painel vão para `gemeo/viveiro1/comando/aerador`. Para mostrar as mensagens passando, conecte o MQTT Explorer em `localhost:1883`.

Se o QR não abrir no celular, confira se ele está na mesma rede, ou digite o endereço que aparece embaixo do QR e na janela do servidor. Sem o servidor, o site funciona como antes, com as abas no mesmo computador.

## ESP32 no Wokwi

A pasta `wokwi/` tem o ESP32 do viveiro para simular no Wokwi: `sketch.ino`, `diagram.json` e `libraries.txt`.
- Sensores: DS18B20 (água), DHT22 (ar), LDR (sol) e potenciômetros no lugar das sondas de OD, pH e amônia.
- Saídas: relé do aerador, LEDs de zona e display OLED.
- Usa as mesmas zonas e regras do site. Funciona sem rede, e o MQTT é opcional (`USAR_MQTT`).

O passo a passo está em `wokwi/LEIAME-wokwi.md`.

## Para editar

O código fica em `codigo/src/` (`fontes.js` guarda as referências e a tabela da página Fontes; `ZONAS` em `modelo.js` guarda as faixas da tilápia). Depois de mudar, rode `python3 build.py` dentro de `codigo/`.
`node test/run.js verao 6` roda 6 dias simulados sem navegador (cenários: `verao`, `inverno`, `seca`).
