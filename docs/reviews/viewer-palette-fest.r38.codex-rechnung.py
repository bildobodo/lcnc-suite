"""R38 discussion arithmetic, not product code or an acceptance test.
Run with Python 3; stdout is JSON. All RGB hex values are sRGB. OKLab is
reported on the 0..1 scale. Flat swatches stand for final DISPLAY pixels,
not material colors under lights. No imports from the live application.
"""
import math,json,itertools

def rgb(h): return tuple(int(h[i:i+2],16)/255 for i in (1,3,5))
def lin(v): return v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4
def luminance(h): return sum(v*w for v,w in zip(map(lin,rgb(h)),(.2126,.7152,.0722)))
def ratio(a,b):
 x,y=sorted((luminance(a),luminance(b))); return (y+.05)/(x+.05)
def lab(h):
 r,g,b=map(lin,rgb(h))
 l=(.4122214708*r+.5363325363*g+.0514459929*b)**(1/3)
 m=(.2119034982*r+.6806995451*g+.1073969566*b)**(1/3)
 s=(.0883024619*r+.2817188376*g+.6299787005*b)**(1/3)
 return (.2104542553*l+.793617785*m-.0040720468*s,1.9779984951*l-2.428592205*m+.4505937099*s,.0259040371*l+.7827717662*m-.808675766*s)
def lch(h):
 L,a,b=lab(h); return {'L':L,'C':math.hypot(a,b),'h':math.degrees(math.atan2(b,a))%360}
def grey(L):
 y=L**3; x=12.92*y if y<=.0031308 else 1.055*y**(1/2.4)-.055
 return '#'+('%02x'%round(x*255))*3
D={'feed':'#22dd44','rapid':'#3d8bff','backplot':'#ff00ff','limit':'#ff7a00'}
E={'feed':'#00a83c','rapid':'#3d8bff','backplot':'#ff00ff','limit':'#e66b00'}
surfaces={'white':'#ffffff','light-grey':'#f2f3f5','medium-grey':'#808080','dark-bg':'#0b0f14','charcoal-bg':'#202428','lit-table-old':'#e0e0e0','neutral-L040':grey(.4),'neutral-L055':grey(.55),'path-facing-stock':'#393d40'}
# Display swatches illustrating target surface ranges, NOT shader material seeds.
models={'cast':'#303438','paint':'#3c4043','dark':'#202326','steel':'#32363a','accent':'#2d3135','stock':'#393d40','marks':'#656a6e'}
res={'palettes':{},'surfaces':surfaces,'rendered_surface_swatch_targets':{k:{'hex':v,**lch(v)} for k,v in models.items()}}
for name,p in [('D',D),('E',E)]:
 res['palettes'][name]={'roles':{r:{'hex':c,'Y':luminance(c),**lch(c),'contrast':{s:ratio(c,bg) for s,bg in surfaces.items()},'max_dark_background_Y_for_3_to_1':(luminance(c)+.05)/3-.05} for r,c in p.items()},'pairs':{a+'/'+b:math.dist(lab(p[a]),lab(p[b])) for a,b in itertools.combinations(p,2)},'collision_pairs':{r:math.dist(lab(c),lab('#c8102e')) for r,c in p.items()}}
 miny=min(luminance(c) for c in p.values())
 res['palettes'][name]['common_dark_background_Y_ceiling_3_to_1']=(miny+.05)/3-.05
 res['palettes'][name]['neutral_background_L_ceiling_3_to_1']=((miny+.05)/3-.05)**(1/3)
res['bounds_grey']={h:{b:ratio(h,b) for b in ['#ffffff','#393d40','#202428','#0b0f14']} for h in ['#4b5563','#888888','#909090','#cbd5e1']}
res['width_storage']={'segments':1200000,'position_bytes_per_segment':24,'packed_positions_one_level_MiB':24*1200000/2**20,'packed_positions_three_full_levels_MiB':3*24*1200000/2**20,'rapid_distance_bytes_per_segment':8,'instance_pair_indices_bytes_per_segment_if_custom':8}
print(json.dumps(res,ensure_ascii=False,indent=2))
