"""Measure a native Fusion screenshot; never changes its pixels.

Calibration uses the 20 mm reference stock and the simulation's 15 mm Z readout,
not the tool's exported DC, OAL or profile. Requires Pillow.
"""
import hashlib
import json
from pathlib import Path
from statistics import median
from PIL import Image

ROOT = Path(__file__).resolve().parent
state = json.loads((ROOT / 'native-simulation-state.json').read_text())
if state['commandId'] != 'IronSimulation':
    raise ValueError('Expected native Simulate command state')
z_input = next(i for i in state['inputs'] if i['name'] == 'Z position')
z_above_stock_mm = z_input['value'] * 10  # Fusion API length values are cm.
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
axis_x = (left + right) / 2
tip_y = stock_top - z_above_stock_mm * scale
samples = []
for row, l, r in gold_rows:
    z = (tip_y - row) / scale
    if 1 <= z <= 160 and row % 2 == 0:
        samples.append([round(z, 6), round((axis_x - l) / scale, 6),
                        round((r - axis_x) / scale, 6)])

record = json.loads((ROOT / 'native-operation.json').read_text())
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
        'expectedTipOffsetMm': 0,
    },
    'coverageZMm': [1, 160],
    'toleranceMm': 0.5,
    'limits': [
        'One Autodesk sample, tip-offset zero, holder removed.',
        'Front image clips the top of the 179.598 mm tool; only z=1..160 mm is measured.',
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
