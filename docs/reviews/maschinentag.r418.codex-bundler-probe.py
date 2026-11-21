import ast
import json
import sys
import tempfile
from pathlib import Path

root = Path('/tmp/codex-r418')
source = root / 'scripts/trace-bundle.py'
tree = ast.parse(source.read_text())
nodes = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in ('_safe_open', 'load_trace_ndjson')]
assert len(nodes) == 2
module = ast.Module(body=[ast.ImportFrom(module='__future__', names=[ast.alias(name='annotations')], level=0)] + nodes, type_ignores=[])
ast.fix_missing_locations(module)
p = Path(tempfile.mkdtemp(prefix='bundle-', dir='/tmp/r418'))
(p / 'trace.ndjson.1').write_text(json.dumps({'t_wall_ns': 1, 'tag': 'before-rotation'}) + '\n')
(p / 'trace.ndjson').write_text(json.dumps({'t_wall_ns': 2, 'tag': 'after-rotation'}) + '\n')
ns = {'json': json, 'sys': sys, 'TRACE_PATH': str(p / 'trace.ndjson')}
exec(compile(module, str(source), 'exec'), ns)
found = ns['load_trace_ndjson']()
assert [r['tag'] for r in found] == ['after-rotation']
result = {'files_available': 2, 'records_available': 2, 'bundler_records': found, 'rotated_input_not_read': True,
          'source': '98748fab:scripts/trace-bundle.py:62'}
Path('/tmp/r418/bundler.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(result))
