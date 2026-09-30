#!/usr/bin/env python3
"""Additional required-value probes through the unmodified R49 report."""
import sys,json
from pathlib import Path
root=Path(__file__).resolve().parent.parent
sys.path.insert(0,str(root/'scripts'))
import test_viewer_ab_report as f
import viewer_ab_report as r
cases=[]
def record(name,rows):
 try:
  d=r.analyse(rows)
  cases.append({'case':name,'verdict':d['verdict'],'checks':d['checks'],'excluded':d['excluded']})
 except Exception as e:cases.append({'case':name,'error':f'{type(e).__name__}: {e}'})
record('control_complete',f.run_rows())
rows=f.run_rows()
for e in rows:
 if 'memory' in e:e['memory'].pop('peak',None)
record('all_peak_values_missing',rows)
rows=f.run_rows()
for e in rows:
 if e.get('phase') in ('reveal','release') and e.get('variant')=='fat' and 'memory' in e:e['memory']['peak']=512*2**20
record('fat_reveal_peak_512MiB',rows)
rows=f.run_rows()
for e in rows:
 if 'memory' in e:e['memory']['gpu'].pop('total',None)
record('gpu_total_missing',rows)
rows=f.run_rows(block_ms=lambda v,rp: 110 if v=='gl' else (10 if rp==2 else 300))
record('control_build_blocks_300_10_300',rows)
for e in rows:
 if e.get('phase')=='build' and e.get('rep')==1 and e['tag']=='browser.viewer.abrun':e['mt'].pop('max')
record('one_build_max_summary_missing_histogram_still_present',rows)
print(json.dumps({'commit':'a614c70','cases':cases},indent=2))
