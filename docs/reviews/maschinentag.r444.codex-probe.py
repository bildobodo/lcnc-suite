"""R444: verify the R443 proposal's boundary cases adopted by plan v6.
Pure arithmetic, no product imports, atomic file IO or controller execution.
"""
import ast
import hashlib
import json
from pathlib import Path

root = Path('/home/cnc/lcnc-suite')
source = root / 'docs/reviews/maschinentag.r443.codex-probe.py'
plan = root / 'docs/reviews/maschinentag.r444.p5-plan-v6.md'
data = source.read_bytes()
module = ast.parse(data)
selected = [node for node in module.body if
            isinstance(node, ast.FunctionDef) and node.name == 'suggested']
assert len(selected) == 1
namespace = {'MAX': 9_999_999}
exec(compile(ast.Module(body=selected, type_ignores=[]), str(source), 'exec'), namespace)
reserve = namespace['suggested']
maximum = namespace['MAX']
plan_text = plan.read_text()
assert 'N = max(next, last_reserved + 1)' in plan_text
assert '1 … MAX+1' in plan_text
assert 'next = N + 1' in plan_text
assert 'last_reserved = N' in plan_text
assert 'Ist `N > MAX`' in plan_text
assert 'Drahtbereich ist 1 … MAX' in plan_text
rows = []
for label, disk, memory, expected, token in [
    ('first', 1, 0, 'reserved', 1),
    ('second', 2, 1, 'reserved', 2),
    ('third', 3, 2, 'reserved', 3),
    ('restart_reserved_unsent', 2, 0, 'reserved', 2),
    ('higher_local_reservation', 2, 7, 'reserved', 8),
    ('last_token', maximum, maximum - 1, 'reserved', maximum),
    ('restart_exhausted', maximum + 1, 0, 'exhausted', None),
    ('local_exhaustion', 1, maximum, 'exhausted', None),
    ('fraction', 1.2, 0, 'invalid', None),
    ('bool', True, 0, 'invalid', None),
    ('negative', -1, 0, 'invalid', None),
    ('string', '1', 0, 'invalid', None),
    ('zero', 0, 0, 'invalid', None),
    ('above_sentinel', maximum + 2, 0, 'invalid', None),
]:
    result = reserve(disk, memory)
    assert result['outcome'] == expected and result['allocated_N'] == token, label
    if token is not None:
        assert 1 <= token <= maximum
        assert 1 <= result['written_next'] <= maximum + 1
    else:
        assert result['write'] is False
    rows.append({'case': label, 'disk_next': disk, 'memory_last': memory, **result})
print(json.dumps({
    'round': 'R444', 'scope': 'Arithmetic model from R443 proposal adopted by v6; not a product test',
    'model_source': str(source.relative_to(root)),
    'model_source_sha256': hashlib.sha256(data).hexdigest(),
    'plan_sha256': hashlib.sha256(plan.read_bytes()).hexdigest(),
    'cases': rows,
}, indent=2))
