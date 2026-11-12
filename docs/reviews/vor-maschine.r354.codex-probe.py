#!/usr/bin/env python3
"""R354 offline review probes. Only mutate an archive copy, restore in finally.
No channel instantiation, machine commands, service access or real gcode parse.
Run with the prepared venv: python probe.py /tmp/codex-r354 output.json
"""
import ast, hashlib, importlib, json, os, subprocess, sys
from pathlib import Path
from unittest import mock
root=Path(sys.argv[1]); out=Path(sys.argv[2])
sys.path.insert(0,str(root/'lcnc-gateway'))
import fake_linuxcnc as fake
import lcnc_iface_check as names
import linuxcnc as native  # class/constant inspection ONLY
results={}
cmd=fake._Command()
cases=[('auto_run_missing_line','auto',(fake.CONSTANTS['AUTO_RUN'],)),
 ('auto_pause_extra_line','auto',(fake.CONSTANTS['AUTO_PAUSE'],1)),
 ('jog_continuous_missing_speed','jog',(fake.CONSTANTS['JOG_CONTINUOUS'],0,0)),
 ('jog_increment_missing_increment','jog',(fake.CONSTANTS['JOG_INCREMENT'],0,0,1.0)),
 ('jog_stop_extra_speed','jog',(fake.CONSTANTS['JOG_STOP'],0,0,1.0)),
 ('jog_bad_selector','jog',(999,0,0))]
results['fake_invalid_call_forms']=[]
for title,method,args in cases:
 before=cmd.serial
 try:
  result=getattr(cmd,method)(*args)
  observed={'accepted':True,'result':result}
 except Exception as e: observed={'accepted':False,'exception':type(e).__name__,'message':str(e)}
 results['fake_invalid_call_forms'].append({'case':title,'method':method,'args':args,'serial_increment':cmd.serial-before,**observed})

def check():
 p=subprocess.run([sys.executable,str(root/'scripts/run_pyright.py'),'--outputjson'],cwd=root,text=True,capture_output=True,timeout=120)
 d=json.loads(p.stdout)
 return {'exit':p.returncode,'summary':d['summary'],'diagnostics':d['generalDiagnostics'],'stderr':p.stderr}

def change(path,transform):
 original=path.read_text()
 return original,transform(original)

def mutation(title,files):
 originals={p:p.read_bytes() if p.exists() else None for p in files}
 try:
  for p,content in files.items(): p.write_text(content)
  results[title]=check()
 finally:
  for p,content in originals.items():
   if content is None:p.unlink()
   else:p.write_bytes(content)

results['baseline']=check()
consumer=root/'typings/conformance/check_codex.py'
mutation('invalid_stub_calls_pass', {consumer:'''import linuxcnc

def calls(c: linuxcnc.command) -> None:
    c.auto(linuxcnc.AUTO_RUN)
    c.auto(linuxcnc.AUTO_PAUSE, 1)
    c.jog(linuxcnc.JOG_CONTINUOUS, 0, 0)
    c.jog(linuxcnc.JOG_INCREMENT, 0, 0, 1.0)
    c.jog(linuxcnc.JOG_STOP, 0, 0, 1.0)
    c.jog(999, 0, 0)
'''})
stub=root/'typings/linuxcnc.pyi'
original=stub.read_text()
added=original.replace('class command:', 'class command:\n    def codex_nonexistent(self) -> None: ...')
assert added != original
mutation('extra_stub_member_passes_gate', {stub:added,consumer:'''import linuxcnc

def use(c: linuxcnc.command) -> None:
    c.codex_nonexistent()
'''})
results['actual_native_missing_extra_member']=not hasattr(native.command,'codex_nonexistent')
results['native_baseline']=names.problems()
# The name checker reads the Protocol and fake constants, not the stub file.
try:
 stub.write_text(added)
 results['native_checker_with_extra_stub_member']=names.problems()
finally:stub.write_text(original)
# It also fails to notice missing module constructors (no channel created).
import types
surface={n:getattr(native,n) for n in dir(native) if not n.startswith('__')}
surface.pop('ini')
with mock.patch.dict(sys.modules,{'linuxcnc':types.SimpleNamespace(**surface)}):
 results['native_checker_with_missing_ini']=names.problems()
surface={n:getattr(native,n) for n in dir(native) if not n.startswith('__')}
surface['stat']=type('StatWithOptional',(),{**{n:getattr(native.stat,n) for n in dir(native.stat) if not n.startswith('__')},'spindle_override':property(lambda self:1.0)})
with mock.patch.dict(sys.modules,{'linuxcnc':types.SimpleNamespace(**surface)}):
 results['native_checker_with_optional_present']=names.problems()

writer=root/'lcnc-gateway/writer_fixture.py'
mutation('excluded_writer_bad_return', {writer:writer.read_text()+"\ndef _codex_bad_return() -> int:\n    return 'wrong'\n"})
cp=root/'lcnc-gateway/command_policy.py'
mutation('promised_strict_module_untyped_definition', {cp:cp.read_text()+"\ndef _codex_untyped(x):\n    return x\n"})
mutation('standard_bad_return_control', {cp:cp.read_text()+"\ndef _codex_bad_return() -> int:\n    return 'wrong'\n"})
results['restored']=check()
results['config']=json.loads((root/'pyrightconfig.json').read_text())
results['meta']={'target':'a16fb55f','root':str(root),'python':sys.executable,'native_access':'import, dir, classes and constants only; no channel, poll, motion or service access'}
out.write_text(json.dumps(results,indent=2)+'\n')
for k,v in results.items():
 print(k, (v.get('exit'),v.get('summary')) if isinstance(v,dict) and 'exit' in v else v if k not in ('config',) else 'saved')
