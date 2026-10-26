"""R209 review probes at be63d3d4. Only fake_linuxcnc and sockets in a
TemporaryDirectory, no live endpoint. Run: pytest r209_probe.py -q -s -o addopts=''
The backlog test uses a real AF_UNIX socket with a full accept queue and an
unmodified HalBridge. All threads are released and joined before assertions.
"""
import asyncio
import json
import socket
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch
import test_button_gates as base
from hal_bridge import HalBridge

gateway,linuxcnc=base.gateway,base.linuxcnc
assert linuxcnc.__lcnc_fake__


def new_bridge(**kwargs):
    defaults=dict(set_phase=lambda _:None,on_reader_connect=lambda:None,
                  hello=lambda:{'instance':[1234,5678]},
                  watchdog_path='/tmp/r209-never-opened',reader_path='/tmp/r209-never-opened-reader')
    defaults.update(kwargs)
    return HalBridge(**defaults)


class TestBusyM6(base._Handlers):
    def test_busy_confirmation_is_unbooked_and_not_queued_then_retry_works(self):
        rt=gateway._status_runtime
        saved=(rt.tool_change_seq,rt.tool_change_tool,gateway._tool_change_confirmed)
        rt.tool_change_seq,rt.tool_change_tool=41,7
        gateway._tool_change_confirmed=None
        def restore():
            rt.tool_change_seq,rt.tool_change_tool,gateway._tool_change_confirmed=saved
        self.addCleanup(restore)
        gateway._reader_is_stale=lambda:False
        gateway._reader_get={'tool_change':True,'tool_prep_number':7}.get
        rx=base.receiver()
        sock=base.PartialSocket(rx,partial=False)
        b=new_bridge();b._wd_sock=sock;b._wd_state='admitted';b._wd_poll_reply=lambda:None
        held,release=threading.Event(),threading.Event()
        def occupy():
            with b._wd_lock:
                held.set();release.wait(2)
        t=threading.Thread(target=occupy);t.start()
        self.assertTrue(held.wait(1))
        def confirm():
            return self._send({'cmd':'confirm_tool_change','request':41},
                             tool_change_requested=True,tool_change_tool=7,tool_change_seq=41,
                             interp_state=linuxcnc.INTERP_WAITING)
        try:
            with patch.object(gateway,'_hal_send',b.watchdog_send):
                t0=time.monotonic();first=confirm();elapsed=time.monotonic()-t0
                self.assertFalse(first['ok'])
                self.assertIn('not sent',first['error'])
                self.assertIsNone(gateway._tool_change_confirmed)
                self.assertEqual(sock.fragments,[])
                release.set();t.join(1)
                # An awaited executor barrier proves the refused operation
                # did not just leave another write pending in that executor.
                base._run(asyncio.to_thread(lambda:None))
                self.assertEqual(sock.fragments,[])
                second=confirm()
        finally:
            release.set();t.join(1)
        print(json.dumps({'case':'busy_m6','first':first,'retry':second,
                          'seconds':round(elapsed,3),'frames':sock.fragments,
                          'pins':rx['comp'],'booked':gateway._tool_change_confirmed}))
        self.assertTrue(second['ok'])
        self.assertIs(rx['comp']['tool-changed'],True)
        self.assertEqual(gateway._tool_change_confirmed,41)
        self.assertLess(elapsed,.5)


class TestDisconnectOwnership(unittest.TestCase):
    def test_disconnect_waits_until_a_bounded_active_send_finishes(self):
        entered=threading.Event();closed=threading.Event();done=threading.Event();events=[]
        class Sock:
            def sendall(self,data):
                events.append('send entered');entered.set()
                time.sleep(.025)
                assert not closed.is_set()
                events.append('send returned')
            def close(self):events.append('close');closed.set()
        b=new_bridge();b._wd_sock=Sock();b._wd_state='admitted';b._wd_poll_reply=lambda:None
        outcomes=[]
        def send():
            outcomes.append(b.watchdog_send({'connected':True}));done.set()
        t=threading.Thread(target=send);t.start()
        self.assertTrue(entered.wait(1))
        b.watchdog_disconnect();t.join(1)
        print(json.dumps({'case':'disconnect_owner','events':events,'outcomes':outcomes}))
        self.assertEqual(events,['send entered','send returned','close'])
        self.assertTrue(done.is_set())
        self.assertEqual(outcomes,[True])
        self.assertIsNone(b._wd_sock)
        self.assertFalse(b._wd_frame_open)


class TestConnectTimeBound(unittest.TestCase):
    def test_full_accept_queue_does_not_hold_send_and_disconnect_indefinitely(self):
        with tempfile.TemporaryDirectory(prefix='r209-backlog-',dir='/tmp') as d:
            path=str(Path(d)/'watchdog.sock')
            srv=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM)
            srv.bind(path);srv.listen(0);srv.settimeout(1)
            # Linux accepts one pending connection with backlog=0. Fill that
            # slot without consuming it, like a listening helper not accepting.
            filler=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM)
            filler.settimeout(.1);filler.connect(path)
            # Prove the accept queue is full before exercising the bridge.
            extra=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM);extra.settimeout(.02)
            try:
                extra.connect(path)
                raise AssertionError('probe setup did not saturate the accept queue')
            except (socket.timeout, BlockingIOError):
                pass
            finally:
                extra.close()
            b=new_bridge(watchdog_path=path)
            entered,send_done,disc_done=threading.Event(),threading.Event(),threading.Event()
            results={};accepted=[]
            # Observe only that the real connect method has been entered;
            # socket.connect and its timeout behavior are not patched.
            connect_name=('_watchdog_connect_locked' if hasattr(b,'_watchdog_connect_locked')
                          else 'watchdog_connect')
            real_connect=getattr(b,connect_name)
            def observe_connect():
                entered.set()
                return real_connect()
            setattr(b,connect_name,observe_connect)
            def send():
                t0=time.monotonic()
                try:results['send_result']=b.watchdog_send({'heartbeat':True})
                except BaseException as e:results['send_error']=repr(e)
                finally:results['send_seconds']=time.monotonic()-t0;send_done.set()
            def disconnect():
                t0=time.monotonic()
                b.watchdog_disconnect()
                results['disconnect_seconds']=time.monotonic()-t0;disc_done.set()
            writer=threading.Thread(target=send,daemon=True)
            closer=threading.Thread(target=disconnect,daemon=True)
            writer.start()
            try:
                self.assertTrue(entered.wait(1))
                bounded_send=send_done.wait(.25)
                closer.start()
                bounded_disconnect=disc_done.wait(.25)
                results.update(send_finished_by_250ms=bounded_send,
                               disconnect_finished_by_250ms=bounded_disconnect)
            finally:
                # Only now let the helper accept: the blocked connect gains
                # space, so the real bridge and waiting lifecycle can finish.
                try:
                    conn,_=srv.accept();accepted.append(conn)
                    writer.join(1);closer.join(1)
                finally:
                    b.watchdog_disconnect()
                    filler.close()
                    for conn in accepted:conn.close()
                    srv.close()
            print(json.dumps({'case':'real_full_accept_queue',**results}))
            self.assertFalse(writer.is_alive())
            self.assertFalse(closer.is_alive())
            self.assertTrue(bounded_send,
                            'The real connect has no timeout; the 60 ms lock limit does not bound this send')
            self.assertTrue(bounded_disconnect,
                            'Lifecycle waits without a deadline for the connect holder')
