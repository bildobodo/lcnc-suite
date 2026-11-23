"""R441 plan review: source-function probes and explicitly labelled models.

No gateway import, LinuxCNC connection, native interpreter or product build.
The write exception is a boundary fault injection, NOT a native observation.
Run: python3 -I -B probe.py /path/to/archive/of/594e333c
"""
from __future__ import annotations

import ast
import asyncio
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sys
import threading
import time
from types import SimpleNamespace as NS

root = Path(sys.argv[1])
path = root / 'lcnc-gateway/gateway.py'
source = path.read_text()
tree = ast.parse(source)


def extract(names, env):
    nodes = [n for n in tree.body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef))
             and n.name in names]
    assert {n.name for n in nodes} == set(names)
    mod = ast.Module(body=[ast.ImportFrom(module='__future__', names=[ast.alias(name='annotations')], level=0),
                           *nodes], type_ignores=[])
    ast.fix_missing_locations(mod)
    exec(compile(mod, str(path), 'exec'), env)
    return env


def completion_cases():
    lcnc = NS(RCS_DONE=1, RCS_EXEC=2, RCS_ERROR=3, INTERP_IDLE=1, INTERP_READING=2,
              EXEC_DONE=2, EXEC_WAITING_FOR_MOTION=5)
    cases = [
        ('later_echo_executing', dict(echo_serial_number=8, state=2, interp_state=2,
                                     queued_mdi_commands=0, exec_state=5), True),
        ('later_error_idle_but_queued', dict(echo_serial_number=8, state=3, interp_state=1,
                                           queued_mdi_commands=1, exec_state=2), True),
        ('own_error_idle_but_queued', dict(echo_serial_number=7, state=3, interp_state=1,
                                         queued_mdi_commands=1, exec_state=2), True),
        ('own_error_not_execution_done', dict(echo_serial_number=7, state=3, interp_state=1,
                                             queued_mdi_commands=0, exec_state=5), True),
        ('own_error_quiet_first_poll', dict(echo_serial_number=7, state=3, interp_state=1,
                                           queued_mdi_commands=0, exec_state=2), True),
        ('positive_completion_same_echo', dict(echo_serial_number=7, state=1, interp_state=1,
                                              queued_mdi_commands=0, exec_state=2), False),
        ('positive_completion_later_echo', dict(echo_serial_number=8, state=1, interp_state=1,
                                               queued_mdi_commands=0, exec_state=2), False),
    ]
    results = []
    for name, status, keep in cases:
        owner = NS(seq=1, stat=NS(**status))
        e = extract({'_StartClaim', '_release_start_claims'}, {
            'time': time, 'linuxcnc': lcnc, '_source_claims': [],
            'current_link': lambda: owner, '_link': owner, '_link_lock': threading.Lock(),
            '_CLAIM_ERROR_PROOF_S': .02, '_trace': NS(emit=lambda *a, **k: None),
        })
        claim = e['_StartClaim']('mdi')
        claim.state, claim.serial, claim.sent_t, claim.link_seq = 'sent', 7, 10., 1
        e['_source_claims'].append(claim)
        e['_release_start_claims'](11., owner)
        kept = bool(e['_source_claims'])
        # Literal translation of v3 P2b line 135, NOT future product code.
        plan_ends = (status['echo_serial_number'] > 7 or
                     (status['echo_serial_number'] == 7 and status['state'] in {1, 3}
                      and status['interp_state'] == 1))
        assert kept == keep, name
        assert plan_ends, name
        result = {'case': name, 'status': status, 'v3_plan_ends': plan_ends,
                  'existing_source_claim_kept': kept}
        if name == 'own_error_quiet_first_poll':
            e['_release_start_claims'](11.03, owner)
            assert not e['_source_claims']
            result['source_claim_released_after_second_quiet_poll_30ms_later'] = True
        results.append(result)
    return results


async def write_cases():
    results = []
    for case in ('admission_refused', 'raises_after_simulated_effect', 'returned_wait_timeout', 'taken'):
        observations = {'entered_command': False, 'simulated_effect': False, 'written_hook': False}

        class WriteRefused(PermissionError):
            pass

        class Cmd:
            def mdi(self, line):
                observations['entered_command'] = True
                observations['simulated_effect'] = True
                if case == 'raises_after_simulated_effect':
                    raise RuntimeError('boundary fault after simulated effect')

            def wait_complete(self, wait):
                return -1 if case == 'returned_wait_timeout' else 1

        conn = NS(cmd=Cmd())
        # Suppress unrelated source-booking machinery; exercise the original
        # last admission, command call, written callback and cancellation wrapper.
        e = extract({'_cmd_blocking', '_thread_to_end'}, {
            'asyncio': asyncio, 'threading': threading, 'time': time,
            '_CMD_WAIT_TIMEOUT': .002, '_CMD_WAIT_SLICE': .001, '_RC_WAIT_CANCELLED': -2,
            'mdi_line_refusal': lambda s: None, '_start_kind': lambda *a: None,
            '_link_is_current': lambda c: c is conn, '_WriteRefused': WriteRefused,
            'LINK_CHANGED': 'link changed',
        })
        caught = None
        rc = None
        try:
            rc = await e['_cmd_blocking'](conn, NS(name='mdi', args=('#3032=0.2',)), wait=.002,
                admit=lambda: 'not admitted' if case == 'admission_refused' else None,
                written=lambda: observations.update(written_hook=True))
        except (WriteRefused, RuntimeError) as exc:
            caught = type(exc).__name__
        assert observations['written_hook'] == (case in ('returned_wait_timeout', 'taken'))
        assert observations['simulated_effect'] == (case != 'admission_refused')
        results.append({'case': case, **observations, 'rc': rc, 'exception': caught,
                        'scope': 'boundary fault injection; not a measured LinuxCNC failure'})
    return results


def log_namespace_model():
    # _requested() is real, the reservations are a model of plan lines 57-62.
    p = root / 'lcnc-gateway/lcnc_paths.py'
    env = {'__name__': 'r441_paths', '__file__': str(p)}
    exec(compile(p.read_text(), str(p), 'exec'), env)
    old = os.environ.get('LCNC_LOG_DIR')
    state_files = {}
    tokens = []
    try:
        for name in ('logs-A', 'logs-B', 'logs-A'):
            os.environ['LCNC_LOG_DIR'] = '/tmp/r441/model/' + name
            folder = env['_requested']()  # no directory creation / resolve()
            file = folder + '/cal_run_counter.json'
            token = state_files.get(file, 1)
            state_files[file] = token + 1
            tokens.append({'namespace': folder, 'token': token})
    finally:
        if old is None:
            os.environ.pop('LCNC_LOG_DIR', None)
        else:
            os.environ['LCNC_LOG_DIR'] = old
    assert [r['token'] for r in tokens] == [1, 1, 2]
    return {'scope': 'actual log-path resolver + model reservations; no files deleted or created',
            'reservations': tokens, 'both_state_files_retained': state_files,
            'same_controller_instance_assumed': True, 'reused_token': 1}


def assignment_cases():
    p = root / 'lcnc-gateway/gateway_util.py'
    spec = importlib.util.spec_from_file_location('r441_gateway_util', p)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    env = m.RemapEnv([], [])
    cases = []
    for line in ('#3014=99', '#[3000+15]=30', '##1=30', '#<p>=3015', 'G0 X1'):
        keys = m.toolsetter_assigned_keys(line, env)
        cases.append({'line': line, 'existing_toolsetter_reader': None if keys is None else sorted(keys),
                      'scope': 'existing conservative reader, not the planned probe booking'})
    assert cases[1]['existing_toolsetter_reader'] is None
    assert cases[2]['existing_toolsetter_reader'] is None
    return cases


async def main():
    result = {
        'round': 'R441', 'base': '594e333c',
        'gateway_sha256': hashlib.sha256(source.encode()).hexdigest(),
        'limits': ['No product plan implementation exists or was executed.',
                   'No gateway import, LinuxCNC connection, browser or native interpreter.',
                   'Plan predicates/reservations are models, not product tests.',
                   'The write exception is injected; no claim that native mdi raised after delivery.'],
        'completion_source_and_plan_predicate': completion_cases(),
        'original_writer_with_boundary_fault': await write_cases(),
        'counter_namespace_model': log_namespace_model(),
        'existing_conservative_assignment_reader': assignment_cases(),
    }
    print(json.dumps(result, indent=2))


asyncio.run(main())
