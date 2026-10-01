"""R63: counterexamples to the written plan, NOT the unbuilt renderer.

Usage: python3 this.py /path/to/archive > plan-probe.json
Only reads style.css; no gateway, network or machine access.
"""
import json
import math
import re
import sys
from pathlib import Path

root = Path(sys.argv[1])
css = (root / "lcnc-webui/src/style.css").read_text()

def theme(name):
    start = css.index(f':root[data-theme="{name}"] {{')
    return dict(re.findall(r'(--[\w-]+):\s*(#[0-9a-fA-F]{6});',
                           css[start:css.index('}', start)]))

def luminance(color):
    rgb = [int(color[i:i+2], 16) / 255 for i in (1, 3, 5)]
    rgb = [v / 12.92 if v <= .04045 else ((v + .055) / 1.055)**2.4 for v in rgb]
    return sum(a*b for a, b in zip(rgb, (.2126, .7152, .0722)))

def contrast(a, b):
    hi, lo = sorted((luminance(a), luminance(b)), reverse=True)
    return (hi + .05) / (lo + .05)

# View coordinates, looking along -Z, near=1, focal length=500 CSS px.
# A is the fixed first world endpoint; only the final 1/51 is visible.
A, B = (10.2, 0, 49), (0, 0, -2)
t_near = 50 / 51
def projected_x(t):
    x = A[0] * (1-t) + B[0] * t
    z = A[2] * (1-t) + B[2] * t
    return 500 * x / -z

visible_length = abs(projected_x(t_near) - projected_x(1))
def choose_cells(length):
    return max(2, 2 ** math.floor(math.log2(length / 6)))

def intervals(n):
    out = []
    for i in range(n):
        lo, hi = max(t_near, i/n), min(1, (i+1)/n)
        if hi > lo:
            out.append(dict(cell=i, tone="dark" if i % 2 == 0 else "light",
                            t=[lo, hi], css_px=abs(projected_x(hi)-projected_x(lo))))
    return out

N = choose_cells(visible_length)
current = intervals(N)
assert 6 <= visible_length/N <= 12
assert N >= 2 and {x['tone'] for x in current} == {'light'}
assert math.isclose(visible_length, 100, abs_tol=1e-9)

# One possible repair, NOT a prescription: count cells in the visible
# parameter interval while retaining the phase at the full edge's start.
adjusted_N = choose_cells(visible_length / (1-t_near))
adjusted = intervals(adjusted_N)
assert {x['tone'] for x in adjusted} == {'light', 'dark'}

ticks = []
for name in ['light', 'dark', 'hc-light', 'hc-dark']:
    tokens = theme(name)
    dark, light, bg = tokens['--viewer-toolpath-bounds'], tokens['--viewer-bounds-alt'], tokens['--bg']
    ticks.append(dict(theme=name, background=bg, tick=dark, alternate=light,
                      tick_to_background=contrast(dark, bg),
                      light_to_background=contrast(light, bg)))
assert ticks[-1]['tick_to_background'] == 1

# The positive threshold case from R62 is now covered by the stated memory.
history = []
n = 8
for length in (95.99, 96.01, 95.99, 96.01, 120.01, 119.99, 76.79, 76.81):
    while length/n > 15: n *= 2
    while n > 2 and length/n < 4.8: n //= 2
    history.append(dict(length=length, N=n, mean=length/n))
assert [x['N'] for x in history[:4]] == [8, 8, 8, 8]

print(json.dumps(dict(
    commit='21a1b68', kind='written-plan arithmetic, not a product rendering',
    near_clip=dict(A=A, B=B, near=1, focal_css_px=500, visible_t=[t_near, 1],
                   visible_length_css_px=visible_length, N=N,
                   nominal_mean_css_px=visible_length/N, visible_cells=current,
                   alternative=dict(N=adjusted_N, mean_visible_cell_css_px=visible_length/(adjusted_N*(1-t_near)),
                                    visible_cells=adjusted)),
    ticks=ticks, hysteresis=history), indent=2))
