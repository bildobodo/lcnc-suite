"""R103 plan counterexamples, run ONLY in a git archive under /tmp.
No implementation of planned M600. Gateway function is extracted unchanged;
all of its dependencies are fakes. Native worker uses synthetic STAT and a
command() stub that raises. Usage: python3 evidence/<this file>.py
"""
from pathlib import Path
import ast,asyncio,json,subprocess,typing,types,re,hashlib,difflib
root=Path(__file__).resolve().parents[1];assert root.is_relative_to('/tmp') and not (root/'.git').exists()
ev=root/'evidence';gw=root/'lcnc-gateway';pre='viewer-palette-fest.r103.codex-'
s=(gw/'gateway.py').read_text();node=next(n for n in ast.parse(s).body if isinstance(n,ast.AsyncFunctionDef) and n.name=='_apply_probe_vars');fragment=ast.get_source_segment(s,node)
values={str(k):float(v) for k,v in {
 3004:300,3005:100,3006:1000,3007:30,3009:3,3010:150,3013:0,
 3100:20,3101:30,3102:-100,3103:1,3104:5,3105:0,3106:0,3107:5,
 3108:1,3109:0,3110:0,3111:10,3112:20,3113:40,3114:50,3115:3}.items()}
before={**values,'3004':200.0,'3100':10.0,'3101':15.0,'3102':-90.0,'3113':15.0,'3114':20.0,'3115':0.0}
async def trial(cancel=False):
 calls=[];memory=before.copy();saved={};trace=[]
 def write(_path,vals):saved.update(vals)
 async def thread(fn,*a):return fn(*a)
 async def mode(_):pass
 async def send(_fn,line,wait):
  index=len(calls);calls.append(line)
  if index==1:
   if cancel:raise asyncio.CancelledError()
   return 3
  for k,v in re.findall(r'#(\d+)=([-\d.]+)',line):memory[k]=float(v)
  return 1
 env={'Dict':typing.Dict,'Any':typing.Any,'_skip_flag_unknown':False,'STAT':types.SimpleNamespace(ini_filename='/synthetic/machine.ini',poll=lambda:None),
 'linuxcnc':types.SimpleNamespace(ini=lambda _:types.SimpleNamespace(find=lambda *_:'/synthetic/machine.var'),MODE_MDI=3),
 'os':__import__('os'),'finite_float':float,'_trace':types.SimpleNamespace(emit=lambda *a,**kw:trace.append((a,kw))),
 '_get_var_file_lock':asyncio.Lock,'_var_file_thread':thread,'_write_var_file_updates':write,'_status_runtime':types.SimpleNamespace(mark_var_file_written=lambda _:None),
 'safe_get':lambda k,d:True if k=='enabled' else d,'reject_if_auto_running':lambda:None,'set_mode':mode,'_cmd_blocking':send,
 'CMD':types.SimpleNamespace(mdi=lambda _:None),'_cmd_rc_failed':lambda rc:rc==3}
 exec(compile(fragment,str(gw/'gateway.py')+'::_apply_probe_vars','exec'),env)
 try:result=await env['_apply_probe_vars'](values,True)
 except asyncio.CancelledError:result='CancelledError'
 assert memory['3004']==300.0 and before['3004']==200.0
 assert memory['3115']==0.0 and values['3115']==3.0
 assert result=='CancelledError' if cancel else result==(True,False)
 return {'result':result,'calls':calls,'interpreter_model_after':memory,'file_model_after':saved,'trace':trace,'before':before}
trials={'second_chunk_error':asyncio.run(trial()),'cancel_after_first_chunk':asyncio.run(trial(True))}
(ev/(pre+'basis.json')).write_text(json.dumps({'function_sha256':hashlib.sha256(fragment.encode()).hexdigest(),'trials':trials},indent=2)+'\n')

# A literal expansion of ONLY the planned replacement moves; no routine built.
prefix='G21 G90 G49\nG0 Z-85\nG53 G1 Z-90 F100\nG53 G1 Z-87\nG53 G1 Z-90\nG53 G1 Z-87\nG53 G0 Z0\n'
after='G43\no100 if [#5070 EQ 1]\nG0 X100\no100 else\nG0 X-100\no100 endif\nG0 Y#5063\nM2\n'
cases={
 'replacement_only':(prefix+after,'mm',0.0,(490,),{}),
 'old_probe_then_replacement':('G21 G90 G49\nG0 Z0\nG38.3 Z-15 F100\n'+prefix+after,'mm',0.0,(490,),{}),
 'replacement_with_explicit_predicted_results':(prefix+'#5063=-90\n#5070=1\n'+after,'mm',0.0,(490,),{}),
}
(ev/(pre+'native-cases.json')).write_text(json.dumps(cases,indent=2)+'\n')
base=(gw/'native_start_probe.py').read_text();needle='program, units, z_off, gcodes_live, extra = CASES[sys.argv[1]]';assert base.count(needle)==1
probe=gw/'r103.native.py';assert not probe.exists();new=base.replace(needle,'CASES.update('+repr(cases)+')\n\n'+needle);probe.write_text(new)
(ev/(pre+'native.patch')).write_text(''.join(difflib.unified_diff(base.splitlines(True),new.splitlines(True),fromfile='native_start_probe.py',tofile='r103.native.py')))
outs={}
try:
 for name in cases:
  r=subprocess.run(['nice','-n','19','/home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python',probe.name,name],cwd=gw,capture_output=True,text=True,timeout=30)
  outs[name]={'exit':r.returncode,'stderr':r.stderr,'out':json.loads(r.stdout) if r.returncode==0 else r.stdout}
  assert r.returncode==0 and outs[name]['out']['parse_error'] is None,outs[name]
  expected={'replacement_only':[-100,0], 'old_probe_then_replacement':[-100,-15], 'replacement_with_explicit_predicted_results':[100,-90]}[name]
  assert outs[name]['out']['rapid'][-1][:2]==expected,outs[name]
finally:probe.unlink()
(ev/(pre+'native.json')).write_text(json.dumps(outs,indent=2)+'\n')
print(json.dumps({'basis_results':{k:v['result'] for k,v in trials.items()},'native':{k:{'error':v['out']['parse_error'],'last_rapid':v['out']['rapid'][-1]} for k,v in outs.items()}},indent=2))
