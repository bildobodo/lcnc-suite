"""Arithmetic review of Fassung 3 at f1b7e27; not a product renderer.

Usage: python3 plan-probe.py /path/to/archive > plan-probe.json
Uses only standard library; reads current theme tokens, no machine access.
"""
import json
import math
import re
import sys
from pathlib import Path

def select_n(length, dt):
    return min(2**14, max(2, 2**math.floor(math.log2(length / dt / 6))))

def visible_cells(n, t0, t1):
    return [i for i in range(n) if min((i+1)/n, t1) > max(i/n, t0)]

def update_n(n, length, dt):
    while n < 2**14 and length/(n*dt) > 15: n *= 2
    while n > 2 and length/(n*dt) < 4.8: n //= 2
    return n

# Positive: the R63 clipping case is fixed by the visible-parameter rule.
t0, length = 50/51, 100
n = select_n(length, 1-t0)
cells = visible_cells(n, t0, 1)
fixed = dict(N=n, mean=length/(n*(1-t0)), cells=cells,
             tones=sorted({i%2 for i in cells}))
assert n == 512 and fixed['tones'] == [0, 1]

# A closed interval exactly one cell long has boundaries only at its ENDS.
# Camera coordinates A=(.24,0,6), B=(0,0,-2), near=1: t0=7/8.
# Focal length 250 -> 500 px doubles projected length 7.5 -> 15 px.
# With the stated hysteresis N remains 8 all the way, including equality.
t0 = 7/8
n = select_n(7.5, 1-t0)
threshold = []
for length in [7.5, 10, 14.99, 15, 15.01]:
    n = update_n(n, length, 1-t0)
    cells = visible_cells(n, t0, 1)
    threshold.append(dict(length_css_px=length, N=n,
                          mean=length/(n*(1-t0)), visible_cells=cells,
                          positive_length_tones=sorted({i%2 for i in cells})))
assert threshold[3]['N'] == 8 and threshold[3]['positive_length_tones'] == [1]
assert threshold[4]['positive_length_tones'] == [0, 1]

# Perspective: BOTH endpoints are in front of the camera, no clipping or
# cap. A=(0,0,-1), B=(2000,0,-10000), focal=500 -> x spans 0..100 CSS px.
# World t is fixed, as the plan requires. Every raster sample centre for
# DPR 1/2 is still in the first DARK cell. No minimum visible width follows
# from N*dt or from containing several mathematical boundaries.
length, ratio, dt = 100, 10000, 1
n = select_n(length, dt)
def screen_x(t):
    return length * (t*ratio) / (1-t+t*ratio)
xs = [screen_x(i/n) for i in range(n+1)]
widths = [b-a for a, b in zip(xs, xs[1:])]
def t_at_x(x):
    s = x/length
    return s/(ratio-(ratio-1)*s)
samples = []
for dpr in (1, 2):
    tones = [min(n-1, int(n*t_at_x((i+.5)/dpr)))%2
             for i in range(round(length*dpr))]
    samples.append(dict(dpr=dpr, total=len(tones), dark=tones.count(0), light=tones.count(1)))
assert all(row['light'] == 0 for row in samples)
assert n == 16 and length/(n*dt) == 6.25
perspective = dict(A=[0,0,-1], B=[2000,0,-10000], focal_css_px=500,
                   visible_t=[0,1], N=n, nominal_mean=length/n,
                   cell_widths_css_px=widths,
                   first_dark_cell_css_px=widths[0],
                   sum_light_cell_widths_css_px=sum(widths[1::2]),
                   centre_samples=samples,
                   limit='Ideal point-sampled projection; not a screenshot or claim about a future antialiasing implementation')

# Read both tones of the now explicit full-tick carrier in all themes.
css = (Path(sys.argv[1])/'lcnc-webui/src/style.css').read_text()
def lum(hexcolor):
    channels = [int(hexcolor[i:i+2], 16)/255 for i in (1,3,5)]
    linear = [x/12.92 if x<=.04045 else ((x+.055)/1.055)**2.4 for x in channels]
    return sum(x*c for x,c in zip(linear,(.2126,.7152,.0722)))
def contrast(a,b):
    hi,lo=sorted((lum(a),lum(b)),reverse=True)
    return (hi+.05)/(lo+.05)
ticks=[]
for name in ('light','dark','hc-light','hc-dark'):
    start=css.index(f':root[data-theme="{name}"] {{')
    tokens=dict(re.findall(r'(--[\w-]+):\s*(#[0-9a-fA-F]{6});',css[start:css.index('}',start)]))
    dark,light,bg=[tokens[k] for k in ('--viewer-bounds','--viewer-bounds-alt','--bg')]
    row=dict(theme=name, core=dark, carrier=light, background=bg,
             core_contrast=contrast(dark,bg), carrier_contrast=contrast(light,bg))
    assert max(row['core_contrast'],row['carrier_contrast']) > 17
    ticks.append(row)

print(json.dumps(dict(commit='f1b7e27', r63_case_fixed=fixed,
                      exact_threshold=threshold, perspective=perspective,
                      tick_carrier=ticks), indent=2))
