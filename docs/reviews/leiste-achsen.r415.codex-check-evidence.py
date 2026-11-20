"""Offline audit of R415 supplied measurements and Codex observations."""
import json,sys
from pathlib import Path
root=Path(sys.argv[1]);P='leiste-achsen.r415.codex-'
def rows(n):return [json.loads(l) for l in (root/n).read_text().splitlines() if l]
strip=rows('leiste-achsen.r415.strip.jsonl')
assert len(strip)==36 and all(not r['fail'] and len(r['samples'])==47 for r in strip)
focus=rows('leiste-achsen.r415.focus.jsonl')
hidden=[r for r in focus if r['case']=='tab-hidden-held-jog']
assert len(hidden)==4
for r in hidden:
 delta=r['held']['scroll']-r['before']['scroll']
 assert (delta==0) if r['variant']=='b2' else (delta>400)
held=rows(P+'held.jsonl')
assert len(held)==2
assert all(r['before']['scroll']==r['forward']['scroll']==r['back']['scroll']==0 and r['boxBefore']==r['boxHeld'] for r in held)
assert all(r['forward']['aria']=='Unhome X' and r['back']['aria']=='Zero X' and r['after']['scroll']>0 for r in held)
neutral=rows(P+'neutral.jsonl');dialog=rows(P+'dialog.jsonl')
assert len(neutral)==len(dialog)==4
for r in neutral:
 assert r['before']['tabIndex']==-1
 assert r['after']['aria']=='Connection details' if r['held'] else r['after']['safety']
for r in dialog:
 assert r['after']['openDialogs']==1
 assert r['after']['aria']=='Active codes — open in the G-code reference' if r['held'] else r['after']['aria']=='Stop jog'
walk=rows(P+'dialog-walk.jsonl')
assert len(walk)==2 and all(len(r['rows'])==10 for r in walk)
assert all(s['safety'] or s['dialog'] or s['reachable'] for r in walk for s in r['rows'])
reports={n:json.loads((root/(P+n+'.json')).read_text())['stats'] for n in ['chromium','firefox','walk-chromium','walk-firefox']}
assert all(r['unexpected']==r['skipped']==r['flaky']==0 for r in reports.values())
print(json.dumps({
 'supplied':{'casesPerVariant':18,'samplesEach':47,'bothVariantsGeometryGreen':True,'heldJogOldRedNewGreen':True},
 'own':{'heldJogTabAndShiftTabStill':True,'afterReleaseScroll':[r['after']['scroll'] for r in held],
        'neutralTabWithoutHold':'Safety Arm/Disarm','neutralTabWithHold':'Connection details',
        'dialogTabWithoutHold':'Stop jog','dialogTabWithHold':'Active codes — open in the G-code reference',
        'dialogScopeEscapeInExtra20Steps':False},
 'reports':reports,
 'interpretation':'PASS means observations were recorded and their preconditions met; offline checks confirm the two changed Tab destinations, not contract compliance.'
},indent=2))
