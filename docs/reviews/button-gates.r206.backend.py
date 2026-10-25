"""R206 independent fake-only probes; run in the reviewed lcnc-gateway archive.
No real controller binding, no HAL socket. The real watchdog_send is exercised
with an in-memory socket stand-in that either times out or records delivery.
"""
import socket
from unittest.mock import patch
import test_button_gates as base
from hal_bridge import HalBridge

gateway, linuxcnc = base.gateway, base.linuxcnc
assert linuxcnc.__lcnc_fake__

class TestStartAfterPreparation(base._Handlers):
    def setUp(self):
        super().setUp()
        self.now = {'kins_type': 0.0, 'twp_active': False}
        gateway._kins_is_switchable = lambda: True
        gateway._twp_capable = lambda: True
        gateway._reader_is_stale = lambda: False
        gateway._reader_get = self.now.get
        gateway.STAT.g5x_index = 1

    def run_after_mode(self, command, mutate):
        # Keep the real set_mode and _cmd_blocking. Simulate controller state
        # changing when the MODE_AUTO command is processed, before AUTO_RUN/STEP.
        original_mode = self.cmd.mode
        def mode(value):
            original_mode(value)
            gateway.STAT.task_mode = value
            if mutate:
                self.now.update(kins_type=2.0, twp_active=False)
        self.cmd.mode = mode
        reply = self._send({'cmd': command}, kins_type=0.0, twp_active=False,
                           g5x_index=1, reader_fresh=True)
        print({'case':self.id().split('.')[-1], 'reply':reply,
               'now':self.now,'commands':self.cmd.names()})
        return reply

    def test_cycle_rechecks_after_mode(self):
        r = self.run_after_mode('cycle_start', True)
        self.assertFalse(r['ok'], 'The frame changed during awaited mode preparation')
        self.assertNotIn('auto', self.cmd.names())

    def test_step_rechecks_after_mode(self):
        r = self.run_after_mode('auto_step', True)
        self.assertFalse(r['ok'], 'The frame changed during awaited mode preparation')
        self.assertNotIn('auto', self.cmd.names())

    def test_control_unchanged_after_mode(self):
        self.assertTrue(self.run_after_mode('cycle_start', False)['ok'])
        self.assertIn('auto', self.cmd.names())

    def test_rfl_rechecks_after_its_final_mode_change(self):
        gateway._shared_status=base._payload(kins_type=0.0,twp_active=False,g5x_index=1,reader_fresh=True)
        original_mode=self.cmd.mode
        def mode(value):
            original_mode(value)
            gateway.STAT.task_mode=value
            self.now.update(kins_type=2.0,twp_active=False)
        self.cmd.mode=mode
        phases=[]
        async def unchanged(_program):
            return None
        with patch.object(gateway,'_rfl_program_changed',unchanged), \
             patch.object(gateway,'_rfl_phase',lambda *args:phases.append(args)):
            base._run(gateway._rfl_sequence(10,0,False,None,0,program=object()))
        print({'case':self.id().split('.')[-1],'commands':self.cmd.names(),'phases':phases,'now':self.now})
        self.assertNotIn('auto',self.cmd.names(),'Final RFL mode preparation changed the frame')
        self.assertEqual(phases[-1][0],'failed')

    def test_cycle_rechecks_after_run_basis_await(self):
        # _cmd_blocking itself awaits capture/file IO before calling CMD.auto.
        # A check moved only below set_mode would still precede this boundary.
        gateway.STAT.task_mode=linuxcnc.MODE_AUTO
        original_auto=self.cmd.auto
        def auto(*args):
            return original_auto(*args)
        self.cmd.auto=auto  # the real method name selects the real start path
        saved_claims=list(gateway._source_claims)
        self.addCleanup(lambda: gateway._source_claims.__setitem__(slice(None), saved_claims))
        async def capture():
            self.now.update(kins_type=2.0,twp_active=False)
            return None
        with patch.object(gateway,'_begin_run_basis',capture), \
             patch.object(gateway,'_ts_program_writes',lambda:set()), \
             patch.object(gateway,'_ts_mark_assumed',lambda _:None):
            r=self._send({'cmd':'cycle_start'},kins_type=0.0,twp_active=False,g5x_index=1,reader_fresh=True)
        print({'case':self.id().split('.')[-1],'reply':r,'commands':self.cmd.names(),'now':self.now})
        self.assertFalse(r['ok'],'The final write must follow all awaited preparation')
        self.assertNotIn('auto',self.cmd.names())

    def test_unknown_current_fixture_cannot_reuse_old_g59(self):
        self.now.update(kins_type=2.0, twp_active=True)
        gateway.STAT.task_mode = linuxcnc.MODE_AUTO
        gateway.STAT.g5x_index = None
        r = self._send({'cmd':'cycle_start'}, kins_type=2.0, twp_active=True,
                       g5x_index=6, reader_fresh=True)
        print({'case':self.id().split('.')[-1], 'current_fixture':None,
               'broadcast_fixture':6,'reply':r,'commands':self.cmd.names()})
        self.assertFalse(r['ok'], 'An unread fixture at Plane must not reuse the old G59')
        self.assertNotIn('auto', self.cmd.names())

    def test_control_current_wrong_fixture_refuses(self):
        self.now.update(kins_type=2.0, twp_active=True)
        gateway.STAT.g5x_index = 1
        r = self._send({'cmd':'cycle_start'}, kins_type=2.0, twp_active=True,
                       g5x_index=6, reader_fresh=True)
        self.assertFalse(r['ok'])
        self.assertNotIn('auto',self.cmd.names())

    def test_control_failed_poll_refuses(self):
        with patch.object(gateway.STAT,'poll',side_effect=RuntimeError('test poll failure')):
            r = self._send({'cmd':'cycle_start'},kins_type=0.0,twp_active=False,
                           g5x_index=1,reader_fresh=True)
        self.assertFalse(r['ok'])
        self.assertNotIn('auto', self.cmd.names())

class SocketDouble:
    def __init__(self, timeout):
        self.timeout=timeout
        self.attempts=[]
        self.delivered=[]
    def sendall(self, data):
        self.attempts.append(data.decode().strip())
        if self.timeout:
            raise socket.timeout('review: this packet was not delivered')
        self.delivered.append(data.decode().strip())

class TestToolChangeDelivery(base._Handlers):
    def setUp(self):
        super().setUp()
        rt=gateway._status_runtime
        saved=(rt.tool_change_seq, rt.tool_change_tool, gateway._tool_change_confirmed)
        rt.tool_change_seq,rt.tool_change_tool=41,7
        gateway._tool_change_confirmed=None
        def restore():
            rt.tool_change_seq,rt.tool_change_tool,gateway._tool_change_confirmed=saved
        self.addCleanup(restore)
        gateway._reader_is_stale=lambda:False
        gateway._reader_get={'tool_change':True,'tool_prep_number':7}.get
        self.bridge=HalBridge(set_phase=lambda _:None,on_reader_connect=lambda:None,hello=lambda:{},
                              watchdog_path='/tmp/r206-unused-watchdog',reader_path='/tmp/r206-unused-reader')
        # Socket already connected and accepted; no IO in reply-draining.
        self.bridge._wd_poll_reply=lambda:None

    def confirm(self):
        return self._send({'cmd':'confirm_tool_change','request':41},
                          tool_change_requested=True, tool_change_tool=7,
                          tool_change_seq=41, interp_state=linuxcnc.INTERP_WAITING)

    def test_dropped_send_is_not_a_permanently_confirmed_request(self):
        sock=SocketDouble(True)
        self.bridge._wd_sock=sock
        with patch.object(gateway,'_hal_send',self.bridge.watchdog_send):
            first=self.confirm()
            sock.timeout=False
            second=self.confirm()
        print({'case':self.id().split('.')[-1], 'first':first, 'retry':second,
               'socket_attempts':sock.attempts,'delivered':sock.delivered,
               'booked_confirmed':gateway._tool_change_confirmed})
        self.assertFalse(first['ok'], 'A dropped packet cannot be reported as confirmed')
        self.assertTrue(second['ok'], 'The still-pending unchanged request must be recoverable')

    def test_control_delivered_only_once(self):
        sock=SocketDouble(False)
        self.bridge._wd_sock=sock
        with patch.object(gateway,'_hal_send',self.bridge.watchdog_send):
            first=self.confirm()
            second=self.confirm()
        self.assertTrue(first['ok'])
        self.assertFalse(second['ok'])
        self.assertEqual(len(sock.delivered),1)
