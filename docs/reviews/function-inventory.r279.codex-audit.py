from pathlib import Path
import subprocess,json,importlib.util,hashlib
repo=Path('/home/cnc/lcnc-suite')
def blob(c,p): return subprocess.check_output(['git','show',f'{c}:{p}'],cwd=repo)
def fns(c):return json.loads(blob(c,'scripts/inventory/functions.json'))
a=fns('b588eaea');c=fns('b3e15974');b=fns('501482aa')
expect=json.loads(json.dumps(a)); comp=next(f for f in c['functions'] if f['id']=='F-COMP');expect['functions']=[comp if f['id']=='F-COMP' else f for f in expect['functions']]
out={'a':'4c021765','b':'501482aa','merge':{'data_exact':b==expect,'areas_unchanged':a['areas']==b['areas']==c['areas'],'excluded_unchanged':a['excludedAtoms']==b['excludedAtoms']==c['excludedAtoms']},'files':{}}
for p in subprocess.check_output(['git','diff','--name-only','f0070ec7','b3e15974'],cwd=repo,text=True).splitlines():
 if p not in ['docs/decisions.md','docs/inventory/funktionen.md','scripts/inventory/functions.json','CLAUDE.md']:
  out['files'][p]={'equal_comp':blob('501482aa',p)==blob('b3e15974',p)}
for side in ['a','b']:
 r=Path('/tmp/codex-r279')/side; spec=importlib.util.spec_from_file_location('f'+side,r/'scripts/inventory/functions.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
 web,py,fs=m.load(r); sts=[s for f in fs['functions'] for s in f.get('statements',[])];out[side+'_inventory']={'statements':len(sts),'open':sum(bool(s.get('gap')) for s in sts),'problems':m.problems(web,py,fs,root=r),'render_matches':m.render(web,py,fs)==(r/'docs/inventory/funktionen.md').read_text()}
for i in [1,2,3]:
 d=json.loads((repo/f'docs/reviews/statements-comp.merge-gate.run{i}.json').read_text());out['gate'+str(i)]={k:d[k] for k in ['kind','base','head','uncommitted','verdict','omitted','pending']};out['gate'+str(i)]['checks']=[{k:x[k] for k in ['name','status','tests','passed','failed','flaky','skipped'] if k in x} for x in d['checks']]
Path('/tmp/codex-r279/audit.json').write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n');print(json.dumps(out,ensure_ascii=False,indent=2))
