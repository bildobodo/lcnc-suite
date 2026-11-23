"""R442: original error-reader and cycle-wait helpers with fake boundaries.

No gateway/status_runtime import, LinuxCNC connection, or native execution.
The poll publication below is a model; the two helper functions are extracted
unchanged from product 594e333c. It is not an implementation of the R442 plan.
"""
from __future__ import annotations
import ast
import asyncio
from collections import deque
import hashlib
import json
from pathlib import Path
import sys
import time
from types import SimpleNamespace as NS

base = Path(sys.argv[1])
gateway_path = base / 'lcnc-gateway/gateway.py'
runtime_path = base / 'lcnc-gateway/status_runtime.py'


def original_function(path, name, env):
    tree = ast.parse(path.read_text())
    nodes = [n for n in ast.walk(tree) if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))
             and n.name == name]
    assert len(nodes) == 1
    mod = ast.Module(body=[ast.ImportFrom(module='__future__', names=[ast.alias(name='annotations')], level=0),
                           nodes[0]], type_ignores=[])
    ast.fix_missing_locations(mod)
    exec(compile(mod, str(path), 'exec'), env)
    return env[name]


class FakeErrorChannel:
    def __init__(self, messages=(), fail=False):
        self.messages = deque(messages)
        self.fail = fail
        self.calls = 0
        self.empty_observed = False

    def poll(self):
        self.calls += 1
        if self.fail:
            raise RuntimeError('injected NML read failure')
        if self.messages:
            return self.messages.popleft()
        self.empty_observed = True
        return None


async def main():
    trace = []
    read = original_function(runtime_path, 'read_errors_nonblocking',
                             {'_trace': NS(emit=lambda *a, **k: trace.append([a, k]))})
    stale = (13, 'LCNC_CAL_CANDIDATE run=1 value=0.20 axis=0')
    cases = []
    for name, count, fail, absent in [
        ('empty_control', 0, False, False),
        ('three_messages_control', 3, False, False),
        ('fifty_messages_no_empty_witness', 50, False, False),
        ('stale_message_behind_fifty', 51, False, False),
        ('error_channel_read_failed', 0, True, False),
        ('error_channel_absent', 0, False, True),
    ]:
        messages = [(12, f'older message {i}') for i in range(count)]
        if count == 51:
            messages[-1] = stale
        channel = FakeErrorChannel(messages, fail)
        obj = NS(_get_err=lambda: None if absent else channel, _err_poll_warned=False)
        before_trace = len(trace)
        got = read(obj)
        env = {'asyncio': asyncio, 'time': time, '_status_gen': 100}
        cycles = original_function(gateway_path, '_status_cycles', env)
        waiter = asyncio.create_task(cycles(1, timeout=.1))
        await asyncio.sleep(0)  # waiter captured generation 100
        # Model the real poller's unconditional generation publication after
        # read_errors_nonblocking returned a list (including cap/error/absent).
        env['_status_gen'] += 1
        cycle_complete = await waiter
        row = {'case': name, 'messages_returned': len(got), 'poll_calls': channel.calls,
               'empty_observed': channel.empty_observed, 'messages_remaining': len(channel.messages),
               'warns': len(trace) - before_trace, 'status_cycles_returned': cycle_complete}
        assert cycle_complete
        if name == 'stale_message_behind_fifty':
            assert len(got) == 50 and list(channel.messages) == [stale]
            row['next_read_after_modelled_new_start'] = read(obj)
            assert row['next_read_after_modelled_new_start'] == [stale]
        elif name in ('error_channel_absent', 'error_channel_read_failed'):
            assert got == [] and not channel.empty_observed
        elif count == 50:
            assert not channel.empty_observed
        else:
            assert channel.empty_observed
        cases.append(row)

    env = {'asyncio': asyncio, 'time': time, '_status_gen': 200}
    cycles = original_function(gateway_path, '_status_cycles', env)
    waiter = asyncio.create_task(cycles(1, timeout=.1))
    await asyncio.sleep(0)
    modelled_poll_began, modelled_idle_seen = 10., 11.
    env['_status_gen'] = 201  # earlier in-flight cycle now publishes
    began_test = {'poll_began': modelled_poll_began, 'idle_seen': modelled_idle_seen,
                  'status_cycles_returned': await waiter,
                  'scope': 'counter-publication model; actual waiter has no poll-begin input'}
    assert began_test['status_cycles_returned']
    assert modelled_poll_began < modelled_idle_seen

    routine_path = base / 'subroutines/probe_basic/tool_setter_param_update.ngc'
    routine = routine_path.read_text()
    assert '#<breakage_tolerance_3037> = #11' in routine
    assert '#3037 = #<breakage_tolerance_3037>' in routine
    collision = {
        'scope': 'static source evidence and arithmetic model, not native execution',
        'existing_owner': 'tool_setter_param_update, breakage_tolerance, argument #11',
        'assignment_lines': [{'line': i, 'text': s.strip()} for i, s in enumerate(routine.splitlines(), 1)
                             if '3037' in s],
        'example_existing_value': .2,
        'literal_plan_next_after_gateway_restart': max(.2, 0) + 1,
        'literal_plan_next_is_integer': (max(.2, 0) + 1).is_integer(),
    }
    assert not collision['literal_plan_next_is_integer']
    print(json.dumps({
        'round': 'R442', 'product_base': '594e333c',
        'hashes': {str(p.relative_to(base)): hashlib.sha256(p.read_bytes()).hexdigest()
                   for p in (gateway_path, runtime_path, routine_path)},
        'error_reader_and_cycle_cases': cases,
        'inflight_cycle_model': began_test,
        'parameter_3037_conflict': collision,
        'limits': ['No product plan implementation executed', 'No live/native/browser connection',
                   'Publication timing and counter arithmetic are models, not a native run'],
    }, indent=2))


asyncio.run(main())
