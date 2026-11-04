"""R269: local implementation notes; no gateway import, sockets or machine access.
Run: python3 -B probe.py /path/to/lcnc-suite
"""
from pathlib import Path
import hashlib
import json
import os
import runpy
import shlex
import subprocess
import sys
from unittest.mock import patch

root = Path(sys.argv[1]).resolve()
source = root / 'lcnc-gateway/lcnc_paths.py'
namespace = runpy.run_path(str(source), run_name='r269_path_probe')
# Intercept mkdir: this checks impurity without creating even a test log path.
with patch.dict(os.environ, {'LCNC_LOG_DIR': '/tmp/r269-only-a-marker'}):
    with patch('os.makedirs') as mkdir:
        requested = namespace['_requested']()
        pure_calls = mkdir.call_count
        resolved, reason = namespace['resolve']()
        resolve_calls = [str(call.args[0]) for call in mkdir.call_args_list]
assert pure_calls == 0
assert resolve_calls == ['/tmp/r269-only-a-marker']

# A shell exports after exec. Read just our marker from the shell's proc file
# and from its newly exec'd child's environment. No other env data is recorded.
child = """import json,os
from pathlib import Path
key=b'R269_ADDED_AFTER_EXEC='
parent=Path('/proc') / str(os.getppid()) / 'environ'
values=[x[len(key):].decode() for x in parent.read_bytes().split(b'\\0') if x.startswith(key)]
print(json.dumps({'shell_proc_marker':values,'child_marker':os.environ.get('R269_ADDED_AFTER_EXEC')}))
"""
command = "export R269_ADDED_AFTER_EXEC=owned-marker\n" + shlex.quote(sys.executable) + " -B -c " + shlex.quote(child) + "\nprintf ''\n"
proc = subprocess.run(['/bin/bash', '--noprofile', '--norc', '-c', command],
                      env={'PATH':'/usr/bin:/bin'}, text=True, capture_output=True, check=True)
environ = json.loads(proc.stdout)
assert environ == {'shell_proc_marker': [], 'child_marker': 'owned-marker'}
print(json.dumps({
    'review_head': subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip(),
    'source_sha256': hashlib.sha256(source.read_bytes()).hexdigest(),
    'path_probe': {'requested':requested,'requested_mkdir_calls':pure_calls,
                   'resolve_mkdir_calls':resolve_calls,'mkdir_intercepted_no_write':True},
    'environment_probe':environ,
    'meaning':'Use a pure path selector before admission; inspect the inherited environment of the launched child, not a late export in the shell proc environ.',
}, indent=2))
