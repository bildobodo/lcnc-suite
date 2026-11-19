import copy,json,shutil,sys,tempfile
from pathlib import Path
root=Path('/tmp/claude-1000/-home-cnc-lcnc-suite/43040f88-3607-41a3-a5fe-dc80019b2257/scratchpad/arch402b');sys.path.insert(0,str(root/'scripts/inventory'))
import coverage as c
import functions
with tempfile.TemporaryDirectory(prefix='r401-result-') as tmp:
 tmp=Path(tmp);gate=tmp/'gate-merge.json';shutil.copyfile('/tmp/r401-input/gate-merge.json',gate);logs=gate.with_suffix('.logs');shutil.copytree('/tmp/r401-input/gate-merge.logs',logs)
 listing=json.loads(Path('/tmp/r401-result-list.json').read_text());rep=json.loads(Path('/tmp/r401-result-report.json').read_text());opts=json.loads(Path('/tmp/r401-result-options.json').read_text())
 assert len(listing)==len(opts)==2 and all(x['fails'] is False for x in opts)
 assert sorted(x['status'] for x in rep['testResults'][0]['assertionResults'])==['failed','passed']
 web,py,fns=functions.load(root);fns=copy.deepcopy(fns)
 e=next(e for f in fns['functions'] for s in f['statements'] for e in s['evidence'] if e['layer']=='unit');e.clear();e.update(layer='unit',file=listing[0]['file'].split('/lcnc-webui/src/')[-1],title=listing[0]['name'])
 functions.load=lambda _:(web,py,fns)
 def append(name,x):
  p=logs/name;d=json.loads(p.read_text());d.extend(x);p.write_text(json.dumps(d))
 def append_report(name,x):
  p=logs/name;d=json.loads(p.read_text());d['testResults'].extend(x['testResults']);p.write_text(json.dumps(d))
 append('unit-light.list.json',listing);append('unit-light.options.json',opts);append_report('unit-light.json',rep)
 def evaluate():
  r=c.coverage(gate,[],[],root=root)
  return {'verdict':r['verdict'],'errors':r['errors'],'checked':sum(s['checked']=='passed' for f in r['functions'] for s in f['statements']),'evidence':[ee for f in r['functions'] for s in f['statements'] for ee in s['evidence'] if ee['layer']=='unit' and ee['file']==e['file']]}
 out={'complete_control':evaluate()}
 p=logs/'unit-light.json';original=p.read_bytes();r=json.loads(original)
 fixture=next(x for x in r['testResults'] if x['name'].endswith('/r401-duplicate.test.ts'))
 fixture['assertionResults']=[x for x in fixture['assertionResults'] if x['status']=='passed']
 p.write_text(json.dumps(r));out['missing_failed_result_of_two']=evaluate();p.write_bytes(original)
 # Both groups have their complete list/options/results; the heavy results
 # cannot cancel a normal failure in the light results.
 append('unit-heavy.list.json',listing);append('unit-heavy.options.json',opts)
 heavy=copy.deepcopy(rep)
 for x in heavy['testResults'][0]['assertionResults']:x['status']='passed';x['failureMessages']=[]
 append_report('unit-heavy.json',heavy);out['heavy_pass_hides_light_failure']=evaluate()
Path('/home/cnc/claude-work/replay5c/evidence402/vor-maschine.rp5.r402.codex-r401-result-probe-rerun.json').write_text(json.dumps(out,indent=2)+'\n')
print(json.dumps(out,indent=2))
