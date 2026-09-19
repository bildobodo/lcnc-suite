#!/usr/bin/env python3
"""Rebuild the bundled examples from the native geometry regression references.

No CAD application, machine connection or network is needed. Geometry remains
unchanged; only names, tool numbers and identities are assigned to the examples.
"""
import copy
import json
from pathlib import Path
import uuid

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'lcnc-webui/public/examples/tools/fusion-freecad.json'
FUSION = [
    ('fusion-tool-contours.json', 'bare-flat-end-mill', 'Flat end mill - 12 mm'),
    ('fusion-tool-contours.json', 'bare-ball-end-mill', 'Ball end mill - 8 mm'),
    ('fusion-tool-contours.json', 'bare-bull-nose-end-mill', 'Bullnose - 10 mm, R1'),
    ('fusion-tool-contours.json', 'bare-drill', 'Micro drill - 0.35 mm'),
    ('fusion-tool-contours.json', 'bare-spot-drill', 'Spot drill'),
    ('fusion-tool-specials.json', 'center-base', 'Center drill'),
    ('fusion-tool-contours.json', 'bare-counter-sink', 'Countersink - 90 deg'),
    ('fusion-tool-chamfers-slots.json', 'chamfer-small-tip', 'Chamfer mill - small tip'),
    ('fusion-tool-followup.json', 'fu-corner-chamfer-end-mill', 'Corner chamfer end mill'),
    ('fusion-tool-specials.json', 'dovetail-radius05-angle60', 'Dovetail - rounded edge'),
    ('fusion-tool-followup.json', 'fu-face-angle45-r2', 'Face mill - 45 deg, R2'),
    ('fusion-tool-contours.json', 'bare-lollipop-mill', 'Lollipop - 12 mm'),
    ('fusion-tool-chamfers-slots.json', 'slot-full-round', 'Slot mill - full round'),
    ('fusion-tool-contours.json', 'bare-radius-mill', 'Corner rounding mill'),
    ('fusion-tool-tapers-threads.json', 'taper-ball-r2-ta12', 'Tapered ballnose - R2'),
    ('fusion-tool-contours.json', 'bare-tapered-mill', 'Tapered bullnose'),
    ('fusion-tool-tapers-threads.json', 'thread-flat-three', 'Thread mill - 3 flat crests'),
    ('fusion-tool-tapers-threads.json', 'thread-round-three', 'Thread mill - 3 round crests'),
    ('fusion-tool-followup.json', 'fu-tap-right-hand', 'Right-hand tap'),
    ('fusion-tool-form-offsets.json', 'form-offset-zero', 'Form mill - multi-lobe profile'),
    ('fusion-tool-followup.json', 'fu-block-drill-angle118', 'Block drill'),
]
FREECAD = [
    ('endmill', 'Flat end mill - 5 mm'), ('ballend', 'Ball end mill - 5 mm'),
    ('bullnose', 'Bullnose - 5 mm, R1.5'), ('drill', 'Drill - 3 mm'),
    ('reamer', 'Reamer - 5 mm'), ('tap', 'Tap - 8 mm'),
    ('chamfer', 'Chamfer mill'), ('v-bit', 'V-bit - 90 deg'),
    ('dovetail', 'Dovetail - 20 mm'), ('radius', 'Radius mill'),
    ('slittingsaw', 'Slitting saw - 100 mm'), ('probe', 'Ball probe - 6 mm'),
    ('taperedballnose', 'Tapered ballnose'), ('thread-mill', 'Single-tooth thread mill'),
]


def read(path):
    with path.open(encoding='utf-8') as f:
        return json.load(f)


def identity(source, key):
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f'https://github.com/bildobodo/lcnc-suite/examples/tools/v1/{source}/{key}'))


def build():
    entries = []
    for number, (filename, case_id, name) in enumerate(FUSION, 1001):
        case = next(c for c in read(ROOT / 'test-fixtures' / filename)['cases'] if c['id'] == case_id)
        # Do not ship captured machining presets, holders, vendor data or source
        # library identities. Preserve every field that defines the tested body.
        raw = {k: copy.deepcopy(case['raw'][k]) for k in ('type', 'unit', 'geometry', 'shaft', 'tapered-type')
               if k in case['raw']}
        raw.update(description=f'Example / Fusion / {name}', guid=identity('fusion360', case_id),
                   **{'post-process': {'number': number}})
        entries.append({'source': 'fusion360', 'data': raw,
                        'reference': f'test-fixtures/{filename}#{case_id}'})
    cases = read(ROOT / 'test-fixtures/freecad/native-profiles.json')['cases']
    for number, (shape, name) in enumerate(FREECAD, 2001):
        raw = copy.deepcopy(next(c['bit'] for c in cases if c['bit']['name'] == shape + ' 1'))
        raw.update(name=f'Example / FreeCAD / {name}', id=identity('freecad', shape))
        entries.append({'source': 'freecad', 'data': {'nr': number, 'id': raw['id'], 'bit': raw},
                        'reference': f'test-fixtures/freecad/native-profiles.json#{shape} 1'})
    custom = copy.deepcopy(read(ROOT / 'test-fixtures/freecad/custom-native.json')['tools'][0])
    custom.update(nr=2015, id=identity('freecad', 'custom-bore'))
    custom['bit'].update(id=custom['id'], name='Example / FreeCAD / Custom body with axial bore')
    entries.append({'source': 'freecad', 'data': custom, 'reference': 'test-fixtures/freecad/custom-native.json'})
    return {'format': 'lcnc-tool-library', 'version': 1, 'is_example': True,
            'name': 'Fusion 360 and FreeCAD example tools',
            'description': 'Geometry examples without holders or cutting presets. New table offsets start at zero.',
            'tools': entries}


if __name__ == '__main__':
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with OUTPUT.open('w', encoding='utf-8') as f:
        json.dump(build(), f, ensure_ascii=False, allow_nan=False, separators=(',', ':'))
        f.write('\n')
    print(f'{OUTPUT}: {len(FUSION)} Fusion + {len(FREECAD) + 1} FreeCAD tools')
