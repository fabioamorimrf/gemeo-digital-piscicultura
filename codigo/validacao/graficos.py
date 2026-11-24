import json, sys, matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
out = sys.argv[1]
fig, ax = plt.subplots(2, 2, figsize=(11, 7.5), sharex='col')
for c, (pov, tit) in enumerate([('2027-03-01', 'Povoamento em 01/03/2027 (ciclo passa pelo inverno)'), ('2027-09-01', 'Povoamento em 01/09/2027 (ciclo no verão chuvoso)')]):
    r = json.load(open(f'validacao/resultados/serie-{pov}.json'))
    s = r['serie']; d = [p['dia'] for p in s]
    a = ax[0][c]
    a.axvspan(0, 35, color='0.92', lw=0); a.text(17, 640, 'adaptação\n(igual)', ha='center', fontsize=8, color='0.4')
    ft, fg = r['fim']['tabela']['dia'], r['fim']['gemeo']['dia']
    st = [p for p in s if p['dia'] <= ft]; sg = [p for p in s if p['dia'] <= fg]
    a.plot([p['dia'] for p in st], [p['Wtab'] for p in st], color='#c0504d', label='Lote A: tabela fixa')
    a.plot([p['dia'] for p in sg], [p['Wgem'] for p in sg], color='#2e75b6', label='Lote B: gêmeo')
    a.axhline(800, color='0.5', ls=':', lw=1)
    for k, col in (('tabela', '#c0504d'), ('gemeo', '#2e75b6')):
        f = r['fim'][k]; a.plot([f['dia']], [800], 'o', color=col); a.annotate(f"{f['dia']} d", (f['dia'], 800), textcoords='offset points', xytext=(-10, 8 if k == 'tabela' else -16), fontsize=8, color=col)
    a.set_title(tit, fontsize=10); a.set_ylabel('Peso médio (g)'); a.set_ylim(0, 880); a.legend(fontsize=8, loc='lower right')
    t = a.twinx(); t.plot(d, [p['Tw'] for p in s], color='0.6', lw=0.6); t.set_ylim(10, 40); t.set_ylabel('Água (°C)', color='0.5', fontsize=8); t.tick_params(labelsize=7, colors='0.5')
    b = ax[1][c]
    b.plot([p['dia'] for p in st], [p['Rtab'] for p in st], color='#c0504d', label='Lote A: tabela fixa')
    b.plot([p['dia'] for p in sg], [p['Rgem'] for p in sg], color='#2e75b6', label='Lote B: gêmeo')
    b.set_ylabel('Ração acumulada (kg)'); b.set_xlabel('Dias desde o povoamento'); b.legend(fontsize=8, loc='lower right')
    for k, col in (('tabela', '#c0504d'), ('gemeo', '#2e75b6')):
        f = r['fim'][k]; b.annotate(f"{f['racao']:.0f} kg", (f['dia'], f['racao']), textcoords='offset points', xytext=(-60, 4 if k == 'tabela' else -14), fontsize=8, color=col)
fig.suptitle('Tilápia-do-nilo, 4.000 peixes de 30 g até 800 g, mesmo clima (semente 7)', fontsize=11)
fig.tight_layout(); fig.savefig(out, dpi=150)
