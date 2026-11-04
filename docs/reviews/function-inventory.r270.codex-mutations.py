"""R270: isolated mutations, restored in finally. Run in the archive copy only."""
from pathlib import Path
import json, os, subprocess, sys
root=Path(sys.argv[1]).resolve() if len(sys.argv)>1 else Path(__file__).resolve().parent
assert str(root).startswith('/tmp/')
node=root/'lcnc-webui/node_modules/vitest/vitest.mjs'
python='/home/cnc/lcnc-suite-dev/lcnc-gateway/.venv/bin/python'
results=[]
def run(name,cmd,cwd):
    p=subprocess.run(cmd,cwd=cwd,text=True,capture_output=True,env={**os.environ,'PYTHONDONTWRITEBYTECODE':'1'})
    (root/(name+'.txt')).write_text(p.stdout+p.stderr)
    results.append({'case':name,'command':cmd,'exit':p.returncode,'log':name+'.txt'})
    return p.returncode
routine=root/'subroutines/probe_basic/probe_cal_round_boss.ngc'
backup=routine.read_bytes()
try:
    routine.unlink()
    assert run('missing-routine-backend',[python,'-B','-m','pytest','scripts/inventory/test_inventory.py','-q'],root)==0
    assert run('missing-routine-web',['node',str(node),'run','src/inventory/webAtoms.test.ts','--maxWorkers=1'],root/'lcnc-webui')==0
finally:
    routine.write_bytes(backup)
var=root/'examples/sim_config/xyz3/sim.var'
backup=var.read_bytes()
try:
    lines=backup.decode().splitlines(keepends=True)
    filtered=[l for l in lines if not l.split() or l.split()[0] != '3036']
    assert len(filtered)==len(lines)-1
    var.write_text(''.join(filtered))
    assert run('wrong-evidence-title',['node',str(node),'run','src/probeVarFiles.test.ts','--maxWorkers=1','-t','are found: one per example profile'],root/'lcnc-webui')==0
    assert run('actual-number-guard',['node',str(node),'run','src/probeVarFiles.test.ts','--maxWorkers=1','-t','declares every number'],root/'lcnc-webui')==1
finally:
    var.write_bytes(backup)
print(json.dumps({'head':'6f10542ae62550a5e21136d33ecb555952861fba','mutations_restored':True,'results':results},indent=2))
