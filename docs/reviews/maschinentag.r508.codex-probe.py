#!/usr/bin/env python3
"""Offline countermodels for R508; no gateway import, NML or live actions.

The file-read probe executes the two named functions extracted from dbd14cab
with controlled dependencies. The remaining cases model the written plan,
not its as-yet unbuilt implementation. Run from /tmp.
"""
import ast
import asyncio
import hashlib
import json
import math
import os
from pathlib import Path
import subprocess
import tempfile

ROOT = Path('/home/cnc/lcnc-suite')


def source(path):
    return subprocess.check_output(['git', 'show', f'dbd14cab:{path}'], cwd=ROOT, text=True)


def extract(text, name, namespace):
    node = next(n for n in ast.parse(text).body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name == name)
    mod = ast.Module(body=[ast.ImportFrom(module='__future__', names=[ast.alias(name='annotations')], level=0), node], type_ignores=[])
    exec(compile(ast.fix_missing_locations(mod), f'<dbd14cab:{name}>', 'exec'), namespace)


async def unrelated_rename():
    util = source('lcnc-gateway/gateway_util.py')
    gw = source('lcnc-gateway/gateway.py')
    ns = {'os': os, 'math': math}
    extract(util, 'read_var_snapshot', ns)
    with tempfile.TemporaryDirectory(prefix='r508-read-') as tmp:
        path = Path(tmp) / 'sim.var'
        path.write_text('5220 1\n5241 50\n')
        async def worker(fn, *args):
            return fn(*args)
        async def synch():
            # A failed own save may still return DONE (the reused helper's
            # comment expressly names this). Another writer replaces the file.
            other = Path(tmp) / 'foreign.new'
            other.write_text('5220 1\n5241 123\n')
            os.replace(other, path)
            return 1, 'task_plan_synch'
        class LinuxCNC:
            RCS_DONE = 1
        class Trace:
            @staticmethod
            def emit(*args, **kwargs):
                pass
        ns.update(_var_file_thread=worker, _synch_interp_params=synch,
                  _G30Unconfirmed=RuntimeError, _own_link_current=lambda: True,
                  linuxcnc=LinuxCNC, _trace=Trace)
        extract(gw, '_g30_synch_read', ns)
        values = await ns['_g30_synch_read'](str(path), ['5220', '5241'])
        assert values['5241'] == 123
        return {'accepted_values': values, 'actual_interpreter_G55_X_in_model': 50,
                'own_save_happened': False, 'replacement_by': 'other writer',
                'meaning': 'New inode + DONE + same descriptor is not writer attribution.',
                'source_sha256': {'gateway.py': hashlib.sha256(gw.encode()).hexdigest(),
                                  'gateway_util.py': hashlib.sha256(util.encode()).hexdigest()}}


def session_seen_by_plan(polls, owner, own, errors=()):
    return (all(p['on'] and p['link'] == owner and p['echo'] in own for p in polls)
            and all(b['t'] - a['t'] <= 1 for a, b in zip(polls, polls[1:]))
            and not errors and polls[-1]['idle'] and polls[-1]['done'])


polls = [dict(t=0, on=True, link=1, echo=100, idle=False, done=False),
         dict(t=.1, on=True, link=1, echo=102, idle=True, done=True)]
own = {100: 'AUTO start', 102: 'non-dropping override'}
assert session_seen_by_plan(polls, 1, own)
out = {
    'kind': 'countermodels of the plan, not native measurements',
    'hidden_drop': {'polls': polls, 'known_writes': own,
                    'intervening_unseen': {'t': .04, 'echo': 101, 'action': 'foreign Abort'},
                    'plan_observation_conditions_pass': True,
                    'limit': 'Assumes distinct serials; does not need a serial collision. A gap must not be ignored.'},
    'short_own_mdi': {'polls': ['IDLE echo100', 'IDLE echo101'],
                      'between': 'own G10 L2 P3 X5, wholly between polls',
                      'session_seen_by_idle_edges': False,
                      'foreign_echo': False,
                      'needed': 'Begin obligation at dispatch/write, not at the first non-IDLE poll.'},
    'last_admission': {'before': {'index': 1, 'tlo': 'CONFIRMED'},
                       'after_read_before_write': {'index': 1, 'tlo': 'UNCONFIRMED'},
                       'index_only_test_accepts': True,
                       'whole_need_test_accepts': False},
}

# The enabled flag is independent of the saved offsets (G92.2 keeps them).
saved = {'5210': 0, '5211': 10, '5212': 20, '5213': 0}
actual = [0, 0, 0]
effective = [saved[str(k)] if saved['5210'] else 0 for k in (5211, 5212, 5213)]
assert actual == effective and actual != [saved[str(k)] for k in (5211, 5212, 5213)]
out['g92_disabled'] = {'parameters': saved, 'status_g92': actual,
                       'raw_comparison_wrongly_inconsistent': True,
                       'effective_comparison_equal': True}

# Formula in status_runtime: rotate(machine - g5x - TLO, -R), then -G92.
def shown_x(tlo_y):
    r = -math.pi / 2
    x, y = 0, -tlo_y
    return x * math.cos(r) - y * math.sin(r)
assert abs(shown_x(10) - shown_x(20)) > 9.99
out['rotation_dependency'] = {'rotation_deg': 90, 'machine_xy': [0, 0], 'row_xy': [0, 0],
                              'confirmed_tlo_x': 0, 'unconfirmed_tlo_y_candidates': [10, 20],
                              'shown_x': [shown_x(10), shown_x(20)]}

out['value_and_proof_binding'] = {
    'before': {'index': 1, 'index_state': 'CONFIRMED', 'row1_x': 7, 'row1_state': 'UNCONFIRMED'},
    'status': {'index': 1, 'row1_x': 0},
    'index_only_overwrite_admitted': True,
    'another_case': 'mtime reseed changes a CONFIRMED row while its old source/epoch stamp remains',
    'publication_case': 'basis.confirmed=true at spawn; a basis change during/after calculation must revoke current Clear',
}
out['read_identity'] = asyncio.run(unrelated_rename())
print(json.dumps(out, ensure_ascii=False, indent=2))
