"""R30: deterministic checks of Fassung 2, without running the random search.
Run: PYTHONDONTWRITEBYTECODE=1 python3 docs/reviews/viewer-palette-fest.r30.probe.py
Reads only formula definitions and the literal F2 colours from the reviewed calculation.
No browser, network, live machine commands or product edits.
"""
import argparse
import ast
import itertools
import json
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('--source-root', type=Path, default=Path(__file__).resolve().parents[2])
parser.add_argument('--output-dir', type=Path, default=Path(__file__).resolve().parent)
args = parser.parse_args()
p = args.source_root / 'docs/reviews/viewer-palette-fest.rechnung.py'
tree = ast.parse(p.read_text())
ns = {}
keep = [n for n in tree.body if isinstance(n, (ast.Import, ast.ImportFrom, ast.FunctionDef))
        or isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id in
            {'MACHADO', 'F2', 'COLL'} for t in n.targets)]
exec(compile(ast.Module(body=keep, type_ignores=[]), str(p), 'exec'), ns)
hexrgb, contrast, normal, cvd = [ns[n] for n in ('hx', 'contrast', 'okd', 'cvd')]
colours = ns['F2']
backgrounds = ['#ffffff', '#0b0f14', '#e0e0e0']
background_checks = {role: {bg: contrast(hexrgb(value), hexrgb(bg)) for bg in backgrounds}
                     for role, value in colours.items()}
pairs = []
for a, b in itertools.combinations(colours, 2):
    x, y = hexrgb(colours[a]), hexrgb(colours[b])
    n, c = normal(x, y), cvd(x, y)
    pairs.append({'a': a, 'b': b, 'normal': n, 'cvd': c,
                  'normal_at_least_025': n >= .25, 'cvd_at_least_012': c >= .12,
                  'declared_dash_exception': c < .12 and 'rapid' in (a, b)})
coll = hexrgb(ns['COLL'])
collision_pairs = {r: {'normal': normal(hexrgb(c), coll), 'cvd': cvd(hexrgb(c), coll)}
                   for r, c in colours.items()}
core, casing = hexrgb('#b8bec6'), hexrgb('#3a3f45')
box = {'core_on_casing': contrast(core, casing),
       'core_on_dark': contrast(core, hexrgb('#0b0f14')),
       'casing_on_white': contrast(casing, hexrgb('#ffffff')),
       'casing_on_table': contrast(casing, hexrgb('#e0e0e0'))}
assert min(v for c in background_checks.values() for v in c.values()) >= 3
assert all(r['normal_at_least_025'] and (r['cvd_at_least_012'] or r['declared_dash_exception']) for r in pairs)
assert all(v >= 3 for v in box.values())
result = {'head': 'af2468b', 'scope': 'Arithmetic only; no perceptual or rendered-scene proof',
          'colours': colours, 'background_contrasts': background_checks,
          'line_pairs': pairs, 'collision_pairs': collision_pairs, 'box_contrasts': box,
          'policy': 'Normal >= .25; CVD >= .12 except declared rapid/feed dash limitation',
          'pass': True}
args.output_dir.joinpath('viewer-palette-fest.r30.probe.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(result, indent=2))
