"""R313: pure evaluator + scripted whole step, plus saved run re-evaluation.
No LinuxCNC import or live transport. Usage: PY -B c.py ARCHIVE SAVED_RUN OUT_JSON
"""
import copy,json,sys,tempfile,hashlib
from pathlib import Path
root=Path(sys.argv[1]);run=Path(sys.argv[2])
sys.path.insert(0,str(root/'scripts'));sys.path.insert(0,str(root/'lcnc-gateway'))
import test_native_stage as t
from test_support import native_cases as nc
import toolsetter_rules as tr
report=json.loads((run/'report.json').read_text())
by={r['case']:r for r in report['rows']}
r=by['ts-sync-program-m600'];book=by['ts-sync-booking']
# Expected section from the recorded OLD booking plus the planted change,
# not from the very after-booking being judged.
seed={}
for line in (root/'examples/sim_config/xyz3/sim.var').read_text().splitlines():
    a=line.split()
    if len(a)>=2 and a[0].isdigit(): seed[a[0]]=float(a[1])
old={k:tr.canonical(seed[k]) for k in nc.TS_KEYS}
old['3005']=t.nr.M600_SLOW
values={**old,'3102':r['new_3102']}
section={k:values[str(v)] for k,v in tr.VAR_MAP.items()}
out={'recording':{'commit':report['commit'],'report_sha256':hashlib.sha256((run/'report.json').read_bytes()).hexdigest(),'report_verdict':report['verdict'],'restore':report['restore']['outcome'],'isolation':report['restore']['isolation']},'section':section}
kw={k:r[k] for k in ['l0','old_3102','new_3102','length','g43','interp_before','interp_after','errors']}
kw['note']=r['toolsetter']
pos=nc.eval_ts_sync('ts-sync-program-m600',**kw)
neg=nc.eval_ts_sync('old-basis',**{**kw,'new_3102':r['old_3102']})
bk=nc.eval_ts_booking('ts-sync-booking',old,values,book['before'],book['after'],canon=tr.canonical)
st=by['ts-sync-stable']
stable=nc.eval_ts_stable('ts-sync-stable',st['toolsetter'],st['version_before'],st['version_after'])
assert [x['status'] for x in (pos,neg,bk,stable)]==['PASS','FAIL','PASS','PASS']
out['saved_run']={'positive':pos,'counter':neg,'booking':bk,'stable':stable}
trace=run/'logs/trace.ndjson'
events=[json.loads(s) for s in trace.read_text().splitlines()]
selected=[]
for ev in events:
    if ev.get('tag')=='toolsetter.sync' or (ev.get('tag')=='nml.error' and ev.get('kind')==11):
        selected.append({k:v for k,v in ev.items() if k in ('t_wall_ns','t_mono_ms','tag','level','kind','text','set_up','wrote','taken','digest')})
out['saved_trace']={'sha256':hashlib.sha256(trace.read_bytes()).hexdigest(),'selected':selected}
assert sum(ev.get('tag')=='toolsetter.sync' for ev in selected)==2
assert [ev['wrote'] for ev in selected if ev.get('tag')=='toolsetter.sync']==[True,False]
sync_start=min(ev['t_mono_ms'] for ev in selected if ev.get('tag')=='toolsetter.sync')
assert not any(ev.get('kind')==11 and ev['t_mono_ms']>=sync_start for ev in selected)
out['booking_countercases']={}
for name in ('after_wrong_six_decimals','before_empty','before_assumed','before_wrong_number'):
    before,after=copy.deepcopy(book['before']),copy.deepcopy(book['after'])
    if name=='after_wrong_six_decimals': after['keys']['3102']['value']+=0.000001
    elif name=='before_empty': before['keys']={}
    elif name=='before_assumed': before['keys']['3102']['origin']='assumed'
    else: before['keys']['3102']['value']=-42.0
    result=nc.eval_ts_booking(name,old,values,before,after,canon=tr.canonical)
    expected='incomplete' if name in ('before_empty','before_assumed') else 'FAIL'
    assert result['status']==expected,result
    out['booking_countercases'][name]={'actual':result,'before':before,'after':after}

class StableError(t.TsClient):
    def request(self,cmd,**kw):
        second=cmd=='cycle_start' and self.starts==1
        result=super().request(cmd,**kw)
        if second:
            self.errors.append((self.frames[-1][0],11,'R313: the second program ended with an NML error'))
        return result

t.nr.SHORT_GRACE=.02
out['whole_step']={}
for name,cls in [('baseline',t.TsClient),('second_start_nml_error',StableError)]:
    with tempfile.TemporaryDirectory(prefix='codex-r312-c-') as td:
        c=cls();ctx,step=t._ts_step(Path(td),c)
        rows=step(ctx)
        verdict=t.nr.verdict({'rows':rows,'restore':{'outcome':'complete','isolation':[]}})
        expected='FAIL' if name=='second_start_nml_error' else 'PASS'
        assert verdict==expected,rows
        out['whole_step'][name]={'rows':rows,'nml_errors':[x for x in c.errors if x[1]==11],
                                'aggregate_with_successful_restore':verdict,'actual_network':False}
Path(sys.argv[3]).write_text(json.dumps(out,indent=2)+'\n')
