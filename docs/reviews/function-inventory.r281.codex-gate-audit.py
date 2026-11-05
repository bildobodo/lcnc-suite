import sys,json,hashlib
from pathlib import Path
sys.path.insert(0,'/tmp/codex-r281/scripts')
from test_select import proof
from test_select.rules import HEAVY_UNIT
r=Path('/home/cnc/claude-work/teststrat/measure/integ.merge-gate.run5.logs')
report=json.loads(Path('/home/cnc/lcnc-suite/docs/reviews/statements-comp.merge-gate.run5.json').read_text())
out={'head':report['head'],'kind':report['kind'],'omitted':report['omitted'],'pending':report['pending'],'heavy_selection_matches':set(report['selection']['unit']['heavy'])==set(HEAVY_UNIT)}
for name in ['unit-light','unit-heavy']:
 listed=json.loads((r/(name+'.list.json')).read_text());ran=json.loads((r/(name+'.json')).read_text());out[name]={'discovered':len(listed),'ran':ran['numTotalTests'],'passed':ran['numPassedTests'],'failed':ran['numFailedTests'],'issues':proof.check_unit_executed(listed,ran),'files':sorted({Path(x['file']).name for x in listed})}
listed=json.loads((r/'list-run.json').read_text());ran=json.loads((r/'playwright.json').read_text());events=[json.loads(l) for l in (r/'mock-events.jsonl').read_text().splitlines()];run=proof.report_run(ran)
out['browser']={'stats':ran['stats'],'execution_issues':proof.check_executed(listed,ran),'worker_issues':proof.check_workers(ran,events,run),'run':run}
out['raw_report_sha256']={n:hashlib.sha256((r/n).read_bytes()).hexdigest() for n in ['unit-heavy.json','unit-heavy.list.json','unit-light.json','unit-light.list.json','playwright.json','list-run.json','mock-events.jsonl']}
Path('/tmp/codex-r281/gate-audit.json').write_text(json.dumps(out,indent=2)+'\n')
print({k:({kk:vv for kk,vv in v.items() if kk!='files'} if isinstance(v,dict) else v) for k,v in out.items() if k!='raw_report_sha256'})
