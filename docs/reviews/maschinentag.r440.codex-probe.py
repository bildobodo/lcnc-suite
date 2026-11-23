"""R440 plan counterexamples. Actual functions from 594e333c, fake boundaries.

No gateway import, no LinuxCNC connection, no sockets or files written by the
extracted functions. The plan-rule examples are explicitly separate models.
"""
from __future__ import annotations
import ast
import asyncio
import hashlib
import json
import sys
from pathlib import Path
from types import SimpleNamespace as NS

source = Path(sys.argv[1]).read_text()
tree = ast.parse(source)
names = {'_feature_job', '_apply_probe_vars_detail', '_ts_book'}
functions = [n for n in tree.body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name in names]
assert {n.name for n in functions} == names
unit = ast.Module(body=[ast.ImportFrom(module='__future__', names=[ast.alias(name='annotations')], level=0), *functions], type_ignores=[])
ast.fix_missing_locations(unit)
compiled = compile(unit, '<extracted gateway.py at 594e333c>', 'exec')

class WriteRefused(PermissionError):
    pass

async def no_result(*args, **kwargs):
    return None

def env():
    ctx = {
        'asyncio': asyncio, '_WriteRefused': WriteRefused,
        '_trace': NS(emit=lambda *a, **k: None),
        'canonical_param': float, 'finite_float': float,
        'safe_get': lambda name, default=None: True if name == 'enabled' else default,
        'reject_if_auto_running': lambda: None, '_interp_idle_refusal': lambda: None,
        'mdi_line_refusal': lambda text: None, '_ts_ensure': lambda: None,
        'linuxcnc': NS(MODE_MDI=3, command=NS(mdi='mdi')),
        'op': lambda fn, *args: (fn, args), '_own_link_current': lambda: True,
        'link': lambda: NS(stat=NS(poll=lambda: None)),
        '_cmd_rc_failed': lambda rc: rc != 1,
        '_resolve_var_file_path': lambda: None,
        'set_mode': no_result,
    }
    exec(compiled, ctx)
    return ctx

async def detail_case(kind):
    ctx = env()
    calls, books = [], []
    async def set_mode(*args, **kwargs):
        if kind == 'mode_refused':
            raise WriteRefused('not admitted before mode write')
    async def command(conn, op, **kwargs):
        if kind == 'write_refused':
            raise WriteRefused('not admitted before parameter write')
        calls.append({'op': op, 'wait': kwargs.get('wait')})
        return -1 if kind == 'write_timeout' else 1
    ctx.update(set_mode=set_mode, _cmd_blocking=command,
               _ts_book=lambda values, origin: books.append({'values': values, 'origin': origin}))
    result = await ctx['_apply_probe_vars_detail']({'3032': .2}, True, admit=lambda: None)
    return {'kind': kind, 'parameter_writes_attempted': len(calls), 'returned': result, 'book_calls': books}

async def handler_case():
    ctx = env()
    calls = []
    completion = asyncio.Event()
    async def command(conn, op, **kwargs):
        calls.append({'op': op, 'wait': kwargs.get('wait')})
        if kwargs.get('wait') is not None:
            await completion.wait()
        return 0
    async def params(*args, **kwargs):
        return True, True
    ctx.update(require_armed=lambda _: None,
        _features=NS(COMMAND_FEATURES={'probe_run':'probing'}, PARAMLESS_PROBE_ROUTINES=set(), purpose_refusal=lambda *a: None),
        get_probe_macros=lambda: ['probe_cal_round_pocket'],
        _start_guard=no_result, _feature_refusal=lambda *args: None,
        _skip_flag_cleared=lambda values: values,
        _apply_probe_vars=params, _cmd_blocking=command)
    result = await ctx['_feature_job']('probe_run', {'routine':'probe_cal_round_pocket','vars':{'3014':99}}, True)
    assert not completion.is_set()
    return {'returned': result, 'command_calls': calls, 'routine_completion_received': completion.is_set()}

async def main():
    cases = [await detail_case(k) for k in ('mode_refused','write_refused','write_timeout','taken_without_file')]
    assert cases[0]['returned'] == cases[1]['returned'] == cases[2]['returned']
    assert [c['parameter_writes_attempted'] for c in cases] == [0,0,1,1]
    handler = await handler_case()
    # Mathematical counterexample to the plan's restart identity scheme.
    token_a, token_b = 345678 + 2, 345679 + 1
    assert token_a == token_b
    # Literal value-only lookup from the v2 field-state rule. Local edit
    # generations are included in this trace to show the missing distinction.
    history = [{'edit':1, 'value':50, 'outcome':'refused'}]
    local_edits = [{'edit':1,'value':50}, {'edit':2,'value':60}, {'edit':3,'value':50}]
    current = local_edits[-1]
    matches = [s for s in history if s['value']==current['value']]
    rule_state = 'refused' if matches and matches[-1]['outcome']=='refused' else 'draft'
    assert rule_state=='refused'
    print(json.dumps({
        'base':'594e333c','gateway_sha256':hashlib.sha256(source.encode()).hexdigest(),
        'scope':'Extracted source functions with simulated boundaries, plus explicitly labelled plan-rule counterexamples. No browser/native/product implementation of R440 executed.',
        'actual_source':{'handler_return':handler, 'apply_detail':cases},
        'plan_models':{
            'token_collision':{'process_A':{'random_base':345678,'counter':2,'token':token_a},'process_B':{'random_base':345679,'counter':1,'token':token_b}},
            'field_ABA':{'server_value':25,'sent':history,'local_edits':local_edits,'v2_value_match_state':rule_state,'current_edit_was_sent':False,'required_current_edit_state':'draft'},
        }}, indent=2))

asyncio.run(main())
