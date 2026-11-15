"""R380: the existing completion predicate, isolated from machine access.

The synthetic stream starts with the override already locked. It contains
no free-to-locked transition belonging to this call, but the present `ran`
predicate plus RoutineEnd accepts it. This tests the proposed reuse, not
an implementation of R380 (none exists yet).
"""
import ast
import json
from pathlib import Path
import sys

root = Path(sys.argv[1])
native = ast.parse((root / 'scripts/native_run.py').read_text())
probe = next(n for n in native.body if isinstance(n, ast.FunctionDef) and n.name == 'probe_cases')
ran = next(n for n in ast.walk(probe) if isinstance(n, ast.FunctionDef) and n.name == 'ran')
tc = ast.parse((root / 'scripts/test_support/tool_change.py').read_text())
end = next(n for n in tc.body if isinstance(n, ast.ClassDef) and n.name == 'RoutineEnd')
scope = {'started': {'seen': False}, 'INTERP_IDLE': 1}
exec(compile(ast.Module(body=[ran, end], type_ignores=[]), '<source excerpts>', 'exec'), scope)
finish = scope['RoutineEnd']()
frames = [
    (0.0, {'feed_override_enabled': False, 'interp_state': 1, 'inpos': True}),
    (0.1, {'feed_override_enabled': False, 'interp_state': 2, 'inpos': False}),
    (1.0, {'feed_override_enabled': True, 'interp_state': 1, 'inpos': True}),
]
answers = []
for t, status in frames:
    effect = scope['ran'](status)
    answers.append(finish(t, status) and effect)
assert answers == [False, False, True]
print(json.dumps({
    'stream': frames,
    'accepted_start_before_this_call_changed_override': True,
    'completion_answers': answers,
    'fresh_free_to_locked_transition': False,
    'interpretation': 'Require a confirmed free baseline before reusing this start witness.'
}, indent=2))
