"""R210 independent lifecycle check at a8b0b03f.
Real Unix sockets only in a TemporaryDirectory. No gateway/controller/HAL
imports, no live endpoint. pytest r210_probe.py -q -s -o addopts=''
"""
import json
import socket
import tempfile
import threading
import time
import unittest
from pathlib import Path
from hal_bridge import HalBridge


class TestFullQueueRecovery(unittest.TestCase):
    def test_failed_connect_releases_owner_then_reconnects_and_sends(self):
        with tempfile.TemporaryDirectory(prefix='r210-wd-',dir='/tmp') as d:
            path=str(Path(d)/'own-watchdog.sock')
            srv=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM)
            srv.bind(path);srv.listen(0);srv.settimeout(2)
            filler=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM)
            filler.settimeout(.1);filler.connect(path)
            b=HalBridge(set_phase=lambda _:None,on_reader_connect=lambda:None,
                        hello=lambda:{'instance':[1234,5678]},
                        watchdog_path=path,reader_path=str(Path(d)/'unused-reader.sock'))
            accepted=None;worker=None;frames=[];thread_errors=[]
            try:
                t0=time.monotonic()
                first=b.watchdog_send({'connected':True})
                elapsed=time.monotonic()-t0
                self.assertIs(first,False)
                self.assertIsNone(b._wd_sock)
                self.assertFalse(b.watchdog_connected)
                self.assertFalse(b._wd_frame_open)
                self.assertLess(elapsed,.25)
                # RLock would re-enter on this thread, so another thread must
                # prove the failed attempt did not leave stream ownership held.
                closed=threading.Event()
                def disconnect():
                    b.watchdog_disconnect();closed.set()
                closer=threading.Thread(target=disconnect);closer.start();closer.join(.25)
                self.assertTrue(closed.is_set())
                accepted,_=srv.accept();accepted.close();accepted=None
                filler.close()
                def helper():
                    try:
                        conn,_=srv.accept()
                        with conn:
                            conn.settimeout(2)
                            buf=b'';welcomed=False
                            while True:
                                data=conn.recv(4096)
                                if not data:break
                                buf+=data
                                while b'\n' in buf:
                                    line,buf=buf.split(b'\n',1)
                                    if not line:continue
                                    frames.append(json.loads(line))
                                    if not welcomed:
                                        welcomed=True
                                        conn.sendall(b'{"type":"welcome"}\n')
                    except BaseException as e:
                        thread_errors.append(repr(e))
                worker=threading.Thread(target=helper,daemon=True);worker.start()
                admission_send=b.watchdog_send({'connected':True})
                deadline=time.monotonic()+1
                while not b.watchdog_admitted and time.monotonic()<deadline:
                    b.watchdog_send({'heartbeat':False})
                    time.sleep(.002)
                self.assertTrue(b.watchdog_admitted)
                final=b.watchdog_send({'tool_changed':True})
                self.assertIs(final,True)
                b.watchdog_disconnect();worker.join(2)
                self.assertFalse(worker.is_alive())
                self.assertEqual(thread_errors,[])
                self.assertEqual(sum(f.get('tool_changed') is True for f in frames),1)
                self.assertFalse(b.watchdog_connected)
                self.assertFalse(b._wd_frame_open)
                print(json.dumps({'case':'full_queue_then_reconnect','first':first,
                      'first_ms':round(elapsed*1000,3),'admission_send':admission_send,
                      'final':final,'frames':frames,'closed':closed.is_set()}))
            finally:
                b.watchdog_disconnect()
                filler.close()
                if accepted:accepted.close()
                srv.close()
                if worker:worker.join(2)
