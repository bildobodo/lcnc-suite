"""R207 independent fake-only probes at bc3c36c1.
Run in an archive: pytest r207_probe.py -q -s -o addopts=''.
No controller, HAL connection, or real socket. The command uses a real
ThreadPoolExecutor queue. The HAL receiver uses the repository's actual
_consume_buf function extracted by AST, without running hal_watchdog startup.
"""
import ast
import asyncio
import json
import socket
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
import test_button_gates as base
from hal_bridge import HalBridge

gateway, linuxcnc = base.gateway, base.linuxcnc
assert linuxcnc.__lcnc_fake__

class TestStartWriteQueue(base._Handlers):
    def setUp(self):
        super().setUp()
        gateway.STAT.task_mode = linuxcnc.MODE_AUTO
        gateway.STAT.g5x_index = 1
        gateway._shared_status = base._payload(kins_type=0.0, twp_active=False,
                                               g5x_index=1, reader_fresh=True)
        self.now = {'kins_type': 0.0, 'twp_active': False}
        gateway._kins_is_switchable = lambda: True
        gateway._twp_capable = lambda: True
        gateway._reader_is_stale = lambda: False
        gateway._reader_get = self.now.get

    def exercise(self, command, change):
        log=[]
        async def run():
            loop=asyncio.get_running_loop()
            submitted=asyncio.Event()
            class ObservedExecutor(ThreadPoolExecutor):
                observe=False
                def submit(self,fn,*args,**kwargs):
                    future=super().submit(fn,*args,**kwargs)
                    if self.observe:
                        submitted.set()
                    return future
            executor=ObservedExecutor(max_workers=1,thread_name_prefix='r207-io')
            loop.set_default_executor(executor)
            entered, release = threading.Event(), threading.Event()
            def occupy():
                entered.set()
                if not release.wait(8):
                    raise TimeoutError('probe did not release the IO worker')
            occupied=loop.run_in_executor(None,occupy)
            while not entered.is_set():
                await asyncio.sleep(0)
            executor.observe=True
            actual=gateway._cmd_blocking
            async def observe(fn,*args,**kwargs):
                check=kwargs.get('admit')
                if check:
                    def observed_check():
                        reason=check()
                        log.append({'admit':reason,'thread':threading.current_thread().name,
                                    'state':dict(self.now)})
                        return reason
                    kwargs['admit']=observed_check
                return await actual(fn,*args,**kwargs)
            with patch.object(gateway,'_cmd_blocking',observe):
                task=asyncio.create_task(gateway.handle_command({'cmd':command},True))
                try:
                    await asyncio.wait_for(submitted.wait(),2)
                    # The real command cannot run yet: the worker is occupied.
                    self.assertNotIn('auto',self.cmd.names())
                    if change:
                        self.now.update(kins_type=2.0,twp_active=False)
                    log.append({'release_worker_with_state':dict(self.now)})
                finally:
                    release.set()
                await occupied
                reply=await asyncio.wait_for(task,3)
                log.append({'reply':reply,'commands':self.cmd.names()})
                return reply
        reply=base._run(run())
        print(json.dumps({'case':self.id().split('.')[-1],'trace':log}))
        return reply

    def test_cycle_refuses_a_frame_changed_while_write_queued(self):
        reply=self.exercise('cycle_start',True)
        self.assertFalse(reply['ok'],'Admission precedes the executor queue, not the write')
        self.assertNotIn('auto',self.cmd.names())

    def test_idle_step_refuses_a_frame_changed_while_write_queued(self):
        reply=self.exercise('auto_step',True)
        self.assertFalse(reply['ok'],'Admission precedes the executor queue, not the write')
        self.assertNotIn('auto',self.cmd.names())

    def test_control_queued_unchanged_start_succeeds(self):
        self.assertTrue(self.exercise('cycle_start',False)['ok'])
        self.assertIn('auto',self.cmd.names())


def receiver():
    # Execute only the repository's parser, no module startup / imports / HAL.
    tree=ast.parse(Path('hal_watchdog.py').read_text())
    fn=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='_consume_buf')
    warnings=[]
    state={'buf':'','comp':{},'json':json,'_wd_msgs_processed':0,
           '_trace':SimpleNamespace(emit=lambda *a,**kw:warnings.append((a,kw)))}
    exec(compile(ast.Module(body=[fn],type_ignores=[]),'hal_watchdog.py:actual-parser','exec'),state)
    state['warnings']=warnings
    return state

class PartialSocket:
    """Accepted stream: first send writes a JSON prefix and then times out.
    Later writes append their bytes to the SAME receiver stream, as TCP/Unix
    SOCK_STREAM does. _consume_buf is the production reader, not a facsimile.
    """
    def __init__(self,state,partial=True):
        self.state=state
        self.partial=partial
        self.closed=False
        self.fragments=[]
    def sendall(self,data):
        if self.closed:
            raise BrokenPipeError('closed')
        if self.partial:
            self.partial=False
            data=data[:10]
            self.feed(data)
            raise socket.timeout('probe: prefix delivered, remainder timed out')
        self.feed(data)
    def feed(self,data):
        self.fragments.append(data.decode())
        self.state['buf']+=data.decode()
        self.state['_consume_buf']()
    def close(self):
        self.closed=True

class TestPartialToolConfirmation(base._Handlers):
    def setUp(self):
        super().setUp()
        rt=gateway._status_runtime
        saved=(rt.tool_change_seq,rt.tool_change_tool,gateway._tool_change_confirmed)
        rt.tool_change_seq,rt.tool_change_tool=41,7
        gateway._tool_change_confirmed=None
        def restore():
            rt.tool_change_seq,rt.tool_change_tool,gateway._tool_change_confirmed=saved
        self.addCleanup(restore)
        gateway._reader_is_stale=lambda:False
        gateway._reader_get={'tool_change':True,'tool_prep_number':7}.get
        self.bridge=HalBridge(set_phase=lambda _:None,on_reader_connect=lambda:None,hello=lambda:{},
            watchdog_path='/tmp/r207-never-connected',reader_path='/tmp/r207-never-connected-reader')
        self.bridge._wd_poll_reply=lambda:None
        self.bridge._wd_state='admitted'
        self.rx=receiver()
    def confirm(self):
        return self._send({'cmd':'confirm_tool_change','request':41},
            tool_change_requested=True,tool_change_tool=7,tool_change_seq=41,
            interp_state=linuxcnc.INTERP_WAITING)
    def test_partial_timeout_then_retry_cannot_book_a_dropped_message(self):
        sock=PartialSocket(self.rx)
        self.bridge._wd_sock=sock
        with patch.object(gateway,'_hal_send',self.bridge.watchdog_send):
            first=self.confirm()
            self.assertFalse(first['ok'])
            second=self.confirm()
            third=self.confirm()
        print(json.dumps({'case':self.id().split('.')[-1], 'first':first,'second':second,'third':third,
            'written_fragments':sock.fragments,'pins':self.rx['comp'],'parser_warnings':self.rx['warnings'],
            'booked':gateway._tool_change_confirmed}))
        self.assertFalse(second['ok'] and not self.rx['comp'].get('tool-changed'),
            'Retry reported successful although the real receiver dropped the joined JSON')
        self.assertFalse(gateway._tool_change_confirmed==41 and not self.rx['comp'].get('tool-changed'),
            'No tool-changed pin, but all further confirmations permanently refused')
    def test_control_complete_message_sets_pin_and_is_booked_once(self):
        sock=PartialSocket(self.rx,partial=False)
        self.bridge._wd_sock=sock
        with patch.object(gateway,'_hal_send',self.bridge.watchdog_send):
            first=self.confirm();second=self.confirm()
        self.assertTrue(first['ok'])
        self.assertFalse(second['ok'])
        self.assertTrue(self.rx['comp']['tool-changed'])
        self.assertEqual(gateway._tool_change_confirmed,41)
        self.assertEqual(len(sock.fragments),1)
