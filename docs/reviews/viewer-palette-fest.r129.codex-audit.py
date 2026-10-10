#!/usr/bin/env python3
"""R129, read-only plan/source audit; stdlib, no controller or native bindings.

Usage: python3 audit.py ARCHIVED_REPOSITORY
The import counterexample executes the archived toplevel.py against a tiny
temporary Python module. It is NOT a LinuxCNC run or a test of unbuilt E4a.
"""
import ast
import hashlib
import json
from pathlib import Path
import runpy
import sys
import tempfile
from types import SimpleNamespace

root = Path(sys.argv[1]).resolve()
sys.dont_write_bytecode = True
sys.path.insert(0, str(root / 'lcnc-gateway'))
from gateway_util import RemapEnv, foreign_m600_codes, nc_norm, position_write_lines

src = root / 'examples/sim_config/twp/python/remap.py'
tree = ast.parse(src.read_text())
functions = {n.name: n for n in tree.body if isinstance(n, ast.FunctionDef)}
axis_attrs = dict(zip(['current_x', 'current_y', 'current_z', 'AA_current',
                      'BB_current', 'CC_current', 'u_current', 'v_current', 'w_current'],
                     'XYZABCUVW'))
direct = {}
calls = {}
for name, node in functions.items():
    direct[name] = sorted({axis_attrs[n.attr] for n in ast.walk(node)
                           if isinstance(n, ast.Attribute) and isinstance(n.ctx, ast.Load)
                           and n.attr in axis_attrs})
    calls[name] = sorted({n.func.id for n in ast.walk(node)
                         if isinstance(n, ast.Call) and isinstance(n.func, ast.Name)
                         and n.func.id in functions})

def closure(name):
    pending, seen, reads = [name], set(), set()
    while pending:
        n = pending.pop()
        if n in seen:
            continue
        seen.add(n)
        reads.update(direct[n])
        pending.extend(calls[n])
    return {'axes': ''.join(a for a in 'XYZABCUVW' if a in reads),
            'read_functions': {n: direct[n] for n in sorted(seen) if direct[n]}}

entries = ('g682', 'g683', 'g684', 'g53x_core', 'g69_core', 'twp_touchoff')
read_table = {n: closure(n) for n in entries}
assert set(read_table['g683']['axes']) == set('ABC')
assert set('XYZA') <= set(read_table['twp_touchoff']['axes'])

# Exercise the ACTUAL shipped helper, extracted from the AST. No module/HAL
# import. Offsets are deliberately fixed at zero. This proves dependence of
# the remap's input on B/C, not an end-to-end collision verdict.
import logging
import math
ns = dict(joint_letter_primary='C', joint_letter_secondary='B',
          radians=math.radians, degrees=math.degrees, log=logging.getLogger('r129'),
          _rotary_work_offset=lambda _self, _letter: 0)
helper = ast.Module(body=[functions['get_current_rotary_positions']], type_ignores=[])
exec(compile(helper, str(src), 'exec'), ns)
rotary_values = []
for b, c in ((0, 0), (20, -15)):
    got = ns['get_current_rotary_positions'](SimpleNamespace(AA_current=0, BB_current=b, CC_current=c))
    rotary_values.append({'B': b, 'C': c, 'primary_secondary_degrees': list(map(math.degrees, got))})
assert rotary_values[0]['primary_secondary_degrees'] != rotary_values[1]['primary_secondary_degrees']

# The same exact shipped TOPLEVEL imports a foreign module when that module
# is earlier in sys.path, e.g. from the INI's PATH_PREPEND. All imports are
# standard Python here; no remap plug-in or machine is launched.
top = root / 'examples/sim_config/twp/python/toplevel.py'
with tempfile.TemporaryDirectory(prefix='r129-shadow-') as d:
    shadow = Path(d) / 'remap.py'
    shadow.write_text('def g682(self, **words):\n    return self.current_x\n')
    old_path = sys.path[:]
    old_remap = sys.modules.pop('remap', None)
    sys.path.insert(0, d)
    try:
        loaded = runpy.run_path(str(top))['remap']
        fn = loaded.g682
        identity = {'toplevel_inside_suite_python': top.resolve().parent == src.parent.resolve(),
                    'function_name': fn.__name__,
                    'actual_function_file_inside_suite_python': Path(fn.__code__.co_filename).resolve().parent == src.parent.resolve(),
                    'observed_X_read': fn(SimpleNamespace(current_x=123.0))}
        assert identity == {'toplevel_inside_suite_python': True, 'function_name': 'g682',
                            'actual_function_file_inside_suite_python': False, 'observed_X_read': 123.0}
    finally:
        sys.path[:] = old_path
        sys.modules.pop('remap', None)
        if old_remap is not None:
            sys.modules['remap'] = old_remap

# The existing routine recognizer checks the ngc marker, NOT prolog/epilog.
# Compare its real answer with RemapEnv's current opaque-body rule.
routines = root / 'subroutines/tool_length_probe'
hooks = {}
for code in ('M600', 'M601'):
    for opt in ('', ' prolog=reads_x', ' epilog=reads_x'):
        line = f'{code} modalgroup=6 ngc={code.lower()}' + opt
        foreign = sorted(foreign_m600_codes([line], [str(routines)]))
        effect = RemapEnv([line], [str(routines)]).effect(('M', int(code[1:])))
        hooks[line] = {'foreign_m600_codes': foreign, 'opaque_in_RemapEnv': effect == (None, None)}
        assert foreign == []
        if opt:
            assert effect == (None, None)

corpus = []
for entry in json.loads((root / 'scripts/parity_corpus/twp_gantry.json').read_text())['programs']:
    path = root / 'scripts/parity_corpus' / entry['file']
    text = path.read_text()
    _, mode = position_write_lines(text)
    flat = [nc_norm(line) for line in text.splitlines()]
    corpus.append({'file': entry['file'], 'mode': mode,
                   'square_call': any('O<square>CALL'.upper() in n.upper() for n in flat),
                   'g682': any('G68.2' in n for n in flat),
                   'g683': any('G68.3' in n for n in flat)})
assert sum(r['mode'] == 'foreign' for r in corpus) == 5
assert sum(r['mode'] == 'ordered' for r in corpus) == 1

out = {'scope': 'plan Fassung 5; no implementation of E4a under test',
       'source_sha256': hashlib.sha256(src.read_bytes()).hexdigest(),
       'call_graph_read_supersets': read_table,
       'actual_rotary_helper': rotary_values,
       'toplevel_import_counterexample': identity,
       'existing_M600_M601_recognizer_and_hooks': hooks,
       'corpus': corpus,
       'checks': 'PASS: all audit assertions; no product acceptance implied'}
print(json.dumps(out, indent=2))
