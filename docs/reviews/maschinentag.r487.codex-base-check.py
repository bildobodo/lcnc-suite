import os
import subprocess
from pathlib import Path
import msgspec

root=Path('/tmp/r487/base/lcnc-gateway')
py='/home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python'
with open('/tmp/r487/base-red.txt','w') as f:
    p=subprocess.run([py,'-m','pytest','-p','conftest',
        'test_path_kinds_worker.py::TestTheProgramsThatLostTheirChanges',
        '--junitxml=/tmp/r487/base-red.xml'],cwd=root,stdout=f,stderr=subprocess.STDOUT,timeout=120)
assert p.returncode==1,p.returncode
env=dict(os.environ);env.pop('START_PROBE_UNTHINNED',None)
p=subprocess.run([py,'native_start_probe.py','@/tmp/r487/three_reversals.json',
    '/tmp/r487/base-three_reversals.msgpack'],cwd=root,env=env,capture_output=True,text=True,timeout=120)
Path('/tmp/r487/base-probe.txt').write_text(p.stdout+'\n'+p.stderr)
assert p.returncode==0,p.stderr
before=msgspec.msgpack.decode(Path('/tmp/r487/base-three_reversals.msgpack').read_bytes())
after=msgspec.msgpack.decode(Path('/tmp/r487/three_reversals.msgpack').read_bytes())
assert before==after
print('old product: five targeted regressions red; same-kind counterexample payload unchanged')
