"""R200 offline audit. Usage: python3 audit.py DOCS_REVIEWS REPRODUCTION_OUTPUT AUDIT_JSON
Run codex-reproduce.py with retained evidence first. No live access.
"""
from pathlib import Path
import json,re,sys
D,O,dest=[Path(x).resolve() for x in sys.argv[1:4]];R=O/'raw'
# A direct raw-directory replay can pass a sibling raw directory instead.
if not R.exists(): R=O.parent/'raw'
marks=json.loads((D/'viewer-palette-fest.r200.marks-f.json').read_text())
anchor=json.loads((D/'viewer-palette-fest.r200.anchors-f.json').read_text())
report=json.loads((O/'f-reproduced.json').read_text());phase={p['phase']:p for p in report['phases']}
rows=[json.loads(x) for x in (R/'trace.ndjson').read_text().splitlines()]
origin=anchor['wall_ns']-anchor['wd_ms']*10**6
wd=[]
for m in re.finditer(r'\[HB-RISING\] \+(\d+)ms True-to-True gap (\d+)ms',(R/'hal_watchdog.log').read_text()):
 t=origin+int(m[1])*10**6
 if marks[1]['t_wall_ns']<=t<marks[-1]['t_wall_ns']:wd.append({'t_wall_ns':t,'integer_gap_ms':int(m[2])})
assert [w['integer_gap_ms'] for w in wd]==[203]
assert phase['R_run']['hal_heartbeat']['watchdog_receipt']=={'status':'gaps','gaps_ms':[203]}
assert all(p['hal_heartbeat']['watchdog_receipt']['status']=='bound' for n,p in phase.items() if n not in ['R_run','prep'])
assert all(p['coverage']['complete'] and p['target_age_p95_under_50ms']['verdict']=='met' for p in phase.values())
assert all(p['parse_overlap']==0 for p in phase.values())
assert phase['S_supersede']['collision']=={'sweep_start':1,'sweep_cancelled':1}
assert phase['S_supersede']['main_thread']['spans']['path_reply']['n']==1
assert phase['S_settle']['collision']=={'sweep_start':1,'sweep_done':1,'done_ms':[47130]}
assert phase['S_supersede']['verdict']['verdict']=='S met'
assert phase['R_run']['verdict']['verdict']=='R overlap proven'
# S, using only the page's own performance clock for ordering.
a=next(m for m in marks if m['name']=='S_supersede')['t_wall_ns'];b=next(m for m in marks if m['name']=='R_load')['t_wall_ns']
sel=[r for r in rows if a<=r['t_wall_ns']<b and r.get('page')=='y3jq4dik']
starts=[r for r in sel if r['tag']=='browser.collision.sweep_start'];cancel=next(r for r in sel if r['tag']=='browser.collision.sweep_cancelled');done=next(r for r in sel if r['tag']=='browser.collision.sweep_done');on=next(r for r in sel if r['tag']=='browser.preview.parse_seen' and r.get('state')=='on')
assert starts[0]['t_perf_ms']<on['t_perf_ms']<cancel['t_perf_ms']<starts[1]['t_perf_ms']<done['t_perf_ms']
assert starts[0]['id']==cancel['id'] and starts[1]['id']==done['id'] and done['covered']==1 and done.get('truncated') is None
perf=[r for r in rows if r['tag']=='browser.viewer.perf' and r.get('page')=='y3jq4dik']
inputs={}
for m0,m1 in zip(marks,marks[1:]):
 rr=[r for r in perf if m0['t_wall_ns']<=r['t_wall_ns']<m1['t_wall_ns'] and r.get('in_n',0)]
 inputs[m0['name']]=[{'received_ns':r['t_wall_ns'],'page_perf_ms':r['t_perf_ms'],'presses':r['in_n'],'window_ms':r['win_ms'],'input_max_ms':r['in_delay_max_ms']} for r in rr]
# Keep the disturbance; never discard it from the histogram on a host hypothesis.
t=wd[0]['t_wall_ns'];context=[r for r in rows if t-4e9<=r['t_wall_ns']<t+5e9 and r['tag'] in ['loop.tick','lag.window','wd.tick_summary','hal.send_summary','proc.status','browser.viewer.perf']]
late=[r for r in rows if marks[-2]['t_wall_ns']<=r['t_wall_ns']<marks[-1]['t_wall_ns']+15e9 and r.get('tag')=='browser.collision.sweep_done']
assert len(late)==1 and late[0]['id']==56 and late[0]['covered']==1 and late[0].get('truncated') is None
out={'report_identical':report==json.loads((D/'viewer-palette-fest.r200.report-f.json').read_text()),'all_phases_complete':True,'all_phase_age_p95_ms':{n:p['status']['age_ms']['p95'] for n,p in phase.items()},'S_contract_met':True,'S_cancel_after_parse_seen_ms':cancel['t_perf_ms']-on['t_perf_ms'],'S_completion':done,'S_input_p95_upper_ms':phase['S_supersede']['input']['delay_ms']['p95'],'input_rows':inputs,'watchdog':{'log_instrumentation':'lcnc-gateway/hal_watchdog.py int(gap_ms)>200 logs every exceeding True-to-True interval','gaps':wd,'derived_max_strict_upper_ms':204,'original_target_p99_lt300_met_by_bound':True,'source_target':'Review R182, answers point 2: p99 < 300 ms; 201 ms was a sufficient measured bound, not a new requirement','host_cause':'plausible common disturbance, not proven; no exclusion used'},'disturbance_events':context,'R_proof':phase['R_run']['verdict']['proof'],'R_settle_late_completion':late[0],'max_phase_edge_s':max(max(x['edge_start_s'],x['edge_end_s']) for p in phase.values() for x in p['coverage']['pages'].values())}
dest.write_text(json.dumps(out,indent=2)+'\n');print(json.dumps({k:out[k] for k in ['report_identical','all_phases_complete','S_contract_met','S_cancel_after_parse_seen_ms','max_phase_edge_s']}))
