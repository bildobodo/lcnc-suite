"""R275 evidence-binding probes; run on an isolated archive only.
Usage: python3 r275-probe.py /tmp/archive
Temporarily removes one guard in archive/command_policy.py and restores it.
No gateway imports, network, LinuxCNC calls or live evidence scenarios.
"""
import hashlib, json, os, subprocess, sys
from pathlib import Path
root=Path(sys.argv[1]).resolve()
assert str(root).startswith('/tmp/'), 'Archive below /tmp required'
gw=root/'lcnc-gateway'
p=gw/'command_policy.py'
src=p.read_bytes()
env={**os.environ,'PYTHONDONTWRITEBYTECODE':'1'}
def run(names):
 r=subprocess.run([sys.executable,'-B','-m','unittest',*names],cwd=gw,env=env,text=True,capture_output=True)
 return {'tests':names,'exit':r.returncode,'stdout':r.stdout,'stderr':r.stderr}
cited=['test_command_policy.TestKinsRunnable.test_plane_kins_with_its_plane_and_g59_runs','test_command_policy.TestKinsRunnable.test_plane_kins_without_a_plane_refuses']
missing=['test_command_policy.TestKinsRunnable.test_plane_kins_with_g54_selected_refuses_the_post_m2_state']
out={'target':'151d048e','policy_sha256_before':hashlib.sha256(src).hexdigest()}
out['baseline']=run(['test_command_policy'])
try:
 needle='if k == 2 and s.g5x_index != 6:'
 assert src.decode().count(needle)==1
 p.write_text(src.decode().replace(needle,'if False:  # R275: wrong-fixture guard removed'))
 out['missing_g59_guard_cited_tests']=run(cited)
 out['missing_g59_guard_unlinked_countercase']=run(missing)
finally:
 p.write_bytes(src)
out['policy_sha256_after']=hashlib.sha256(p.read_bytes()).hexdigest()
# Read-only concrete scope countercase (existing pure policy + fixture).
query="""import json\nfrom test_command_policy import state\nfrom command_policy import touchoff_route\nprint(json.dumps([{'twp_capable':b, 'fixture':g, 'route':touchoff_route(state(kins_switchable=b,twp_capable=b,kins_type=0,g5x_index=g), ('Z',))} for b in (False,True) for g in range(6,10)]))"""
r=subprocess.run([sys.executable,'-B','-c',query],cwd=gw,env=env,text=True,capture_output=True)
assert r.returncode==0,r.stderr
out['machine_frame_reserved_fixtures']=json.loads(r.stdout)
assert out['baseline']['exit']==0
assert out['missing_g59_guard_cited_tests']['exit']==0
assert out['missing_g59_guard_unlinked_countercase']['exit']==1
assert out['policy_sha256_before']==out['policy_sha256_after']
print(json.dumps(out,indent=2,ensure_ascii=False))
