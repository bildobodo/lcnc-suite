"""R21: repeatable evaluation with the existing project palette formulas.

Run from any directory; writes only this round's JSON evidence.
This is not a rendered scene test or a WCAG certification.
"""
import json
from pathlib import Path
import runpy
import subprocess

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
p = runpy.run_path(str(HERE / 'operator-punkte.palette.py'))
result = {
    'head': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
    'method': 'Existing project palette formulas and thresholds; not a rendered-image or WCAG certification. LIT = #e0e0e0.',
    'cases': [],
}
variants = [(t, {}) for t in p['THEMES']] + [
    ('dark', {'selection': '#22b8cf'}),
    ('hc-dark', {'selection': '#00e5ff'}),
    ('dark', {'feed': '#008a9c'}),
    ('dark', {'feed': '#22b8cf', 'rapid': '#f5a623', 'backplot': '#ff00ff'}),
]
for theme, changes in variants:
    r = p['roles'](theme, changes)
    result['cases'].append({
        'theme': theme, 'changes': changes,
        'failures': p['check'](theme, changes),
        'contrasts': {k: {
            'background': round(p['contrast'](r[k], r['bg']), 3),
            'lit': round(p['contrast'](r[k], p['LIT']), 3),
        } for k in ['feed', 'rapid', 'backplot', 'selection', 'halo']},
    })
(HERE / 'operator-punkte.r21.palette.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps({f'{c["theme"]}:{c["changes"]}': c['failures'] for c in result['cases']}, indent=2))
