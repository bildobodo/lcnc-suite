"""Re-extract the holder silhouette from the unchanged native Fusion PNG.

Run with Python, Pillow and NumPy; does not run Fusion or edit image pixels.
"""
import hashlib
import json
from pathlib import Path
import numpy as np
from PIL import Image

root=Path(__file__).resolve().parent
path=root/'fusion-tool-holders.json'
with path.open() as f:result=json.load(f)
reference=result['simulation']
image_path=root/reference['image']
with Image.open(image_path) as im:rgb=np.asarray(im.convert('RGB')).astype(float)
r,g,b=rgb[:,:,0],rgb[:,:,1],rgb[:,:,2]
# Hue separation includes the dark shaded silhouette; a brightness cutoff
# would incorrectly erode the right edge by up to 1.9 mm.
blue=(b>g*1.2)&(g>r*1.3)
gold=(r>90)&(g>50)&(b<30)&(r>g*1.15)
# Native orthographic image and an independent 20 mm stock block establish
# scale. The bottom gold pixel fixes the tip; no LCNC output is used here.
ys,xs=np.where(gold)
tip_y=float(ys.max())+.5
blue[int(tip_y)+1:]=False
capture={'camera':reference['camera']}
scale=rgb.shape[0]/(capture['camera']['extents'][2]*10)
axis=rgb.shape[1]/2
edges=[]
for y in np.where(blue.any(axis=1))[0]:
    xs=np.where(blue[y])[0]
    edges.append([(float(xs.max())+.5-axis)/scale,(tip_y-(float(y)+.5))/scale])
with image_path.open('rb') as f:digest=hashlib.sha256(f.read()).hexdigest()
stock=(r>150)&(abs(r-g)<1)&(abs(g-b)<1)
stock[:int(tip_y)+20]=False
stock_width=max(np.count_nonzero(row) for row in stock)
reference.update({'sha256':digest,'pixelsPerMm':scale,'stockWidthPixels':int(stock_width),
    'tipPixelY':tip_y,'axisPixelX':axis,'rightEdgeMm':edges})
with path.open('w') as f:
    json.dump(result,f,indent=2)
    f.write('\n')
print('pixels/mm',scale,'stock width',stock_width,'holder Z range',min(p[1] for p in edges),max(p[1] for p in edges))
