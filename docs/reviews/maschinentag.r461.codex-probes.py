"""R461 design counterexamples; stdlib only, no gateway import or machine connection.

The read rule is a literal model of C1-R, NOT an unbuilt product implementation.
The toolsetter checks execute the named head functions in an isolated namespace.
"""
import ast
import hashlib
import json
import math
import os
import re
from pathlib import Path
import tempfile
import threading
from types import SimpleNamespace
from typing import Optional

ROOT = Path('/tmp/r461/tree')
source = (ROOT / 'lcnc-gateway/gateway.py').read_text()
tree = ast.parse(source)
names = {'_ts_open_drift', '_ts_hold_reason'}
nodes = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in names]
ns = dict(Optional=Optional, _ts_basis_version=9,
          _bulk=SimpleNamespace(published_toolsetter={'routine': True}),
          _ts_published_input=lambda: (8, {}),
          _toolsetter_parse_ctx=lambda: {}, toolsetter_inputs_equal=lambda a, b: False,
          _ts_basis={}, toolsetter_basis_view=lambda x: {'state': 'assumed'},
          _machine_on_in_auto=lambda st: False, _ts_attempt_key=lambda: (9, 'P'),
          _ts_readback_outcomes={}, _ts_hold_note=lambda *a: None,
          _ts_hold_anchor=(9, 100), TS_HOLD_MAX_S=30,
          time=SimpleNamespace(monotonic=lambda: 129.9))
exec(compile(ast.Module(body=nodes, type_ignores=[]), 'head:gateway.py', 'exec'), ns)
ts = {'before_cap': ns['_ts_hold_reason'](None), 'old_publication': ns['_ts_open_drift']()}
ns['time'].monotonic = lambda: 130.0
ts['at_cap'] = ns['_ts_hold_reason'](None)
ns['_ts_published_input'] = lambda: (9, {})
ts['current_publication_still_assumed'] = ns['_ts_open_drift']()
assert ts == {'before_cap': 'read_back', 'old_publication': 'toolsetter',
              'at_cap': None, 'current_publication_still_assumed': None}

def sig(s):
    return s.st_ino, s.st_mtime_ns, s.st_size

with tempfile.TemporaryDirectory(prefix='r461-read-', dir='/tmp/r461') as tmp:
    path = Path(tmp) / 'tool.tbl'
    original = b'T13 P13 D8.000 Z63.192\n'
    prefix = b'T13 P13 D1.'
    complete = b'T13 P13 D1.875 Z63.192\n'
    path.write_bytes(original)
    ready, finish = threading.Event(), threading.Event()
    def writer():
        with path.open('wb', buffering=0) as f:
            f.write(prefix)
            ready.set()
            if not finish.wait(5):
                raise TimeoutError('probe reader did not release writer')
            f.write(complete[len(prefix):])
    thread = threading.Thread(target=writer)
    thread.start()
    assert ready.wait(2)
    with path.open('rb') as f:
        a = sig(os.fstat(f.fileno()))
        data = f.read()
        b = sig(os.fstat(f.fileno()))
    c = sig(path.stat())
    # Use the unchanged head's actual line parser, without importing gateway.
    tt = ast.parse((ROOT / 'lcnc-gateway/tool_table.py').read_text())
    wanted = {'_TOOL_FIELDS', '_TOOL_INT_FIELDS', '_INT_RE', '_REAL_RE'}
    tt_nodes = [n for n in tt.body if
                (isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id in wanted for t in n.targets))
                or (isinstance(n, ast.ClassDef) and n.name == 'ToolTableUnreadable')
                or (isinstance(n, ast.FunctionDef) and n.name == 'parse_tool_line')]
    tt_ns = {'re': re}
    exec(compile(ast.Module(body=tt_nodes, type_ignores=[]), 'head:tool_table.py', 'exec'), tt_ns)
    parsed = tt_ns['parse_tool_line'](data.decode())
    read = {'rule_accepts': a == b == c, 'bytes': data.decode(),
            'actual_head_line_parser': parsed,
            'fd_before': a, 'fd_after': b, 'path_after': c,
            'writer_has_finished': False, 'complete_expected': complete.decode()}
    finish.set()
    thread.join(2)
    assert not thread.is_alive()
    assert read['rule_accepts'] and data == prefix and path.read_bytes() == complete
    assert parsed['D'] == 1.0

# Counterexample to testing only ORIGINAL triangle vertices per slab.
# A vertical facet spans z=0..10 at r=4. All its original vertices are in
# the outer slabs; an erroneously small intermediate slab goes untested.
vertices = [(4, 0, 0), (4, 0, 10), (0, 4, 10)]
def wrong_radius(z):
    return 1 if 4 <= z <= 6 else 4
geometry = {'original_vertices_pass': all(math.hypot(x,y) <= wrong_radius(z) for x,y,z in vertices),
            'edge_midpoint': [4,0,5], 'edge_midpoint_inside': 4 <= wrong_radius(5),
            'inscribed20_radius_at_edge_midangle': math.cos(math.pi/20),
            'required_circle_radius': 1.0}
assert geometry['original_vertices_pass'] and not geometry['edge_midpoint_inside']

f6 = {
    'late_text_order': ['preview V adopted; text V pending',
                       'check(V) captures context: no proven text, no header',
                       'check(V) finishes, card shows captured context',
                       'text V arrives; gcodeLinesBound becomes true; no new check input'],
    'unit_counterexample': '(T13 D=6.0)\no100 sub\nG20\no100 endsub\nG0 X1\nM2\n',
    'unit_counterexample_prestate': 'metric interpreter; o100 never called',
    'syntactic_unit_rule': 'in', 'executed_unit_at_move': 'mm',
    'block_delete_counterexample': '(T13 D=6.0)\n/G20\nG0 X1\nM2\n',
    'block_delete_prestate': 'metric interpreter, block delete enabled',
    'native_executed': False,
    'tolerance_mm': 0.001, 'tolerance_in': 0.001/25.4,
    'old_rounding_guard_difference_mm': 0.00005*25.4,
}
out = {'source_commit': '6c78780c3c2eba279356fb47662695f270b6bd61',
       'source_sha256': hashlib.sha256(source.encode()).hexdigest(),
       'method': 'isolated head functions + literal read-rule model + analytic counterexamples; no native/browser/gate run',
       'toolsetter': ts, 'coherent_read_counterexample': read,
       'hull_guard_counterexample': geometry, 'f6': f6}
Path('/tmp/r461/observations.json').write_text(json.dumps(out, indent=2) + '\n')
print(json.dumps(out, indent=2))
