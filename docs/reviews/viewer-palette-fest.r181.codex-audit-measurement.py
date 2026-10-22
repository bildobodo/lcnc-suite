from pathlib import Path
import json,hashlib,collections,statistics
ROOT=Path('/home/cnc/lcnc-suite'); OUT=Path('/tmp/codex-r181-mxspmf64')
marks_path=Path('/home/cnc/claude-work/bpc/marks.json');marks=json.loads(marks_path.read_text());(OUT/'measurement-marks.json').write_bytes(marks_path.read_bytes())
t0,t1=marks[0]['t_wall_ns'],marks[-1]['t_wall_ns'];records=[];sources=[]
for path in sorted((ROOT/'runlogs').glob('trace.ndjson*')):
 if not path.is_file():continue
 with path.open('rb') as f:
  size=path.stat().st_size;used=0;count=0
  while used<size:
   line=f.readline();used+=len(line)
   if not line:break
   if not line.startswith(b'{"t_wall_ns":'):continue
   try:t=int(line[13:line.index(b',',13)])
   except ValueError:continue
   if not t0<=t<t1:continue
   try:r=json.loads(line)
   except ValueError:continue
   count+=1
   tag=r.get('tag','')
   if tag=='browser.viewer.perf' or tag=='loop.tick' or tag.startswith(('gcode.','browser.collision.','lag.','poll_status.slow','ws.fanout_send_slow','browser.ws.hb_delivery_stall','run_basis.','safety.','wd.trip')):
    # Keep only numeric measurements, event names and a coarse host class. No tokens, addresses or program text.
    clean={k:v for k,v in r.items() if isinstance(v,(int,float,bool)) or v is None}
    clean['tag']=tag
    if tag=='browser.viewer.perf':clean['host_class']='local' if r.get('host') in {'localhost','127.0.0.1','::1'} else 'remote';clean['vis']=r.get('vis')
    if tag=='gcode.refresh_scheduled':clean['reason']=r.get('reason')
    records.append(clean)
 sources.append({'file':path.name,'read_initial_bytes':size,'events_in_measurement':count})
records.sort(key=lambda r:r['t_wall_ns'])
(OUT/'measurement-events.json').write_text(json.dumps(records,indent=2)+'\n')
summary=[]
for a,b in zip(marks,marks[1:]):
 rows=[r for r in records if a['t_wall_ns']<=r['t_wall_ns']<b['t_wall_ns']];perf=[r for r in rows if r['tag']=='browser.viewer.perf' and r.get('host_class')=='remote'];counts=collections.Counter(r['tag'] for r in rows)
 def vmax(key):return max((r.get(key,0) for r in perf),default=None)
 def med(key):return statistics.median(r[key] for r in perf if key in r) if any(key in r for r in perf) else None
 data={'phase':a['name'],'seconds':(b['t_wall_ns']-a['t_wall_ns'])/1e9,'windows':len(perf),'status_frames':sum(r.get('frames',0) for r in perf),'gap_p95_windows_above_50':sum(r.get('gap_p95_ms',0)>50 for r in perf),'gap_p95_median':med('gap_p95_ms'),'gap_p95_max':vmax('gap_p95_ms'),'gap_max':vmax('gap_max_ms'),'apply_max_ms':vmax('apply_max_ms'),'apply_mean_window_median_ms':med('apply_mean_ms'),'mt_late_max_ms':vmax('mt_late_max_ms'),'heap_present':sum(r.get('heap_used_mb') is not None for r in perf),'event_counts':dict(sorted(counts.items()))}
 if perf:data['largest_gap_window']={k:perf[max(range(len(perf)),key=lambda i:perf[i].get('gap_max_ms',0))].get(k) for k in ['t_wall_ns','gap_max_ms','gap_p95_ms','apply_max_ms','mt_late_max_ms','raf_gap_max_ms','frames']}
 summary.append(data)
report={'marks_sha256':hashlib.sha256(marks_path.read_bytes()).hexdigest(),'sources':sources,'phases':summary,'caveats':['Trace events filtered to original exact phase marks; three-second summaries assigned by receipt time, not interval clipping.','No commands sent; retrospective read only.','No reconstruction of a pooled p95 from per-window percentiles.','Event counts do not measure peak memory or job queue length.']}
(OUT/'measurement-audit.json').write_text(json.dumps(report,indent=2)+'\n')
for s in summary:print({k:v for k,v in s.items() if k not in ['event_counts','largest_gap_window']})
print('retained numeric/event records',len(records))
