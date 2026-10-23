"""Reproduce R193 from retained data, without sockets or driver execution.
Usage: python3 this.py [docs/reviews] [raw-dir during initial capture]
Default raw data are the new r193.codex-* evidence files beside the report.
"""
from pathlib import Path
import contextlib,gzip,hashlib,io,json,os,shutil,sys,tempfile
D=Path(sys.argv[1]).resolve() if len(sys.argv)>1 else Path(__file__).resolve().parent
out=Path(tempfile.mkdtemp(prefix='codex-r193-reproduce-'));(out/'tools').mkdir();(out/'raw').mkdir()
raw=Path(sys.argv[2]).resolve() if len(sys.argv)>2 else out/'raw'
if len(sys.argv)<=2:
 for file in ['events','rss']:
  with gzip.open(D/f'viewer-palette-fest.r193.codex-{file}.jsonl.gz','rb') as src:
   (raw/('trace.ndjson' if file=='events' else 'rss.jsonl')).write_bytes(src.read())
 logs=json.loads((D/'viewer-palette-fest.r193.codex-heartbeat-logs.json').read_text())
 buf=bytearray(b' '*logs['gateway_file_bytes'])
 for row in logs['gateway_heartbeat_lines']:
  text=(row['line']+'\n').encode();assert len(text)==row['bytes'];buf[row['offset']:row['offset']+row['bytes']]=text
 (raw/'gateway.log').write_bytes(buf);(raw/'hal_watchdog.log').write_text(logs['watchdog_text'])
for name,src in [('bpc.py','viewer-palette-fest.r182.browser-pc-bpc.py'),('bpc2.py','viewer-palette-fest.r193.browser-pc-report2.py')]:shutil.copyfile(D/src,out/'tools'/name)
sys.path.insert(0,str(out/'tools'));sys.dont_write_bytecode=True
import bpc,bpc2
bpc.LOGS=str(raw);bpc2.RSS=str(raw/'rss.jsonl')
sys.argv=['bpc2.py','report','--pages','k1iipz2t','--marks',str(D/'viewer-palette-fest.r193.marks-s.json'),'--anchors',str(D/'viewer-palette-fest.r193.anchors-s.json'),'--supersede',str(D/'viewer-palette-fest.r193.supersede-s.json')]
buf=io.StringIO()
with contextlib.redirect_stdout(buf):bpc2.report()
actual=json.loads(buf.getvalue());expected=json.loads((D/'viewer-palette-fest.r193.report-s.json').read_text())
(out/'reproduced.json').write_text(buf.getvalue())
assert actual==expected,'report differs; see '+str(out/'reproduced.json')
marks=bpc.load_marks();a,z=marks[0]['t_wall_ns'],marks[-1]['t_wall_ns']
recs=bpc.trace_lines(a-3600*10**9,z+15*10**9)
active={r.get('page') for r in recs if r['tag']=='browser.viewer.perf' and a<=r['t_wall_ns']<z}
assert active=={'k1iipz2t'},active
oldpage=[r for r in recs if r['tag']=='browser.viewer.perf' and r.get('page')=='rhpl0tia']
assert oldpage and max(r['t_wall_ns'] for r in oldpage)<a
sup=next(p for p in actual['phases'] if p['phase']=='S_supersede')
assert sup['status']['age_ms']['p95']==60 and sup['status_interior']['age_ms']['p95']==62
assert all(p['coverage']['complete'] for p in actual['phases'])
assert all(p['input']['presses']==0 for p in actual['phases'])
seen=[r for r in recs if r['tag']=='browser.preview.parse_seen' and r.get('page')=='k1iipz2t' and a<=r['t_wall_ns']<z]
# These receipt-time differences are only observations, not a load-time bound.
off=next(r for r in seen if r.get('job')==41 and r.get('state')=='off')
on=next(r for r in seen if r.get('job')==42 and r.get('state')=='on')
page_gap=on.get('rx_ms',0)-off.get('rx_ms',0)
summary={'full_report_identical':True,'active_pages':sorted(active),'previous_page_last_seconds_before_run':(a-max(r['t_wall_ns'] for r in oldpage))/1e9,
 'all_phases_complete':True,'all_press_counts_zero':True,'S_age_p95':60,'S_interior_age_p95':62,'S_verdict':sup['verdict'],
 'S_spans':sup['main_thread'],'gap_41_to_42_ms_by_page_receipt':page_gap,'output':str(out)}
print(json.dumps(summary,indent=2))
