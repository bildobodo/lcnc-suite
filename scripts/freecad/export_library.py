"""Export evaluated FreeCAD CAM tools, including custom shapes, to LCNC Suite.

Run in FreeCAD's Python console (see docs/freecad-tool-import.md). Only temporary
copies of shape documents are opened. No job, library or user document is saved.
The exported mesh is the tool alone, in mm, translated from native ZMin to Z=0.
"""
import json
from pathlib import Path
import shutil
import tempfile


def _resolve(reference, directories):
    ref = Path(reference)
    candidates = ([ref] if ref.is_absolute() else []) + [Path(d) / ref for d in directories]
    candidates += [Path(d) / ref.name for d in directories]
    found = {p.resolve() for p in candidates if p.is_file()}
    if len(found) != 1:
        raise ValueError(f'Missing or ambiguous FreeCAD asset: {reference}. Supply explicit search directories.')
    return found.pop()


def _geometry(shape_path, bit, tolerance):
    import FreeCAD as App
    active = App.ActiveDocument.Name if App.ActiveDocument else None
    with tempfile.TemporaryDirectory(prefix='lcnc-freecad-') as tmp:
        copy = Path(tmp) / shape_path.name
        shutil.copyfile(shape_path, copy)
        doc = App.openDocument(str(copy))
        try:
            bags = [o for o in doc.Objects if o.Name == 'PropertyBag']
            bodies = [o for o in doc.Objects if o.TypeId == 'PartDesign::Body']
            if len(bags) != 1 or len(bodies) != 1:
                raise ValueError(f'{shape_path.name}: expected one PropertyBag and one tool Body')
            bag = bags[0]
            params = {**bit.get('attribute', {}), **bit.get('parameter', {})}
            if shape_path.stem.lower() == 'bullnose' and 'CornerRadius' not in params:
                if 'TorusRadius' in params:
                    params['CornerRadius'] = params['TorusRadius']
                elif 'FlatRadius' in params:
                    params['CornerRadius'] = App.Units.Quantity(params['Diameter']).Value / 2 - App.Units.Quantity(params['FlatRadius']).Value
            for key, value in params.items():
                if key in bag.PropertiesList:
                    setattr(bag, key, int(value) if bag.getTypeIdOfProperty(key) == "App::PropertyInteger" else value)
                elif key in bit.get('parameter', {}) and key not in ('TorusRadius', 'FlatRadius'):
                    raise ValueError(f'{shape_path.name}: unknown shape parameter {key}')
            for obj in doc.Objects:
                obj.touch()
            doc.recompute(None, True, True)
            if any('Invalid' in o.State for o in doc.Objects):
                raise ValueError(f'{shape_path.name}: native recompute failed')
            shape = bodies[0].Shape
            if shape.isNull() or not shape.isValid() or not shape.Solids:
                raise ValueError(f'{shape_path.name}: native tool is not a valid solid')
            # OCCT's analytic BoundBox can overestimate trimmed toroidal faces.
            # Tessellated extents describe the actual exported surface.
            vertices, triangles = shape.tessellate(tolerance)
            if len(vertices) > 100000 or len(triangles) > 200000:
                raise ValueError('Mesh exceeds LCNC import limits; increase tolerance (max 0.1 mm)')
            zmin = min(v.z for v in vertices)
            return {'mesh': {'vertices': [[v.x, v.y, v.z - zmin] for v in vertices],
                             'triangles': [list(t) for t in triangles]},
                    'source_z_min': zmin, 'tolerance': tolerance}
        finally:
            App.closeDocument(doc.Name)
            if active and active in App.listDocuments():
                App.setActiveDocument(active)


def export_library(library_path, output_path, *, bit_dirs=(), shape_dirs=(), tolerance=.01):
    """Write one .lcnc-tools.json from an fctl v1 + fctb v2 library.

    bit_dirs / shape_dirs are explicit search paths for dependencies. Standard
    sibling Bit and Shape directories are searched automatically. Files are never
    fetched from the network. Tool numbers come from the library, not a CAM job.
    """
    import FreeCAD as App
    if not 0 < tolerance <= .1:
        raise ValueError('tolerance must be >0 and <=0.1 mm')
    library_path = Path(library_path).resolve()
    output_path = Path(output_path).resolve()
    if output_path.exists():
        raise ValueError('Output already exists; choose a new file to avoid overwriting it')
    with library_path.open() as f:
        library = json.load(f)
    if library.get('version') != 1 or not isinstance(library.get('tools'), list):
        raise ValueError('Expected an fctl version 1 library')
    if len(library['tools']) > 2000:
        raise ValueError('Library exceeds 2000 tools')
    bits = [library_path.parent, library_path.parent.parent / 'Bit', *bit_dirs]
    shapes = [library_path.parent.parent / 'Shape', *shape_dirs]
    tools = []
    for ref in library['tools']:
        path = _resolve(ref['path'], bits)
        with path.open() as f:
            bit = json.load(f)
        if bit.get('version') != 2:
            raise ValueError(f'{path.name}: expected fctb version 2')
        shape_path = _resolve(bit['shape'], [path.parent, *shapes])
        geom = _geometry(shape_path, bit, tolerance)
        tools.append({'nr': ref['nr'], 'id': bit.get('id') or path.stem, 'bit': bit, 'geometry': geom})
    payload = {'format': 'lcnc-freecad-tools', 'version': 1, 'unit': 'mm',
               'freecad_version': '.'.join(App.Version()[:3]), 'tools': tools}
    encoded = json.dumps(payload, allow_nan=False, separators=(',', ':')).encode()
    if len(encoded) > 16 * 1024 * 1024:
        raise ValueError('Export exceeds 16 MB; split the library or increase tolerance')
    # Exclusive write avoids replacing a file created while native evaluation ran.
    with output_path.open('xb') as f:
        f.write(encoded)
    return str(output_path)
