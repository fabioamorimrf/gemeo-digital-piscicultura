#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Servidor local do gêmeo digital do Viveiro 1.

Um único arquivo, só com a biblioteca padrão do Python (3.8 ou mais novo):
  - serve o site (pasta "site" ao lado deste arquivo) em http://<ip>:8000/
  - é um broker MQTT 3.1.1 simples, sem internet:
      * por WebSocket em ws://<ip>:8000/mqtt  (usado pelo site no navegador)
      * por TCP em <ip>:1883                   (para MQTT Explorer, um ESP32 real etc.)

Uso:  python servidor.py            (ou dê dois cliques em iniciar-servidor.bat)
      python servidor.py --porta 8080 --mqtt 1884 --sem-navegador

Limitações (é um broker de demonstração): QoS 0 na entrega (QoS 1 e 2 recebidos
são confirmados), sem autenticação, sem sessões persistentes. Mensagens retidas
e "last will" funcionam.
"""
import argparse, asyncio, base64, hashlib, json, mimetypes, os, socket, struct, sys, webbrowser
from urllib.parse import unquote, urlparse

PASTA = os.path.join(os.path.dirname(os.path.abspath(__file__)), "site")
GUID_WS = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
mimetypes.add_type("text/javascript", ".js")

# ------------------------------------------------------------------ broker MQTT
class Broker:
    def __init__(self):
        self.clientes = set()          # Sessao
        self.retidas = {}              # tópico -> payload (bytes)
        self.total = 0

    @staticmethod
    def casa(filtro, topico):
        f, t = filtro.split("/"), topico.split("/")
        if topico.startswith("$") and f[0] in ("#", "+"):
            return False
        for i, parte in enumerate(f):
            if parte == "#":
                return True
            if i >= len(t):
                return False
            if parte != "+" and parte != t[i]:
                return False
        return len(f) == len(t)

    def publicar(self, topico, payload, reter=False, origem=None):
        self.total += 1
        if reter:
            if payload:
                self.retidas[topico] = payload
            else:
                self.retidas.pop(topico, None)
        pacote = pacote_publish(topico, payload, False)
        for c in list(self.clientes):
            if any(self.casa(f, topico) for f in c.filtros):
                c.enviar(pacote)


def var_int(n):
    out = bytearray()
    while True:
        b = n % 128
        n //= 128
        if n:
            b |= 0x80
        out.append(b)
        if not n:
            return bytes(out)


def str_mqtt(s):
    b = s.encode("utf-8")
    return struct.pack("!H", len(b)) + b


def pacote_publish(topico, payload, reter):
    corpo = str_mqtt(topico) + payload
    return bytes([0x30 | (1 if reter else 0)]) + var_int(len(corpo)) + corpo


class Sessao:
    """Uma conexão MQTT; o transporte (TCP ou WebSocket) entrega bytes em receber()."""

    def __init__(self, broker, enviar_bytes, fechar, nome):
        self.broker, self._enviar, self._fechar, self.nome = broker, enviar_bytes, fechar, nome
        self.buf = bytearray()
        self.filtros = set()
        self.conectado = False
        self.will = None
        self.id = "?"

    def enviar(self, dados):
        try:
            self._enviar(dados)
        except Exception:
            pass

    def receber(self, dados):
        self.buf += dados
        while True:
            if len(self.buf) < 2:
                return
            mult, tam, i = 1, 0, 1
            while True:
                if i >= len(self.buf):
                    return
                b = self.buf[i]
                tam += (b & 0x7F) * mult
                mult *= 128
                i += 1
                if not b & 0x80:
                    break
                if i > 4:
                    raise ValueError("comprimento inválido")
            if len(self.buf) < i + tam:
                return
            cab, corpo = self.buf[0], bytes(self.buf[i:i + tam])
            del self.buf[:i + tam]
            self.pacote(cab >> 4, cab & 0x0F, corpo)

    def pacote(self, tipo, flags, c):
        b = self.broker
        if tipo == 1:  # CONNECT
            n = struct.unpack("!H", c[:2])[0]
            p = 2 + n
            nivel, fl = c[p], c[p + 1]
            p += 4  # nível, flags, keepalive
            if nivel == 5:  # MQTT 5: pula as propriedades
                mult, tam = 1, 0
                while True:
                    x = c[p]; p += 1; tam += (x & 0x7F) * mult; mult *= 128
                    if not x & 0x80: break
                p += tam
            def ler_str():
                nonlocal p
                n = struct.unpack("!H", c[p:p + 2])[0]
                v = c[p + 2:p + 2 + n]
                p += 2 + n
                return v
            self.id = ler_str().decode("utf-8", "replace") or self.nome
            if fl & 0x04:  # last will
                if nivel == 5:
                    mult, tam = 1, 0
                    while True:
                        x = c[p]; p += 1; tam += (x & 0x7F) * mult; mult *= 128
                        if not x & 0x80: break
                    p += tam
                wt = ler_str().decode("utf-8", "replace")
                wp = ler_str()
                self.will = (wt, wp, bool(fl & 0x20))
            self.conectado = True
            b.clientes.add(self)
            self.enviar(bytes([0x20, 3, 0, 0, 0]) if nivel == 5 else bytes([0x20, 2, 0, 0]))
            print(f"  + cliente MQTT {self.id} ({self.nome})")
        elif tipo == 3:  # PUBLISH
            qos, reter = (flags >> 1) & 3, bool(flags & 1)
            n = struct.unpack("!H", c[:2])[0]
            topico = c[2:2 + n].decode("utf-8", "replace")
            p = 2 + n
            pid = None
            if qos:
                pid = c[p:p + 2]
                p += 2
            b.publicar(topico, c[p:], reter, self)
            if qos == 1:
                self.enviar(bytes([0x40, 2]) + pid)
            elif qos == 2:
                self.enviar(bytes([0x50, 2]) + pid)
        elif tipo == 6:  # PUBREL
            self.enviar(bytes([0x70, 2]) + c[:2])
        elif tipo == 8:  # SUBSCRIBE
            pid, p, codigos = c[:2], 2, bytearray()
            while p < len(c):
                n = struct.unpack("!H", c[p:p + 2])[0]
                filtro = c[p + 2:p + 2 + n].decode("utf-8", "replace")
                p += 3 + n
                self.filtros.add(filtro)
                codigos.append(0)
            self.enviar(bytes([0x90]) + var_int(2 + len(codigos)) + pid + bytes(codigos))
            for t, pl in list(b.retidas.items()):
                if any(Broker.casa(f, t) for f in self.filtros):
                    self.enviar(pacote_publish(t, pl, True))
        elif tipo == 10:  # UNSUBSCRIBE
            pid, p = c[:2], 2
            while p < len(c):
                n = struct.unpack("!H", c[p:p + 2])[0]
                self.filtros.discard(c[p + 2:p + 2 + n].decode("utf-8", "replace"))
                p += 2 + n
            self.enviar(bytes([0xB0, 2]) + pid)
        elif tipo == 12:  # PINGREQ
            self.enviar(bytes([0xD0, 0]))
        elif tipo == 14:  # DISCONNECT
            self.will = None
            self._fechar()

    def encerrar(self):
        if self in self.broker.clientes:
            self.broker.clientes.discard(self)
            print(f"  - cliente MQTT {self.id} saiu")
        if self.will:
            t, pl, r = self.will
            self.will = None
            self.broker.publicar(t, pl, r)


# ------------------------------------------------------------------ HTTP + WebSocket
def ips_locais():
    ips = []
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("10.255.255.255", 1))  # não envia nada; só escolhe a interface da rede local
        ips.append(s.getsockname()[0])
        s.close()
    except Exception:
        pass
    try:
        for ip in socket.gethostbyname_ex(socket.gethostname())[2]:
            if ip not in ips and not ip.startswith("127."):
                ips.append(ip)
    except Exception:
        pass
    return ips or ["127.0.0.1"]


async def http(leitor, escritor, broker, porta, porta_mqtt):
    try:
        linhas = []
        while True:
            l = await asyncio.wait_for(leitor.readline(), 30)
            if not l or l in (b"\r\n", b"\n"):
                break
            linhas.append(l.decode("latin-1").rstrip("\r\n"))
        if not linhas:
            escritor.close(); return
        metodo, caminho, _ = (linhas[0].split(" ") + ["", ""])[:3]
        cab = {}
        for l in linhas[1:]:
            if ":" in l:
                k, v = l.split(":", 1)
                cab[k.strip().lower()] = v.strip()
        rota = unquote(urlparse(caminho).path)

        if rota == "/mqtt" and cab.get("upgrade", "").lower() == "websocket":
            await websocket(leitor, escritor, cab, broker)
            return
        if rota == "/api/info":
            corpo = json.dumps({"gemeo": True, "ips": ips_locais(), "porta": porta, "mqtt_tcp": porta_mqtt, "mensagens": broker.total}).encode()
            responder(escritor, 200, "application/json", corpo)
        else:
            if rota.endswith("/"):
                rota += "index.html"
            arq = os.path.normpath(os.path.join(PASTA, rota.lstrip("/")))
            if not arq.startswith(PASTA) or not os.path.isfile(arq):
                responder(escritor, 404, "text/plain; charset=utf-8", "não encontrado".encode())
            else:
                with open(arq, "rb") as f:
                    corpo = f.read()
                tipo = mimetypes.guess_type(arq)[0] or "application/octet-stream"
                if arq.endswith(".html"):  # avisa a página de que ela está no servidor local (liga o MQTT)
                    corpo = corpo.replace(b"<script>window.MODO_GEMEO", b"<script>window.GEMEO_SERVIDOR = true;</script>\n<script>window.MODO_GEMEO", 1)
                if tipo.startswith("text/") or tipo.endswith("javascript"):
                    tipo += "; charset=utf-8"
                responder(escritor, 200, tipo, corpo if metodo != "HEAD" else b"", len(corpo))
        await escritor.drain()
    except Exception:
        pass
    finally:
        try:
            escritor.close()
        except Exception:
            pass


def responder(escritor, status, tipo, corpo, tam=None):
    txt = {200: "OK", 404: "Not Found"}.get(status, "OK")
    escritor.write(f"HTTP/1.1 {status} {txt}\r\nContent-Type: {tipo}\r\nContent-Length: {len(corpo) if tam is None else tam}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n".encode() + corpo)


async def websocket(leitor, escritor, cab, broker):
    chave = cab.get("sec-websocket-key", "")
    aceite = base64.b64encode(hashlib.sha1((chave + GUID_WS).encode()).digest()).decode()
    protos = [p.strip() for p in cab.get("sec-websocket-protocol", "").split(",") if p.strip()]
    linha_proto = f"Sec-WebSocket-Protocol: {'mqtt' if 'mqtt' in protos else protos[0]}\r\n" if protos else ""
    escritor.write(("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                    f"Sec-WebSocket-Accept: {aceite}\r\n{linha_proto}\r\n").encode())
    await escritor.drain()

    def enviar(dados, op=0x2):
        n = len(dados)
        if n < 126:
            h = bytes([0x80 | op, n])
        elif n < 65536:
            h = bytes([0x80 | op, 126]) + struct.pack("!H", n)
        else:
            h = bytes([0x80 | op, 127]) + struct.pack("!Q", n)
        escritor.write(h + dados)

    fechado = False
    def fechar():
        nonlocal fechado
        fechado = True
        try:
            enviar(b"", 0x8); escritor.close()
        except Exception:
            pass

    nome = "websocket " + str(escritor.get_extra_info("peername", ("?",))[0])
    s = Sessao(broker, enviar, fechar, nome)
    try:
        while not fechado:
            h = await leitor.readexactly(2)
            op, mascara, n = h[0] & 0x0F, h[1] & 0x80, h[1] & 0x7F
            if n == 126:
                n = struct.unpack("!H", await leitor.readexactly(2))[0]
            elif n == 127:
                n = struct.unpack("!Q", await leitor.readexactly(8))[0]
            m = await leitor.readexactly(4) if mascara else b"\0\0\0\0"
            dados = bytearray(await leitor.readexactly(n))
            if mascara:
                for i in range(n):
                    dados[i] ^= m[i & 3]
            if op == 0x8:
                break
            if op == 0x9:
                enviar(bytes(dados), 0xA); continue
            if op in (0x0, 0x1, 0x2):
                s.receber(bytes(dados))
            await escritor.drain()
    except (asyncio.IncompleteReadError, ConnectionError, ValueError, IndexError, struct.error):
        pass
    finally:
        s.encerrar()
        try:
            escritor.close()
        except Exception:
            pass


async def mqtt_tcp(leitor, escritor, broker):
    def fechar():
        try:
            escritor.close()
        except Exception:
            pass
    nome = "tcp " + str(escritor.get_extra_info("peername", ("?",))[0])
    s = Sessao(broker, escritor.write, fechar, nome)
    try:
        while True:
            d = await leitor.read(65536)
            if not d:
                break
            s.receber(d)
            await escritor.drain()
    except (ConnectionError, ValueError, IndexError, struct.error):
        pass
    finally:
        s.encerrar()
        fechar()


async def principal(args):
    broker = Broker()
    srv = await asyncio.start_server(lambda r, w: http(r, w, broker, args.porta, args.mqtt), "0.0.0.0", args.porta)
    tcp = None
    if args.mqtt:
        try:
            tcp = await asyncio.start_server(lambda r, w: mqtt_tcp(r, w, broker), "0.0.0.0", args.mqtt)
        except OSError:
            print(f"  (porta MQTT {args.mqtt} ocupada; seguindo só com o WebSocket)")
    ip = ips_locais()[0]
    print("\n  Gêmeo digital do Viveiro 1 — servidor local\n")
    print(f"  Computador (painel):  http://localhost:{args.porta}/")
    print(f"  Celular (simulador):  http://{ip}:{args.porta}/simulador.html")
    print(f"  Broker MQTT:          ws://{ip}:{args.porta}/mqtt" + (f"  e  {ip}:{args.mqtt} (TCP)" if tcp else ""))
    print("\n  O celular precisa estar na mesma rede Wi-Fi que este computador.")
    print("  Para parar, feche esta janela ou aperte Ctrl+C.\n")
    if not args.sem_navegador:
        try:
            webbrowser.open(f"http://localhost:{args.porta}/")
        except Exception:
            pass
    await srv.serve_forever()


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="Site + broker MQTT local do gêmeo digital")
    ap.add_argument("--porta", type=int, default=8000)
    ap.add_argument("--mqtt", type=int, default=1883, help="porta MQTT TCP (0 desliga)")
    ap.add_argument("--sem-navegador", action="store_true")
    a = ap.parse_args()
    if not os.path.isdir(PASTA):
        print(f"Não achei a pasta do site em {PASTA}. Deixe servidor.py ao lado da pasta 'site'.")
        sys.exit(1)
    try:
        asyncio.run(principal(a))
    except KeyboardInterrupt:
        print("\n  Servidor encerrado.")
