"""R263: recheck the supplied reports and mutate only their event evidence.
Usage: python3 worker-proof.py ROOT EVIDENCE_DIR
ROOT = isolated reviewed checkout; EVIDENCE_DIR = Claude's docs/reviews.
No network or modifications.
"""
import sys, json, copy
from pathlib import Path
sys.path.insert(0, str(Path(sys.argv[1])/'scripts'))
from test_select import proof
root=Path(sys.argv[2])
out={}
for name in ['r263-selected','r263-full-w2','r263-full-w3']:
    p=root/f'per-worker-mock.{name}.gate-round.logs'
    r=json.loads((p/'playwright.json').read_text())
    listing=json.loads((p/'list-run.json').read_text())
    ev=[json.loads(s) for s in (p/'mock-events.jsonl').read_text().splitlines()]
    out[name]={'stats':r['stats'], 'identities':len(proof.playwright_tests(r)),
      'execution_errors':proof.check_executed(listing,r),'worker_errors':proof.check_workers(r,ev)}
# All controls start with the actual complete full-w3 events, and change only the noted field.
p=root/'per-worker-mock.r263-full-w3.gate-round.logs'
r=json.loads((p/'playwright.json').read_text())
ev=[json.loads(s) for s in (p/'mock-events.jsonl').read_text().splitlines()]
def case(name, mutate):
    x=copy.deepcopy(ev)
    mutate(x)
    errors=proof.check_workers(r,x)
    out[name]={'expected':'reject', 'actual_errors':errors[:3], 'error_count':len(errors), 'accepted':not errors}
def set_on(x, predicate, field, value):
    for e in x:
        if predicate(e): e[field]=value
case('bound_owner_wrong', lambda x:set_on(x,lambda e:e['event']=='bound','workerIndex',999))
case('slot_wrong',lambda x:set_on(x,lambda e:e['event'] in ('test-start','test-end'),'slot',15))
case('bound_lies_about_endpoint',lambda x:set_on(x,lambda e:e['event']=='bound','endpoint','http://localhost:4500/'))
case('events_from_another_run',lambda x:set_on(x,lambda e:e['event'] in ('test-start','test-end'),'run','old-other-run'))
case('report_worker_mismatch',lambda x:set_on(x,lambda e:e['event'] in ('test-start','test-end'),'workerIndex',999) or None)
# This mismatch has no overlapping spans: shift *all* event owner IDs consistently; the Playwright report is unchanged.
x=copy.deepcopy(ev)
for e in x:
    if 'workerIndex' in e:e['workerIndex']+=100
out['all_event_workers_disagree_with_report']={'expected':'reject','actual_errors':proof.check_workers(r,x)}
# A missing entire bound marker is the existing guard's positive sensitivity control.
x=[e for e in ev if not (e['event']=='bound' and e['workerIndex']==0)]
errors=proof.check_workers(r,x)
out['missing_bound_control']={'rejected':bool(errors), 'error_count':len(errors)}
r2=json.loads((root/'per-worker-mock.r263-full-w2.gate-round.logs/playwright.json').read_text())
out['w2_report_with_w3_event_log']={'expected':'reject', 'actual_errors':proof.check_workers(r2,ev)}
ev2=[json.loads(s) for s in (root/'per-worker-mock.r263-full-w2.gate-round.logs/mock-events.jsonl').read_text().splitlines()]
out['w2_report_with_both_original_event_logs']={'expected':'reject', 'actual_errors':proof.check_workers(r2,ev+ev2)}
print(json.dumps(out,indent=2,ensure_ascii=False))
