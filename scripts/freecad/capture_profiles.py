"""Regenerate the native profile oracle from a FreeCAD CAM Tools/Shape directory.

Run inside FreeCAD / FreeCADCmd:
    import capture_profiles
    capture_profiles.capture('/path/to/CAM/Tools/Shape', '/new/native-profiles.json')
The installed source templates are never saved; output must not exist.
"""
import json
from pathlib import Path
import shutil
import sys
import tempfile

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'lcnc-gateway'))
from freecad_import import DEFAULTS, quantity


def capture(shape_dir, output_path):
    import FreeCAD as App
    results = []
    active = App.ActiveDocument.Name if App.ActiveDocument else None
    for name, params in DEFAULTS.items():
        for factor in (1, .7, 1.4):
            bit = {'version': 2, 'name': name + ' ' + str(factor), 'shape': name + '.fcstd',
                   'parameter': {k: quantity(v) * factor if k != 'Flutes' and 'angle' not in k.lower()
                                 else int(v) if k == 'Flutes' else v for k, v in params.items()}}
            with tempfile.TemporaryDirectory(prefix='lcnc-oracle-') as tmp:
                path = Path(tmp) / bit['shape']
                shutil.copyfile(Path(shape_dir) / bit['shape'], path)
                doc = App.openDocument(str(path))
                try:
                    bag = doc.getObject('PropertyBag')
                    for key, value in bit['parameter'].items():
                        setattr(bag, key, value)
                    for obj in doc.Objects:
                        obj.touch()
                    doc.recompute(None, True, True)
                    body = next(o for o in doc.Objects if o.TypeId == 'PartDesign::Body')
                    sketch = next(o for o in doc.Objects if o.TypeId == 'Sketcher::SketchObject')
                    edges = [[[p.x, p.y] for p in g.toShape().discretize(Deflection=.0005)]
                             for i, g in enumerate(sketch.Geometry) if not sketch.getConstruction(i)]
                    results.append({'bit': bit, 'volume': body.Shape.Volume, 'edges': edges,
                                    'valid': body.Shape.isValid()})
                finally:
                    App.closeDocument(doc.Name)
                    if active and active in App.listDocuments():
                        App.setActiveDocument(active)
    with Path(output_path).open('x') as f:
        json.dump({'version': App.Version()[:3], 'tolerance_mm': .0005, 'cases': results}, f,
                  allow_nan=False, separators=(',', ':'))
