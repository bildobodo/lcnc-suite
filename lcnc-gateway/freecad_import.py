"""FreeCAD fctl/fctb and LCNC native bundles. No FreeCAD runtime on the gateway.

Standard meridians follow the shipped FreeCAD 1.1 CAM sketches (including
small shoulder constraints). Custom templates must use the native exporter.
All output geometry is in machine units, with the physical bottom at Z=0.
"""
import io
import json
import math
from pathlib import Path, PurePosixPath
import re
import zipfile

with Path(__file__).with_name('freecad_shape_defaults.json').open() as _f:
    DEFAULTS = json.load(_f)

TYPES = {'endmill': 'endmill', 'reamer': 'reamer', 'ballend': 'ball',
         'bullnose': 'bullnose', 'chamfer': 'chamfer', 'dovetail': 'dovetail',
         'drill': 'drill', 'probe': 'probe', 'radius': 'radiusmill',
         'slittingsaw': 'slotmill', 'tap': 'tap', 'taperedballnose': 'tapered',
         'thread-mill': 'threadmill', 'v-bit': 'chamfer'}
ALIASES = {'ballnose': 'ballend', 'vbit': 'v-bit', 'threadmill': 'thread-mill'}
MAX_TOOLS = 2000
MAX_VERTICES = 100000
MAX_TRIANGLES = 200000
MAX_EXPANDED = 32 * 1024 * 1024
_QUANTITY = re.compile(r'\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)\s*([^\d\s]*)\s*')


def finite(value, label, limit=100000):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f'{label}: expected a number')
    if not math.isfinite(value) or abs(value) > limit:
        raise ValueError(f'{label}: non-finite or excessive value')
    return float(value)


def quantity(value, angle=False):
    """Literal quantities only. Never execute FreeCAD expressions on a gateway."""
    if isinstance(value, (int, float)):
        return finite(value, 'Quantity')
    match = _QUANTITY.fullmatch(value) if isinstance(value, str) else None
    if not match:
        raise ValueError(f'Unsupported FreeCAD quantity: {str(value)[:80]}')
    units = {'': 1, 'deg': 1, '°': 1, 'rad': 180 / math.pi} if angle else {
        '': 1, 'mm': 1, 'cm': 10, 'm': 1000, 'um': .001, 'µm': .001,
        'in': 25.4, 'inch': 25.4, '"': 25.4, 'ft': 304.8}
    if match[2] not in units:
        raise ValueError(f'Unsupported FreeCAD unit: {match[2]}')
    return finite(float(match[1]) * units[match[2]], 'Quantity')


def clean_text(value, label):
    if not isinstance(value, str) or len(value) > 4096 or any(ord(c) < 32 for c in value):
        raise ValueError(f'{label}: invalid text')
    return value


def shape_name(bit):
    name = PurePosixPath(str(bit.get('shape', '')).replace('\\', '/')).stem.lower()
    return ALIASES.get(name, name)


def parameters(bit, shape):
    attrs, params = bit.get('attribute', {}), bit.get('parameter', {})
    if not isinstance(attrs, dict) or not isinstance(params, dict):
        raise ValueError('FreeCAD parameter and attribute must be objects')
    supplied = {**attrs, **params}
    if shape == 'bullnose' and 'CornerRadius' not in supplied:
        if 'TorusRadius' in supplied:
            supplied['CornerRadius'] = supplied['TorusRadius']
        elif 'FlatRadius' in supplied:
            supplied['CornerRadius'] = quantity(supplied.get('Diameter', DEFAULTS[shape]['Diameter'])) / 2 - quantity(supplied['FlatRadius'])
    values = {**DEFAULTS.get(shape, {}), **supplied}
    return {k: quantity(v, 'angle' in k.lower()) for k, v in values.items()
            if k in DEFAULTS.get(shape, {}) or k == 'Diameter'}


def standard_profile(shape, p):
    """Sample the native meridian to <=1 micron chord error; preserve shoulders."""
    r, length = p['Diameter'] / 2, p['Length']
    shank = p.get('ShankDiameter', p['Diameter']) / 2
    height = p.get('CuttingEdgeHeight', length)
    if min(r, length, shank) <= 0:
        raise ValueError('FreeCAD diameter, shank and length must be positive')
    pts = [[0., 0.]]
    def line(x, z):
        pts.append([x, z])
    def arc(cx, cz, radius, a, b):
        if radius <= 0:
            raise ValueError('FreeCAD arc radius must be positive')
        step = min(math.pi / 24, 4 * math.asin(math.sqrt(min(1, .001 / (2 * radius)))))
        n = max(2, math.ceil(abs(b - a) / step))
        if n > 4096:
            raise ValueError('FreeCAD contour exceeds sampling limit')
        for i in range(n + 1):
            theta = a + (b - a) * i / n
            line(cx + radius * math.cos(theta), cz + radius * math.sin(theta))
    def shoulder(z, delta=.01):
        line(shank, z + delta)
        line(shank, length)
        line(0, length)
    def half_angle(key):
        v = p[key]
        if not 0 < v < 180:
            raise ValueError(f'FreeCAD {key} must be between 0 and 180 degrees')
        return math.radians(v / 2)
    if shape in ('endmill', 'reamer'):
        line(r, 0); line(r, height); shoulder(height, -.01)
    elif shape in ('ballend', 'bullnose'):
        corner = r if shape == 'ballend' else p['CornerRadius']
        if not 0 < corner <= r:
            raise ValueError('FreeCAD corner radius is outside the cutter')
        arc(r - corner, corner, corner, -math.pi / 2, 0)
        line(r, height); shoulder(height)
    elif shape == 'drill':
        line(r, r / math.tan(half_angle('TipAngle')))
        line(r, length); line(0, length)
    elif shape == 'tap':
        tip = r / math.tan(half_angle('TipAngle'))
        line(r, tip); line(r, tip + p['CuttingEdgeLength'])
        shoulder(tip + p['CuttingEdgeLength'], 0)
    elif shape == 'chamfer':
        tip = p['TipDiameter'] / 2 + .001
        line(tip, 0); line(tip + height * math.tan(half_angle('CuttingEdgeAngle')), height)
        shoulder(height)
    elif shape == 'v-bit':
        tip = p['TipDiameter'] / 2 + .000025
        top = (r - tip) / math.tan(half_angle('CuttingEdgeAngle'))
        line(tip, 0); line(r, top); line(r, top + height); shoulder(top + height, -.01)
    elif shape == 'dovetail':
        neck = p['NeckDiameter'] / 2
        line(r, 0); line(r - height * math.tan(half_angle('CuttingEdgeAngle')), height)
        line(neck, height); line(neck, height + p['NeckHeight'])
        shoulder(height + p['NeckHeight'], 0)
    elif shape == 'radius':
        tip, cr = p['TipDiameter'] / 2 + .001, p['CuttingRadius']
        if cr <= 0 or not 0 <= (tip + cr - r) / cr < 1:
            raise ValueError('FreeCAD radius profile parameters are incompatible')
        end = math.acos((r - tip - cr) / cr)
        arc(tip + cr, 0, cr, math.pi, end)
        line(r, height); shoulder(height)
    elif shape == 'probe':
        stem = p['ShaftDiameter'] / 2
        if not 0 < stem <= r:
            raise ValueError('FreeCAD probe shaft must fit the ball')
        arc(0, r, r, -math.pi / 2, math.acos(stem / r))
        line(stem, length); line(0, length)
    elif shape == 'slittingsaw':
        cap = p['CapHeight']
        pts = [[0, -cap], [p['CapDiameter'] / 2, -cap], [p['CapDiameter'] / 2, 0],
               [r, 0], [r, p['BladeThickness']], [shank, p['BladeThickness']],
               [shank, length], [0, length]]
    elif shape == 'thread-mill':
        neck = p['NeckDiameter'] / 2
        rise = (r - neck) * math.tan(half_angle('cuttingAngle'))
        line(neck, 0); line(r, rise); line(r, rise + p['Crest'])
        line(neck, 2 * rise + p['Crest']); line(neck, p['NeckLength'])
        shoulder(p['NeckLength'])
    elif shape == 'taperedballnose':
        a = half_angle('TaperAngle')
        arc(0, r, r, -math.pi / 2, -a)
        tr, tz = r * math.cos(a), r - r * math.sin(a)
        line(tr + (height - tz) * math.tan(a), height)
        z = tz + (p['TaperDiameter'] / 2 - tr) / math.tan(a)
        line(p['TaperDiameter'] / 2, z); shoulder(z)
    else:
        raise ValueError(f'Custom FreeCAD shape {shape!r}: use the FreeCAD native exporter')
    zmin = -length if shape == 'probe' else min(z for _, z in pts)
    shift = min(z for _, z in pts)
    if any(not math.isfinite(x + z) or x < -1e-8 or z > length + 1e-8 for x, z in pts):
        raise ValueError('Invalid FreeCAD contour; export the evaluated native shape')
    # A normal outline only travels backwards at the native 0.01 mm shoulder.
    if any(b[1] < a[1] - .010001 for a, b in zip(pts, pts[1:])):
        raise ValueError('Self-overlapping FreeCAD dimensions; use the native exporter')
    return [[max(0, x), z - shift] for x, z in pts], zmin


def _mesh(raw, scale):
    if not isinstance(raw, dict):
        raise ValueError('Native mesh must be an object')
    verts, triangles = raw.get('vertices'), raw.get('triangles')
    if not isinstance(verts, list) or not 4 <= len(verts) <= MAX_VERTICES:
        raise ValueError('Native mesh vertex limit exceeded or missing')
    if not isinstance(triangles, list) or not 4 <= len(triangles) <= MAX_TRIANGLES:
        raise ValueError('Native mesh triangle limit exceeded or missing')
    out = []
    for v in verts:
        if not isinstance(v, list) or len(v) != 3:
            raise ValueError('Invalid native mesh vertex')
        out.append([finite(c, 'Mesh coordinate') * scale for c in v])
    if abs(min(v[2] for v in out)) > .00001 * scale or max(v[2] for v in out) <= 0:
        raise ValueError('Native mesh must start at the physical tip Z=0 and extend in +Z')
    for tri in triangles:
        if (not isinstance(tri, list) or len(tri) != 3
                or any(type(i) is not int or not 0 <= i < len(out) for i in tri) or len(set(tri)) != 3):
            raise ValueError('Invalid native mesh triangle indices')
    return {'vertices': out, 'triangles': triangles}


def parse_bit(bit, number, identity, unit, geometry=None):
    if not isinstance(bit, dict) or bit.get('version') != 2:
        raise ValueError('FreeCAD tool bit must be fctb version 2')
    if type(number) is not int or not 1 <= number <= 99999:
        raise ValueError('FreeCAD tool number must be an integer from 1 to 99999')
    shape = shape_name(bit)
    scale = 1 if unit == 'mm' else 1 / 25.4
    source_id = clean_text(bit.get('id') or identity, 'FreeCAD identity')
    if not source_id:
        raise ValueError('FreeCAD source identity is missing')
    description = clean_text(bit.get('name', identity), 'FreeCAD tool name')
    p = parameters(bit, shape)
    supplied = {**bit.get('attribute', {}), **bit.get('parameter', {})}
    diameter = quantity(supplied.get('Diameter', p.get('Diameter', 0)))
    if diameter <= 0:
        raise ValueError(f'{description}: FreeCAD Diameter must be positive')
    tool = {'T': number, 'D': diameter * scale, 'type': TYPES.get(shape, 'formmill'),
            'description': description, 'source_format': 'freecad', 'source_id': source_id,
            'source_metadata': bit, 'material': str(supplied.get('Material', '')) or None}
    if geometry is not None:
        if not isinstance(geometry, dict):
            raise ValueError('Invalid native FreeCAD geometry')
        mesh = _mesh(geometry.get('mesh'), scale)
        tool.update(native_mesh=mesh, oal=max(v[2] for v in mesh['vertices']),
                    source_z_min=finite(geometry.get('source_z_min'), 'Source origin') * scale,
                    geometry_tolerance=finite(geometry.get('tolerance'), 'Mesh tolerance') * scale)
        if not 0 < tool['geometry_tolerance'] <= .1 * scale:
            raise ValueError('Native FreeCAD tolerance must be >0 and <=0.1 mm')
    else:
        declared = str(bit.get('shape-type', shape)).lower()
        if shape not in TYPES or declared == 'custom':
            raise ValueError(f'{description}: custom FreeCAD shape; use scripts/freecad/export_library.py')
        profile, origin = standard_profile(shape, p)
        tool.update(native_profile=[[x * scale, z * scale] for x, z in profile],
                    source_z_min=origin * scale, oal=max(z for _, z in profile) * scale,
                    geometry_tolerance=.001 * scale,
                    geometry_note='FreeCAD 1.1 standard template. Export from FreeCAD if the shape template was customized.')
    if 'Flutes' in supplied or 'Flutes' in p:
        flutes = quantity(supplied.get('Flutes', p.get('Flutes')))
        if not flutes.is_integer() or not 0 <= flutes <= 1000:
            raise ValueError('FreeCAD Flutes must be an integer from 0 to 1000')
        tool['flutes'] = int(flutes)
    return tool


def _reject_constant(value):
    raise ValueError(f'Invalid number: {value}')


def _json(raw):
    try:
        return json.loads(raw, parse_constant=_reject_constant)
    except (UnicodeError, json.JSONDecodeError, RecursionError) as e:
        raise ValueError(f'Invalid tool JSON: {e}') from e


def _deduplicate(tools):
    parsed, skipped, seen = [], [], set()
    for t in tools:
        (skipped if t['T'] in seen else parsed).append(t)
        seen.add(t['T'])
    return parsed, skipped


def decode_freecad_blob(raw, unit):
    if unit not in ('mm', 'in'):
        raise ValueError('Unknown machine units')
    if raw.startswith(b'PK'):
        try:
            with zipfile.ZipFile(io.BytesIO(raw)) as archive:
                entries = [i for i in archive.infolist() if not i.is_dir()]
                if len(entries) > 4096 or sum(i.file_size for i in entries) > MAX_EXPANDED:
                    raise ValueError('FreeCAD archive exceeds 4096 files or 32 MB expanded')
                names = [i.filename.replace('\\', '/') for i in entries]
                if len(set(names)) != len(names):
                    raise ValueError('Duplicate FreeCAD archive paths')
                assets = dict(zip(names, entries))
                libraries = [n for n in names if n.lower().endswith('.fctl') and not n.startswith('__MACOSX/')]
                if len(libraries) != 1:
                    raise ValueError('FreeCAD ZIP must contain exactly one .fctl library and its .fctb files')
                lib = _json(archive.read(assets[libraries[0]]))
                if not isinstance(lib, dict) or lib.get('version') != 1 or not isinstance(lib.get('tools'), list):
                    raise ValueError('FreeCAD library must be fctl version 1')
                if len(lib['tools']) > MAX_TOOLS:
                    raise ValueError('FreeCAD library exceeds 2000 tools')
                tools = []
                for ref in lib['tools']:
                    if not isinstance(ref, dict) or not isinstance(ref.get('path'), str):
                        raise ValueError('Invalid FreeCAD library reference')
                    path = ref['path'].replace('\\', '/')
                    base = PurePosixPath(path).name
                    candidates = [n for n in names if n == path or n == str(PurePosixPath(libraries[0]).parent / path)]
                    if not candidates:
                        candidates = [n for n in names if PurePosixPath(n).name == base]
                    if len(candidates) != 1 or not base.lower().endswith('.fctb'):
                        raise ValueError(f'Missing or ambiguous FreeCAD tool bit: {base}')
                    bit = _json(archive.read(assets[candidates[0]]))
                    if any(PurePosixPath(n).suffix.lower() == '.fcstd' for n in names):
                        raise ValueError('ZIP includes shape templates: use the FreeCAD native exporter to evaluate them')
                    tools.append(parse_bit(bit, ref.get('nr'), PurePosixPath(base).stem, unit))
                return _deduplicate(tools)
        except (zipfile.BadZipFile, RuntimeError, NotImplementedError, OSError, EOFError) as e:
            raise ValueError(f'Invalid FreeCAD ZIP: {e}') from e
    return parse_freecad_data(_json(raw), unit)


def parse_freecad_data(data, unit):
    if unit not in ('mm', 'in'):
        raise ValueError('Unknown machine units')
    if not isinstance(data, dict):
        raise ValueError('Tool library must be a JSON object')
    if data.get('format') == 'lcnc-freecad-tools':
        if data.get('version') != 1 or data.get('unit') != 'mm' or not isinstance(data.get('tools'), list):
            raise ValueError('Unsupported native FreeCAD bundle version or units')
        if len(data['tools']) > MAX_TOOLS:
            raise ValueError('FreeCAD bundle exceeds 2000 tools')
        tools = []
        for entry in data['tools']:
            if not isinstance(entry, dict) or 'geometry' not in entry:
                raise ValueError('Native FreeCAD bundle entry is missing geometry')
            tools.append(parse_bit(entry.get('bit'), entry.get('nr'), entry.get('id', ''), unit, entry['geometry']))
        return _deduplicate(tools)
    if 'shape' in data:
        tool = parse_bit(data, 1, data.get('name', 'standalone'), unit)
        tool['geometry_note'] += ' Standalone tool assigned T1; use a library to preserve numbering.'
        return [tool], []
    if 'tools' in data:
        raise ValueError('A .fctl only references tool bits. Upload a ZIP with the .fctl and referenced .fctb files, or a native FreeCAD export.')
    raise ValueError('Not a FreeCAD tool library')
