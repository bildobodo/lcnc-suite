"""R278: exercise the Start->Resume case with the real paused gate pair.
An isolated 59ae81e8 archive is required, including local node_modules.
The generated test copies the existing harness and changes only run:true to
run:false in its Start/Resume case. Source restored in finally.
"""
import hashlib
import json
from pathlib import Path
import subprocess
import sys

root = Path(sys.argv[1]).resolve()
if not str(root).startswith('/tmp/'): raise SystemExit('isolated /tmp archive required')
web = root / 'lcnc-webui'
source = web / 'src/useGamepad.ts'
original = source.read_bytes()
test_source = (web / 'src/useGamepad.test.ts').read_text()
old = '{ action: "start", open: { run: true, resume: true }'
new = '{ action: "start", open: { run: false, resume: true }'
if test_source.count(old) != 1: raise RuntimeError('test anchor')
probe = web / 'src/r278Gamepad.test.ts'
if probe.exists(): raise RuntimeError('probe file exists')
out = {'target': '59ae81e8', 'test_change': [old, new], 'sha_before': hashlib.sha256(original).hexdigest()}
def run(files, pattern=None):
    args = ['node','node_modules/vitest/vitest.mjs','run',*files,'--maxWorkers=1','--allowOnly=false','--retry=0']
    if pattern: args += ['-t',pattern]
    p = subprocess.run(args,cwd=web,text=True,capture_output=True)
    return {'exit':p.returncode,'stdout':p.stdout,'stderr':p.stderr}
try:
    probe.write_text(test_source.replace(old,new))
    out['baseline_paused_case'] = run(['src/r278Gamepad.test.ts'],r"'start'.*'cycle_resume'")
    if '1 passed' not in out['baseline_paused_case']['stdout']: raise RuntimeError('baseline case did not execute')
    old_code = 'if (perms.resume) deps.fire({ cmd: "cycle_resume" }, ACTION_GATES.resume);'
    new_code = 'if (perms.resume && perms.run) deps.fire({ cmd: "cycle_resume" }, ACTION_GATES.resume);'
    if original.decode().count(old_code)!=1:raise RuntimeError('source anchor')
    out['mutation']=[old_code,new_code]
    source.write_text(original.decode().replace(old_code,new_code))
    out['existing_tests_with_mutation']=run(['src/useGamepad.test.ts','src/actionAdmission.test.ts'])
    out['paused_case_with_mutation']=run(['src/r278Gamepad.test.ts'],r"'start'.*'cycle_resume'")
    if out['paused_case_with_mutation']['exit'] != 1 or 'AssertionError' not in out['paused_case_with_mutation']['stderr']:
        raise RuntimeError('counterexample not observed')
finally:
    source.write_bytes(original)
    probe.unlink(missing_ok=True)
    out['sha_after']=hashlib.sha256(source.read_bytes()).hexdigest()
    (root/'gamepad-probe.json').write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(out,ensure_ascii=False,indent=2))
