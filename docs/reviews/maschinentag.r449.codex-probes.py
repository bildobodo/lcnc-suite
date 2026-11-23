"""R449 plan probes at product 54955611; fake worker, no gateway import.

These assert the present prerequisites, not a proposed implementation.
The two gateway helpers are compiled unchanged from their AST nodes.
"""
import ast
import json
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Dict, Optional

import pytest

from bulk_pipeline import BulkPipeline
from calc_lifetime import ActionLedger
import test_bulk_pipeline as fixtures

OBS = {}


def record(name, value):
    OBS[name] = value
    Path('/tmp/r449/observations.json').write_text(
        json.dumps(OBS, indent=2, ensure_ascii=False) + '\n')


def helper(name, **bindings):
    tree = ast.parse(Path('gateway.py').read_text())
    node = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == name)
    scope = dict(Optional=Optional, Dict=Dict, Any=Any, **bindings)
    exec(compile(ast.Module(body=[node], type_ignores=[]), 'gateway.py', 'exec'), scope)
    return scope[name]


def test_first_load_has_no_pinnable_start():
    b = BulkPipeline(get_stat=lambda: None, get_machine_units=lambda: 'mm',
                     build_wcs_rotation_patches=lambda: {})
    ctx = b.start_ctx('/new.ngc')
    check = b.run_start_check('/new.ngc', SimpleNamespace(), 'source')
    run = dict(file='/new.ngc', state='sent', verified=check[0], ctx=ctx)
    pin = helper('_run_for_pin', _run_basis=run)('/new.ngc')
    record('first_load', dict(ctx=ctx, start_check=check, run_for_pin=pin))
    assert ctx is None and check == (False, 'no publication of this program') and pin is None


@pytest.fixture
def published():
    case = fixtures.TestRunBinding()
    case.setUp()
    try:
        case._load()
        assert case._check() == (True, None)
        yield case
    finally:
        case.tearDown()


def test_previous_program_supplies_no_start_for_new_program(published):
    b = published.b
    newfile = published.ngc + '-new.ngc'
    ctx = b.start_ctx(newfile)
    check = b.run_start_check(newfile, published.live, 'new source')
    record('different_file', dict(ctx=ctx, start_check=check,
                                 origin_fields=sorted(b.published_origin)))
    assert ctx is None and check == (False, 'no publication of this program')


def test_pending_same_file_is_not_a_verified_run_basis(published):
    published.b.reparse_pending = True
    ctx = published.b.start_ctx(published.ngc)
    check = published._check()
    record('same_file_pending', dict(ctx_exists=ctx is not None, start_check=check))
    assert ctx is not None and check == (False, 'a parse runs or is pending')


def test_wait_in_idle_can_be_observed_file_writer():
    ledger = ActionLedger()
    writer = ledger.begin_file(None, 'program_write')
    wait = helper('_restart_wait',
                  _bulk=SimpleNamespace(unloading=False, spawned_program_gen=1),
                  _calc_gen=SimpleNamespace(snapshot=lambda: (1, 0)),
                  _actions=ledger, _actions_quiet=lambda: ledger.busy() is None,
                  linuxcnc=SimpleNamespace(INTERP_IDLE=1))
    st = SimpleNamespace(interp_state=1, current_vel=0)
    why = wait(st, False)
    record('idle_file_writer', dict(why=why, interp_idle=True, current_vel=0))
    assert why == 'observed:program_write'
    assert writer.outcome is None
