"""Offline R414 evidence audit; does not start a browser or touch a sim."""
from pathlib import Path
import json,sys

root=Path(sys.argv[1])
P='leiste-achsen.r414.codex-'
def rows(name):
    return [json.loads(l) for l in (root/name).read_text().splitlines() if l]
strip=rows('leiste-achsen.r414.strip.jsonl')
b2=[x for x in strip if x['variant']=='b2']
blocked=[x for x in strip if x['variant']=='b2occ']
assert len(b2)==len(blocked)==18
assert all(len(x['samples'])==47 and not x['fail'] for x in b2)
assert all(x['fail'] and any(not s['estop'] for s in x['samples']) for x in blocked)
safety=rows('leiste-achsen.r414.safety.jsonl')
assert len(safety)==10
assert all(x['over']==x['detailOver']==0 and x['detailH']==x['before']['h'] for x in safety)
focus=rows('leiste-achsen.r414.focus.jsonl')
selects=[x for x in focus if x['case']=='pointer-select']
assert len(selects)==2
assert {x['variant']:x['held']['scroll']-x['before']['scroll'] for x in selects}=={'b2':0,'b2old':-83}
tab=rows(P+'tab.jsonl')
assert len(tab)==6 and all(x['landed'] and len(x['held']['pointers'])==1 for x in tab)
native=rows(P+'native-tab.jsonl')
assert len(native)==4
for x in native:
    assert x['before']['prevActive'] and x['held']['targetActive']
    assert len(x['held']['pointers'])==1
    assert x['held']['scroll']-x['before']['scroll']>400
    assert x['before']['jog']['x']-x['held']['jog']['x']>400
    assert x['point']['x']>x['held']['jog']['x']+x['held']['jog']['width']
for browser in ('e2e','firefox-core'):
    a=[x for x in native if x['project']==browser]
    assert len(a)==2 and a[0]['held']['scroll']==a[1]['held']['scroll']
occ=rows(P+'occlusion.jsonl')
assert len(occ)==2
assert all(x['before']['estop'] and x['before']['stopOk'] and not x['after']['estop'] and not x['after']['stopOk'] for x in occ)
assert all(len(x['boxes'])==4 and max(b['height'] for b in x['boxes'])==min(b['height'] for b in x['boxes']) for x in occ)
reports={n:json.loads((root/(P+n+'.json')).read_text())['stats'] for n in ['chromium','firefox','native-chromium','native-firefox','initial-native-chromium']}
assert all(reports[n]['unexpected']==reports[n]['skipped']==reports[n]['flaky']==0 for n in reports if not n.startswith('initial'))
print(json.dumps({
    'supplied':{'b2Green':len(b2),'occludedRed':len(blocked),'samplesEach':47,'safetyCases':len(safety),'pointerSelectDelta':{'old':-83,'new':0}},
    'own':{'overlayRejectedByBoth':True,'fourEqualHeights':True,
           'nativeTab': [{'browser':x['project'],'newListener':x['listener'],'scrollWhileHeld':x['held']['scroll']-x['before']['scroll'],'jogBeforeX':x['before']['jog']['x'],'jogHeldX':x['held']['jog']['x']} for x in native]},
    'reports':reports,
    'interpretation':'Own native Tab cases assert the counterexample (>400 px movement), not compliance; plan contract still fails.'
},indent=2))
