"""Pure arithmetic for the R62 plan, no product or machine writes."""
import json, math, re
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
# Run from the review archive's evidence/, or pass the repo root as argv[1].
import sys
if len(sys.argv)>1: ROOT=Path(sys.argv[1])
css=(ROOT/'lcnc-webui/src/style.css').read_text()
start=css.index(':root[data-theme="dark"] {')
colors=dict(re.findall(r'(--viewer-[\w-]+):\s*(#[0-9a-fA-F]{6});',css[start:css.index('}',start)]))
def rgb(h):return [int(h[i:i+2],16)/255 for i in (1,3,5)]
def lin(x):return x/12.92 if x<=.04045 else ((x+.055)/1.055)**2.4
def lum(h):return sum(a*lin(x) for a,x in zip((.2126,.7152,.0722),rgb(h)))
def contrast(a,b):
 x,y=sorted((lum(a),lum(b)),reverse=True);return (x+.05)/(y+.05)
def lab(h):
 r,g,b=map(lin,rgb(h))
 l=(.4122214708*r+.5363325363*g+.0514459929*b)**(1/3)
 m=(.2119034982*r+.6806995451*g+.1073969566*b)**(1/3)
 s=(.0883024619*r+.2817188376*g+.6299787005*b)**(1/3)
 return [.2104542553*l+.793617785*m-.0040720468*s,1.9779984951*l-2.428592205*m+.4505937099*s,.0259040371*l+.7827717662*m-.808675766*s]
N=8; length=95.9; w0=1;w1=10
# Clip endpoints: x0=0,w0=1; x1=10,w1=10. Uniform world t,
# then perspective divide. Total projected edge length is 95.9 CSS px.
xs=[length*(t*w1)/((1-t)*w0+t*w1) for t in [i/N for i in range(N+1)]]
result={
 'endpoint_colors':[{'N':2**k,'first':'dark','last':'dark' if (2**k)%2 else 'light'} for k in range(5)],
 'perspective':{'total_css_px':length,'N':N,'nominal_css_px':length/N,'w_ratio':w1/w0,
                'actual_cell_css_px':[round(b-a,4) for a,b in zip(xs,xs[1:])]},
 'threshold_without_hysteresis':[{'L':L,'N':max(1,2**math.floor(math.log2(L/6)))} for L in [95.99,96.01,95.99,96.01]],
 'cyan_distance':{k:round(math.dist(lab('#00e5ff'),lab(v)),5) for k,v in colors.items()},
 'cyan_contrast':{b:round(contrast('#00e5ff',b),5) for b in ['#ffffff','#0b0f14','#000000','#15181c','#f0f2f4']},
}
print(json.dumps(result,indent=2))
