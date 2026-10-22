"""R183 review-only counterexamples; imports tools but never runs main.
All logs, messages and commands below are synthetic. No live ports or machine.
"""
import asyncio, json, os, pathlib, sys, tempfile, time, unittest
from unittest.mock import patch
ROOT=pathlib.Path(os.environ.get('R183_PROBE_ROOT', pathlib.Path(__file__).resolve().parent))
sys.path.insert(0,str(ROOT/'measurement-tools'));sys.path.insert(0,str(ROOT/'repo/lcnc-gateway'))
import bpc2, drive2
from ws_fanout import build_status_envelope
S=10**9; OUT={}
def ev(tag,t,**kw):return {'t_wall_ns':int(t*S),'tag':tag,**kw}
def base_run(page='p',why='origin'):
 return [ev('browser.collision.run_check_start',10,page=page,run=1,version=1,**{'from':None}),
         ev('gcode.spawn_start',20,job=7,pinned=True,basis='x',active_idx=1),
         ev('gcode.publish',25,job=7,pinned=True,basis='x',active_idx=1,version=2),
         ev('browser.collision.run_check_discarded',26,page=page,why=why,gen=1)]
def rv(recs,pages={'p'}):
 recs=sorted(recs,key=lambda r:r['t_wall_ns']);js,_=bpc2.jobs(recs)
 return bpc2.r_verdict(recs,js,pages)
def s_jobs(n):
 recs=[]
 for j in range(1,n+1):
  recs.append(ev('gcode.spawn_start',10*j,job=j,basis=f'b{j}',active_idx=2-(j-1)%2))
  if j<n:recs.extend([ev('gcode.reparse_superseded',10*j+2,job=j),ev('gcode.parse_cancelled',10*j+3,job=j)])
  else:recs.append(ev('gcode.publish',10*j+3,job=j,basis=f'b{j}',active_idx=2-(j-1)%2))
 return bpc2.jobs(recs)
class Frames:
 def __init__(self,frames):self.frames=iter(frames)
 def __aiter__(self):return self
 async def __anext__(self):
  try:return json.dumps(next(self.frames))
  except StopIteration:raise StopAsyncIteration
class Tests(unittest.IsolatedAsyncioTestCase):
 async def test_r182_watchdog_and_rss_counterexamples_now_reject_missing_proof(self):
  header=bpc2.HB_HEADER+'\n'; anchor={'wd_ms':1000,'wall_ns':S,'wd_pid':7,'wd_log_bytes':len(header),'gwlog':0}
  wd=header+'[HB-DUMP] +1000ms reason=trip_reset\n[HB-RISING] +2000ms True-to-True gap 450ms\n[HB-DUMP] +5000ms reason=trip_reset\n'
  ticks=[ev('wd.tick_summary',t,pid=7) for t in range(5)]
  results={'missing_anchor':bpc2.watchdog(S,3*S,None,wd,ticks,''),
           'missing_log':bpc2.watchdog(S,3*S,anchor,None,ticks,''),
           'clock_step':bpc2.watchdog(S,3*S,anchor,wd,ticks,'[HB] +1ms skew=41000ms clients=1'),
           'later_reset':bpc2.watchdog(S,3*S,anchor,wd,ticks,''),
           'missing_rss':bpc2.rss_block([],0,10*S)}
  OUT['r182_report_controls']=results
  for k in ['missing_anchor','missing_log','clock_step']:self.assertEqual(results[k]['status'],'not proven')
  self.assertEqual(results['later_reset'],{'status':'gaps','gaps_ms':[450]})
  self.assertEqual(results['missing_rss']['status'],'not collected')
 async def test_s_old_no_supersession_case_is_now_not_met(self):
  js,o=s_jobs(2);js[0]['events']=['spawn_start','publish']
  r=bpc2.s_verdict(js,o,{'status':'sampled','workers_at_once_max':1},2);OUT['s_r182_no_cancellation']=r
  self.assertEqual(r['verdict'],'S not met')
 async def test_trace_reader_follows_renamed_inode(self):
  from tracetail import TraceTail
  with tempfile.TemporaryDirectory() as d:
   p=pathlib.Path(d)/'trace.ndjson';p.write_text(json.dumps(ev('one',1))+'\n')
   tail=TraceTail(0,d);self.assertEqual([r['tag'] for r in tail.since(0)],['one'])
   old=p.with_name('trace.ndjson.2');p.rename(old)
   with old.open('a') as f:f.write(json.dumps(ev('two',2))+'\n')
   p.write_text(json.dumps(ev('three',3))+'\n')
   got=[r['tag'] for r in tail.since(0)];OUT['trace_renamed_inode']=got
   self.assertEqual(got,['one','two','three'])

 async def test_envelope_and_trip_controls(self):
  c=drive2.Client2();env=build_status_envelope(status_data={'interp_state':1},errors=[],clients_list=[{'ip':'127.0.0.1','armed':True},{'ip':'192.0.2.1','armed':True}],armed=True,safety_trip={'reason':'trip'})
  c.ws=Frames([env]);await c._read();OUT['envelope']={'env':c.env,'breach':drive2.guard_breach(c)}
  self.assertIn('ARMED',drive2.guard_breach(c))
  c.env['clients'].pop();self.assertIn('trip',drive2.guard_breach(c))
  env['clients'].pop();env.pop('safety_trip');c.ws=Frames([env]);await c._read()
  self.assertIsNone(drive2.guard_breach(c));self.assertIsNone(c.env['safety_trip'])
 async def test_anchor_requires_idle_and_standstill(self):
  for label,state in [('AUTO',{'interp_state':2,'inpos':False,'current_vel':10}),('manual_jog',{'interp_state':1,'inpos':False,'current_vel':10})]:
   with self.subTest(label=label),tempfile.TemporaryDirectory() as d:
    log=pathlib.Path(d)/'wd';log.write_text('instrumentation\n')
    c=drive2.Client2();c.st={**state,'estop':False,'enabled':True};c.env={'clients':[{'armed':True}],'armed':True};c.env_at=time.monotonic();sent=[]
    async def cmd(o):sent.append(o);raise drive2.Stop('probe: never dispatch a machine command')
    c.cmd=cmd
    self.assertIsNone(drive2.guard_breach(c))
    with patch.object(drive2,'WDLOG',str(log)):
     with self.assertRaises(drive2.Stop):await drive2.anchored_reset(c)
    OUT.setdefault('anchor_not_still',{})[label]={'state':c.st,'attempted_commands':sent}
    self.assertEqual(sent,[],'The stated idle/standstill precondition must be checked before E-Stop')
 async def test_r_control(self):
  r=rv(base_run());OUT['r_control']=r;self.assertEqual(r['verdict'],'R overlap proven')
 async def test_r_completed_before_parse(self):
  recs=base_run()+[ev('browser.collision.sweep_start',10.1,page='p'),ev('browser.collision.sweep_done',12,page='p',ms=1900)]
  r=rv(recs);OUT['r_done_before_parse']={'records':recs,'result':r}
  self.assertEqual(r['verdict'],'R overlap not proven','A full check finished at 12, eight seconds before the parse')
 async def test_r_cross_page_pairing(self):
  recs=base_run();recs[-1]['page']='q';r=rv(recs,{'p','q'});OUT['r_cross_page']={'records':recs,'result':r}
  self.assertEqual(r['verdict'],'R overlap not proven','Start and discard are from different pages')
 async def test_r_idle_discard_is_not_publish_causality(self):
  r=rv(base_run(why='idle'));OUT['r_idle_discard']=r
  self.assertEqual(r['verdict'],'R overlap not proven','Ending the run is no evidence that publication discarded a running sweep')
 async def test_s_control(self):
  js,o=s_jobs(4);r=bpc2.s_verdict(js,o,{'status':'sampled','workers_at_once_max':1},4);OUT['s_control']=r
  self.assertEqual(r['verdict'],'S met')
 async def test_s_missing_switch_record(self):
  js,o=s_jobs(1);r=bpc2.s_verdict(js,o,{'status':'sampled','workers_at_once_max':1},None)
  OUT['s_missing_switches']={'jobs':js,'result':r}
  self.assertEqual(r['verdict'],'S not met','No switch record, only one completed parse and no supersession cannot meet S')
 async def test_s_count_must_match(self):
  js,o=s_jobs(5);r=bpc2.s_verdict(js,o,{'status':'sampled','workers_at_once_max':1},4);OUT['s_extra_job']=r
  self.assertEqual(r['verdict'],'S not met','Five jobs cannot be attributed to the four requested switches by count alone')
 async def test_row_stall_cannot_be_removed_from_latency_population(self):
  rows=[ev('browser.viewer.perf',t,page='p',vis='visible',raf_pauses=0,age_n=n,age_h={str(age):n},age_max_ms=age) for t,n,age in [(101,60,10),(104,60,10),(107,60,10),(112,60,100),(115,60,10),(118,60,10)]]
  keep,excluded=bpc2.page_rows(rows,{'p'},100*S,120*S)
  got=bpc2.status_block(keep)['age_ms'];all_in_phase=bpc2.status_block(rows[2:])['age_ms']
  OUT['visible_stall_rows']={'kept_times':[r['t_wall_ns']//S for r in keep],'excluded':excluded,'kept_age':got,'age_with_stalled_row':all_in_phase}
  # Same visible page, no visibility change and no RAF pause: a delayed perf
  # timer must not prove the latency distribution of only the fast remainder.
  self.assertTrue(any(r['t_wall_ns']==112*S for r in keep),'This is a visible load interval, not a hidden transition')
if __name__=='__main__':
 result=unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(Tests))
 (ROOT/'tools-evidence.json').write_text(json.dumps(OUT,indent=2));sys.exit(not result.wasSuccessful())
