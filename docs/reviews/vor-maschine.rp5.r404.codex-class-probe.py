import json,copy,shutil,sys,tempfile
from pathlib import Path
root=Path('/tmp/codex-r404-replay');sys.path.insert(0,str(root/'scripts/inventory'))
import coverage as c
out={}
with tempfile.TemporaryDirectory(prefix='r402-class-') as tmp:
 tmp=Path(tmp);gate=tmp/'gate-merge.json';shutil.copyfile('/tmp/r401-input/gate-merge.json',gate);logs=gate.with_suffix('.logs');shutil.copytree('/tmp/r401-input/gate-merge.logs',logs)
 original=gate.read_bytes();base=json.loads(original)
 originals={p:p.read_bytes() for p in logs.rglob('*') if p.is_file()}
 def evaluate(name):
  r=c.coverage(gate,[],[],root=root)
  out[name]={'verdict':r['verdict'],'errors':r['errors'],'runs':r['runs'],'checked':sum(s['checked']=='passed' for f in r['functions'] for s in f['statements']),
   'estop':next(f for f in r['functions'] if f['id']=='F-ESTOP')['triggered'],
   'trigger_totals':{p:sum(sum(v.values()) for f in r['functions'] for cmd,projects in f['triggered']['commands'].items() for p2,v in projects.items() if p2==p and isinstance(v,dict)) for p in ['e2e','firefox-core']}}
  print(name,r['verdict'],len(r['errors']),out[name]['checked'])
 def restore():
  gate.write_bytes(original)
  for p,b in originals.items():p.write_bytes(b)
 evaluate('control')
 # A gate check's name is an indexed identity, just as a result's id is.
 target=next(x for x in base['checks'] if x['name']=='browser-workers')
 for where in ['before','after']:
  d=copy.deepcopy(base);other=copy.deepcopy(target);other['run']='another-run'
  if where=='before':d['checks'].insert(0,other)
  else:d['checks'].append(other)
  gate.write_text(json.dumps(d));evaluate('duplicate_gate_check_'+where);restore()
 # No positively known reference: matching absent run ids must not become
 # a run identity. Only Chromium is changed; Firefox/backend stay intact.
 d=copy.deepcopy(base);next(x for x in d['checks'] if x['name']=='browser-workers').pop('run');gate.write_text(json.dumps(d))
 for name in ['list-run.json','playwright.json']:
  p=logs/name;x=json.loads(p.read_text());x['config']['metadata'].pop('run',None);p.write_text(json.dumps(x))
 p=logs/'replay.json';x=json.loads(p.read_text());x.pop('run');p.write_text(json.dumps(x));evaluate('unknown_chromium_run');restore()
 # Strict JSON loader: duplicate semantic object member, positive control
 # above. It must withhold the replay rather than accept its last value.
 p=logs/'replay.json';s=p.read_text();assert s.lstrip().startswith('{');idx=s.index('{');p.write_text(s[:idx+1]+'"run":"earlier-run",'+s[idx+1:]);evaluate('duplicate_json_run');restore()
Path('/tmp/r404-class-probe.json').write_text(json.dumps(out,indent=2,ensure_ascii=False)+'\n')
