import json,subprocess,sys
from pathlib import Path
root=Path('/tmp/codex-r359');src=root/'lcnc-gateway/gateway.py'
def gate():
 p=subprocess.run([sys.executable,str(root/'scripts/run_pyright.py'),'--outputjson'],cwd=root,text=True,capture_output=True,timeout=120)
 d=json.loads(p.stdout)
 return {'exit':p.returncode,'summary':d['summary'],'diagnostics':d['generalDiagnostics'],'stderr':p.stderr}
r={'target':'999a8ca9'};original=src.read_bytes()
rules=[('jog_stop_speed','op(linuxcnc.command.jog, linuxcnc.JOG_STOP, jf, arg)','op(linuxcnc.command.jog, linuxcnc.JOG_STOP, jf, arg, 1.0)'),
 ('pause_line','op(linuxcnc.command.auto, linuxcnc.AUTO_PAUSE)','op(linuxcnc.command.auto, linuxcnc.AUTO_PAUSE, 9)'),
 ('mode_7','op(linuxcnc.command.mode, mode)','op(linuxcnc.command.mode, 7)')]
try:
 s=original.decode()
 for title,a,b in rules:
  assert s.count(a)==1,(title,s.count(a))
  s=s.replace(a,b)
 r['mutations']=[x[0] for x in rules]
 src.write_text(s)
 r['mutated']=gate()
finally:src.write_bytes(original)
r['restored']=gate()
assert r['mutated']['exit']!=0 and r['restored']['exit']==0
(root/'probes/type-probe.json').write_text(json.dumps(r,indent=2)+'\n')
for k in ['mutated','restored']:print(k,r[k])
