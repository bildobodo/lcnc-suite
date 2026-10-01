"""Offline R63 diagnostic cases through real dispatch with fake LinuxCNC.

Run: python3 mode-probe.py /path/to/archive. No real binding or server.
Imports the repository's explicit fake BEFORE importing gateway via tests.
"""
import json
import sys
from pathlib import Path

root = Path(sys.argv[1]).resolve()
sys.path.insert(0, str(root / 'lcnc-gateway'))
import fake_linuxcnc
lc = fake_linuxcnc.install()
assert lc.__lcnc_fake__
from test_command_dispatch import TestGoToZeroAndJogStopDispatch, _run
import gateway

cases = [
    ('unknown', {}, False, 'LinuxCNC kept MANUAL (asked for MDI)'),
    ('unhomed', {'task_state': lc.STATE_ON, 'joints': 5, 'homed': [1, 1, 0, 1, 1, 0, 0, 0, 0]},
     False, 'LinuxCNC kept MANUAL (asked for MDI): not all joints are homed'),
    ('unused_joint_flags', {'task_state': lc.STATE_ON, 'joints': 3, 'homed': [1, 1, 1, 0, 0, 0, 0, 0, 0]},
     False, 'LinuxCNC kept MANUAL (asked for MDI)'),
    ('off', {'task_state': lc.STATE_OFF, 'joints': 3, 'homed': [1, 1, 1]},
     False, 'LinuxCNC kept MANUAL (asked for MDI): the machine is off'),
    ('known_jog', {'task_state': lc.STATE_ON, 'joints': 3, 'homed': [1, 1, 1]},
     True, 'LinuxCNC kept MANUAL (asked for MDI): a jog is active — release it'),
    ('all_seen', {'task_state': lc.STATE_OFF, 'joints': 3, 'homed': [0, 0, 0]},
     True, 'LinuxCNC kept MANUAL (asked for MDI): a jog is active — release it; the machine is off; not all joints are homed'),
    ('flags_without_joint_count', {'homed': [0, 0, 0]},
     False, 'LinuxCNC kept MANUAL (asked for MDI)'),
]
result = []
for name, state, jogging, expected in cases:
    t = TestGoToZeroAndJogStopDispatch()
    t.setUp()
    gateway._active_jogs.clear()
    try:
        gateway.STAT.task_mode = lc.MODE_MANUAL
        # Start a jog through the fake dispatch, rather than inventing a flag.
        if jogging:
            assert t._send({'cmd': 'jog_cont', 'axis': 0, 'vel': 1.0})['ok']
        for key, value in state.items():
            setattr(gateway.STAT, key, value)
        response = t._send({'cmd': 'mdi', 'text': 'G0 X1'})
        assert not response['ok'], response
        # Dispatch prefixes exception types; compare the complete wire text.
        assert response['error'] == 'ValueError: ' + expected, response
        assert t.cmd.args_of('mdi') is None, t.cmd.calls
        result.append(dict(case=name, response=response, mdi_dispatched=False))
    finally:
        gateway._active_jogs.clear()
        t.tearDown()

# A request for MANUAL names an observed OFF state but does not imply that
# the unhomed joints caused a refusal (only MDI/AUTO require that wording).
t = TestGoToZeroAndJogStopDispatch()
t.setUp()
try:
    gateway.STAT.task_mode = lc.MODE_MDI
    gateway.STAT.task_state = lc.STATE_OFF
    gateway.STAT.joints = 3
    gateway.STAT.homed = [0, 0, 0]
    try:
        _run(gateway.set_mode(lc.MODE_MANUAL))
        raise AssertionError('ignored MANUAL switch was accepted')
    except ValueError as error:
        assert str(error) == 'LinuxCNC kept MDI (asked for MANUAL): the machine is off'
        result.append(dict(case='manual_no_homing_claim', error=str(error)))
finally:
    t.tearDown()

out = dict(commit='21a1b68', fake_linuxcnc=True, cases=result, passed=len(result))
(root/'evidence/viewer-palette-fest.r63.mode-probe.json').write_text(json.dumps(out, indent=2) + '\n')
print(json.dumps(out, indent=2))
