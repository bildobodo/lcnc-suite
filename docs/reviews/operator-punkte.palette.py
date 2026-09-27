# Mirrors lcnc-webui/src/themeTokens.test.ts (contrast, OKLab, Machado 2009 sev. 1) — scratch evaluation only.
import math, itertools, re, sys
def hx(h): n=int(h[1:],16); return ((n>>16)&255,(n>>8)&255,n&255)
def lin(v): v/=255; return v/12.92 if v<=0.04045 else ((v+0.055)/1.055)**2.4
def lum(c): return 0.2126*lin(c[0])+0.7152*lin(c[1])+0.0722*lin(c[2])
def contrast(a,b):
    x,y=sorted([lum(a),lum(b)],reverse=True); return (x+0.05)/(y+0.05)
def oklab(c):
    r,g,b=map(lin,c)
    l=(0.4122214708*r+0.5363325363*g+0.0514459929*b)**(1/3)
    m=(0.2119034982*r+0.6806995451*g+0.1073969566*b)**(1/3)
    s=(0.0883024619*r+0.2817188376*g+0.6299787005*b)**(1/3)
    return (0.2104542553*l+0.793617785*m-0.0040720468*s,1.9779984951*l-2.428592205*m+0.4505937099*s,0.0259040371*l+0.7827717662*m-0.808675766*s)
def okd(a,b): return math.dist(oklab(a),oklab(b))
M={'protan':[[0.152286,1.052583,-0.204868],[0.114503,0.786281,0.099216],[-0.003882,-0.048116,1.051998]],
   'deutan':[[0.367322,0.860646,-0.227968],[0.280085,0.672501,0.047413],[-0.011820,0.042940,0.968881]],
   'tritan':[[1.255528,-0.076749,-0.178779],[-0.078411,0.930809,0.147602],[0.004733,0.691367,0.303900]]}
def unlin(v):
    v=min(1,max(0,v)); return 255*(12.92*v if v<=0.0031308 else 1.055*v**(1/2.4)-0.055)
def sim(c,k):
    if k=='normal': return c
    l=[lin(x) for x in c]; return tuple(unlin(sum(r[i]*l[i] for i in range(3))) for r in M[k])
VIEWS=['normal','protan','deutan','tritan']
LIT=(224,224,224)
css=open(__import__('os').path.join(__import__('os').path.dirname(__import__('os').path.abspath(__file__)), '../../lcnc-webui/src/style.css')).read()
def block(sel):
    i=css.index(sel+' {'); body=css[css.index('{',i)+1:css.index('}',i)]
    return dict(re.findall(r'(--[\w-]+):\s*([^;]+);',body))
THEMES={'light':':root[data-theme="light"]','dark':':root[data-theme="dark"]','hc-light':':root[data-theme="hc-light"]','hc-dark':':root[data-theme="hc-dark"]'}
# pair table (a, b, colour-separated)
PAIRS=[('feed','rapid',0),('feed','backplot',1),('feed','limit',1),('feed','selection',0),('feed','collision',0),
('rapid','backplot',0),('rapid','limit',0),('rapid','selection',0),('rapid','collision',0),('backplot','limit',0),
('backplot','selection',0),('backplot','collision',0),('limit','selection',0),('limit','collision',0),('selection','collision',0)]
PATH=['feed','rapid','backplot','limit','selection','collision']
def roles(theme, over={}):
    b=block(THEMES[theme]); r={k:hx(b['--viewer-'+k]) for k in PATH}; r['halo']=hx(b['--viewer-selection-halo']); r['bg']=hx(b['--bg'])
    r.update({k:hx(v) for k,v in over.items()}); return r
def check(theme, over={}, verbose=True):
    r=roles(theme,over); bad=[]; floor=4.5 if theme.startswith('hc') else 3
    for k in ['feed','rapid','backplot','limit','collision']:
        cb,cl=contrast(r[k],r['bg']),contrast(r[k],LIT)
        if cb<floor: bad.append(f'{k} on bg {cb:.2f}')
        if cl<3: bad.append(f'{k} on lit {cl:.2f}')
    s,h=r['selection'],r['halo']
    if contrast(s,r['bg'])<floor: bad.append(f'selection core on bg {contrast(s,r["bg"]):.2f}')
    if max(contrast(s,LIT),contrast(h,LIT))<3: bad.append('selection core/halo on lit')
    if contrast(s,h)<4.5: bad.append(f'selection core on halo {contrast(s,h):.2f}')
    for a,c in itertools.combinations(PATH,2):
        d=okd(r[a],r[c])
        if d<0.12: bad.append(f'{a}/{c} normal {d:.3f}')
    for a,c,col in PAIRS:
        if col:
            for v in VIEWS[1:]:
                d=okd(sim(r[a],v),sim(r[c],v))
                if d<0.12: bad.append(f'{a}/{c} {v} {d:.3f}')
    return bad
if __name__=='__main__':
    for t in THEMES: print(t, 'current:', check(t) or 'OK')
