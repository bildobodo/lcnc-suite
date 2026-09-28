"""R28: capture admission with unavailable or changing current controller data.

Real dispatcher under fake_linuxcnc; temporary parameter files; no live I/O.
R27 scenarios retained; reader staleness now explicit. Additional stale/missing
status and current-poll controls cover the strict R28 read contract.

Run with PYTHONDONTWRITEBYTECODE=1 and the gateway venv Python. --source-root
may point to a git archive under /tmp; --revision names that archive's commit.
"""
import argparse
import asyncio
import json
import sys
from contextlib import ExitStack
from pathlib import Path
from unittest.mock import patch

parser = argparse.ArgumentParser()
parser.add_argument('--source-root', type=Path, default=Path(__file__).resolve().parents[2])
parser.add_argument('--revision', default='d839c01')
parser.add_argument('--output', type=Path, default=Path(__file__).with_suffix('.json'))
args = parser.parse_args()
sys.path.insert(0, str(args.source_root / 'lcnc-gateway'))
from test_g30 import _G30Case, gateway, linuxcnc
from test_command_dispatch import _payload

assert getattr(linuxcnc, '__lcnc_fake__', False)
KIN_UNKNOWN = 'Kinematics mode unknown — HAL reader stale'
NO_STATUS = 'Machine status not read — capture again'
MOVING = 'Machine moving — capture once it stands'
expected = {
    'stationary': None,
    'moving_before': MOVING,
    'moving_during_synch': MOVING,
    'frame_during_synch': 'Machine frame only',
    'reader_missing_after_synch': KIN_UNKNOWN,
    'stat_poll_fails_after_synch': NO_STATUS,
    'fixed_kins_without_reader': None,
    'reader_stale_after_synch': KIN_UNKNOWN,
    'status_missing_after_synch': NO_STATUS,
    'interp_busy_on_current_poll': 'Machine busy — wait until it is idle',
    'motion_missing_on_current_poll': 'Motion state unknown — wait for status',
    'position_refreshed_on_current_poll': None,
}
results = []
for kind, expected_error in expected.items():
    case = _G30Case()
    case.setUp()
    fixed = kind == 'fixed_kins_without_reader'
    pin = {'kins_type': None if fixed else 0}
    stale = {'value': fixed}
    poll_log = []
    try:
        gateway._shared_status = _payload(inpos=True, current_vel=0.0, kins_type=0)
        if kind == 'moving_before':
            gateway._shared_status.inpos = gateway.STAT.inpos = False
            gateway._shared_status.current_vel = gateway.STAT.current_vel = 12.0
        original_synch = case.task.task_plan_synch

        def current_poll():
            poll_log.append('poll_after_synch')
            if kind == 'stat_poll_fails_after_synch':
                raise RuntimeError('R28 simulated STAT read failure')
            if kind == 'interp_busy_on_current_poll':
                gateway.STAT.interp_state = linuxcnc.INTERP_READING
            if kind == 'motion_missing_on_current_poll':
                gateway.STAT.current_vel = None
            if kind == 'position_refreshed_on_current_poll':
                gateway.STAT.position = (42.0, 20.0, -5.0, 725.0, 0.0, -370.0, 0.0, 0.0, 0.0)

        def synch():
            original_synch()
            gateway.STAT.poll = current_poll
            if kind == 'moving_during_synch':
                gateway.STAT.current_vel = 12.0
            if kind == 'frame_during_synch':
                pin['kins_type'] = 1
            if kind == 'reader_missing_after_synch':
                pin['kins_type'] = None
            if kind == 'reader_stale_after_synch':
                stale['value'] = True
            if kind == 'status_missing_after_synch':
                gateway._shared_status = None

        case.task.task_plan_synch = synch
        with ExitStack() as stack:
            for name, value in (
                ('_kins_is_switchable', lambda: not fixed),
                ('_identity_first', lambda: True),
                ('_twp_capable', lambda: False),
                ('_reader_get', lambda name: pin.get(name)),
                ('_reader_is_stale', lambda: stale['value']),
            ):
                stack.enter_context(patch.object(gateway, name, value))
            reply = asyncio.run(gateway.handle_command({'cmd': 'capture_g30'}, True))

        accepted = expected_error is None
        checks = {'ok': reply.get('ok') is accepted}
        if accepted:
            checks['current'] = reply.get('current') == {
                'X': 42.0 if kind == 'position_refreshed_on_current_poll' else 10.0,
                'Y': 20.0, 'Z': -5.0, 'A': 725.0, 'C': 350.0,
            }
        else:
            checks['reason'] = reply.get('error') == expected_error
            checks['no_current'] = 'current' not in reply
        if kind == 'moving_before':
            checks['no_command'] = case.task.calls == []
        else:
            checks['confirmed_stored'] = reply.get('confirmed') is True and reply.get('values') == case.stored()
            checks['only_synch'] = case.task.calls == [('synch',)]
        results.append({
            'case': kind, 'shared_frame': getattr(gateway._shared_status, 'kins_type', None),
            'reader_frame': pin['kins_type'], 'reader_stale': stale['value'],
            'polls': poll_log, 'reply': reply, 'calls': case.task.calls,
            'checks': checks, 'matches_contract': all(checks.values()),
        })
    finally:
        case.doCleanups()

result = {'head': args.revision, 'isolation': 'fake_linuxcnc; temporary files; mocked HAL reader; no network',
          'cases': results}
args.output.write_text(json.dumps(result, indent=2) + '\n')
for row in results:
    print(('PASS' if row['matches_contract'] else 'FAIL'), row['case'],
          json.dumps(row['reply'], ensure_ascii=False))
sys.exit(0 if all(row['matches_contract'] for row in results) else 1)
