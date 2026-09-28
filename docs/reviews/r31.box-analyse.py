#!/usr/bin/env python3
"""Fit the captured isolated edge to background/core/casing MSAA coverage.
No image modification. Input is the raw RGB profile captured by r31.extra.spec.ts.
The browser uses four coverage samples: enumerate their three possible colours.
"""
import json
from pathlib import Path

def rgb(hex_colour):
    return [int(hex_colour[i:i+2], 16) for i in (1, 3, 5)]

out = []
for scene in json.loads(Path(__file__).with_name('r31.box-profiles.json').read_text()):
    core, casing = rgb(scene['core']), rgb(scene['casing'])
    bg = scene['samples'][0]['rgb']
    candidates = []
    for c in range(5):
        for s in range(5-c):
            candidate = [(c*core[j]+s*casing[j]+(4-c-s)*bg[j])/4 for j in range(3)]
            candidates.append((c, s, candidate))
    fitted = []
    for sample in scene['samples']:
        c, s, pixel = min(candidates, key=lambda q: sum((a-b)**2 for a,b in zip(q[2], sample['rgb'])))
        error = max(abs(a-b) for a,b in zip(pixel,sample['rgb']))
        fitted.append({'at_css': sample['tCss'], 'core': c/4, 'casing': s/4, 'max_rgb_error': error})
    out.append({'dpr': scene['dpr'], 'theme':scene['theme'],
                'core_css_px':sum(p['core'] for p in fitted)/scene['dpr'],
                'total_css_px':sum(p['core']+p['casing'] for p in fitted)/scene['dpr'],
                'max_rgb_error':max(p['max_rgb_error'] for p in fitted), 'profile':fitted})
print(json.dumps(out, indent=2))
