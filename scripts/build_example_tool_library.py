#!/usr/bin/env python3
"""Rebuild the bundled examples from the native geometry regression references.

No CAD application, machine connection or network is needed. Geometry remains
unchanged; example identities and nominal exposed lengths are assigned.
"""
import copy
import json
from pathlib import Path
import uuid
import sys

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'examples/sim_config/tool-libraries/fusion-freecad.json'
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

# Nominal tip-to-spindle-face distances in mm for the bare-tool examples.
# Each leaves part of the modeled shaft inside the spindle and the working
# profile exposed. No holder projection is included: these examples have no
# holder geometry. These simulation placements are not measured tool offsets.
EXAMPLE_Z_MM = {
    1001: 50, 1002: 40, 1003: 45, 1004: 6, 1005: 60,
    1006: 35, 1007: 45, 1008: 65, 1009: 50, 1010: 45,
    1011: 55, 1012: 120, 1013: 30, 1014: 65, 1015: 45,
    1016: 50, 1017: 50, 1018: 50, 1019: 50, 1020: 145,
    1021: 50,
    2001: 40, 2002: 45, 2003: 45, 2004: 35, 2005: 40,
    2006: 40, 2007: 20, 2008: 12, 2009: 35, 2010: 40,
    2011: 38, 2012: 40, 2013: 40, 2014: 35, 2015: 25,
}


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
        entries.append({'source': 'fusion360', 'data': raw, 'example_z_mm': EXAMPLE_Z_MM[number],
                        'reference': f'test-fixtures/{filename}#{case_id}'})
    cases = read(ROOT / 'test-fixtures/freecad/native-profiles.json')['cases']
    for number, (shape, name) in enumerate(FREECAD, 2001):
        raw = copy.deepcopy(next(c['bit'] for c in cases if c['bit']['name'] == shape + ' 1'))
        raw.update(name=f'Example / FreeCAD / {name}', id=identity('freecad', shape))
        entries.append({'source': 'freecad', 'data': {'nr': number, 'id': raw['id'], 'bit': raw},
                        'example_z_mm': EXAMPLE_Z_MM[number],
                        'reference': f'test-fixtures/freecad/native-profiles.json#{shape} 1'})
    custom = copy.deepcopy(read(ROOT / 'test-fixtures/freecad/custom-native.json')['tools'][0])
    custom.update(nr=2015, id=identity('freecad', 'custom-bore'))
    custom['bit'].update(id=custom['id'], name='Example / FreeCAD / Custom body with axial bore')
    entries.append({'source': 'freecad', 'data': custom, 'example_z_mm': EXAMPLE_Z_MM[2015],
                    'reference': 'test-fixtures/freecad/custom-native.json'})
    return {'format': 'lcnc-tool-library', 'version': 2, 'is_example': True,
            'name': 'Fusion 360 and FreeCAD example tools',
            'description': 'Tool geometry without holder meshes or cutting presets. Nominal exposed lengths for simulation, with the upper shaft inside the spindle; measure installed tools before machining.',
            'tools': entries}


# The shop's own tools, numbered from 1 (operator 2026-09-29): the test
# programs call them by these numbers (T2, T3, T8, T13 …) — a sim table with
# only the library's T1001+/T2001+ refused every such program at its first T
# word ("Requested tool 13 not found in the tool table") and the preview
# showed nothing. The library keeps its 1000/2000 blocks: imported into a
# real machine's table, they never collide with its T1–T99. Each profile
# keeps its own T1 (the demo program is measured for it); the shop's tools
# follow from T2.
SHOP = (
    'T2 P2 Z47.690467 D6.000000 ; 6mm 30\u00b0 Engraving Tool\n'
    'T3 P3 Z22.000000 D6.000000 ; 6mm 45\u00b0 Engraving Tool\n'
    'T4 P4 Z73.168800 D6.000000 ; 6mm 60\u00b0 Engraving Tool\n'
    'T5 P5 Z22.000000 D6.000000 ; 6mm 90\u00b0 Engraving Tool\n'
    'T6 P6 Z60.000000 D6.000000 ; 6mm Ball Endmill\n'
    'T7 P7 Z66.000000 D6.000000 ; 6mm Flat Endmill\n'
    'T8 P8 Z68.000000 D8.000000 ; 8mm Flat Endmill\n'
    'T9 P9 Z56.000000 D10.000000 ; 10mm Spot Drill\n'
    'T10 P10 Z49.000000 D12.000000 ; 12mm Flat Endmill\n'
    'T11 P11 Z58.000000 D16.000000 ; 16mm Flat Endmill\n'
    'T12 P12 Z30.000000 D6.000000 ; Inlay cutter D6x20x50 5.7\u00b0 R1\n'
    'T13 P13 Z65.067133 D8.000000 ; Inlay cutter D8x47x100 3.7\u00b0 R1\n'
    'T14 P14 Z42.540000 D3.000000 ; 3mm tool\n'
    'T50 P50 Z50.000000 D50.000000 ; 50mm Face Mill\n'
    'T99 P99 Z40.000000 D3.000000 ; 3D Touch Probe\n'
)

def seeds():
    """Fresh simulator tables; keep each demo program's original tool numbers."""
    sys.path.insert(0, str(ROOT / 'lcnc-gateway'))
    from tool_import import decode_tool_blob, initial_z_offset
    from tool_table import _TOOL_META_FIELDS
    tools, _ = decode_tool_blob(json.dumps(build()).encode(), 'mm')
    metadata = {str(t['T']): {k: t[k] for k in _TOOL_META_FIELDS if k in t} for t in tools}
    rows = ''.join(f"T{t['T']} P{t['T']} Z{initial_z_offset(t):.6f} D{t['D']:.6f} ; {t['description']}\n" for t in tools)
    demos = {
        'xyz3': 'T1 P1 Z50 D6 ; Example end mill\n' + SHOP,
        'xyzac5': 'T1 P1 Z100 D12 ; XYZAC demo: 12 mm end mill, 100 mm gauge length\n' + SHOP,
        'xyzabc6': 'T1 P1 Z200.000 D14.000 ; Gantry example, 200 mm gauge length, 14 mm diameter\n' + SHOP,
    }
    result = {}
    for directory, demo in demos.items():
        result[f'{directory}/tool.tbl'] = demo + rows
        result[f'{directory}/tool.seed.json'] = json.dumps(metadata, ensure_ascii=False, separators=(',', ':')) + '\n'
    return result


if __name__ == '__main__':
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with OUTPUT.open('w', encoding='utf-8') as f:
        json.dump(build(), f, ensure_ascii=False, allow_nan=False, separators=(',', ':'))
        f.write('\n')
    print(f'{OUTPUT}: {len(FUSION)} Fusion + {len(FREECAD) + 1} FreeCAD tools')
    for rel, content in seeds().items():
        (ROOT / 'examples/sim_config' / rel).write_text(content, encoding='utf-8')
