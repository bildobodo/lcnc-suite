"""No native run: synthetic inputs to the candidate's actual evaluators."""
import json
import sys
sys.path.insert(0, '/tmp/codex-r427/scripts')
from test_support import native_cases as nc

marks={'b_down':0.0,'block_start':1000.0,'block_end':3500.0}
record={'tag':'jog.lease_expired','t_wall_ns':1550000000,'lease':2,
        'stopped':[0],'failed':[],'late_ms':3}
dense=[(i*.05, min(i*.05,1.6)*20, 20 if i*.05<1.6 else 0) for i in range(91)]
def evaluate(samples, **fields):
    return nc.eval_lease_page_blocked('r427',0,marks,samples,[{**record,**fields}],lambda t:t)
control=evaluate(dense)
assert control['status']=='PASS',control
after_restart=[(t,p,v) if t<2.2 else (t,p+(t-2.2)*20,20) for t,p,v in dense]
missing_window=[x for x in dense if x[0]<=1.6 or x[0]>=3.5]
out={'control':control,
     'negative_deadline_evidence':evaluate(dense,late_ms=-100),
     'motion_resumes_during_block':evaluate(after_restart),
     'no_samples_in_standstill_window':evaluate(missing_window)}
print(json.dumps(out,indent=2))
# These should not PASS: keep the actual verdicts as review evidence.
