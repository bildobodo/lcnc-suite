#!/usr/bin/env python3
"""Synthetic traces through the ORIGINAL report, no live logs or connections.
Run from archive root: python3 -B evidence/viewer-palette-fest.r48.report-probe.py
"""
import sys,json,copy
from pathlib import Path
root=Path(__file__).resolve().parent.parent
sys.path.insert(0,str(root/'scripts'))
import test_viewer_ab_report as f
import viewer_ab_report as r
cases=[]
def record(name,rows):
 rows[0]["order"]="gl,fat,fat,gl,gl,fat"
 try:
  v=r.analyse(rows)
  cases.append({'case':name,'verdict':v.get('verdict'),'checks':v.get('checks'),'excluded':v.get('excluded'),'build':v.get('build')})
 except Exception as e:cases.append({'case':name,'error':f'{type(e).__name__}: {e}'})
record('complete_control',f.run_rows())
rows=f.run_rows()
for e in rows:
 e.pop('memory',None);e.pop('memory_at',None)
record('all_memory_samples_missing',rows)
record('all_build_histograms_missing',[e for e in f.run_rows() if not(e.get('phase')=='build' and e['tag']=='browser.viewer.abhist')])
record('all_steady_mt_histograms_missing',[e for e in f.run_rows() if not(e.get('phase')=='orbit' and e.get('series')=='mt')])
# No repeat-count validation: only the first A and B remain, but the run has an end.
record('only_one_repetition_each',[e for e in f.run_rows() if e.get('rep',0)<2])
# Same count of blocks as the base fixture, radically longer fat build.
rows=f.run_rows()
for e in rows:
 if e.get('phase')=='build' and e.get('variant')=='fat' and e['tag']=='browser.viewer.abrun': e['ms']=1600
 if e.get('phase')=='build' and e.get('variant')=='fat' and e.get('series')=='mt':
  h=f.hist_of([(1,10),(1500,1)]);e.update(bins=f.sparse(h),n=h.n,max=h.max)
record('build_A_110ms_B_1500ms_same_block_count',rows)
# Equal sampling duration is a prerequisite when comparing raw stall counts.
rows=f.run_rows(flags=lambda v,rp,ph: {'interacted':True} if v=='fat' and rp in (2,5) and ph=='orbit' else None,
 frames=lambda v,rp,ph: ([(16.7,178),(150,2)] if v=='gl' else [(16.7,176),(150,4)]) if ph=='orbit' else [(16.7,180)])
record('A_three_orbits_two_gaps_each_B_one_orbit_four_gaps',rows)
print(json.dumps({'commit':'8624ade','cases':cases},indent=2))
