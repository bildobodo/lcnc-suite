"""R182 review: offline counterexamples; no sockets, machine or real log access.
Run with gateway venv Python; TOOL_DIR contains unmodified, renamed evidence.
"""
import asyncio, contextlib, io, json, os, pathlib, sys, tempfile, unittest
from unittest.mock import AsyncMock, patch
ROOT=pathlib.Path(os.environ.get('R182_PROBE_ROOT', pathlib.Path(__file__).resolve().parent))
sys.path.insert(0, str(ROOT/'measurement-tools'))
sys.path.insert(0, str(ROOT/'repo/lcnc-gateway'))
import bpc, drive, drive2, report2
from ws_fanout import build_status_envelope
OUT={}
class Frames:
    def __init__(self, frames): self.frames=iter(frames)
    def __aiter__(self): return self
    async def __anext__(self):
        try: return json.dumps(next(self.frames))
        except StopIteration: raise StopAsyncIteration
class Tests(unittest.IsolatedAsyncioTestCase):
    async def test_client_guard_reads_real_envelope(self):
        envelope=build_status_envelope(status_data={'interp_state':1, 'enabled':True}, errors=[],
            clients_list=[{'ip':'127.0.0.1','armed':True},{'ip':'192.0.2.1','armed':True}],
            armed=True, safety_trip={'reason':'test trip'})
        c=drive.Client(); c.ws=Frames([envelope]); await c._read()
        OUT['guard']={'wire':envelope,'driver_status':c.st,'detected_armed':drive2.other_armed(c.st),
                      'detected_trip':c.st.get('safety_trip')}
        self.assertEqual(len(drive2.other_armed(c.st)),1,'The actual gateway envelope contains an armed remote page')
        self.assertEqual(c.st.get('safety_trip'),envelope['safety_trip'])
    async def test_guard_control_with_flattened_envelope(self):
        self.assertEqual(len(drive2.other_armed({'clients':[{'ip':'192.0.2.1','armed':True}]})),1)
    async def test_second_local_client_is_not_the_driver(self):
        clients=[{'ip':'127.0.0.1','armed':True}, {'ip':'127.0.0.1','armed':True}]
        detected=drive2.other_armed({'clients':clients})
        OUT['two_local_clients']={'clients':clients,'detected':detected}
        self.assertTrue(detected,'Only one local armed client is this driver; the second must be detected')
    async def test_valid_watchdog_gap_control(self):
        with tempfile.TemporaryDirectory() as d:
            log=pathlib.Path(d)/'wd'; log.write_text('[HB-DUMP] +1000ms reason=trip_reset\n[HB-RISING] +2000ms True-to-True gap 450ms\n')
            with patch.object(report2,'WDLOG',str(log)),patch.object(report2,'RSS',str(pathlib.Path(d)/'rss')):
                anchor,rising=report2.wd_anchor([{'tag':'wd.trip_reset','t_wall_ns':10**9}])
                out=report2.phase([],{},10**9,3*10**9,set(),rising)
                OUT['valid_watchdog_control']={'anchor':anchor,'rising':rising,'report':out}
        self.assertEqual(out['hal_heartbeat']['watchdog_true_to_true_over_200ms'],[450])
        self.assertEqual(out['hal_heartbeat']['bound'],'see the gaps')
    async def test_missing_watchdog_is_unknown(self):
        with tempfile.TemporaryDirectory() as d, patch.object(report2,'WDLOG',os.path.join(d,'missing')), patch.object(report2,'RSS',os.path.join(d,'rss')):
            anchor,rising=report2.wd_anchor([])
            out=report2.phase([],{},0,10**9,set(),rising)
            OUT['missing_watchdog']={'anchor':anchor,'report':out}
        self.assertNotIn('no receipt gap',out['hal_heartbeat']['bound'],'Missing log/anchor must not certify a receipt bound')
    async def test_clock_step_invalidates_bound(self):
        with tempfile.TemporaryDirectory() as d, patch.object(report2,'RSS',os.path.join(d,'rss')):
            out=report2.phase([],{'vm_clock_steps_ms':[41000]},0,10**9,set(),[])
            OUT['clock_step']=out
        self.assertNotIn('no receipt gap',out['hal_heartbeat']['bound'],'A detected clock step must invalidate/re-anchor the bound')
    async def test_later_reset_cannot_move_an_old_gap(self):
        # trace filtered to the measurement contains reset at wall=1 s.
        # Watchdog later reset is beyond the measurement; taking the last from
        # each input independently mismatches these two resets by 4 seconds.
        with tempfile.TemporaryDirectory() as d:
            log=pathlib.Path(d)/'wd'; log.write_text('[HB-DUMP] +1000ms reason=trip_reset\n[HB-RISING] +2000ms True-to-True gap 450ms\n[HB-DUMP] +5000ms reason=trip_reset\n')
            with patch.object(report2,'WDLOG',str(log)),patch.object(report2,'RSS',str(pathlib.Path(d)/'rss')):
                anchor,rising=report2.wd_anchor([{'tag':'wd.trip_reset','t_wall_ns':10**9}])
                out=report2.phase([],{},10**9,3*10**9,set(),rising)
                OUT['reset_mismatch']={'anchor':anchor,'rising':rising,'report':out}
        self.assertNotIn('no receipt gap',out['hal_heartbeat']['bound'],'450 ms gap was inside the measured 1..3 s interval')
    async def _supersede(self,cancel):
        sp1={'tag':'gcode.spawn_start','job':1,'basis':'b1','active_idx':2,'t_wall_ns':100}
        sp2={'tag':'gcode.spawn_start','job':2,'basis':'b2','active_idx':1,'t_wall_ns':200}
        pub={'tag':'gcode.publish','job':2,'basis':'b2','active_idx':1,'t_wall_ns':300}
        async def wait(pred,t,timeout,what,tags):
            x=responses.pop(0); self.assertTrue(pred(x)); return x
        responses=[sp1,sp2,pub]
        ends=[{'tag':'gcode.reparse_superseded','job':1},{'tag':'gcode.parse_cancelled','job':1},pub] if cancel else [{'tag':'gcode.publish','job':1},pub]
        c=type('FakeClient',(),{'cmd':AsyncMock()})()
        with patch.object(drive2,'wait_trace',wait),patch.object(drive2,'recs_after',side_effect=[[] if cancel else [{'tag':'gcode.worker_done','job':1}],ends]),patch.object(drive2.asyncio,'sleep',AsyncMock()),contextlib.redirect_stdout(io.StringIO()):
            result=await drive2.supersede(c,2,1.5)
        return result
    async def test_supersede_control(self):
        result=await self._supersede(True); OUT['supersede_control']=result
        self.assertEqual(result[0]['ended'],['gcode.parse_cancelled','gcode.reparse_superseded'])
    async def test_supersede_characterization_no_cancel_is_only_logged(self):
        result=await self._supersede(False); OUT['no_supersede']=result
        self.assertEqual(result[0]['ended'], ['gcode.publish'])  # Diagnostic outcome, not acceptance proof.
    async def test_pooled_histogram_control(self):
        self.assertEqual(report2.quant(report2.pool([{'h':{'0':9}},{'h':{'100':1}}],'h')), {'n':10,'p50':1.0,'p95':110.0,'p99':110.0})
if __name__=='__main__':
    r=unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(Tests))
    (ROOT/'tools-evidence.json').write_text(json.dumps(OUT,indent=2))
    sys.exit(not r.wasSuccessful())
