"""R307 A: offline native preview of the return and its successor.
Usage: gateway Python -B this_file.py archive-1c32325c old-tool_touch_off.ngc
Reuses native_start_probe.py: private tool mmap, synthetic STAT and command
stub which raises. No running LinuxCNC, gateway or HAL access.
"""
import hashlib,json,os,subprocess,sys
from pathlib import Path
root=Path(sys.argv[1]).resolve(); old=Path(sys.argv[2]).resolve()
harness=root/'lcnc-gateway/native_start_probe.py'; source=harness.read_text()
old_bytes=old.read_bytes()
assert hashlib.sha256(old_bytes).hexdigest()=='9d180577d1909b178f2921d3c96dd78536037b9f8312b862bd93354d6be51de2'
cases=[
 ('known_top_longer','G21 G90\nG53 G0 X50 Y50 Z0\nT2 M600\nG0 X60 Y60\nM2\n',{},False),
 ('following_move_establishes_xy','G21 G90\nG53 G0 Z0\nT2 M600\nG0 X60 Y60\nM2\n',{},False),
 ('old_copy_unknown_xy','G21 G90\nG53 G0 Z0\nT2 M600\nG0 X60 Y60\nM2\n',{},True),
 ('return_disabled','G21 G90\nG53 G0 X50 Y50 Z0\nT2 M600\nM2\n',{3106:0},False),
]
results=[]
for name,prog,vars_,older in cases:
 extra={'subs':{'tool_touch_off.ngc':old_bytes.decode()}} if older else {}
 addition='CASES["codex_r307"] = _m600('+repr(vars_ or None)+', prog='+repr(prog)+', **'+repr(extra)+')\n'
 changed=source.replace('program, units, z_off, gcodes_live, extra = CASES[sys.argv[1]]',addition+'program, units, z_off, gcodes_live, extra = CASES[sys.argv[1]]')
 assert changed!=source
 env=dict(os.environ);env.pop('PYTHONPATH',None);env['PYTHONDONTWRITEBYTECODE']='1'
 boot='__file__='+repr(str(harness))+'\nimport sys\nsys.argv=['+repr(str(harness))+',"codex_r307"]\nexec(compile('+repr(changed)+', __file__, "exec"))'
 p=subprocess.run([sys.executable,'-B','-c',boot],capture_output=True,text=True,cwd=harness.parent,env=env,timeout=60)
 lines=[x for x in p.stdout.splitlines() if x.startswith('{')]
 if p.returncode or not lines:raise RuntimeError((name,p.returncode,p.stderr[-2000:]))
 r=json.loads(lines[-1]); assert 'skip' not in r,r
 events=sorted([(s,'F',pt) for s,pt in zip(r['feed_seq'],r['feed'])]+[(s,'R',pt) for s,pt in zip(r['rapid_seq'],r['rapid'])])
 rec={'case':name,'program':prog,'old_routine':older,'parse_error':r['parse_error'],'violations':r['violations'],
      'probe_unpredicted':r.get('probe_unpredicted'),'rapid_dep':r.get('rapid_dep'),'feed_dep':r.get('feed_dep'),
      'position_read_lines':r.get('position_read_lines'),'last_events':events[-4:],'mmap_unchanged':r['mmap_unchanged']}
 if older:
  ok=r['parse_error'] is None and bool(r.get('probe_unpredicted'))
 else:
  last=events[-1][2]
  target=(10.,10.,-80.) if name=='return_disabled' else (60.,60.,-80.)
  ok=r['parse_error'] is None and r['violations']==[] and all(abs(a-b)<1e-8 for a,b in zip(last,target))
  if name=='following_move_establishes_xy':ok=ok and r['feed_dep'][-1]==3 and r['rapid_dep'][-1]==0
 rec['conforms']=ok and r['mmap_unchanged'];results.append(rec)
print(json.dumps({'head':'1c32325c','harness_sha256':hashlib.sha256(source.encode()).hexdigest(),'old_routine_sha256':hashlib.sha256(old_bytes).hexdigest(),'checks':results,'conforming':sum(r['conforms'] for r in results),'contrary':sum(not r['conforms'] for r in results)},indent=2,ensure_ascii=False))
sys.exit(int(any(not r['conforms'] for r in results)))
