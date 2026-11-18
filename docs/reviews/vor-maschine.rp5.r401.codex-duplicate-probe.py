import copy,json,shutil,sys,tempfile
from pathlib import Path
root=Path('/tmp/codex-r401-replay');sys.path.insert(0,str(root/'scripts/inventory'))
import coverage as c
import functions
with tempfile.TemporaryDirectory(prefix='r400-duplicate-') as tmp:
 tmp=Path(tmp);gate=tmp/'gate-merge.json';shutil.copyfile('/tmp/r401-input/gate-merge.json',gate);logs=gate.with_suffix('.logs');shutil.copytree('/tmp/r401-input/gate-merge.logs',logs)
 listing=json.loads(Path('/tmp/r400-duplicate-list.json').read_text());rep=json.loads(Path('/tmp/r400-duplicate-report.json').read_text());opts=json.loads(Path('/tmp/r400-duplicate-options.json').read_text())
 web,py,fns=functions.load(root);fns=copy.deepcopy(fns)
 e=next(e for f in fns['functions'] for s in f['statements'] for e in s['evidence'] if e['layer']=='unit');e.clear();e.update(layer='unit',file=listing[0]['file'].split('/lcnc-webui/src/')[-1],title=listing[0]['name'])
 functions.load=lambda _:(web,py,fns)
 for name,add in [('unit-light.list.json',listing),('unit-light.options.json',opts)]:
  p=logs/name;p.write_text(json.dumps(json.loads(p.read_text())+add))
 p=logs/'unit-light.json';r=json.loads(p.read_text());r['testResults']+=rep['testResults'];p.write_text(json.dumps(r))
 def evaluate():
  r=c.coverage(gate,[],[],root=root)
  return {'verdict':r['verdict'],'errors':r['errors'],'checked':sum(s['checked']=='passed' for f in r['functions'] for s in f['statements']),'evidence':[ee for f in r['functions'] for s in f['statements'] for ee in s['evidence'] if ee['layer']=='unit' and ee['file']==e['file']]}
 out={'both_rows':evaluate()}
 p=logs/'unit-light.options.json';r=json.loads(p.read_text());r=[x for x in r if not(x['fullName']=='same title' and x['fails'] is True)];p.write_text(json.dumps(r))
 out['missing_one_of_two_options']=evaluate()
Path('/tmp/r401-duplicate-probe.json').write_text(json.dumps(out,indent=2)+'\n')
print(json.dumps(out,indent=2))
