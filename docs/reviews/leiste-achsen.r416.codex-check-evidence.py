"""Offline audit of R416 evidence; no browser or machine access."""
import json,sys
from pathlib import Path
root=Path(sys.argv[1]);P='leiste-achsen.r416.codex-'
def rows(n):return [json.loads(l) for l in (root/n).read_text().splitlines() if l]
strip=rows('leiste-achsen.r416.strip.jsonl')
assert len(strip)==36 and all(not r['fail'] and len(r['samples'])==47 for r in strip)
focus=rows('leiste-achsen.r416.focus.jsonl')
orders=[r for r in focus if r['case'].startswith('order-')]
assert len(orders)==16
new=[r for r in orders if r['variant']=='b2'];old=[r for r in orders if r['variant']=='b2r415']
assert len(new)==len(old)==8 and all(r['free']==r['held'] for r in new)
assert sum(r['free']!=r['held'] for r in old)==6
held=rows(P+'held.jsonl');assert len(held)==2
assert all(r['before']['scroll']==r['forward']['scroll']==r['back']['scroll']==0 and r['boxBefore']==r['boxHeld'] for r in held)
assert all(r['forward']['aria']=='Unhome X' and r['back']['aria']=='Zero X' and r['after']['scroll']>0 for r in held)
neutral=rows(P+'neutral.jsonl');dialog=rows(P+'dialog.jsonl')
assert len(neutral)==len(dialog)==4
assert all(r['before']['tabIndex']==-1 and r['after']['safety'] and r['after']['text']=='ArmDisarm' for r in neutral)
assert all(r['after']['openDialogs']==1 and r['after']['aria']=='Stop jog' for r in dialog)
extra=rows(P+'extra.jsonl');assert len(extra)==6
assert all(r['same'] and r['before']['scroll']==r['held']['scroll'] and len(r['held']['pointers'])==1 for r in extra)
reports={n:json.loads((root/(P+n+'.json')).read_text())['stats'] for n in ['chromium','firefox']}
assert all(r['expected']==8 and r['unexpected']==r['skipped']==r['flaky']==0 for r in reports.values())
print(json.dumps({
 'supplied':{'geometryCasesPerVariant':18,'samplesEach':47,'newOrderComparisonsEqual':8,'oldOrderComparisonsUnequal':6,'oldTotal':8},
 'own':{'heldJogTabAndShiftTabStill':True,'neutralStripTab':'Arm/Disarm','dialogPowerTab':'Stop jog',
        'extraIdenticalDOMTargets': [{'project':r['project'],'where':r['where'],'key':r['key'],'target':r['held']['aria'] or r['held']['text']} for r in extra],
        'afterReleaseScroll':[r['after']['scroll'] for r in held]},
 'reports':reports,
 'verdict':'agreement for Stage B plan/prototype; production integration remains subject to implementation review'
},indent=2))
