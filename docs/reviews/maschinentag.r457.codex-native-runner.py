import json, os, subprocess, sys, pathlib, hashlib, time
root=pathlib.Path('/tmp/r457')
ns={'CASES':{}}
exec((root/'cases.py').read_text(),ns)
names=['plain','g55_first','g55_rotary','g55_with_move','g20_g55','m6_after_g55','m6_after_g55_rot','m6_first_g43_zero','inch_g43_g55','g43_line_then_x','py_motion_first_bound','comp_next_xyz_g55','arc_first_g55','tap_first_g55']+[n for n in ns['CASES'] if n.startswith('cx_')]
(root/'out/meta.json').write_text(json.dumps({n:ns['META'][n] for n in names},indent=2))
rows=[]
for name in names:
 for mode in ['old','cand']:
  env=dict(os.environ, F9B_MODE=mode,F9B_SPY='1', F9B_UNITS=ns['META'][name]['units'])
  env.pop('PYTHONPATH',None)
  argv=[sys.executable,str(root/'probe.py'),name,str(root/'out'/f'{name}.{mode}.msgpack')]
  prior=root/'out'/f'{name}.{mode}.json'
  if prior.exists():
   saved=json.loads(prior.read_text())
   if not any(saved.get(k) for k in ['skip','error','invalid','parse_error']):
    assert saved['mmap_unchanged']
    rows.append({'name':name,'mode':mode,'start_believed':saved.get('start_believed'),'start_unbound':saved.get('start_unbound')})
    continue
  p=subprocess.run(argv,cwd=root/'tree/lcnc-gateway',env=env,capture_output=True,text=True,timeout=60)
  lines=[l for l in p.stdout.splitlines() if l.startswith('{')]
  rec=json.loads(lines[-1]) if lines else {'invalid':p.stdout,'stderr':p.stderr}
  (root/'out'/f'{name}.{mode}.json').write_text(json.dumps(rec,indent=2))
  assert p.returncode==0 and not any(rec.get(k) for k in ['skip','error','invalid','parse_error']), (name,mode,p.returncode,rec.get("parse_error"),rec.get("error"))
  assert rec['mmap_unchanged'], (name,mode)
  rows.append({'name':name,'mode':mode,'start_believed':rec.get('start_believed'),'start_unbound':rec.get('start_unbound')})
(root/'native-summary.json').write_text(json.dumps(rows,indent=2))
print(f'{len(rows)} native offline parses PASS; no skipped cases; tool mmap unchanged')
