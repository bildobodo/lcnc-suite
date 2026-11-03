"""R264 independent counter-cases using the original final full-run evidence.
Usage: python3 proof-review.py REVIEWED_CHECKOUT CLAUDE_DOCS_REVIEWS
"""
from pathlib import Path
import sys,json,copy,collections
sys.path.insert(0,str(Path(sys.argv[1])/'scripts'))
from test_select import proof
root=Path(sys.argv[2]); name='per-worker-mock.r264-full-w3.gate-round'
gate=json.loads((root/(name+'.json')).read_text()); p=root/(name+'.logs')
r=json.loads((p/'playwright.json').read_text()); listing=json.loads((p/'list-run.json').read_text())
ev=[json.loads(s) for s in (p/'mock-events.jsonl').read_text().splitlines()]
run=next(c['run'] for c in gate['checks'] if c['name']=='browser-workers')
def check(report,events):return proof.check_report_run(report,run)+proof.check_workers(report,events,run)
out={'original':{'run':run,'report_run':proof.report_run(r),'stats':r['stats'],'results':len(proof.playwright_results(r)),
 'execution_errors':proof.check_executed(listing,r),'worker_errors':check(r,ev),
 'event_counts':dict(collections.Counter(e['event'] for e in ev))}}
assert not out['original']['execution_errors'] and not out['original']['worker_errors']
def mutate(name,fn):
    rr,ee=copy.deepcopy(r),copy.deepcopy(ev); fn(rr,ee)
    errors=check(rr,ee)
    out[name]={'rejected':bool(errors),'count':len(errors),'first':errors[:2]}
    assert errors,name

def assign(ee,cond,field,value):
    for e in ee:
        if cond(e):e[field]=value
is_test=lambda e:e['event'] in ('test-start','test-end')
mutate('wrong_bound_owner',lambda rr,ee:assign(ee,lambda e:e['event']=='bound','workerIndex',999))
mutate('wrong_test_slot',lambda rr,ee:assign(ee,is_test,'slot',15))
mutate('shared_endpoint',lambda rr,ee:assign(ee,lambda e:e['event']=='bound','endpoint','http://localhost:4500/'))
mutate('foreign_event_run',lambda rr,ee:assign(ee,is_test,'run','old-run'))
mutate('foreign_report_run',lambda rr,ee:rr['config']['metadata'].__setitem__('run','old-run'))
mutate('missing_report_run',lambda rr,ee:rr['config']['metadata'].pop('run'))
mutate('shifted_workers',lambda rr,ee:[e.__setitem__('workerIndex',e['workerIndex']+100) for e in ee if 'workerIndex' in e])
mutate('missing_stop',lambda rr,ee:ee.__setitem__(slice(None),[e for e in ee if e['event']!='stopped']))
mutate('missing_bound',lambda rr,ee:ee.__setitem__(slice(None),[e for e in ee if not (e['event']=='bound' and e['workerIndex']==0)]))
# Duplicate one actual complete start/end pair, in its original lifetime.
start=next(i for i,e in enumerate(ev) if e['event']=='test-start'); identity=lambda e:tuple(e.get(k) for k in ('file','project','title','retry'))
end=next(i for i,e in enumerate(ev) if e['event']=='test-end' and identity(e)==identity(ev[start]))
mutate('duplicate_complete_pair',lambda rr,ee:ee.__setitem__(slice(end+1,end+1),[copy.deepcopy(ev[start]),copy.deepcopy(ev[end])]))
mutate('test_before_bind',lambda rr,ee:ee.insert(0,ee.pop(start)))
mutate('test_after_stop',lambda rr,ee:ee.append(ee.pop(end)))
mutate('end_missing',lambda rr,ee:ee.pop(end))
mutate('foreign_pair',lambda rr,ee:ee.__setitem__(slice(end+1,end+1),[{**ev[start],'title':'unreported case'},{**ev[end],'title':'unreported case'}]))
mutate('same_case_wrong_retry',lambda rr,ee:assign(ee,lambda e:is_test(e) and identity(e)==identity(ev[start]),'retry',1))
for old in ['r263-full-w2','r263-full-w3']:
    oldp=root/f'per-worker-mock.{old}.gate-round.logs'
    oldev=[json.loads(s) for s in (oldp/'mock-events.jsonl').read_text().splitlines()]
    mutate('current_report_old_log_'+old,lambda rr,ee:ee.__setitem__(slice(None),oldev))
    mutate('old_plus_current_log_'+old,lambda rr,ee:ee.__setitem__(slice(0,0),oldev))
print(json.dumps(out,indent=2,ensure_ascii=False))
