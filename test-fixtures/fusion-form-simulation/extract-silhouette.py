"""Measure a native Fusion screenshot; never changes its pixels.

Calibration uses the 20 mm reference stock, the simulation's Z readout and an
explicit orthographic camera when recorded, not DC, OAL or profile. Requires Pillow.
"""
import hashlib
import json
import sys
from pathlib import Path
from statistics import median
from PIL import Image

ROOT = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path(__file__).resolve().parent
max_z = float(sys.argv[2]) if len(sys.argv) > 2 else 160
state = json.loads((ROOT / 'native-simulation-state.json').read_text())
if state['commandId'] != 'IronSimulation':
    raise ValueError('Expected native Simulate command state')
z_input = next(i for i in state['inputs'] if i['name'] == 'Z position')
z_above_stock_mm = z_input['value'] * 10  # Fusion API length values are cm.
if any(i['value'] != 0 for i in state['inputs'] if i['name'] in ['X position', 'Y position']):
    raise ValueError('Calibration requires the tool at X=Y=0 above the stock centre')
image_path = ROOT / 'native-front.png'
with Image.open(image_path) as image:
    image = image.convert('RGB')
    width, height = image.size
    pixels = image.load()
    gold_rows = []
    for y in range(height):
        xs = [x for x in range(width)
              if (lambda r, g, b: r > 30 and g > 18 and r > g * 1.08
                  and g > b * 1.6 and b < 90)(*pixels[x, y])]
        if xs:
            gold_rows.append((y, xs[0] - 0.5, xs[-1] + 0.5))
    bottom_y = gold_rows[-1][0]
    stock_rows = []
    for y in range(bottom_y + 5, height):
        xs = [x for x in range(width)
              if max(pixels[x, y]) - min(pixels[x, y]) < 5 and pixels[x, y][0] > 140]
        if len(xs) > 50:
            stock_rows.append((y, xs[0] - 0.5, xs[-1] + 0.5, len(xs)))

# The stock interior is a solid grey rectangle; reject its antialiased top/bottom
# and the white trace markers at its lower edge when measuring the width.
interior = stock_rows[10:-10]
left = median(row[1] for row in interior)
right = median(row[2] for row in interior)
stock_top = stock_rows[0][0] - 0.5
scale = (right - left) / 20
stock_scale = scale
scale_source = '20 mm reference stock silhouette'
camera_path = ROOT / 'native-camera.json'
if camera_path.exists():
    # A deliberately configured, front-facing orthographic camera supplies an
    # independent scale without the fractional-pixel uncertainty of stock edges.
    camera = json.loads(camera_path.read_text())['capture']
    if (camera['type'] != 0 or camera['up'] != [0, 0, 1]
            or camera['eye'][0] != camera['target'][0]
            or camera['eye'][2] != camera['target'][2]):
        raise ValueError('Expected documented orthographic front-view camera')
    scale = height / (camera['extents'][2] * 10)
    if abs((right - left) - 20 * scale) > 2:
        raise ValueError('Camera scale disagrees with the independent stock width')
    scale_source = 'orthographic camera height; checked against 20 mm stock within 2 pixels'
axis_x = (left + right) / 2
tip_y = stock_top - z_above_stock_mm * scale
samples = []
for row, l, r in gold_rows:
    z = (tip_y - row) / scale
    if 1 <= z <= max_z and row % 2 == 0:
        samples.append([round(z, 6), round((axis_x - l) / scale, 6),
                        round((r - axis_x) / scale, 6)])

record = json.loads((ROOT / 'native-operation.json').read_text())
offset = record['raw']['geometry']['tip-offset']
full_height_visible = gold_rows[0][0] > 0 and bottom_y < height - 1
result = {
    'source': 'Fusion native Simulate graphics view; no CAM post contour',
    'fusionVersion': record['fusion_version'],
    'operation': record['operation'],
    'screenshot': 'native-front.png',
    'screenshotSha256': hashlib.sha256(image_path.read_bytes()).hexdigest(),
    'imageSize': [width, height],
    'raw': record['raw'],
    'calibration': {
        'stockWidthMm': 20, 'displayedZAboveStockMm': z_above_stock_mm,
        'stockLeftPx': left, 'stockRightPx': right, 'stockTopPx': stock_top,
        'pixelsPerMm': scale, 'axisXPx': axis_x, 'tipYPx': tip_y,
        'scaleSource': scale_source, 'stockPixelsPerMm': stock_scale,
        'expectedTipOffsetMm': offset,
    },
    'silhouetteBounds': {
        'fullHeightVisible': full_height_visible,
        'minZMm': (tip_y - (bottom_y + 0.5)) / scale,
        'maxZMm': (tip_y - (gold_rows[0][0] - 0.5)) / scale,
    },
    'coverageZMm': [1, max_z],
    'toleranceMm': 0.5,
    'limits': [
        f'One Autodesk sample, tip-offset {offset:g} mm, holder removed.',
        f'Numeric edge samples cover z=1..{max_z:g} mm; full height visible: {full_height_visible}.',
        'Pixel calibration, antialiasing and native mesh faceting limit precision.',
        'This checks the meridian silhouette, not every 3D mesh surface or tool family.',
    ],
    'sampleColumns': ['zMm', 'leftRadiusMm', 'rightRadiusMm'],
    'samples': samples,
}
rows = result.pop('samples')
serialized = json.dumps(result, indent=2)[:-2] + ',\n  "samples": [\n'
serialized += ',\n'.join('    ' + json.dumps(s) for s in rows) + '\n  ]\n}\n'
(ROOT / 'native-silhouette.json').write_text(serialized)
print(json.dumps({'calibration':result['calibration'], 'samples':len(samples),
                  'visibleTipY':bottom_y + 0.5, 'zRange':result['coverageZMm']}, indent=2))
