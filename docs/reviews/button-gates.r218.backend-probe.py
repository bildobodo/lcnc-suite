"""R218 boundary checks. Fake LinuxCNC only; one temporary parameter file.
The queue harness is the unchanged R217 probe, imported as a module.
"""
import tempfile
from pathlib import Path
from unittest import mock
import test_r217_codex as prior
from test_button_gates_d import _Writer
from test_button_gates import _payload, _run
import gateway

lc = gateway.linuxcnc
assert lc.__lcnc_fake__


class Boundaries(_Writer):
    queued = prior.WriteBoundary.queued

    def setUp(self):
        super().setUp()
        self.takes_the_mode()
        self.cmd.wait_complete = lambda *a: lc.RCS_DONE
        gateway._cmd_lock = None
        gateway._shared_status = _payload(inpos=True, current_vel=0.0)

    def test_late_poll_failure_is_not_a_favourable_snapshot(self):
        def changed():
            gateway.STAT.poll = mock.Mock(side_effect=OSError('late poll failure'))
        r = _run(self.queued({'cmd': 'home_all'}, changed))
        print('late failed poll:', r, self.cmd.names())
        self.assertFalse(r['ok'])
        self.assertIn('not read', r['error'])
        self.assertEqual(self.cmd.names(), [])

    def test_q1_needs_manual_at_the_write_too(self):
        self.controller(homed=False)
        gateway._shared_status = _payload(homed=False, inpos=True, current_vel=0.0)
        with mock.patch.object(gateway, '_spindle_before_homing', lambda: True):
            r = _run(self.queued({'cmd': 'spindle_forward', 'speed': 1000},
                                lambda: setattr(gateway.STAT, 'task_mode', lc.MODE_MDI)))
        print('late Q1 mode change:', r, self.cmd.names())
        self.assertFalse(r['ok'])
        self.assertEqual(self.cmd.names(), [])

    def test_teleop_itself_has_its_own_admission(self):
        r = _run(self.queued({'cmd': 'unhome_all'},
                            lambda: setattr(gateway.STAT, 'interp_state', lc.INTERP_READING)))
        print('before teleop:', r, self.cmd.names())
        self.assertFalse(r['ok'])
        self.assertEqual(self.cmd.names(), [])

    def test_var_file_boundary_keeps_unknown_and_retry_really_clears(self):
        with tempfile.TemporaryDirectory(prefix='r218-var-') as directory:
            path = Path(directory) / 'machine.var'
            path.write_text('3116 7.000000\n')
            ini_path = Path(directory) / 'machine.ini'
            ini_path.write_text('[RS274NGC]\nPARAMETER_FILE=machine.var\n')
            gateway.STAT.ini_filename = str(ini_path)
            class Ini:
                def find(self, section, key):
                    return 'machine.var' if (section, key) == ('RS274NGC', 'PARAMETER_FILE') else None
                def findall(self, *args):
                    return []
            original = gateway._write_var_file_updates
            writes = []
            def persist_then_run(filename, values):
                original(filename, values)  # real atomic persistence to our temp file
                writes.append(dict(values))
                if len(writes) == 1:
                    gateway.STAT.task_mode = lc.MODE_MDI
                    gateway.STAT.interp_state = lc.INTERP_READING
            with mock.patch.object(gateway.linuxcnc, 'ini', lambda _: Ini()), \
                 mock.patch.object(gateway, '_skip_flag_unknown', True), \
                 mock.patch.object(gateway, '_var_file_lock', None), \
                 mock.patch.object(gateway, '_write_var_file_updates', persist_then_run):
                r = _run(gateway.handle_command({'cmd': 'cycle_start'}, True, self.writer.conn_key))
                value = float(path.read_text().split()[1])
                print('persisted, then foreign run:', r, self.cmd.names(),
                      'file=', value, 'unknown=', gateway._skip_flag_unknown)
                self.assertFalse(r['ok'])
                self.assertEqual(self.cmd.names(), ['mode'])
                self.assertEqual(value, 0.0)
                self.assertTrue(gateway._skip_flag_unknown)
                self.cmd.calls.clear()
                self.controller()
                gateway.STAT.ini_filename = str(ini_path)
                gateway._cmd_lock = None
                r = _run(gateway.handle_command({'cmd': 'cycle_start'}, True, self.writer.conn_key))
                print('idle retry:', r, self.cmd.names(), 'unknown=', gateway._skip_flag_unknown)
                self.assertTrue(r['ok'], r)
                self.assertEqual(self.cmd.names(), ['mode', 'mdi', 'mode', 'auto'])
                self.assertIn('#3116=0', self.cmd.args_of('mdi')[0])
                self.assertFalse(gateway._skip_flag_unknown)
