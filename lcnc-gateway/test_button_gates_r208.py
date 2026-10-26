"""Button gates BG-20 / BG-09 — Codex's R208 probe, adopted UNCHANGED as the
guard (docs/reviews/button-gates.r208.backend.py; only this header differs).
R208 fake-only transport and last-write probes at 66f58e2a.
No sockets or live HAL; real watchdog_send plus the repository receiver AST.
No product edits; fault injection supplies partial writes and thread order.
"""
import asyncio
import contextlib
import io
import json
import socket
import threading
import time
import unittest
from unittest.mock import patch
import test_button_gates as base
from hal_bridge import HalBridge

gateway, linuxcnc = base.gateway, base.linuxcnc
assert linuxcnc.__lcnc_fake__


def receiver():
    rx=base.receiver()
    rx.update(time=time,_T0=time.monotonic(),_hb_recv_ring=[],
              _last_hb_recv=None,_last_hb_recv_true=None,
              _HB_DUMP_GAP_MS=1000,_hb_recv_print=lambda *a:None,
              _hb_recv_flush=lambda *a:None)
    return rx


def bridge(sock):
    b=HalBridge(set_phase=lambda _:None,on_reader_connect=lambda:None,hello=lambda:{},
                watchdog_path='/tmp/r208-never-opened',reader_path='/tmp/r208-never-opened-reader')
    b._wd_sock=sock
    b._wd_state='admitted'
    b._wd_poll_reply=lambda:None
    return b


class CutSocket:
    def __init__(self,rx,cuts):
        self.rx,self.cuts=rx,list(cuts)
        self.fragments=[]
    def feed(self,data):
        self.fragments.append(data.decode())
        self.rx['buf']+=data.decode()
        self.rx['_consume_buf']()
    def sendall(self,data):
        if self.cuts:
            n=self.cuts.pop(0)
            assert 0<=n<len(data),(n,data)
            self.feed(data[:n])
            raise socket.timeout('R208 injected partial frame')
        self.feed(data)
    def close(self):
        pass


class TestSequentialRecovery(unittest.TestCase):
    def test_all_first_and_repair_cut_positions(self):
        # Every byte position of an initial M6 frame, then every position of
        # a repair+heartbeat frame. Neither abandoned message may apply late.
        first={'tool_changed':True}
        second={'heartbeat':True,'connected':True}
        n1=len((json.dumps(first)+'\n').encode())
        n2=2+len((json.dumps(second)+'\n').encode())
        total=0
        with contextlib.redirect_stdout(io.StringIO()):
            for i in range(n1):
                for j in range(n2):
                    with self.subTest(first_cut=i,repair_cut=j):
                        rx=receiver();sock=CutSocket(rx,[i,j]);b=bridge(sock)
                        self.assertIsNone(b.watchdog_send(first))
                        self.assertIsNone(b.watchdog_send(second))
                        self.assertIs(b.watchdog_send({'compensation_enable':True}),True)
                        self.assertNotIn('tool-changed',rx['comp'])
                        self.assertNotIn('heartbeat',rx['comp'])
                        self.assertNotIn('connected',rx['comp'])
                        self.assertIs(rx['comp'].get('compensation-enable'),True)
                        self.assertEqual(rx['buf'],'')
                        total+=1
        print(json.dumps({'case':'all_first_and_repair_cut_positions','combinations':total}))


class TestStartClaimBookkeeping(base._Handlers):
    def test_refused_thread_write_leaves_claim_and_run_basis_unsent(self):
        basis={'state':'pending'}
        claims=[]
        writes=[]
        async def begin():return basis
        def auto(*args):writes.append(args)
        with patch.object(gateway,'_source_claims',claims), \
             patch.object(gateway,'_source_lock',None), \
             patch.object(gateway,'_begin_run_basis',begin), \
             patch.object(gateway,'_ts_program_writes',lambda:set()), \
             patch.object(gateway,'_ts_mark_assumed',lambda _:None):
            with self.assertRaises(gateway._StartRefused):
                base._run(gateway._cmd_blocking(auto,linuxcnc.AUTO_RUN,0,
                                               wait=None,admit=lambda:'refused by probe'))
        self.assertEqual(writes,[])
        self.assertEqual(basis['state'],'unsent')
        self.assertEqual([c.state for c in claims],['unsent'])
        print(json.dumps({'case':'refused_thread_write','basis':basis,'claims':[c.state for c in claims]}))


class InterleavedSocket(CutSocket):
    def __init__(self,rx):
        super().__init__(rx,[9])
        self.confirm_started=threading.Event()
        self.confirm_release=threading.Event()
        self.confirm_interrupted=False
    def sendall(self,data):
        if b'"tool_changed"' in data and not self.confirm_interrupted:
            self.confirm_interrupted=True
            # The repair and the confirmation's complete JSON reached the
            # receiver, but its newline has not. Another writer can run.
            self.feed(data[:-1])
            self.confirm_started.set()
            if not self.confirm_release.wait(4):
                raise TimeoutError('probe did not release confirmation write')
            self.feed(data[-1:])
            return
        super().sendall(data)


class TestConcurrentRecovery(base._Handlers):
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
        gateway._shared_status=base._payload(tool_change_requested=True,tool_change_tool=7,
                        tool_change_seq=41,interp_state=linuxcnc.INTERP_WAITING)

    def exercise(self,interleave):
        rx=receiver();sock=InterleavedSocket(rx);b=bridge(sock)
        # Real first call sets the repair state after a partial write.
        self.assertIsNone(b.watchdog_send({'connected':True}))
        replies={}
        async def wait_started():
            while not sock.confirm_started.is_set():
                await asyncio.sleep(0)
        async def run():
            task=asyncio.create_task(gateway.handle_command({'cmd':'confirm_tool_change','request':41},True))
            try:
                await asyncio.wait_for(wait_started(),2)
                if interleave:
                    # Exactly the heartbeat-loop call shape on the main thread;
                    # CMD lock does not cover this transport writer.
                    replies['heartbeat']=b.watchdog_send({'heartbeat':True,'connected':True})
            finally:
                sock.confirm_release.set()
            replies['confirm']=await asyncio.wait_for(task,2)
            if not interleave:
                replies['heartbeat']=b.watchdog_send({'heartbeat':True,'connected':True})
            replies['repeat']=await gateway.handle_command({'cmd':'confirm_tool_change','request':41},True)
        with patch.object(gateway,'_hal_send',b.watchdog_send):
            base._run(run())
        print(json.dumps({'case':self.id().split('.')[-1],'replies':replies,
                          'fragments':sock.fragments,'pins':rx['comp'],
                          'booked':gateway._tool_change_confirmed,'open':b._wd_frame_open,
                          'parser_warnings':rx['warnings']}))
        return replies,rx

    def test_heartbeat_cannot_invalidate_an_inflight_confirmation_and_book_it(self):
        replies,rx=self.exercise(True)
        self.assertFalse(replies['confirm']['ok'] and not rx['comp'].get('tool-changed'),
                         'Second writer invalidated an active frame; confirm still reported success')
        self.assertFalse(gateway._tool_change_confirmed==41 and not rx['comp'].get('tool-changed'),
                         'No M6 pin effect but permanently booked')

    def test_control_heartbeat_after_confirmation_keeps_both_messages(self):
        replies,rx=self.exercise(False)
        self.assertTrue(replies['confirm']['ok'])
        self.assertTrue(replies['heartbeat'])
        self.assertTrue(rx['comp']['tool-changed'])
        self.assertTrue(rx['comp']['heartbeat'])
        self.assertEqual(gateway._tool_change_confirmed,41)
        self.assertFalse(replies['repeat']['ok'])
