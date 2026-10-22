"""R184 isolated review probes. Imports measurement tools; never calls main.
No network or machine commands. Tests use real-module evidence from the
TypeScript probes and explicit synthetic page/trace timelines.
"""
import asyncio, json, os, pathlib, sys, tempfile, time, unittest
from unittest.mock import patch
ROOT=pathlib.Path(os.environ.get('R184_PROBE_ROOT',pathlib.Path(__file__).resolve().parent))
sys.path.insert(0,str(ROOT/'measurement-tools'));sys.path.insert(0,str(ROOT/'repo/lcnc-gateway'))
import bpc2, drive2
from ws_fanout import build_status_envelope
S=10**9;OUT={}
def ev(tag,t,**kw):return {'t_wall_ns':int(t*S),'tag':tag,**kw}
def page(tag,ms,**kw):return ev('browser.'+tag,ms/1000,page='p',t_perf_ms=ms,**kw)
def pinned(start=20,end=25):return [ev('gcode.spawn_start',start,job=7,pinned=True,basis='x',active_idx=1),ev('gcode.publish',end,job=7,basis='x',active_idx=1,version=2)]
def seen(on=20100,off=25100):return [page('preview.parse_seen',26000,state='on',started_ms=20000,rx_ms=on),page('preview.parse_seen',26001,state='off',started_ms=20000,rx_ms=off)]
def sweep(start=10000,end=30000):return [page('collision.sweep_start',start,id=3,run_gen=1,range_from=None),page('collision.sweep_done',end,id=3,run_gen=1)]
def rv(recs,pages={'p'},bound=50):
 recs=sorted(recs,key=lambda r:r['t_wall_ns']);js,_=bpc2.jobs(recs);return bpc2.r_verdict(recs,js,pages,bound)
def switches(n=4):
 recs=[];log=[]
 for j in range(1,n+1):
  idx=2-(j-1)%2;recs.append(ev('gcode.spawn_start',j*10,job=j,basis=f'b{j}',active_idx=idx))
  log.append({'switch':j,'to':'G55' if idx==2 else 'G54','basis':f'b{j}','job':j})
  if j<n:recs.extend([ev('gcode.reparse_superseded',j*10+2,job=j),ev('gcode.parse_cancelled',j*10+3,job=j)])
  else:recs.append(ev('gcode.publish',j*10+3,job=j,basis=f'b{j}',active_idx=idx))
 return recs,log
def sv(recs,log):
 js,o=bpc2.jobs(recs);return bpc2.s_verdict(js,o,{'status':'sampled','workers_at_once_max':1},log)
class Frames:
 def __init__(self,frames):self.frames=iter(frames)
 def __aiter__(self):return self
 async def __anext__(self):
  try:return json.dumps(next(self.frames))
  except StopIteration:raise StopAsyncIteration
class Tests(unittest.IsolatedAsyncioTestCase):
 async def test_previous_watchdog_and_rss_controls(self):
  header=bpc2.HB_HEADER+'\n';anchor={'wd_ms':1000,'wall_ns':S,'wd_pid':7,'wd_log_bytes':len(header),'gwlog':0}
  wd=header+'[HB-DUMP] +1000ms reason=trip_reset\n[HB-RISING] +2000ms True-to-True gap 450ms\n[HB-DUMP] +5000ms reason=trip_reset\n';ticks=[ev('wd.tick_summary',t,pid=7) for t in range(5)]
  r={'missing_anchor':bpc2.watchdog(S,3*S,None,wd,ticks,''),'missing_log':bpc2.watchdog(S,3*S,anchor,None,ticks,''),'clock_step':bpc2.watchdog(S,3*S,anchor,wd,ticks,'[HB] +1ms skew=41000ms clients=1'),'later_reset':bpc2.watchdog(S,3*S,anchor,wd,ticks,''),'missing_rss':bpc2.rss_block([],0,10*S)};OUT['previous_report_controls']=r
  for k in ['missing_anchor','missing_log','clock_step']:self.assertEqual(r[k]['status'],'not proven')
  self.assertEqual(r['later_reset'],{'status':'gaps','gaps_ms':[450]});self.assertEqual(r['missing_rss']['status'],'not collected')
 async def test_envelope_and_trip_controls(self):
  c=drive2.Client2();env=build_status_envelope(status_data={'interp_state':1},errors=[],clients_list=[{'ip':'127.0.0.1','armed':True},{'ip':'192.0.2.1','armed':True}],armed=True,safety_trip={'reason':'trip'})
  c.ws=Frames([env]);await c._read();self.assertIn('ARMED',drive2.guard_breach(c));c.env['clients'].pop();self.assertIn('trip',drive2.guard_breach(c))
  env['clients'].pop();env.pop('safety_trip');c.ws=Frames([env]);await c._read();self.assertIsNone(drive2.guard_breach(c))
 async def test_anchor_rejects_auto_manual_unknown_and_stale_without_command(self):
  for name,state,stale in [('auto',{'interp_state':2,'inpos':False,'current_vel':10},False),('manual',{'interp_state':1,'inpos':False,'current_vel':10},False),('unknown',{'interp_state':1},False),('stale',{'interp_state':1,'inpos':True,'current_vel':0},True)]:
   with self.subTest(name=name):
    c=drive2.Client2();c.st={**state,'estop':False};c.env={'clients':[{'armed':True}],'armed':True};c.env_at=time.monotonic()-(3 if stale else 0);sent=[]
    async def cmd(o):sent.append(o);raise drive2.Stop('never dispatch a machine command')
    c.cmd=cmd
    with self.assertRaises(drive2.Stop):await drive2.anchored_reset(c)
    OUT.setdefault('anchor_rejections',{})[name]=sent;self.assertEqual(sent,[])
 async def test_anchor_still_and_estop_controls(self):
  for state in [{'interp_state':1,'inpos':True,'current_vel':0,'estop':False},{'estop':True}]:
   c=drive2.Client2();c.st=state;c.env={};c.env_at=time.monotonic();self.assertIsNone(drive2.not_still(c))
 async def test_s_control_and_original_rests(self):
  recs,log=switches();r={'control':sv(recs,log),'missing':sv(recs,None),'extra':sv(switches(5)[0],log)}
  OUT['s_controls']=r;self.assertEqual(r['control']['verdict'],'S met');self.assertEqual(r['missing']['verdict'],'S not met');self.assertEqual(r['extra']['verdict'],'S not met')
 async def test_s_basis_and_no_supersession(self):
  recs,log=switches();log[0]['basis']='wrong';self.assertEqual(sv(recs,log)['verdict'],'S not met')
  recs,log=switches();recs=[r for r in recs if r['tag']!='gcode.reparse_superseded'];self.assertEqual(sv(recs,log)['verdict'],'S not met')
 async def test_r_control(self):
  r=rv(pinned()+seen()+sweep());OUT['r_positive_control']=r;self.assertEqual(r['verdict'],'R overlap proven')
 async def test_r_original_completed_case(self):
  r=rv(pinned()+seen()+sweep(end=12000));OUT['r_old_completed']=r;self.assertEqual(r['verdict'],'R overlap not proven')
 async def test_r_original_cross_page_case(self):
  s=sweep();s[-1]['page']='q';r=rv(pinned()+seen()+s,{'p','q'});OUT['r_old_cross_page']=r;self.assertEqual(r['verdict'],'R overlap not proven')
 async def test_r_original_idle_discard_case(self):
  r=rv(pinned()+seen()+[page('collision.run_check_start',10000,gen=1),page('collision.run_check_discarded',26000,gen=1,why='idle')]);OUT['r_old_idle_discard']=r;self.assertEqual(r['verdict'],'R overlap not proven')
 async def test_r_no_bound_and_non_run_sweep(self):
  self.assertEqual(rv(pinned()+seen()+sweep(),bound=None)['verdict'],'R overlap not proven')
  s=sweep();s[0]['run_gen']=None;self.assertEqual(rv(pinned()+seen()+s)['verdict'],'R overlap not proven')
 async def test_r_worker_already_done_before_parse_but_main_consumes_late(self):
  src=json.loads((ROOT/'sweep-evidence.json').read_text()); recs=pinned()+seen()+sweep()[:1]+src['events'];r=rv(recs)
  OUT['r_delayed_completion']={'source_probe':src,'records':recs,'result':r}
  self.assertEqual(r['verdict'],'R overlap not proven','Actual sweep 10–12 s, parse 20–25 s. Only completion handling is late (26 s).')
 async def test_r_paused_sweep_is_not_active_during_parse(self):
  src=json.loads((ROOT/'sweep-evidence.json').read_text())['pause'];r=rv(pinned()+seen()+sweep());OUT['r_paused']={'actual_pause':src,'actual_parse':[20000,25000],'result':r}
  self.assertEqual(r['verdict'],'R overlap not proven','The real pause path emits no event: held 19–27 s across the 20–25 s parse.')
 async def test_r_a_different_heartbeats_rtt_does_not_bound_the_parse_on_frame(self):
  # FIFO network stall entirely between heartbeats. HB at 19.8 and 20.8 s
  # have round trip <50 ms. Status-on (20.030) waits until 20.700; status-off
  # (20.533) follows at 20.701. Parse finished 20.500; sweep begins 20.600.
  recs=pinned(end=20.5)+seen(on=20700,off=20701)+sweep(start=20600,end=21000);r=rv(recs,bound=50)
  OUT['r_unpaired_status_delay']={'records':recs,'actual_parse':[20000,20500],'actual_sweep':[20600,21000],'on_frame_send':20030,'on_frame_receive':20700,'other_heartbeat_sends':[19800,20800],'largest_measured_heartbeat_roundtrip':50,'result':r}
  self.assertEqual(r['verdict'],'R overlap not proven','The largest sampled RTT is no bound on a different, unpaired status frame.')
 async def test_r183_slow_row_is_kept_and_phase_incomplete(self):
  rows=[ev('browser.viewer.perf',t,page='p',vis='visible',raf_pauses=0,age_h={str(age):60}) for t,age in [(101,10),(104,10),(107,10),(112,100),(115,10),(118,10)]]
  keep,ex,inner,cov=bpc2.page_rows(rows,{'p'},100*S,120*S);r=bpc2.target(keep,inner,cov);OUT['rows_original']={'kept':len(keep),'excluded':ex,'target':r,'age':bpc2.quant(bpc2.pool(keep,'age_h'))}
  self.assertEqual(len(keep),6);self.assertFalse(cov['complete']);self.assertEqual(r['verdict'],'not proven')
 async def test_visible_raf_stall_row_is_not_hidden(self):
  slow=json.loads((ROOT/'clock-evidence.json').read_text())['visibleLongRafGap']['actual'];rows=[ev('browser.viewer.perf',t,page='p',vis='visible',raf_pauses=0,age_h={'10':1}) for t in [101,104,107,115,118]]
  slow={**slow,**ev('browser.viewer.perf',112,page='p')};rows.append(slow);keep,ex,inner,cov=bpc2.page_rows(rows,{'p'},100*S,120*S)
  OUT['rows_visible_long_raf']={'row_from_real_module':slow,'kept_times':[r['t_wall_ns']/S for r in keep],'excluded':ex,'all_age':bpc2.quant(bpc2.pool(rows,'age_h')),'reported_age':bpc2.quant(bpc2.pool(keep,'age_h')),'target':bpc2.target(keep,inner,cov)}
  self.assertIn(slow,keep,'raf_pauses is a >5 s duration threshold, not evidence of hiding; visibility stayed visible.')
if __name__=='__main__':
 result=unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(Tests));(ROOT/'tools-evidence.json').write_text(json.dumps(OUT,indent=2));sys.exit(not result.wasSuccessful())
