# Monta as páginas a partir de src/: versão local (abre direto do disco) e versão para o Artifact
import pathlib
R = pathlib.Path(__file__).parent; S = R / 'src'
css = (S/'estilo.css').read_text(); js = '\n'.join((S/f).read_text() for f in ['modelo.js','gemeo.js','fontes.js','ui.js'])
js = js.replace("if (typeof module !== 'undefined') module.exports", "if (false) module.exports")
FONTES = '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700&family=Barlow+Semi+Condensed:wght@500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap">'
import re
def svg(nome):
    t = (S/'icones'/(nome + '.svg')).read_text()
    miolo = re.search(r'<svg[^>]*>(.*)</svg>', t, re.S).group(1)
    return '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ' '.join(miolo.split()) + '</svg>'
ICONES = lambda html: re.sub(r'<i class="ic" data-ic="([a-z-]+)"></i>', lambda m: svg(m.group(1)), html)
def corpo(titulo, modo, html):
    html = ICONES(html)
    return (f'<title>{titulo}</title>\n<meta name="claude:viewport-fit-sides" content="cover">\n{FONTES}\n<style>\n{css}\n</style>\n'
            f'{html}\n<script>window.MODO_GEMEO = "{modo}";</script>\n<script>\n{js}\n</script>\n')
def completo(c):
    return ('<!doctype html>\n<html lang="pt-BR">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
            + c.replace('</style>\n', '</style>\n</head>\n<body>\n', 1) + '</body>\n</html>\n')
PV = (S/'previsao-corpo.html').read_text(); FT = (S/'fontes-corpo.html').read_text()
painel = corpo('Gêmeo da Tilápia', 'painel', (S/'painel.html').read_text().replace('<!--CORPO-PREVISAO-->', PV).replace('<!--CORPO-FONTES-->', FT))
sim = corpo('Simulador do Viveiro', 'simulador', (S/'simulador.html').read_text())
for d in ['dist/site', 'dist/artifact']: (R/d).mkdir(parents=True, exist_ok=True)
(R/'dist/site/index.html').write_text(completo(painel)); (R/'dist/site/simulador.html').write_text(completo(sim))
prev = corpo('Previsão de 7 dias', 'previsao', (S/'previsao.html').read_text().replace('<!--CORPO-->', PV))
fontes = corpo('Fontes do Protótipo', 'fontes', (S/'fontes.html').read_text().replace('<!--CORPO-->', FT))
for nome, pag in [('previsao.html', prev), ('fontes.html', fontes)]:
    (R/'dist/site'/nome).write_text(completo(pag)); (R/'dist/artifact'/nome).write_text(completo(pag))
(R/'dist/artifact/index.html').write_text(painel); (R/'dist/artifact/simulador.html').write_text(completo(sim))
import shutil
for f in ['mqtt.min.js', 'qrcode.js']: shutil.copy(R/'vendor'/f, R/'dist/site'/f)
(R/'dist/site/.nojekyll').write_text('')
print('ok', len(painel)//1024, 'KB')
