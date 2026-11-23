"""R450: present source behavior behind two plan counterexamples.

No gateway import, controller connection, worker subprocess or HTTP server.
Gateway function bodies are extracted unchanged; only route decorators are
omitted. Bindings replace environment dependencies with temporary files.
"""
import ast
import hashlib
import json
import os
from pathlib import Path
import sys
import time
from types import SimpleNamespace
from typing import Optional

from fastapi import HTTPException, Response

SOURCE = Path('/tmp/r449/tree/lcnc-gateway')
sys.path.insert(0, str(SOURCE))
from gateway_util import rotary_hold_settled, rotary_hold_update, validate_path_within

OBS = {}


def note(name, data):
    OBS[name] = data
    Path('/tmp/r450/observations.json').write_text(json.dumps(OBS, indent=2) + '\n')


def function(name, **bindings):
    tree = ast.parse((SOURCE / 'gateway.py').read_text())
    node = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == name)
    node.decorator_list = []
    env = dict(Optional=Optional, **bindings)
    exec(compile(ast.Module(body=[node], type_ignores=[]), str(SOURCE / 'gateway.py'), 'exec'), env)
    return env[name]


def test_real_load_first_parse_can_pass_after_cycle_start():
    bulk = SimpleNamespace(unloading=False, spawned_program_gen=None)
    wait = function('_restart_wait', _bulk=bulk,
                    _calc_gen=SimpleNamespace(snapshot=lambda: (7, 3)),
                    _actions_quiet=lambda: True,
                    linuxcnc=SimpleNamespace(INTERP_IDLE=1))
    idle = SimpleNamespace(interp_state=1, current_vel=0)
    running = SimpleNamespace(interp_state=2, current_vel=1)
    abc = [20.0, 0.0, 0.0]
    hold = rotary_hold_update(None, abc, 0.0)
    assert wait(idle, True) is None
    assert not rotary_hold_settled(hold, abc, 0.2)
    # No spawn occurred in that settle window. Cycle Start came first.
    why = wait(running, True)
    settled = rotary_hold_settled(hold, abc, 1.1)
    note('first_load_after_start', {'program_gen': 7, 'spawned_program_gen': None,
         'interp_idle': False, 'current_vel': 1, 'restart_wait': why,
         'rotary_settled': settled, 'both_scheduling_gates_allow': why is None and settled})
    assert why is None and settled
    # Control: an already spawned generation does get the running veto.
    bulk.spawned_program_gen = 7
    assert wait(running, True) == 'not_idle'


def test_gcode_route_reads_current_file_not_announced_publication(tmp_path):
    path = tmp_path / 'program.ngc'
    old = b'G0 X1\nM2\n'
    new = b'G0 X999\nM2\n'
    path.write_bytes(old)
    announced = {'program_id': 'epoch.7', 'version': 10,
                 'source': hashlib.sha256(old).hexdigest()}
    path.write_bytes(new)  # Edit without a load: the program ID stays the same.
    get = function('get_gcode', get_nc_files_dir=lambda: str(tmp_path),
                   os=os, time=time, hashlib=hashlib, HTTPException=HTTPException,
                   Response=Response, validate_path_within=validate_path_within,
                   ALLOWED_EXTENSIONS={'.ngc'}, _fanout_enter=lambda _: 1,
                   _fanout_exit=lambda _: None)
    response = get(str(path))
    actual = response.headers['X-Program-Source']
    note('mutable_text', {'announced': announced, 'response_source': actual,
         'response_text': response.body.decode(),
         'identity_only_gate_under_the_plan': True,
         'source_matches_publication': actual == announced['source']})
    assert response.body == new
    assert actual == hashlib.sha256(new).hexdigest()
    assert actual != announced['source']
