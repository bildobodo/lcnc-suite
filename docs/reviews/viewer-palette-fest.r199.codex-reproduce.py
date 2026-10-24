"""R199 offline reproduction. No network, no driver, no machine commands.
Usage: python3 reproduce.py DOCS_REVIEWS RAW_DIRECTORY OUTPUT_DIRECTORY
Use '-' for RAW_DIRECTORY to restore it from the retained codex evidence.
"""
from pathlib import Path
import contextlib,io,json,sys,shutil,gzip,hashlib
D,raw,out=[Path(s).resolve() for s in sys.argv[1:4]]; out.mkdir(exist_ok=True)
if sys.argv[2]=='-':
 raw=out/'raw';raw.mkdir(exist_ok=True)
 for name,target in [('events','trace.ndjson'),('rss','rss.jsonl')]:
  with gzip.open(D/f'viewer-palette-fest.r199.codex-{name}.jsonl.gz','rb') as f:(raw/target).write_bytes(f.read())
 logs=json.loads((D/'viewer-palette-fest.r199.codex-heartbeat-logs.json').read_text())
 buf=bytearray(b' '*logs['gateway_file_bytes'])
 for row in logs['gateway_heartbeat_lines']:
  data=(row['line']+'\n').encode();assert len(data)==row['bytes'];buf[row['offset']:row['offset']+row['bytes']]=data
 (raw/'gateway.log').write_bytes(buf);(raw/'hal_watchdog.log').write_text(logs['watchdog_text'])
tool=out/'tools'; tool.mkdir(exist_ok=True)
for name,src in [('bpc.py','r182.browser-pc-bpc.py'),('bpc2.py','r197.browser-pc-report2.py')]:shutil.copyfile(D/('viewer-palette-fest.'+src),tool/name)
sys.path.insert(0,str(tool));sys.dont_write_bytecode=True
import bpc,bpc2
bpc.LOGS=str(raw);bpc2.RSS=str(raw/'rss.jsonl')
summary={}
for variant in ['s','f']:
 pre='viewer-palette-fest.r199.'
 sys.argv=['bpc2.py','report','--pages','y3jq4dik','--marks',str(D/(pre+'marks-'+variant+'.json')),'--anchors',str(D/(pre+'anchors-'+variant+'.json')),'--supersede',str(D/(pre+'supersede-'+variant+'.json'))]
 buf=io.StringIO()
 with contextlib.redirect_stdout(buf):bpc2.report()
 actual=json.loads(buf.getvalue());expected=json.loads((D/(pre+'report-'+variant+'.json')).read_text())
 (out/(variant+'-reproduced.json')).write_text(buf.getvalue())
 if actual!=expected:
  diffs=[]
  def diff(a,b,path=''):
   if isinstance(a,dict) and isinstance(b,dict):
    for k in a.keys()|b.keys():diff(a.get(k),b.get(k),path+'/'+k)
   elif isinstance(a,list) and isinstance(b,list) and len(a)==len(b):
    for i,(x,y) in enumerate(zip(a,b)):diff(x,y,path+'/'+str(i))
   elif a!=b:diffs.append({'path':path,'actual':a,'expected':b})
  diff(actual,expected);(out/(variant+'-diff.json')).write_text(json.dumps(diffs,indent=2))
  print('DIFF',variant,len(diffs))
 phases={p['phase']:p for p in actual['phases']};marks=bpc.load_marks()
 a,z=marks[0]['t_wall_ns'],marks[-1]['t_wall_ns'];allrecs=bpc.trace_lines(a-3600*10**9,z+15*10**9)
 perf=[r for r in allrecs if r.get('tag')=='browser.viewer.perf']; pages={}
 for r in perf:
  v=pages.setdefault(r.get('page'),{'rows_in_run':0,'last_row_ns':0,'host':r.get('host')});v['last_row_ns']=max(v['last_row_ns'],r['t_wall_ns']);v['rows_in_run']+=a<=r['t_wall_ns']<z
 i=next(i for i,m in enumerate(marks) if m['name']=='S_supersede');t0,t1=marks[i]['t_wall_ns'],marks[i+1]['t_wall_ns']
 rows=[r for r in perf if t0<=r['t_wall_ns']<t1 and r.get('page')=='y3jq4dik']
 p=phases['S_supersede'];settle=phases['S_settle']
 timeline=[r for r in allrecs if t0-10**9<=r['t_wall_ns']<marks[i+2]['t_wall_ns'] and (r.get('tag','').startswith(('gcode.','browser.collision.','browser.preview.')))]
 (out/(variant+'-timeline.json')).write_text(json.dumps(timeline,indent=2)+'\n')
 keys=[r for r in perf if a<=r['t_wall_ns']<z and r.get('in_n',0)>0]
 (out/(variant+'-input-rows.json')).write_text(json.dumps(keys,indent=2)+'\n')
 summary[variant]={'full_report_identical':actual==expected,'phases':{n:{'coverage':p['coverage'],'age':p.get('status',{}).get('age_ms'),'age_interior':p.get('status_interior',{}).get('age_ms'),'target':p.get('target_age_p95_under_50ms'),'presses':p.get('input',{}).get('presses'),'hal_heartbeat':p['hal_heartbeat'],'parse_overlap':p['parse_overlap']} for n,p in phases.items()},'observed_pages':pages,'S_verdict':p['verdict'],'S_collision':p['collision'],'S_spans':p['main_thread'],'S_settle_collision':settle['collision'],'S_settle_spans':settle['main_thread'],'raf_ticks_mean':sum(r['raf_ticks'] for r in rows)/len(rows),'raf_gap_p95_mean':sum(r['raf_gap_p95_ms'] for r in rows)/len(rows),'last_parse_ms':p['parse_jobs'][-1]['ran_ms']}
 if variant=='f':
  proof=phases['R_run']['verdict']['proof']; expectedproof=json.loads((D/(pre+'r-proof-f.json')).read_text())
  assert proof==expectedproof
  parse=proof['parse'];A=proof['heartbeat_a'];B=proof['heartbeat_b'];word=proof['word']
  assert parse['p0_ns']/1e6 < A['g'] < B['g'] < parse['p1_ns']/1e6
  assert A['pid']==B['pid']==parse['gateway_pid']
  assert word['tick']>=A['ta'] and B['dt']>=A['ta'] and word['n']==B['dn']
  summary[variant]['R_proof_identical']=True;summary[variant]['R_verdict']=phases['R_run']['verdict']
(out/'summary.json').write_text(json.dumps(summary,indent=2)+'\n')
print(json.dumps({v:{'identical':r['full_report_identical'],'pages':r['observed_pages'],'S':r['S_verdict'],'frames_mean':r['raf_ticks_mean'],'parse_ms':r['last_parse_ms']} for v,r in summary.items()},indent=2))
