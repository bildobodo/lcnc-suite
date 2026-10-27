"""R217: real executor queue boundaries and the program start's flag prelude.
Only fake_linuxcnc; all CMD calls are recorded, no sockets or live machine.
"""
import asyncio
import threading
from concurrent.futures import ThreadPoolExecutor
from unittest import mock
from test_button_gates_d import _Writer
from test_button_gates import _payload, _run
import gateway
lc = gateway.linuxcnc
assert lc.__lcnc_fake__

class WriteBoundary(_Writer):
    def setUp(self):
        super().setUp()
        self.takes_the_mode()
        self.cmd.wait_complete = lambda *a: lc.RCS_DONE
        gateway._shared_status = _payload(inpos=True,current_vel=0.0)

    async def queued(self,msg,change):
        loop=asyncio.get_running_loop()
        pool=ThreadPoolExecutor(max_workers=1)
        loop.set_default_executor(pool)
        release=threading.Event()
        blocker=loop.run_in_executor(None,release.wait,5)
        submitted=asyncio.Event()
        original=loop.run_in_executor
        def enqueue(executor,fn,*args):
            fut=original(executor,fn,*args)
            submitted.set()
            return fut
        task=None
        try:
            with mock.patch.object(loop,'run_in_executor',enqueue):
                task=asyncio.create_task(gateway.handle_command(msg,True,self.writer.conn_key))
                await asyncio.wait_for(submitted.wait(),2)
                # A real work item is now queued behind the occupied worker.
                self.assertEqual(self.cmd.calls,[])
                change()
                release.set()
                await blocker
                return await asyncio.wait_for(task,3)
        finally:
            release.set()
            if task and not task.done():
                task.cancel()
                await asyncio.gather(task,return_exceptions=True)

    def test_mode_rechecks_homing_after_the_executor_queue(self):
        def changed():gateway.STAT.joint=tuple({'homing':1} for _ in range(16))
        r=_run(self.queued({'cmd':'set_mode','mode':lc.MODE_MDI},changed))
        print('mode after queue:',r,self.cmd.names())
        self.assertNotIn('mode',self.cmd.names())

    def test_spindle_rechecks_after_its_final_executor_queue(self):
        def changed():
            gateway.STAT.task_mode=lc.MODE_MDI
            gateway.STAT.interp_state=lc.INTERP_READING
        r=_run(self.queued({'cmd':'spindle_forward','speed':1000},changed))
        print('spindle after queue:',r,self.cmd.names())
        self.assertNotIn('spindle',self.cmd.names())

    def test_home_rechecks_after_its_final_executor_queue(self):
        def changed():
            gateway.STAT.task_mode=lc.MODE_MDI
            gateway.STAT.interp_state=lc.INTERP_READING
        r=_run(self.queued({'cmd':'home_all'},changed))
        print('home after queue:',r,self.cmd.names())
        self.assertNotIn('home',self.cmd.names())

    def test_unhome_rechecks_after_teleop_wait(self):
        def teleop(*args):
            self.cmd.calls.append(('teleop_enable',args,{}))
            gateway.STAT.interp_state=lc.INTERP_READING
            gateway.STAT.task_mode=lc.MODE_MDI
        self.cmd.teleop_enable=teleop
        r=_run(gateway.handle_command({'cmd':'unhome_all'},True,self.writer.conn_key))
        print('unhome after teleop:',r,self.cmd.names())
        self.assertNotIn('unhome',self.cmd.names())

    def test_unchanged_controller_passes_through_same_queue(self):
        r=_run(self.queued({'cmd':'spindle_forward','speed':1000},lambda:None))
        self.assertTrue(r['ok'],r)
        self.assertIn('spindle',self.cmd.names())

    def start_queue(self, cmd, already_auto):
        # With AUTO already selected, the queued side effect is AUTO_RUN /
        # AUTO_STEP itself. Otherwise it is their preparatory MODE(AUTO).
        self.controller(task_mode=lc.MODE_AUTO if already_auto else lc.MODE_MANUAL)
        def changed():
            gateway.STAT.task_mode=lc.MODE_MDI
            gateway.STAT.interp_state=lc.INTERP_READING
        r=_run(self.queued({'cmd':cmd},changed))
        print(cmd, 'already_auto=',already_auto, r, self.cmd.names())
        self.assertNotIn('auto' if already_auto else 'mode',self.cmd.names())

    def test_start_rechecks_before_queued_mode(self):
        self.start_queue('cycle_start',False)

    def test_step_rechecks_before_queued_mode(self):
        self.start_queue('auto_step',False)

    def test_start_rechecks_before_queued_auto(self):
        self.start_queue('cycle_start',True)

    def test_step_rechecks_before_queued_auto(self):
        self.start_queue('auto_step',True)

    def test_skip_flag_prelude_refuses_before_its_mode_switch(self):
        # Old published idle, but another GUI's AUTO run now owns the machine.
        self.controller(task_mode=lc.MODE_AUTO,interp_state=lc.INTERP_READING)
        # The flag writer itself is isolated: this test concerns the MODE
        # command before it. Keep it pending, as it would be until confirmed.
        with mock.patch.object(gateway,'_skip_flag_unknown',True), \
             mock.patch.object(gateway,'_apply_probe_vars',mock.AsyncMock(return_value=(False,False))):
            r=_run(gateway.handle_command({'cmd':'cycle_start'},True,self.writer.conn_key))
        print('skip prelude:',r,self.cmd.names())
        self.assertNotIn('mode',self.cmd.names(),'the guard must refuse BEFORE its own MDI switch')
