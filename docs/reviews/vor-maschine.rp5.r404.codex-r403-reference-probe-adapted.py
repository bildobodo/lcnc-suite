import copy,json,shutil,subprocess,sys,tempfile
from pathlib import Path
root=Path('/tmp/claude-1000/-home-cnc-lcnc-suite/43040f88-3607-41a3-a5fe-dc80019b2257/scratchpad/arch404');sys.path.insert(0,str(root/'scripts/inventory'))
import coverage as c
out={}
with tempfile.TemporaryDirectory(prefix='r403-reference-') as tmp:
 tmp=Path(tmp);gate=tmp/'gate-merge.json';shutil.copyfile('/tmp/r401-input/gate-merge.json',gate);logs=gate.with_suffix('.logs');shutil.copytree('/tmp/r401-input/gate-merge.logs',logs)
 original=json.loads(gate.read_text())
 def evaluate(label):
  r=c.coverage(gate,[],[],root=root)
  try:json.dumps(r);serialized=True;error=None
  except TypeError as e:serialized=False;error=str(e)
  summary={'verdict':r['verdict'],'errors':r['errors'],'serialized':serialized,'serialization_error':error,
   'run_value_types':{k:type(v).__name__ for k,v in r['runs'].items()},
   'checked':sum(s['checked']=='passed' for f in r['functions'] for s in f['statements']),
   'passed_by_layer':{ly:sum(e['status']=='passed' for f in r['functions'] for s in f['statements'] for e in s['evidence'] if e['layer']==ly) for ly in ['unit','browser','gateway']},
   'triggers':{p:sum(sum(v.values()) for f in r['functions'] for cmd,projects in f['triggered']['commands'].items() for p2,v in projects.items() if p2==p and isinstance(v,dict)) for p in ['e2e','firefox-core']}}
  # The public CLI must also be able to emit the named failure report.
  dest=tmp/(label+'.coverage.json');md=tmp/(label+'.coverage.md')
  proc=subprocess.run([sys.executable,'-B',str(root/'scripts/inventory/coverage.py'),'--gate',str(gate),'--out',str(dest),'--md',str(md)],capture_output=True,text=True)
  summary['cli']={'returncode':proc.returncode,'stdout':proc.stdout,'stderr':proc.stderr,'json_exists':dest.exists(),'md_exists':md.exists()}
  out[label]=summary
  print(label,r['verdict'],len(r['errors']),'serializable',serialized,'cli',proc.returncode,dest.exists())
 evaluate('control')
 for check in ['browser-workers','firefox-workers','backend']:
  for order in ['before','after']:
   d=copy.deepcopy(original);x=copy.deepcopy(next(v for v in d['checks'] if v['name']==check));x['run']='another-run'
   if order=='before':d['checks'].insert(0,x)
   else:d['checks'].append(x)
   gate.write_text(json.dumps(d));evaluate(check+'_'+order)
 gate.write_text(json.dumps(original))
Path('/home/cnc/claude-work/replay5c/evidence404/vor-maschine.rp5.r404.codex-r403-reference-probe-rerun.json').write_text(json.dumps(out,indent=2,ensure_ascii=False)+'\n')
