"""Measure original pixels; does not edit the native images or fit to LCNC."""
from pathlib import Path
import json
import hashlib
from PIL import Image
import numpy as np

ROOT=Path(__file__).resolve().parent
cases=[]
with (ROOT/'cases.json').open() as f: prepared=json.load(f)
for case in prepared:
    folder=ROOT/case['id']
    with (folder/'capture.json').open() as f: capture=json.load(f)
    with (folder/'native-operation.json').open() as f: op=json.load(f)
    assert capture['active_command_at_capture']=='IronSimulation'
    camera=capture['camera']
    assert camera['type']==0 and camera['up']==[0,0,1]
    assert camera['eye'][0]==camera['target'][0]==0
    assert camera['eye'][2]==camera['target'][2]
    with Image.open(folder/'native-front.png') as im:
        rgb=np.asarray(im.convert('RGB')).astype(float)
    height,width,_=rgb.shape
    r,g,b=rgb[:,:,0],rgb[:,:,1],rgb[:,:,2]
    gold=(r>30)&(g>18)&(r>g*1.08)&(g>b*1.6)&(b<90)
    ys=np.flatnonzero(gold.any(axis=1))
    assert len(ys)>20 and ys[0]>0 and ys[-1]<height-1
    scale=height/(camera['extents'][2]*10)
    axis=width/2
    # Pixel centres are x+0.5/y+0.5. Edges lie on pixel boundaries.
    tip_y=float(ys[-1]+1)
    samples=[]
    for y in ys:
        xs=np.flatnonzero(gold[y])
        samples.append([round((tip_y-(y+.5))/scale,8),
            round((axis-float(xs[0]))/scale,8),round((float(xs[-1]+1)-axis)/scale,8)])
    # Grey reference block, independently known to be 20 mm wide.
    grey=(abs(r-g)<5)&(abs(g-b)<5)&(r>140)
    grey[:ys[-1]+5,:]=False
    grey_widths=grey.sum(axis=1)
    widths=grey_widths[grey_widths>5*scale]
    stock_pixels=float(np.median(widths))
    assert abs(stock_pixels-20*scale)<2.1, (case['id'],stock_pixels,20*scale)
    raw={k:v for k,v in op['raw'].items() if k in ['type','geometry','unit','post-process','shaft']}
    # Geometry regression fixtures need no feed presets or unrelated library identifiers.
    result={'id':case['id'],'family':case['family'],'fusionVersion':capture['fusion_version'],
        'raw':raw,'screenshotSha256':hashlib.sha256((folder/'native-front.png').read_bytes()).hexdigest(),
        'imageSize':[width,height],'camera':camera,
        'calibration':{'pixelsPerMm':scale,'axisXPx':axis,'tipEdgeYPx':tip_y,
            'stockWidthMm':20,'stockWidthPx':stock_pixels,
            'tipWorldZMm':camera['target'][2]*10+height/(2*scale)-tip_y/scale,
            'origin':'lowest native gold silhouette edge; no fit to LCNC geometry'},
        'goldHeightMm':float(ys[-1]+1-ys[0])/scale,
        'sampleColumns':['zMm','leftRadiusMm','rightRadiusMm'],
        'samples':samples}
    cases.append(result)
    print(case['id'],'height',round(result['goldHeightMm'],5),'radii',round(min(row[1] for row in samples),5),round(max(row[1] for row in samples),5),'tipZ',result['calibration']['tipWorldZMm'])
with (ROOT/'native-silhouettes.json').open('w') as f:
    json.dump({'source':'Native Fusion simulation pixels, no CAM-post contour',
        'scope':'Front cutting silhouettes. Camera scale checked against 20 mm reference block; native bottom edge defines local axial origin. Not a full 3D or installation-pose certification.',
        'cases':cases},f,indent=2); f.write('\n')
