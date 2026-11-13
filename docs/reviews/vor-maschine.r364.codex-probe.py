"""R364: plan examples + original helper control flow; no live channels.

python3 this-file.py /tmp/codex-r362 result.json
The three gateway helpers are taken from the original AST. Dependencies
are in-memory fakes. No asyncio loop, server, HAL or gateway import occurs.
The home group function expresses the rule read in LinuxCNC v2.9.4
homing.c do_home_one_joint; it is NOT a native LinuxCNC execution.
"""
import ast
import hashlib
import json
from pathlib import Path
import sys
from types import SimpleNamespace as NS

root = Path(sys.argv[1])
path = root / 'lcnc-gateway/gateway.py'
text = path.read_text()
tree = ast.parse(text)
names = {'_jog_mode_flag', '_jog_axis_arg', '_manual_command'}
nodes = [n for n in tree.body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))
         and n.name in names]
assert len(nodes) == 3
module = ast.fix_missing_locations(ast.Module(body=[
    ast.ImportFrom(module='__future__', names=[ast.alias(name='annotations')], level=0),
    *nodes], type_ignores=[]))

def complete(coro):
    """All fake async dependencies finish inline; any real wait is an error."""
    try:
        value = coro.send(None)
    except StopIteration as end:
        return end.value
    coro.close()
    raise AssertionError(f'unexpected external wait: {value!r}')

def home_group(sequences, joint):
    if sequences[joint] >= 0:
        return [joint]
    return [i for i, value in enumerate(sequences)
            if abs(value) == abs(sequences[joint])]

def jog_case(motion_mode, beyond, teleop_succeeds):
    stat = NS(motion_mode=motion_mode, axis_mask=7, poll=lambda: None)
    conn = NS(stat=stat)
    writes = []
    async def write(owner, command, **kwargs):
        writes.append(command)
        if command == ['teleop_enable', 1] and teleop_succeeds:
            stat.motion_mode = 3
        return 0
    scope = {'linuxcnc': NS(TRAJ_MODE_TELEOP=3, command=NS(teleop_enable='teleop_enable')),
             'link': lambda: conn, 'safe_get': lambda k, default=None: getattr(stat, k, default),
             '_shared_status': NS(homed=True, joints_beyond_limit=beyond),
             '_joint_jog_facts': lambda: {'axes': [{'joint': 0}, {'joint': 1}, {'joint': 2}]},
             '_axes_from_mask': lambda mask: 'XYZ', '_AXIS_LETTERS': 'XYZABCUVW',
             '_cmd_blocking': write, 'op': lambda name, *args: [name, *args],
             '_trace': NS(emit=lambda *a, **kw: None)}
    exec(compile(module, str(path), 'exec'), scope)
    flag = complete(scope['_jog_mode_flag']())
    target = scope['_jog_axis_arg'](0, flag)
    # Illustrative distinct windows: selecting by homed alone is wrong in
    # a joint-mode recovery, even though both windows are valid and known.
    axis_span, joint_span, distance = 1000, 100, 200
    return {'homed': True, 'motion_mode_before': motion_mode, 'beyond': beyond,
            'teleop_succeeds': teleop_succeeds, 'joint_flag': flag, 'target': target,
            'writes': writes, 'distance': distance,
            'plan_homed_axis_span': axis_span,
            'actual_target_span': joint_span if flag else axis_span,
            'plan_admits_distance': abs(distance) <= axis_span,
            'actual_target_admits_distance': abs(distance) <= (joint_span if flag else axis_span)}

def home_admission_case(recheck):
    sequences = [1, 2, 3]
    events = []
    class Refused(Exception):
        pass
    def admission():
        events.append(['admit', list(sequences)])
        return 'Home group changed' if recheck and len(home_group(sequences, 0)) != 1 else None
    async def mode(value, *, admit, conn):
        why = admit()
        if why:
            raise Refused(why)
        events.append(['mode', value])
        # New reader data arrives during the awaited switch / wait.
        sequences[:] = [-1, -1, -1]
        events.append(['sequence_changed', list(sequences)])
    async def write(conn, command, *, wait, admit):
        why = admit()
        if why:
            raise Refused(why)
        events.append(['home_written', command.args[0], home_group(sequences, command.args[0])])
    scope = {'linuxcnc': NS(MODE_MANUAL=1), 'link': lambda: object(),
             '_gate_admit': lambda gate, armed: admission,
             'set_mode': mode, '_cmd_blocking': write, '_WriteRefused': Refused}
    exec(compile(module, str(path), 'exec'), scope)
    # The plan's early check succeeds in both cases.
    assert home_group(sequences, 0) == [0]
    reply = complete(scope['_manual_command']('zero', True, (NS(args=(0,)), None)))
    return {'recheck_group_at_each_write': recheck, 'events': events, 'reply': reply}

vectors = [[-1, -1, -1], [1, -2, -2], [-1, 0, 1], [-1, 0, 2]]
result = {'product_base': '45727d61', 'plan': 'a699d525',
          'source_sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
          'live_access': False,
          'groups_from_native_rule': [{'sequence': v,
              'targets_per_request': [home_group(v, j) for j in range(len(v))]}
              for v in vectors],
          'jog_actual_targets': [jog_case(3, [], True), jog_case(1, [0], True),
                                 jog_case(1, [], False)],
          'home_await_boundary': [home_admission_case(False), home_admission_case(True)]}
assert result['groups_from_native_rule'][2]['targets_per_request'] == [[0, 2], [1], [2]]
assert result['groups_from_native_rule'][3]['targets_per_request'] == [[0], [1], [2]]
assert [c['joint_flag'] for c in result['jog_actual_targets']] == [0, 1, 1]
assert [c['actual_target_admits_distance'] for c in result['jog_actual_targets']] == [True, False, False]
assert result['home_await_boundary'][0]['reply']['ok'] is True
assert result['home_await_boundary'][1]['reply']['ok'] is False
Path(sys.argv[2]).write_text(json.dumps(result, indent=2) + '\n')
print('R364: 4 sequence vectors, 3 jog routes, 2 admission traces reproduced')
