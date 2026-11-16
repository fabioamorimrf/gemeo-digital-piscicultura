# ESP32 do Viveiro 1 no Wokwi

Projeto do ESP32 que, no gêmeo digital, fica no viveiro: lê os sensores, classifica as leituras nas zonas da tilápia, controla o aerador e mostra tudo no display.

## Como abrir no Wokwi

1. Entre em https://wokwi.com, clique em **New Project** e escolha **ESP32**.
2. Na aba `sketch.ino`, apague o conteúdo e cole o deste arquivo.
3. Na aba `diagram.json`, apague o conteúdo e cole o deste arquivo. O circuito aparece montado.
4. Crie um arquivo `libraries.txt` (seta ao lado das abas → **New file**) e cole o conteúdo deste.
5. Clique em ▶ para simular.

Se o Wokwi acusar `extended character is not valid in an identifier`, a cópia trouxe espaços invisíveis (espaço não separável). Baixe o arquivo e copie do editor de texto, em vez de copiar da pré-visualização.

## O que tem no circuito

| Peça | Papel | Pino |
|---|---|---|
| DS18B20 | temperatura da água | 4 |
| DHT22 | temperatura e umidade do ar | 15 |
| Potenciômetro 1 | oxigênio dissolvido (0 a 12 mg/L) | 34 |
| Potenciômetro 2 | pH (4 a 10) | 35 |
| Potenciômetro 3 | amônia total, NAT (0 a 3 mg/L) | 32 |
| LDR | radiação solar estimada | 33 |
| Display OLED | leituras, zonas e situação da ração | 21 (SDA), 22 (SCL) |
| Relé + LED azul | aerador | 26 e 27 |
| LEDs verde, amarelo e vermelho | pior zona entre as leituras (ideal, atenção, crítica) | 25, 14, 13 |
| Botão | troca a tela do display | 18 |

O Wokwi não tem sondas de OD, pH e amônia, por isso elas são potenciômetros. Clique numa peça durante a simulação para mexer no valor (temperatura do DS18B20 e do DHT22, luz do LDR).

## Regras (as mesmas do site)

- Zonas da tilápia: temperatura ideal de 26 a 30 °C; OD ideal de 5 mg/L ou mais, crítico abaixo de 3; pH ideal de 5,5 a 9,0; NH₃-N ideal abaixo de 0,07 mg/L. As fontes estão no início do `sketch.ino` e na página Fontes do site.
- Aerador sem o gêmeo (fallback local): liga com OD abaixo de 3 mg/L (Boyd, 2018a) e desliga com 5 mg/L ou mais (Tucker, 2005).
- Segurança: abaixo de 2,5 mg/L liga em qualquer modo (escolha do protótipo).
- Ração (tela 2 do display): só alimentar com OD acima de 3 mg/L (SENAR, 2019; Rotta et al., 2023), com o fator de temperatura da Tabela 3 do SENAR.
- A amônia tóxica é calculada pela fórmula de Emerson et al. (1975).
- A radiação vem da fórmula de lux do LDR na documentação do Wokwi, convertida por cerca de 120 lux por W/m². É uma aproximação, sem fonte.

## Roteiro rápido

1. Gire o potenciômetro do OD para baixo. Abaixo de 3 mg/L, o relé e o LED azul ligam e o LED vermelho acende. Acima de 5, o aerador desliga.
2. Mude a temperatura do DS18B20 para 18 °C. A água entra na zona crítica, e a tela 2 mostra a ração com fator de 60%.
3. Suba o pH e a amônia total. A amônia tóxica sobe e passa de 0,07 mg/L (atenção).
4. No monitor serial, digite `ligar`, `desligar`, `auto` ou `status`. Cada leitura também sai em uma linha JSON.

## MQTT (opcional)

O ESP32 funciona sozinho, sem rede: `#define USAR_MQTT 0` (padrão).
Com `#define USAR_MQTT 1`, ele se conecta à rede `Wokwi-GUEST` e ao broker definido em `MQTT_BROKER` (padrão `broker.hivemq.com`, porta 1883). Ele publica em `gemeo/viveiro1/agua/...`, `clima/...` e `atuador/...`, e recebe `gemeo/viveiro1/comando/aerador` (`LIGAR`, `DESLIGAR` ou `AUTO`).
Sem comando do gêmeo por 60 s, o ESP32 volta ao fallback local. Enquanto o broker estiver fora, ele guarda até 30 leituras e as envia em `gemeo/viveiro1/historico` quando volta.

O site de apresentação não fala MQTT (as abas conversam pelo navegador). Então, com o MQTT ligado, as mensagens aparecem num cliente MQTT, por exemplo o HiveMQ Web Client, e não no painel do site.
