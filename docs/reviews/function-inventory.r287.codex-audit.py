"""Read-only source and saved gate verification for R287."""
import hashlib
import json
import subprocess
import sys
from pathlib import Path

ROOT=Path('/tmp/codex-r287')
LIVE=Path('/home/cnc/lcnc-suite')
sys.path.insert(0,str(ROOT/'scripts'))
from test_select import proof

r=Path('/home/cnc/claude-work/teststrat/measure/native.step1.gate-round.run3.logs')
report=json.loads((LIVE/'docs/reviews/native-stage.step1.gate-round.run3.json').read_text())
out={k:report.get(k) for k in ['head','base','kind','verdict','omitted','pending','heavy_lock_wait_s']}
listed=json.loads((r/'unit-light.list.json').read_text())
ran=json.loads((r/'unit-light.json').read_text())
out['unit-light']={'listed':len(listed),'ran':ran['numTotalTests'],'passed':ran['numPassedTests'],
                   'issues':proof.check_unit_executed(listed,ran)}
listed=json.loads((r/'list-run.json').read_text())
ran=json.loads((r/'playwright.json').read_text())
events=[json.loads(s) for s in (r/'mock-events.jsonl').read_text().splitlines()]
out['browser']={'stats':ran['stats'],'execution_issues':proof.check_executed(listed,ran),
                'worker_issues':proof.check_workers(ran,events,proof.report_run(ran))}
out['raw_sha256']={n:hashlib.sha256((r/n).read_bytes()).hexdigest() for n in
                  ['unit-light.json','unit-light.list.json','playwright.json','list-run.json','mock-events.jsonl','backend/report.json']}
files=['scripts/native_run.py','scripts/install_examples.py','scripts/test_native_stage.py',
       *['scripts/test_support/'+s+'.py' for s in ['live_target','native_cases','system_host','restore_lan','live_session','heavy_lock']]]
out['source_hashes']={}
for p in files:
    a=(ROOT/p).read_bytes()
    b=subprocess.check_output(['git','-C',str(LIVE),'show','7d9c79c2:'+p])
    out['source_hashes'][p]={'sha256':hashlib.sha256(a).hexdigest(),'matches_7d9c79c2':a==b}
(ROOT/'r287-audit.json').write_text(json.dumps(out,indent=2)+'\n')
print(json.dumps({k:v for k,v in out.items() if k not in ['source_hashes','raw_sha256']},indent=2))
