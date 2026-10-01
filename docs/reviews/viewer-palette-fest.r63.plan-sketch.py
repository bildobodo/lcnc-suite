"""Generate an SVG explanation from the R63 arithmetic (not a UI screenshot).
Usage: python3 plan-sketch.py plan-probe.json > plan-sketch.svg
"""
import json
import sys
from html import escape

data = json.load(open(sys.argv[1]))
parts = ['<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="660" viewBox="0 0 1080 660">',
         '<rect width="1080" height="660" fill="#e5e7eb"/>',
         '<style>text{font-family:system-ui,sans-serif;fill:#111827;font-size:15px}.title{font-size:21px;font-weight:600}.small{font-size:13px}</style>']
def text(x,y,s,cls=''):
    parts.append(f'<text x="{x}" y="{y}" class="{cls}">{escape(s)}</text>')
def line(x1,y1,x2,y2,c,w=1):
    parts.append(f'<path d="M{x1},{y1} L{x2},{y2}" stroke="{c}" stroke-width="{w}"/>')
text(24,32,'R63 – Gegenbeispiele zum schriftlichen Plan', 'title')
text(24,57,'Rechenskizze, kein Screenshot des Produkts; Maße in CSS px.')
text(24,94,'Near-Plane: 100 px sichtbar, Weltphase bleibt am ursprünglichen Anfang')
for row,(n,cells,label) in enumerate([
        (16,data['near_clip']['visible_cells'],'Plan: N=16, L/N=6,25 px → nur hell'),
        (512,data['near_clip']['alternative']['visible_cells'],'Beispiel mit N·Δt: N=512 → beide Töne')]):
    y=119+row*55
    text(24,y+20,label)
    for col,bg in enumerate(['#ffffff','#000000']):
        x=700+col*175
        parts.append(f'<rect x="{x-15}" y="{y}" width="140" height="35" fill="{bg}"/>')
        pos=x+100
        for cell in cells:
            size=cell['css_px']
            line(pos,y+17.5,pos-size,y+17.5,'#000000' if cell['tone']=='dark' else '#ffffff')
            pos-=size
text(24,249,'Endmarken: dunkler Querstrich gegenüber zweifarbigem Träger')
text(480,279,'Plan: nur dunkel')
text(779,279,'Option: hell 3 px + dunkel 1 px')
for row,entry in enumerate(data['ticks']):
    y=300+row*77
    text(24,y+27,f"{entry['theme']}: Querstrich/Grund {entry['tick_to_background']:.2f}:1")
    for col,dual in enumerate([False,True]):
        x=440+col*320
        parts.append(f'<rect x="{x}" y="{y}" width="290" height="51" fill="{entry["background"]}"/>')
        start=x+33.5
        for i in range(16):
            line(start+i*14,y+25.5,start+(i+1)*14,y+25.5,
                 entry['tick'] if i%2==0 else entry['alternate'])
        for xx in (start,start+16*14):
            if dual: line(xx,y+18,xx,y+33,entry['alternate'],3)
            line(xx,y+18,xx,y+33,entry['tick'])
text(24,639,'Der helle Boxabschnitt macht nur den Schnittpunkt sichtbar, nicht die dunklen Querarme.', 'small')
parts.append('</svg>')
print('\n'.join(parts))
