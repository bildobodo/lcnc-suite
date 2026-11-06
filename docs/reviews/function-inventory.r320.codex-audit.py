#!/usr/bin/env python3
"""R320 inventory-only audit. argv[1]: archive, argv[2]: git repository.
Reads the already accepted saved run; no live endpoint or native execution.
"""
import copy
import hashlib
import json
from pathlib import Path
import subprocess
import sys

root,repo=map(Path,sys.argv[1:3])
sys.path.insert(0,str(root/'scripts/inventory'))
import functions as fn

def git(*args): return subprocess.check_output(['git',*args],cwd=repo)
base=git('rev-parse','e4cb0c82').decode().strip()
head=git('rev-parse','41d0d1ab').decode().strip()
before=json.loads(git('show',base+':scripts/inventory/functions.json'))
web,py,after=fn.load(root)
assert not fn.problems(web,py,after)
assert fn.render(web,py,after)==(root/'docs/inventory/funktionen.md').read_text()
assert set(git('diff','--name-only',base,head).decode().splitlines())=={
    'docs/inventory/funktionen.md','scripts/inventory/functions.json'}
def indexed(data):
    return {f['id']+'.'+s['id']:s for f in data['functions'] for s in f.get('statements',[])}
b,a=indexed(before),indexed(after)
expected={'F-HOME.S2c','F-JOG.S5','F-GOTO.S1c','F-OVERRIDE.S2','F-OVERRIDE.S2b',
          'F-TOOLCHANGE.S2','F-TOOLMEASURE.S5','F-TOOLMEASURE.S6b','F-PROBE.S3'}
assert a.keys()==b.keys()
changed={key for key in a if a[key]!=b[key]}
assert changed==expected,changed
normalized=copy.deepcopy(after)
for key,s in indexed(normalized).items():
    if key in changed:
        s['gap']=b[key]['gap']
assert normalized==before,'a non-gap field changed'
run=Path('/home/cnc/claude-work/live-tier/20261106T040338/report.json')
data=run.read_bytes(); report=json.loads(data)
assert report['commit']==base and report['profile']=='3axis_xyz' and report.get('variant') is None
assert report['verdict']=='PASS'
rows=report['rows']; result={}; bound_titles=set()
for key in sorted(changed):
    statement=a[key]; matches=[]
    for e in statement['evidence']:
        assert e['layer']=='native'
        assert fn.native_status(e,[report],base)=='PASS at '+base
        # No passing run of the inventory-only successor is invented.
        assert fn.native_status(e,[report],head)=='ran at '+base+' (not this commit)'
        hit=[r for r in rows if r['case']==e['title'] and r.get('variant')==e.get('variant')]
        assert len(hit)==1 and hit[0]['status']=='PASS' and not hit[0].get('informational')
        matches.append({'evidence':e,'status_at_run':fn.native_status(e,[report],base),
                        'status_at_inventory_commit':fn.native_status(e,[report],head),'row':hit[0]})
        bound_titles.add(e['title'])
    result[key]={'applies':statement['applies'],'old_gap':b[key].get('gap'),
                 'gap':statement.get('gap'),'matches':matches}
assert len(bound_titles)==25
assert [key for key in changed if a[key].get('gap')]==['F-GOTO.S1c']
assert 'nicht ausgeübt' in a['F-GOTO.S1c']['gap']
assert next(r for r in rows if r['case']=='goto-g30')['target'][2]==0
informational=[r['case'] for r in rows if r.get('informational')]
assert len(informational)==6 and not bound_titles.intersection(informational)
remaining={key:s['gap'] for key,s in a.items() if s.get('gap')}
assert len(remaining)==17
assert all(a[k]==b[k] for k in remaining if k!='F-GOTO.S1c')
out={'base':base,'head':head,'changed_statements':result,'matched_rows':len(bound_titles),
     'closed_gaps':8,'remaining_gaps':remaining,'informational_excluded':informational,
     'generated_table_matches':True,'only_gap_fields_changed':True,
     'run_file':str(run),'run_sha256':hashlib.sha256(data).hexdigest(),
     'scope':'Historical native PASS at e4cb0c82. No PASS claimed for the inventory-only successor.'}
print(json.dumps(out,ensure_ascii=False,indent=2))
