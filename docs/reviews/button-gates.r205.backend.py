"""R205: current HAL vs the last broadcast, entirely on fake_linuxcnc.
Copy into the reviewed archive's lcnc-gateway directory and run pytest.
set_mode is replaced only to record the mode transition without real IO.
The policy, dispatcher, start guard and command handler are unchanged.
"""
from unittest.mock import patch
import test_button_gates as base

gateway, linuxcnc = base.gateway, base.linuxcnc
assert linuxcnc.__lcnc_fake__

class TestCurrentStartBasis(base._Handlers):
    def run_case(self, cmd, stale, current_kins, **snapshot):
        gateway._kins_is_switchable = lambda: True
        gateway._twp_capable = lambda: True
        reads = []
        freshness_calls = []
        def is_stale():
            freshness_calls.append(stale)
            return stale
        gateway._reader_is_stale = is_stale
        def reader(key):
            reads.append(key)
            return {'kins_type': current_kins, 'twp_active': False, 'twp_defined': False}.get(key)
        gateway._reader_get = reader
        async def mode(value):
            self.cmd.calls.append(('mode', (value,), {}))
            gateway.STAT.task_mode = value
        old = dict(kins_type=0.0, twp_active=False, g5x_index=1, reader_fresh=True)
        old.update(snapshot)
        with patch.object(gateway, 'set_mode', mode):
            result = self._send({'cmd': cmd}, **old)
        print({'case': self.id().split('.')[-1], 'reply': result,
               'commands': self.cmd.names(), 'reader_calls': reads,
               'freshness_calls': freshness_calls,
               'reader_stale_now': stale, 'reader_kins_now': current_kins})
        return result

    def check_rejected(self, cmd, stale, current_kins, **snapshot):
        result = self.run_case(cmd, stale, current_kins, **snapshot)
        self.assertFalse(result['ok'], 'A formerly runnable broadcast cannot authorize a start against the current HAL state')
        self.assertNotIn('auto', self.cmd.names())

    def test_cycle_start_rechecks_reader_freshness_now(self):
        self.check_rejected('cycle_start', True, 0)

    def test_step_rechecks_reader_freshness_now(self):
        self.check_rejected('auto_step', True, 0)

    def test_cycle_start_rechecks_current_kinematics(self):
        self.check_rejected('cycle_start', False, 2)

    def test_step_rechecks_current_kinematics(self):
        self.check_rejected('auto_step', False, 2)

    def test_control_runnable_cycle_start(self):
        self.assertTrue(self.run_case('cycle_start', False, 0)['ok'])
        self.assertIn('auto', self.cmd.names())

    def test_control_runnable_step(self):
        self.assertTrue(self.run_case('auto_step', False, 0)['ok'])
        self.assertIn('auto', self.cmd.names())

    def test_control_cached_strand_refuses(self):
        self.check_rejected('cycle_start', False, 2, kins_type=2)

    def test_control_cached_stale_refuses(self):
        self.check_rejected('auto_step', True, 0, reader_fresh=False)
