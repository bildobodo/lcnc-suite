"""R220 supplementary transitions; fake LinuxCNC, own executor only."""
import asyncio
import threading
from concurrent.futures import ThreadPoolExecutor
from unittest import mock
from test_button_gates_d import _Writer
from test_button_gates import _payload, _run
from gateway_util import joint_jog_map
import test_r217_codex as queue_harness
import gateway

lc=gateway.linuxcnc
assert lc.__lcnc_fake__

class MoreBoundaries(_Writer):
    queued=queue_harness.WriteBoundary.queued

    def setUp(self):
        super().setUp()
        self.takes_the_mode()
        self.cmd.wait_complete=lambda *a:lc.RCS_DONE
        gateway._active_jogs.clear()
        gateway._cmd_lock=None
        self.controller(homed=False)
        gateway._shared_status=_payload(homed=False,inpos=True,current_vel=0.0)
        rows,why=joint_jog_map(list('XYZ'),3,list('XYZ'),[20.0]*3)
        p=mock.patch.object(gateway,'_joint_jog_facts',lambda:{
            'enabled':True,'fraction':0.1,'axes':rows,'reason':why})
        p.start();self.addCleanup(p.stop)

    def test_homing_gained_after_preparation_refuses_too(self):
        r=_run(self.queued({'cmd':'jog_cont','axis':0,'vel':1.0},
                          lambda:setattr(gateway.STAT,'homed',(1,)*3+(0,)*13)))
        print('inverse transition:',r,self.cmd.names())
        self.assertFalse(r['ok'])
        self.assertIn('Homing state changed',r['error'])
        self.assertEqual(gateway._active_jogs,{})
        self.assertNotIn('jog',self.cmd.names())

    def test_missing_homing_flags_after_queue_refuses(self):
        r=_run(self.queued({'cmd':'jog_cont','axis':0,'vel':1.0},
                          lambda:setattr(gateway.STAT,'joint',None)))
        print('unknown homing:',r,self.cmd.names())
        self.assertFalse(r['ok'])
        self.assertEqual(gateway._active_jogs,{})
        self.assertNotIn('jog',self.cmd.names())

    def test_failed_jog_write_books_nothing(self):
        self.cmd.jog=mock.Mock(side_effect=RuntimeError('failed before sending'))
        r=_run(gateway.handle_command({'cmd':'jog_cont','axis':0,'vel':1.0},True,self.writer.conn_key))
        print('failed write:',r,dict(gateway._active_jogs))
        self.assertFalse(r['ok'])
        self.assertEqual(gateway._active_jogs,{})

    def test_second_cancel_keeps_the_command_lock_until_written(self):
        async def go():
            loop=asyncio.get_running_loop()
            loop.set_default_executor(ThreadPoolExecutor(max_workers=1))
            release=threading.Event()
            blocker=loop.run_in_executor(None,release.wait,5)
            submitted=asyncio.Event()
            original=loop.run_in_executor
            jobs=[]
            def enqueue(executor,fn,*args):
                future=original(executor,fn,*args)
                jobs.append(future)
                submitted.set()
                return future
            task=None
            try:
                with mock.patch.object(loop,'run_in_executor',enqueue):
                    task=asyncio.create_task(gateway.handle_command(
                        {'cmd':'jog_cont','axis':0,'vel':1.0},True,self.writer.conn_key))
                    await asyncio.wait_for(submitted.wait(),2)
                    self.writer.cmd_inflight='jog_cont'
                    self.writer.cmd_inflight_task=task
                    # First cancel from the real preemption helper; a WS
                    # disconnect can then cancel that same inflight task.
                    self.assertEqual(gateway._preempt_inflight('abort',923),1)
                    await asyncio.sleep(0)
                    self.assertTrue(gateway._get_cmd_lock().locked())
                    task.cancel()
                    for _ in range(6):await asyncio.sleep(0)
                    held=gateway._get_cmd_lock().locked()
                    early_cleanup=False
                    if not held:
                        # The disconnect cleanup now gets the lock while
                        # the shielded CMD write has not started yet.
                        async with gateway._get_cmd_lock():
                            await gateway._jog_stop_for_client()
                        early_cleanup=True
                    release.set()
                    await blocker
                    await asyncio.gather(task,return_exceptions=True)
                    await asyncio.gather(*jobs,return_exceptions=True)
                    for _ in range(3):await asyncio.sleep(0)
                    after=dict(gateway._active_jogs)
                    calls=list(self.cmd.calls)
                    if not early_cleanup:
                        async with gateway._get_cmd_lock():
                            await gateway._jog_stop_for_client()
                    return held,early_cleanup,after,calls
            finally:
                release.set()
                if task and not task.done():
                    task.cancel()
                    await asyncio.gather(task,return_exceptions=True)
        held,early,booked,calls=_run(go())
        print('second cancel:',{'lock_held_until_write':held,'cleanup_before_write':early,
                               'booked_after_late_write':booked,'calls_before_later_cleanup':calls})
        self.assertTrue(held,'the command lock must not escape under an unfinished write')
