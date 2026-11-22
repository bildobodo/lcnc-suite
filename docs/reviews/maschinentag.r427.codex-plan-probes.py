"""R427 plan counterexamples, not an implementation of P2a.

1. Model the proposed replacement of the once-per-version latch by a
   reusable input key (the comparison in gateway._ts_drift_reason).
2. Use the real toolsetter_ctx/read_var_snapshot and the unchanged pure
   apply_var_patches function (AST extracted to avoid native imports),
   following the worker's read/copy/patch sequence on a temporary var file.
No LinuxCNC import, no gateway, no network, no native program execution.
"""
import ast
import json
from pathlib import Path
import sys
import tempfile
from typing import Dict, List

root = Path(sys.argv[1] if len(sys.argv) > 1 else '/tmp/codex-r427')
sys.path.insert(0, str(root / 'lcnc-gateway'))
from gateway_util import TOOLSETTER_BASIS_KEYS, toolsetter_ctx, read_var_snapshot

def latch_sequence(use_input_key):
    published = 'A' if use_input_key else 1
    last_asked = None
    rows = []
    # Program stays loaded. The first B parse fails, so A remains displayed.
    for label, version, key in [('first B', 2, 'B'), ('back to A', 3, 'A'), ('second B', 4, 'B')]:
        current = key if use_input_key else version
        requested = not (published == current or last_asked == current)
        rows.append({'event': label, 'current': current, 'last_asked_before': last_asked,
                     'published': published, 'request': requested})
        if requested:
            last_asked = current
        # This is a failed B attempt. For the version control, the intervening
        # A parse succeeds; the key model already has the same effective A.
        if label == 'back to A' and requested:
            published = current
    return rows

key_latch = latch_sequence(True)
version_latch = latch_sequence(False)
assert key_latch[-1]['request'] is False
assert version_latch[-1]['request'] is True

source = root / 'lcnc-gateway/gcode_canon.py'
tree = ast.parse(source.read_text())
fn = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'apply_var_patches')
ns = {'Dict': Dict, 'List': List}
exec(compile(ast.Module(body=[fn], type_ignores=[]), str(source), 'exec'), ns)
patch = ns['apply_var_patches']
with tempfile.TemporaryDirectory(prefix='r427-plan-') as folder:
    var = Path(folder) / 'machine.var'
    copied = Path(folder) / 'worker.var'
    booked = {k: {'value': 10.0, 'origin': 'assumed', 't': 0} for k in TOOLSETTER_BASIS_KEYS}
    ctx = toolsetter_ctx(booked, 1)
    assert ctx['view']['state'] == 'assumed'
    assert '3014' not in ctx['patches']
    # The book was made before a later file replacement (e.g. synch).
    var.write_text(''.join(f'{k} {20 if k == 3014 else 10}\n' for k in sorted(TOOLSETTER_BASIS_KEYS)))
    copied.write_text(var.read_text())
    patch(str(copied), ctx['patches'])
    _, actual = read_var_snapshot(str(copied), ['3014'])
    assert actual['3014'] == 20.0 and booked[3014]['value'] == 10.0
    assumed = {'booked': booked[3014]['value'], 'worker_copy_after_patches': actual['3014'],
               'patch_for_3014': ctx['patches'].get('3014'), 'view': ctx['view']['state']}
    # Positive control: confirmed values are patched, regardless of the copy.
    confirmed = {k: {**v, 'origin': 'read'} for k, v in booked.items()}
    patch(str(copied), toolsetter_ctx(confirmed, 2)['patches'])
    _, patched = read_var_snapshot(str(copied), ['3014'])
    assert patched['3014'] == 10.0

print(json.dumps({'method': __doc__, 'repeated_key_latch': key_latch,
                  'version_latch_control': version_latch, 'assumed_copy': assumed,
                  'confirmed_patch_control': patched}, indent=2))
