"""R29 arithmetic evidence, no product changes or live I/O.

Run: PYTHONDONTWRITEBYTECODE=1 python3 docs/reviews/viewer-palette-fest.r29.probe.py
Uses only the colour formula definitions from Claude's immutable calculation.
The four-colour counterexample is explicit, not an optimisation upper bound.
Writes its own JSON plus a standalone SVG/HTML comparison (no external assets).
"""
import ast
import itertools
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
source = HERE / 'viewer-palette-fest.rechnung.py'
tree = ast.parse(source.read_text())
keep = [n for n in tree.body if isinstance(n, (ast.Import, ast.ImportFrom, ast.FunctionDef))
        or isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id == 'MACHADO' for t in n.targets)]
ns = {}
exec(compile(ast.Module(body=keep, type_ignores=[]), str(source), 'exec'), ns)
hx, lum, contrast, distance, cvd = [ns[k] for k in ('hx', 'lum', 'contrast', 'okd', 'cvd')]
backgrounds = ['#ffffff', '#0b0f14', '#e0e0e0']
four = ['#24906c', '#d800f0', '#cc0000', '#0048fc']

def pair(a, b):
    return {'a': a, 'b': b, 'normal_oklab': distance(hx(a), hx(b)), 'worst_simulated_oklab': cvd(hx(a), hx(b)),
            'luminance_contrast': contrast(hx(a), hx(b))}

result = {
    'head': 'a750216',
    'three_background_luminance_band_at_3': [3 * (lum(hx(backgrounds[1])) + .05) - .05,
                                          (lum(hx(backgrounds[2])) + .05) / 3 - .05],
    'four_colour_counterexample': {
        'colours': four,
        'background_contrast': {c: {bg: contrast(hx(c), hx(bg)) for bg in backgrounds} for c in four},
        'pairs': [pair(a, b) for a, b in itertools.combinations(four, 2)],
        'scope': 'Refutes impossibility of four colours at normal OKLab >= .25; not a CVD-safe recommended palette.',
    },
    'rapid_options': {c: [pair(c, x) for x in ['#395afa', '#9f6700', '#c8102e']]
                      for c in ['#d422e5', '#e118b6']},
    'selection_without_halo': {bg: contrast(hx('#22b8cf'), hx(bg)) for bg in backgrounds},
}
rows = result['four_colour_counterexample']
assert min(v for r in rows['background_contrast'].values() for v in r.values()) >= 3
assert min(r['normal_oklab'] for r in rows['pairs']) >= .25
HERE.joinpath('viewer-palette-fest.r29.probe.json').write_text(json.dumps(result, indent=2) + '\n')

colours = backgrounds + four + ['#395afa', '#d422e5', '#e118b6', '#9f6700', '#c8102e', '#22b8cf', '#6f6f6f']
views = {mode: {c: c if mode == 'normal' else ns['tohex'](ns['sim'](hx(c), mode))
                for c in colours} for mode in ['normal', 'protan', 'deutan', 'tritan']}
html = r'''<!doctype html>
<html lang="de"><meta charset="utf-8"><title>R29 – Linienvergleich</title>
<style>
body{font:16px/1.5 system-ui;margin:24px;color:#17212b;background:#f4f5f7;max-width:1120px}
h1{font-size:24px}h2{font-size:18px;margin-bottom:4px}p{max-width:95ch}
label{display:inline-block;margin:8px 20px 8px 0}select{font:inherit;padding:6px}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(420px,1fr));gap:20px}
section{background:white;padding:12px;border:1px solid #9aa5b1;border-radius:6px}
svg{display:block;width:100%;height:auto;border:1px solid #9aa5b1}
.note{font-size:14px}button{font:inherit;padding:6px} code{font-size:14px}
</style>
<h1>R29: Farben und Verdeckung getrennt betrachten</h1>
<p>Illustration mit synthetischen SVG-Linien, kein Screenshot des Viewers und kein Nachweis für WebGL oder Barrierefreiheit.
Die Striche sind bei 1:1 1 px breit; in den unteren Karten hat die Auswahl 3 px, der F4-Saum insgesamt 7 px.
Vergleiche die parallelen Linien und die Kreuzungen. Eine vollständig verdeckte Linie wird durch keine Palette sichtbar.</p>
<label>Hintergrund <select id="bg"><option value="#ffffff">Hell</option><option value="#0b0f14">Dunkel</option><option value="#e0e0e0">Tisch</option></select></label>
<label>Farbsimulation <select id="vision"><option value="normal">Normal</option><option value="protan">Protanopie</option><option value="deutan">Deuteranopie</option><option value="tritan">Tritanopie</option></select></label>
<label><input id="rapid" type="checkbox" checked> Eilgänge zeigen</label>
<div class="cards">
<section><h2>F2: Purpur-Magenta #d422e5</h2><div id="new"></div><p class="note">Blau: Vorschub · gestrichelt: Eilgang · Ocker: Grenze · Rot: Körper als Farbfläche</p></section>
<section><h2>Gegenentwurf: Magenta #e118b6</h2><div id="old"></div><p class="note">Bessere schlechteste simulierte Distanz zu Blau, geringere zu Rot. F6 trennt Rot als Körperrolle.</p></section>
<section><h2>F4: Auswahl mit 7-px-Gesamtbreite</h2><div id="halo"></div><p class="note">Dichte Nachbarlinien werden vom dunklen Saum verdeckt. Auf Hell ist Cyan durch den Saum besser sichtbar.</p></section>
<section><h2>Nur 3 px Cyan, ohne Saum</h2><div id="plain"></div><p class="note">Zeigt den Zielkonflikt: weniger Verdeckung, aber zu wenig Cyan-Kontrast auf Hell/Tisch. Keine fertige Lösung für beide Hintergründe.</p></section>
</div>
<p><strong>Gegenentwurf für die Sichtprüfung:</strong> Viewer-Grund optional dauerhaft dunkel, unabhängig vom UI-Theme.
Damit bleibt Cyan ohne Saum sichtbar. Der helle Maschinentisch muss dabei weiterhin separat geprüft werden;
ein dunkler Canvas allein behebt diesen Fall nicht.</p>
<p class="note">Farbsimulation: Machado-Matrizen wie in der Projekt-Rechnung, in linearem RGB angewendet.
Abstände und das Vierfarben-Gegenbeispiel stehen in <a href="viewer-palette-fest.r29.probe.json">der JSON-Datei</a>.</p>
<script>
const views=__VIEWS__;
function draw(id,rapid,selected,halo){
 const mode=document.querySelector('#vision').value, b=document.querySelector('#bg').value;
 const c=x=>views[mode][x], show=document.querySelector('#rapid').checked;
 const line=(x1,y1,x2,y2,col,width=1,dash='')=>`<path d="M${x1} ${y1}L${x2} ${y2}" fill="none" stroke="${c(col)}" stroke-width="${width}" ${dash?`stroke-dasharray="${dash}"`:''}/>`;
 let s=`<svg viewBox="0 0 480 240" role="img" aria-label="Parallele und kreuzende Vorschub- und Eilganglinien"><rect width="480" height="240" fill="${c(b)}"/>`;
 s+=`<rect x="342" y="138" width="90" height="60" rx="8" fill="${c('#c8102e')}"/>`;
 for(let y=24;y<118;y+=4){s+=line(24,y,456,y,'#395afa');if(show)s+=line(24,y+2,456,y+2,rapid,1,'8 5');}
 for(let i=0;i<6;i++){s+=line(30+i*10,150,280+i*10,220,'#395afa');if(show)s+=line(30+i*10,220,280+i*10,150,rapid,1,'8 5');}
 s+=line(325,150,448,190,'#9f6700',2);
 if(selected){if(halo)s+=line(24,74,456,74,'#0b0f14',7);s+=line(24,74,456,74,'#22b8cf',3);}
 document.getElementById(id).innerHTML=s+'</svg>';
}
function render(){draw('new','#d422e5',false,false);draw('old','#e118b6',false,false);draw('halo','#d422e5',true,true);draw('plain','#d422e5',true,false);}
document.querySelectorAll('select,input').forEach(x=>x.addEventListener('change',render));render();
</script></html>'''.replace('__VIEWS__', json.dumps(views))
HERE.joinpath('viewer-palette-fest.r29.vergleich.html').write_text(html)
print(json.dumps({'band':result['three_background_luminance_band_at_3'],
                  'four_colours':four, 'min_normal':min(r['normal_oklab'] for r in rows['pairs']),
                  'min_cvd':min(r['worst_simulated_oklab'] for r in rows['pairs']),
                  'selection_no_halo':result['selection_without_halo']}, indent=2))
