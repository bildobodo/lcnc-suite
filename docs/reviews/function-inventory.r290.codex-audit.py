"""Read-only R290 source and saved gate audit; no live service access."""
import hashlib
import json
import subprocess
import sys
from pathlib import Path
ROOT = Path(__file__).resolve().parent
LIVE = Path('/home/cnc/lcnc-suite')
sys.path.insert(0, str(ROOT / 'scripts'))
from test_select import proof
logs = Path('/home/cnc/claude-work/teststrat/measure/native.step1.gate-round.run7.logs')
gate = json.loads((Path('/home/cnc/claude-work/teststrat/measure/native.step1.gate-round.run7.json')).read_text())
out = {k: gate.get(k) for k in ['head','base','kind','verdict','omitted','pending','heavy_lock_wait_s']}
out['round_gate'] = gate
listed = json.loads((logs/'unit-light.list.json').read_text())
ran = json.loads((logs/'unit-light.json').read_text())
out['unit-light'] = {'listed': len(listed), 'ran': ran['numTotalTests'], 'passed': ran['numPassedTests'],
                     'issues': proof.check_unit_executed(listed, ran)}
out['backend'] = json.loads((logs/'backend/report.json').read_text())
out['raw_sha256'] = {n: hashlib.sha256((logs/n).read_bytes()).hexdigest() for n in
                     ['unit-light.list.json', 'unit-light.json', 'backend/report.json']}
files=['scripts/native_run.py', 'scripts/test_native_stage.py', 'scripts/install_examples.py',
       *['scripts/test_support/'+n+'.py' for n in ['live_target','native_cases','system_host','restore_lan','live_session','heavy_lock']]]
out['source_hashes'] = {}
for p in files:
    a = (ROOT/p).read_bytes()
    b = subprocess.check_output(['git','-C',str(LIVE),'show','6786d89f:'+p])
    out['source_hashes'][p] = {'sha256': hashlib.sha256(a).hexdigest(), 'matches_6786d89f': a==b}
p = ROOT/'r290-keepalive-source.py'
out['external_keeper'] = {'path': '/home/cnc/claude-work/bg/keepalive_ini.py',
                          'sha256': hashlib.sha256(p.read_bytes()).hexdigest(),
                          'tested': 'only drain function AST; no top-level or socket execution',
                          'not_in_commit': True}
(ROOT/'r290-audit.json').write_text(json.dumps(out, indent=2)+'\n')
print(json.dumps({k: v for k,v in out.items() if k not in ['source_hashes','raw_sha256','backend','round_gate']}, indent=2))
print('All source hashes match:', all(v['matches_6786d89f'] for v in out['source_hashes'].values()))
print('backend report keys:', list(out['backend']))
