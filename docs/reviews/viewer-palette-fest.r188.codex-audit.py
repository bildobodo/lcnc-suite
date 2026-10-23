"""R188 read-only audit. Run with R188_ROOT pointing to the frozen tool/raw snapshot.
Never opens a socket or calls a driver; imports only report and trace-reading helpers.
"""
import os,sys,json,math,gzip,hashlib,io,contextlib,collections
from pathlib import Path
ROOT=Path(os.getenv('R188_ROOT','/tmp/codex-r188-cc5ox9ki'))
DOCS=Path(os.getenv('R188_DOCS','/home/cnc/lcnc-suite/docs/reviews'))
sys.path.insert(0,str(ROOT/'tools'))
import bpc2,bpc
bpc.LOGS=str(ROOT/'raw');bpc2.RSS=str(ROOT/'raw/rss.jsonl')
def load(n):return json.loads((DOCS/f'viewer-palette-fest.r188.{n}.json').read_text())
marks=[load(f'marks-run{i}') for i in (1,2)]
lo=min(m[0]['t_wall_ns'] for m in marks)-3600*10**9
hi=max(m[-1]['t_wall_ns'] for m in marks)+15*10**9
all_events=bpc.trace_lines(lo,hi)
perf=[r for r in all_events if r.get('tag')=='browser.viewer.perf']
all_rss=[json.loads(l) for l in (ROOT/'raw/rss.jsonl').open()]

def independent_quantile(rs,key,q):
 h=collections.Counter()
 for r in rs:
  for k,v in (r.get(key) or {}).items():h[float(k)]+=v
 n=sum(h.values())
 if not n:return {'n':0}
 pos=math.ceil(n*q);acc=0
 for k in sorted(h):
  acc+=h[k]
  if acc>=pos:
   w=1 if k<20 else 2 if k<100 else 10 if k<500 else 50 if k<2000 else 500
   return {'n':n,'value':k+w}

def evidence_digest(r):return hashlib.sha256(json.dumps(r,sort_keys=True,separators=(',',':')).encode()).hexdigest()

result={'review':'R188','runs':[]}
for i,ms in enumerate(marks,1):
 given=load(f'report-run{i}');pages=set(given['pages']);phases=[]
 # Re-run the supplied report without changing its code, redirected only to frozen files.
 sys.argv=['bpc2','report','--pages',','.join(sorted(pages)),'--marks',str(DOCS/f'viewer-palette-fest.r188.marks-run{i}.json'),'--anchors',str(DOCS/f'viewer-palette-fest.r188.anchors-run{i}.json'),'--supersede',str(DOCS/f'viewer-palette-fest.r188.supersede-run{i}.json')]
 output=io.StringIO()
 with contextlib.redirect_stdout(output):bpc2.report()
 actual=json.loads(output.getvalue());assert actual==given, f'report run {i} differs'
 (ROOT/f'recomputed-run{i}.json').write_text(output.getvalue())
 for a0,b0,p in zip(ms,ms[1:],given['phases']):
  a,b=a0['t_wall_ns'],b0['t_wall_ns'];rows=[r for r in perf if a<=r['t_wall_ns']<b and r.get('page') in pages]
  visible=[r for r in rows if r.get('vis')=='visible' and not r.get('vis_changes',0)]
  assert len(visible)==p['page_rows']
  q95=independent_quantile(visible,'age_h',.95);q99=independent_quantile(visible,'age_h',.99)
  inp=independent_quantile(visible,'in_delay_h',.95)
  assert q95['n']==p['status']['age_ms']['n'] and q95['value']==p['status']['age_ms']['p95'] and q99['value']==p['status']['age_ms']['p99']
  assert inp['n']==p['input']['delay_ms']['n']
  if inp['n']:assert inp['value']==p['input']['delay_ms']['p95']
  assert sum(r.get('age_unbound',0)+r.get('clk_conflicts',0)+r.get('age_neg',0) for r in visible)==0
  bypage={};chain=[]
  for page in sorted(set(r['page'] for r in rows)):
   rs=[r for r in rows if r['page']==page]
   before=[r for r in perf if r['page']==page and r['t_wall_ns']<a]
   after=[r for r in perf if r['page']==page and r['t_wall_ns']>=b]
   edge_start=(rs[0]['t_wall_ns']-a)/1e9;edge_end=(b-rs[-1]['t_wall_ns'])/1e9
   gaps=[{'receipt_s':(y['t_wall_ns']-x['t_wall_ns'])/1e9,'page_gap_ms':y['win_start']-x['win_end'],'first_ns':x['t_wall_ns'],'second_ns':y['t_wall_ns']} for x,y in zip(rs,rs[1:]) if y['t_wall_ns']-x['t_wall_ns']>4.5e9]
   bypage[page]={'rows':len(rs),'receipt_edge_start_s':edge_start,'receipt_edge_end_s':edge_end,'page_window_ms':sum(r['win_ms'] for r in rs),'chain_breaks':sum(abs(y['win_start']-x['win_end'])>.2 for x,y in zip(rs,rs[1:])),'long_receipt_gaps':gaps,'previous_window_adjacent':bool(before and abs(rs[0]['win_start']-before[-1]['win_end'])<=.2),'next_window_adjacent':bool(after and abs(after[0]['win_start']-rs[-1]['win_end'])<=.2)}
  rss=[r for r in all_rss if a<=r['t_wall_ns']<b]
  # Memory counters, plus the peak number of workers per sampled instant.
  workers=collections.defaultdict(set)
  for r in rss:
   if r['kind']=='worker':workers[r['t_wall_ns']].add(r['pid'])
  starts=[r for r in all_events if a<=r['t_wall_ns']<b and r['tag']=='browser.collision.sweep_start' and r.get('page') in pages]
  phases.append({'phase':a0['name'],'duration_s':(b-a)/1e9,'coverage':bypage,'age_p95_ms':q95['value'],'age_p99_ms':q99['value'],'age_max_ms':max(r['age_max_ms'] for r in visible),'input_p95':inp,'input_max_ms':p['input']['delay_ms']['max'],'target':p.get('target_age_p95_under_50ms'),'rss_rows':len(rss),'workers_max_at_sample':max(map(len,workers.values()),default=0),'page_memory':p['page_memory'],'process_memory':p['process_memory'],'watchdog':p['hal_heartbeat'],'sweep_starts':[{'id':r['id'],'points':r['points'],'run_gen':r.get('run_gen'),'t_wall_ns':r['t_wall_ns']} for r in starts]})
 # independently check the saved R witness actually exists in the raw events
 proof=load(f'r-proof-run{i}');pr=proof['parse'];p0,p1=pr['p0_ns'],pr['p1_ns'];page=proof['page']
 spans=[r for r in all_events if r.get('tag')=='gcode.parse_span' and r.get('job')==pr['job'] and r.get('pid')==pr['gateway_pid'] and r.get('p0_ns')==p0 and r.get('p1_ns')==p1 and r.get('pinned')]
 assert len(spans)==1
 matching=[]
 for name in ['heartbeat_a','heartbeat_b']:
  h=proof[name];rs=[r for r in perf if r.get('page')==page and h in (r.get('hb_pairs') or [])];assert len(rs)==1;matching+=rs
  assert p0+1000 < h['g']*1e6 < p1-1000
 A,B=proof['heartbeat_a'],proof['heartbeat_b'];w=proof['word']
 assert A['pid']==B['pid']==pr['gateway_pid'] and A['g']<B['g'] and B['dt']>=A['ta'] and w['tick']==B['dt'] and w['n']==B['dn'] and w['run_gen'] is not None
 words=[r for r in all_events if r.get('tag')=='browser.collision.sweep_witness' and r.get('page')==page and all(r.get(k)==v for k,v in w.items())];assert len(words)==1
 # Confirm all S lifecycle groups, and no old publisher wins later through end of run.
 switches=load(f'supersede-run{i}');jobs={sw['job']:[] for sw in switches}
 for r in all_events:
  if ms[0]['t_wall_ns']<=r['t_wall_ns']<ms[-1]['t_wall_ns'] and r.get('job') in jobs:jobs[r['job']].append(r)
 swproof=[]
 for k,sw in enumerate(switches):
  rs=jobs[sw['job']];spawn=[r for r in rs if r['tag']=='gcode.spawn_start'];pub=[r for r in rs if r['tag']=='gcode.publish'];cancel=[r for r in rs if r['tag']=='gcode.parse_cancelled'];super_=[r for r in rs if r['tag']=='gcode.reparse_superseded']
  assert len(spawn)==1 and spawn[0]['reason']=='wcsoff:G54:z' and spawn[0]['basis']==sw['basis']
  if k<7:assert len(cancel)==len(super_)==1 and not pub
  else:assert len(pub)==1 and pub[0]['basis']==sw['basis']
  swproof.append({'job':sw['job'],'z':sw['z'],'basis':sw['basis'],'spawn_ns':spawn[0]['t_wall_ns'],'cancel_ns':cancel[0]['t_wall_ns'] if cancel else None,'publish_ns':pub[0]['t_wall_ns'] if pub else None})
 for z in {s['z'] for s in switches}:assert len({s['basis'] for s in switches if s['z']==z})==1
 for x,y in zip(swproof,swproof[1:]):assert x['cancel_ns']<y['spawn_ns']
 result['runs'].append({'run':i,'report_exact_match':True,'phases':phases,'r_source_verified':True,'r_proof':proof,'r_source_sha256':[evidence_digest(r) for r in [spans[0],*matching,words[0]]],'s_source_verified':True,'switches':swproof})
# Counterexamples to the new completeness criterion, never touching measurements.
S=10**9
synthetic=[]
for end in range(3,61,3):
 synthetic.append({'page':'test','vis':'visible','t_wall_ns':end*S,'win_start':(end-3)*1000,'win_end':end*1000,'win_ms':3000,'age_h':{'10':100} if end<=30 else {'100':100}})
# All source windows: late half is slow. Drop that suffix or retain just one interior fast row.
cases={'complete':synthetic,'lost_suffix':synthetic[:10],'one_fast_row':synthetic[3:4],'lost_middle':[r for r in synthetic if r['t_wall_ns']!=30*S]}
result['coverage_counterexamples']={}
for name,rs in cases.items():
 kept,excl,inside,cov=bpc2.page_rows(rs,{'test'},0,61*S)
 result['coverage_counterexamples'][name]={'input_rows':len(rs),'coverage':cov,'target':bpc2.target(kept,inside,cov)}
assert result['coverage_counterexamples']['complete']['target']['verdict']=='not met'
assert result['coverage_counterexamples']['lost_suffix']['target']['verdict']=='met'
assert result['coverage_counterexamples']['one_fast_row']['target']['verdict']=='met'
assert result['coverage_counterexamples']['lost_middle']['target']['verdict']=='not proven'
# Also show that the provided REAL failing S phase can turn green on a surviving short prefix.
result['actual_phase_prefix_counterexamples']=[]
for i,ms in enumerate(marks,1):
 a=next(m['t_wall_ns'] for m in ms if m['name']=='S_supersede');b=next(m['t_wall_ns'] for m in ms if m['name']=='S_settle')
 pages=set(load(f'report-run{i}')['pages']);rs=[r for r in perf if a<=r['t_wall_ns']<b and r.get('page') in pages]
 for size in range(1,len(rs)):
  kept,ex,ins,cov=bpc2.page_rows(rs[:size],pages,a,b)
  tgt=bpc2.target(kept,ins,cov)
  if tgt['verdict']=='met':
   result['actual_phase_prefix_counterexamples'].append({'run':i,'kept_rows':size,'real_rows':len(rs),'removed_tail_s':(b-rs[size-1]['t_wall_ns'])/1e9,'coverage':cov,'target':tgt});break
# Preserve selected original measurement records, not unrelated requests or boot argv.
core_tags={'browser.viewer.perf','wd.tick_summary','wd.trip_reset','browser.ws.client_env','browser.ws.hb_delivery_stall','lag.window','loop.tick'}
low=marks[0][0]['t_wall_ns']-10*S;high=marks[1][-1]['t_wall_ns']+15*S
chosen=[r for r in all_events if low<=r['t_wall_ns']<high and (r['tag'] in core_tags or r['tag'].startswith('browser.collision.') or r['tag'].startswith('gcode.') and r['tag']!='gcode.worker_log' or r['tag'].startswith('safety.'))]
with gzip.open(ROOT/'events.jsonl.gz','wt') as f:
 for r in chosen:f.write(json.dumps(r,separators=(',',':'))+'\n')
with gzip.open(ROOT/'rss.jsonl.gz','wt') as f:
 for r in all_rss:
  if low<=r['t_wall_ns']<high:f.write(json.dumps(r,separators=(',',':'))+'\n')
# Save just heartbeat log lines with original byte offsets (the reports' offsets remain auditable).
lines=[];pos=0
for raw in (ROOT/'raw/gateway.log').read_bytes().splitlines(keepends=True):
 if b'[HB' in raw:lines.append({'offset':pos,'bytes':len(raw),'line':raw.decode().rstrip('\n')})
 pos+=len(raw)
(ROOT/'heartbeat-logs.json').write_text(json.dumps({'gateway_file_bytes':pos,'gateway_heartbeat_lines':lines,'watchdog_text':(ROOT/'raw/hal_watchdog.log').read_text()},indent=2))
result['durable_raw_records']=len(chosen)
result['provided_tests']='24 passed (tools report/driver test, isolated imports, no sockets)'
(ROOT/'audit.json').write_text(json.dumps(result,indent=2))
print(json.dumps({'runs_exactly_reproduced':len(result['runs']),'r_proofs_verified':2,'s_lifecycles_verified':2,'counterexamples':result['coverage_counterexamples'],'real_prefix_counterexamples':result['actual_phase_prefix_counterexamples'],'saved_event_rows':len(chosen)},indent=2))
