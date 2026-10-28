"""R219: late homing state, cancellation, homing admission. Fake binding only."""
import asyncio
import threading
from concurrent.futures import ThreadPoolExecutor
from unittest import mock
import test_r217_codex as prior
from test_button_gates_d import _Writer
from test_button_gates import _payload, _run
from gateway_util import joint_jog_map
import gateway

lc = gateway.linuxcnc
assert lc.__lcnc_fake__

class Transitions(_Writer):
    queued = prior.WriteBoundary.queued

    def setUp(self):
        super().setUp()
        self.takes_the_mode()
        self.cmd.wait_complete = lambda *args: lc.RCS_DONE
        gateway._active_jogs.clear()
        gateway._cmd_lock = None
        self.order('XYZ')
        gateway._shared_status = _payload(inpos=True, current_vel=0.0)

    def order(self, letters):
        rows, why = joint_jog_map(list(letters), len(letters), list('XYZ'), [20.0]*len(letters))
        patch = mock.patch.object(gateway, '_joint_jog_facts', lambda: {
            'enabled':True,'fraction':0.1,'axes':rows,'reason':why})
        patch.start()
        self.addCleanup(patch.stop)

    def jogs(self):
        return [args for name,args,_ in self.cmd.calls if name=='jog']

    def test_lost_homing_while_queued_does_not_keep_uncapped_speed(self):
        gateway.STAT.motion_mode = 1  # native FREE; the fake only exports TRAJ_MODE_TELEOP
        gateway._shared_status = _payload(homed=True,inpos=True,current_vel=0.0,joints_beyond_limit=['X'])
        r = _run(self.queued({'cmd':'jog_cont','axis':0,'vel':9.0},
                            lambda: setattr(gateway.STAT,'homed',(0,)*16)))
        jogs = self.jogs()
        print('homing lost, cap:',r,jogs)
        self.assertTrue(not jogs or abs(jogs[-1][3]) <= 2.0,
                        'fresh unhomed state must refuse or use the declared cap')

    def test_lost_homing_while_queued_does_not_open_gantry(self):
        self.order('XYYZ')
        self.controller(joints=4)
        gateway.STAT.homed = (1,)*4 + (0,)*12
        gateway.STAT.motion_mode = 1  # native FREE; the fake only exports TRAJ_MODE_TELEOP
        gateway._shared_status = _payload(homed=True,inpos=True,current_vel=0.0,joints_beyond_limit=['Y'])
        r = _run(self.queued({'cmd':'jog_cont','axis':1,'vel':1.0},
                            lambda: setattr(gateway.STAT,'homed',(0,)*16)))
        print('homing lost, gantry:',r,self.jogs())
        self.assertEqual(self.jogs(),[], 'no single-joint Y jog before homing')

    def test_new_joint_jog_during_homing_is_refused(self):
        self.controller(homed=False,homing=True)
        gateway._shared_status = _payload(homed=False,inpos=True,current_vel=0.0,homing_active=True)
        r = _run(gateway.handle_command({'cmd':'jog_cont','axis':0,'vel':1.0},True,self.writer.conn_key))
        print('homing active:',r,self.jogs(),gateway._controller_gate_refusal('jog',True))
        self.assertFalse(r['ok'], 'native motion rejects every new joint jog while homing')
        self.assertEqual(self.jogs(),[])

    def test_homing_started_in_queue_is_refused(self):
        self.controller(homed=False)
        gateway._shared_status = _payload(homed=False,inpos=True,current_vel=0.0)
        def changed():gateway.STAT.joint=tuple({'homing':True} for _ in range(16))
        r = _run(self.queued({'cmd':'jog_cont','axis':0,'vel':1.0},changed))
        print('homing started in queue:',r,self.jogs())
        self.assertEqual(self.jogs(),[])

    def test_cancel_queued_jog_still_stops_on_disconnect(self):
        self.controller(homed=False)
        gateway._shared_status = _payload(homed=False,inpos=True,current_vel=0.0)
        async def go():
            loop=asyncio.get_running_loop()
            loop.set_default_executor(ThreadPoolExecutor(max_workers=1))
            release=threading.Event()
            blocker=loop.run_in_executor(None,release.wait,5)
            submitted=asyncio.Event()
            original=loop.run_in_executor
            def enqueue(executor,fn,*args):
                future=original(executor,fn,*args)
                submitted.set()
                return future
            with mock.patch.object(loop,'run_in_executor',enqueue):
                task=asyncio.create_task(gateway.handle_command({'cmd':'jog_cont','axis':0,'vel':1.0},True,self.writer.conn_key))
                try:
                    await asyncio.wait_for(submitted.wait(),2)
                    self.assertEqual(self.jogs(),[])
                    task.cancel()  # disconnect while the write is queued
                    await asyncio.sleep(0)
                finally:
                    release.set()
                await blocker
                result=await asyncio.gather(task,return_exceptions=True)
            # _cmd_blocking shields the write and waits for it to END before
            # releasing the lock, as it must. The ordinary recorder returns
            # immediately; no fake wait inside a native CMD call is needed.
            self.assertIsInstance(result[0],asyncio.CancelledError)
            booked=dict(gateway._active_jogs)
            async with gateway._get_cmd_lock():
                await gateway._jog_stop_for_client()
            return booked
        booked=_run(go())
        print('cancelled queued write then disconnect:',booked,self.jogs())
        if any(args[0] == lc.JOG_CONTINUOUS for args in self.jogs()):
            self.assertIn((lc.JOG_STOP,1,0),self.jogs(),
                          'a jog whose write finished must be reachable by disconnect stop')
        else:
            self.assertEqual(gateway._active_jogs,{})  # cancelling an unsent jog is also valid

    def test_unchanged_unhomed_cap_and_stop(self):
        self.controller(homed=False)
        gateway._shared_status = _payload(homed=False,inpos=True,current_vel=0.0)
        r=_run(gateway.handle_command({'cmd':'jog_cont','axis':0,'vel':9.0},True,self.writer.conn_key))
        self.assertTrue(r['ok'],r)
        self.assertEqual(self.jogs(),[(lc.JOG_CONTINUOUS,1,0,2.0)])
        r=_run(gateway.handle_command({'cmd':'jog_stop','axis':0},False,self.writer.conn_key))
        self.assertTrue(r['ok'],r)
        self.assertEqual(self.jogs()[-1],(lc.JOG_STOP,1,0))
        self.assertEqual(gateway._active_jogs,{})
