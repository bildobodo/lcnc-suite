"""R189 read-only report probes; R189_ROOT contains copied tools and R188 saved data.
No sockets or drivers. Reports write only r_proof.json in the temporary tools directory.
"""
import os,sys,json,io,contextlib,unittest,copy
from pathlib import Path
ROOT=Path(os.environ.get('R189_ROOT','/tmp/codex-r189-mqkah3j3'))
DOCS=Path(os.environ.get('R189_DOCS','/home/cnc/lcnc-suite/docs/reviews'))
sys.path.insert(0,str(ROOT/'tools'))
import bpc,bpc2
bpc.LOGS=str(ROOT/'raw');bpc2.RSS=str(ROOT/'raw/rss.jsonl')
S=10**9
proof={}
def load(round,name):return json.loads((DOCS/f'viewer-palette-fest.r{round}.{name}.json').read_text())
def row(t,k,page='p'):
 return {'page':page,'vis':'visible','t_wall_ns':int(t*S),'win_start':k*3000,'win_end':(k+1)*3000,'win_ms':3000,'age_h':{'10':100}}
def run_report(i):
 given=load(189,f'report-run{i}')
 sys.argv=['bpc2','report','--pages',','.join(given['pages']),'--marks',str(DOCS/f'viewer-palette-fest.r188.marks-run{i}.json'),'--anchors',str(DOCS/f'viewer-palette-fest.r188.anchors-run{i}.json'),'--supersede',str(DOCS/f'viewer-palette-fest.r188.supersede-run{i}.json')]
 out=io.StringIO()
 with contextlib.redirect_stdout(out):bpc2.report()
 return json.loads(out.getvalue())
class Probes(unittest.TestCase):
 def test_both_saved_reports_and_unchanged_metrics(self):
  results=[]
  for i in [1,2]:
   actual=run_report(i);given=load(189,f'report-run{i}');old=load(188,f'report-run{i}')
   self.assertEqual(actual,given)
   for p in given['phases']:self.assertTrue(p['coverage']['complete'])
   for p,q in zip(given['phases'],old['phases']):
    self.assertEqual({k:v for k,v in p.items() if k!='coverage'},{k:v for k,v in q.items() if k!='coverage'})
   results.append({'run':i,'exact_report_match':True,'all_noncoverage_phase_values_unchanged':True,'coverage':{p['phase']:p['coverage'] for p in actual['phases']}})
  proof['reports']=results
 def test_actual_R188_truncation(self):
  ms=load(188,'marks-run1');a=next(r['t_wall_ns'] for r in ms if r['name']=='S_supersede');b=next(r['t_wall_ns'] for r in ms if r['name']=='S_settle')
  rs=[r for r in bpc.trace_lines(a,b) if r['tag']=='browser.viewer.perf' and r.get('page')=='rhpl0tia']
  self.assertEqual(len(rs),16);out={}
  for name,rows,expected in [('full',rs,'not met'),('first_3',rs[:3],'not proven')]:
   keep,_,inside,cov=bpc2.page_rows(rows,{'rhpl0tia'},a,b,expected={'rhpl0tia'})
   t=bpc2.target(keep,inside,cov);self.assertEqual(t['verdict'],expected);out[name]={'coverage':cov,'target':t}
  proof['actual_R188_counterexample']=out
 def test_missing_prefix_suffix_single_or_middle(self):
  rs=[row(t,k) for k,t in enumerate(range(3,61,3))]
  for r in rs[10:]:r['age_h']={'100':100}
  out={}
  for name,rows,want in [('full',rs,'not met'),('missing_prefix',rs[10:],'not proven'),('missing_suffix',rs[:10],'not proven'),('single_inner',rs[3:4],'not proven'),('missing_middle',rs[:9]+rs[10:],'not proven')]:
   keep,_,inside,cov=bpc2.page_rows(rows,{'p'},0,61*S,expected={'p'})
   t=bpc2.target(keep,inside,cov);self.assertEqual(t['verdict'],want);out[name]={'coverage':cov,'target':t}
  proof['synthetic_truncation']=out
 def test_long_internal_receipt_gap_with_window_chain(self):
  rs=[row(t,k) for k,t in enumerate([2,4,8.9,10,14,16,19])]
  _,_,_,cov=bpc2.page_rows(rs,{'p'},0,20*S,expected={'p'})
  self.assertTrue(cov['complete']);self.assertFalse(cov['complete_by_receipt_gaps'])
  proof['delayed_internal_row']=cov
 def test_exact_edge_threshold(self):
  out={}
  for side in ['start','end']:
   for extra in [0,1]:
    rs=[row(t,k) for k,t in enumerate([4.5,7,10,13,15.5])]
    if side=='start':rs[0]['t_wall_ns']+=extra
    else:rs[-1]['t_wall_ns']-=extra
    cov=bpc2.page_rows(rs,{'p'},0,20*S,expected={'p'})[3]
    self.assertEqual(cov['complete'],extra==0)
    out[f'{side}_4.5s_plus_{extra}ns']=cov
  proof['edge_thresholds']=out
 def test_missing_windows_fall_back_per_page(self):
  rs=[row(t,k) for k,t in enumerate([2,5,8,11,14,17])]
  for r in rs:r.pop('win_start');r.pop('win_end')
  self.assertTrue(bpc2.page_rows(rs,{'p'},0,20*S,expected={'p'})[3]['complete'])
  missing=rs[:2]+rs[3:]
  # Extra page messages cannot fill a hole in p's own sequence.
  q=[row(t,k,page='q') for k,t in enumerate([2,5,8,11,14,17])]
  cov=bpc2.page_rows(missing+q,{'p','q'},0,20*S,expected={'p','q'})[3]
  self.assertFalse(cov['complete']);self.assertEqual(cov['pages']['p']['inner_breaks'],1)
  proof['per_page_receipt_fallback']=cov
 def test_silent_or_empty_page(self):
  rs=[row(t,k) for k,t in enumerate([2,5,8,11,14,17])]
  cov=bpc2.page_rows(rs,{'p','q'},0,20*S,expected={'p','q'})[3]
  self.assertFalse(cov['complete']);self.assertEqual(cov['pages']['q'],{'rows':0,'complete':False})
  self.assertFalse(bpc2.page_rows([],{'p'},0,20*S,expected={'p'})[3]['complete'])
  self.assertFalse(bpc2.page_rows([],{'p'},0,20*S)[3]['complete'])
  proof['silent_page']=cov
 def test_report_expected_pages_wiring_and_historical_page(self):
  original=bpc.trace_lines
  ms=load(188,'marks-run1');a=ms[0]['t_wall_ns'];last=ms[-1]['t_wall_ns']
  events=original(a-3600*S,last+10*S)
  # Supplied reports list historical page 9ok6gt09; it must not be expected in this run.
  sample=copy.deepcopy(next(r for r in events if r['tag']=='browser.viewer.perf'))
  historical={**sample,'page':'9ok6gt09','t_wall_ns':a-5*S}
  try:
   bpc.trace_lines=lambda *args:sorted(events+[historical],key=lambda r:r['t_wall_ns'])
   past=run_report(1)
   self.assertTrue(all(p['coverage']['complete'] for p in past['phases']))
   self.assertTrue(all('9ok6gt09' not in p['coverage']['pages'] for p in past['phases']))
   # If that page appears in one phase of the run, report() must expect it in the others too.
   active={**sample,'page':'9ok6gt09','t_wall_ns':next(m['t_wall_ns'] for m in ms if m['name']=='S_load')+S}
   bpc.trace_lines=lambda *args:sorted(events+[historical,active],key=lambda r:r['t_wall_ns'])
   present=run_report(1)
   for p in present['phases']:
    self.assertFalse(p['coverage']['complete'])
    self.assertIn('9ok6gt09',p['coverage']['pages'])
   rest=next(p for p in present['phases'] if p['phase']=='A_rest')
   self.assertEqual(rest['target_age_p95_under_50ms']['verdict'],'not proven')
   proof['report_wiring']={'historical_only_all_complete':True,'active_then_silent_all_incomplete':True,'silent_phase':rest['coverage'],'silent_phase_target':rest['target_age_p95_under_50ms']}
  finally:bpc.trace_lines=original
if __name__=='__main__':
 r=unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(Probes))
 proof['tests']={'run':r.testsRun,'failures':len(r.failures),'errors':len(r.errors)}
 (ROOT/'probes.json').write_text(json.dumps(proof,indent=2))
 sys.exit(not r.wasSuccessful())
