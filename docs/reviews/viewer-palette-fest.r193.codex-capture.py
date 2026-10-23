from pathlib import Path
import json,gzip,collections,hashlib
root=Path('/home/cnc/lcnc-suite');b=Path('/tmp/codex-r193-uvyrd4u6')
marks=json.loads((root/'docs/reviews/viewer-palette-fest.r193.marks-s.json').read_text())
a,z=marks[0]['t_wall_ns'],marks[-1]['t_wall_ns']
rows=[];counts=collections.Counter()
for p in (root/'runlogs').glob('trace.ndjson*'):
 with p.open('rb') as f:
  for raw in f:
   if not raw.startswith(b'{"t_wall_ns":'):continue
   try:t=int(raw[13:raw.index(b',',13)])
   except (ValueError,IndexError):continue
   if not a-3600*10**9<=t<z+15*10**9:continue
   try:r=json.loads(raw)
   except ValueError:continue
   tag=r.get('tag','')
   if tag in ['browser.viewer.perf','browser.preview.parse_seen','browser.env'] or tag.startswith(('browser.collision.','gcode.','wd.','safety.')):
    rows.append(r);counts[tag]+=1
rows.sort(key=lambda r:r['t_wall_ns'])
with gzip.open(b/'events.jsonl.gz','wt') as f:
 for r in rows:f.write(json.dumps(r,separators=(',',':'))+'\n')
with (b/'raw/trace.ndjson').open('w') as f:
 for r in rows:f.write(json.dumps(r,separators=(',',':'))+'\n')
rss=[]
with Path('/home/cnc/claude-work/bpc/rss.jsonl').open() as f:
 for line in f:
  r=json.loads(line)
  if a-3*10**9<=r['t_wall_ns']<z+3*10**9:rss.append(r)
with gzip.open(b/'rss.jsonl.gz','wt') as f:
 for r in rss:f.write(json.dumps(r,separators=(',',':'))+'\n')
(b/'raw/rss.jsonl').write_text(''.join(json.dumps(r)+'\n' for r in rss))
# Preserve only heartbeat lines, at their original byte offsets, sufficient
# for unchanged report() and its phase offsets; no other gateway log text.
gw=(root/'runlogs/gateway.log').read_bytes();mask=bytearray(b' '*len(gw));hb=[];offset=0
for line in gw.splitlines(keepends=True):
 if any(mark in line for mark in [b'[HB]',b'[HB-WAKE]',b'[HB-STALL]']):
  mask[offset:offset+len(line)]=line;hb.append({'offset':offset,'bytes':len(line),'line':line.decode().rstrip('\n')})
 offset+=len(line)
(b/'raw/gateway.log').write_bytes(mask)
wd=(root/'runlogs/hal_watchdog.log').read_text();(b/'raw/hal_watchdog.log').write_text(wd)
(b/'heartbeat-logs.json').write_text(json.dumps({'gateway_file_bytes':len(gw),'gateway_heartbeat_lines':hb,'watchdog_text':wd},indent=2))
active=collections.Counter(r.get('page') for r in rows if r['tag']=='browser.viewer.perf' and a<=r['t_wall_ns']<z)
last={}
for r in rows:
 if r['tag']=='browser.viewer.perf':last[r.get('page')]=r['t_wall_ns']
(b/'capture-summary.json').write_text(json.dumps({'events':len(rows),'tags':dict(counts),'rss':len(rss),'active_pages_in_run':dict(active),'last_seen_by_page':last,'run':[a,z]},indent=2))
print(json.dumps({'events':len(rows),'rss':len(rss),'active_pages':dict(active)}))
