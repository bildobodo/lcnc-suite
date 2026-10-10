#!/usr/bin/env python3
"""R132 offline review cases. Use the archived native harness unchanged in memory
except for added inputs and observational wrappers; unavailable-interpreter cases
explicitly inject that dependency failure. No live controller or machine command.

Usage: <venv-python> audit.py /path/to/archive/src [case]
"""
import contextlib
import io
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(sys.argv[1]).resolve()
CASES = {
    'early_m6': ('G21 G90\nG53 G0 Z0\nM6\nG91 G0 X10\nG0 Y10\nM2\n', {'emcio': 'TOOL_CHANGE_POSITION = 50 50 50'}),
    'early_m6_none': ('G21 G90\nG53 G0 Z0\nM6\nG91 G0 X10\nG0 Y10\nM2\n', {}),
    'early_m6_first': ('G21 G90\nM6\nG91 G0 X10\nG0 Y10\nM2\n', {'emcio': 'TOOL_CHANGE_POSITION = 50 50 50'}),
    'late_m6_control': ('G21 G90\nG0 X0 Y0 Z0\nM6\nG91 G0 X10\nG0 Y10\nM2\n', {'emcio': 'TOOL_CHANGE_POSITION = 50 50 50'}),
    'no_interp': ('G21 G90\nG53 G0 Z0\nG0 X10\nM2\n', {}),
    'interp_control': ('G21 G90\nG53 G0 Z0\nG0 X10\nM2\n', {}),
    'initial_read': ('#1=#5420\nG0 X[#1+5] Y0 Z0\nG0 X10\nM2\n', {}),
    'initial_named_read': ('#1=#<_x>\nG0 X[#1+5] Y0 Z0\nG0 X10\nM2\n', {}),
    'read_on_first_move': ('G0 X[#5420+5] Y0 Z0\nG0 X10\nM2\n', {}),
    'read_after_modal': ('G21 G90\n#1=#5420\nG0 X[#1+5] Y0 Z0\nG0 X10\nM2\n', {}),
    'initial_read_with_modal': ('G21 G90 #1=#5420\nG0 X[#1+5] Y0 Z0\nG0 X10\nM2\n', {}),
    'initial_read_percent': ('%\n#1=#5420\nG0 X[#1+5] Y0 Z0\nG0 X10\nM2\n%\n', {}),
    'initial_read_blank': ('\n#1=#5420\nG0 X[#1+5] Y0 Z0\nG0 X10\nM2\n', {}),
    'unknown_kins': ('G21 G90\nG53 G0 Z0\nG0 X10\nM2\n', {'ctx': {'kins_type': None}}),
    'unknown_switchkins': ('G21 G90\nG53 G0 Z0\nG0 X10\nM2\n', {'ctx': {'kins_type': None}, 'ini': '[KINS]\nKINEMATICS = xyzac-trt-kins sparm=identityfirst\n'}),
    'g28_feed_second': ('G21 G90 F100\nG28\nM2\n', {}),
    'g28_rapid_control': ('G21 G90 F100\nG28\nM2\n', {}),
}

if len(sys.argv) == 2:
    results = {}
    for name in CASES:
        p = subprocess.run([sys.executable, __file__, str(ROOT), name], capture_output=True,
                           text=True, timeout=60)
        if p.returncode:
            results[name] = {'rc': p.returncode, 'stdout': p.stdout, 'stderr': p.stderr}
        else:
            results[name] = json.loads(p.stdout)
    print(json.dumps(results, indent=2))
    sys.exit(0)

name = sys.argv[2]
program, extra = CASES[name]
harness = ROOT / 'lcnc-gateway/native_start_probe.py'
source = harness.read_text()
anchor = 'program, units, z_off, gcodes_live, extra = CASES[sys.argv[1]]'
assert source.count(anchor) == 1
source = source.replace(anchor, 'CASES[sys.argv[1]] = ' + repr((program, 'mm', 0.0, (490,), extra)) + '\n' + anchor)
instrument = '''
import gcode_canon as _review_canon
_review_events = []
def _review_state(c):
    return {'line': c.lineno, 'seq': c.seq, 'dep': sorted(c.dep), 'stale': sorted(c.stale),
            'read_done': sorted(c._read_done), 'read_lines': c.read_lines}
def _review_wrap(method):
    original = getattr(_review_canon.PreviewCanon, method)
    def observed(c, *a, **kw):
        before = _review_state(c)
        result = original(c, *a, **kw)
        args = [getattr(v, 'sequence_number', str(v)) if method == 'next_line' else v for v in a]
        _review_events.append({'method': method, 'args': args, 'before': before, 'after': _review_state(c)})
        return result
    setattr(_review_canon.PreviewCanon, method, observed)
for _method in ('change_tool', '_dep_step', 'next_line'):
    _review_wrap(_method)
'''
if name == 'no_interp':
    instrument += '\n_review_canon.PreviewCanon.interp = staticmethod(lambda: None)\n_review_canon.interp_this = lambda: None\n'
if name == 'g28_feed_second':
    instrument += '''
_review_orig_traverse = _review_canon.PreviewCanon.straight_traverse
_review_traverses = 0
def _review_feed_second(c, *a):
    global _review_traverses
    if c._program_line():
        _review_traverses += 1
        if _review_traverses == 2:
            return c.straight_feed(*a)
    return _review_orig_traverse(c, *a)
_review_canon.PreviewCanon.straight_traverse = _review_feed_second
'''
anchor = 'import gcode_parse_worker as worker  # noqa: E402'
assert source.count(anchor) == 1
source = source.replace(anchor, anchor + '\n' + instrument)
sys.argv = [str(harness), name]
namespace = {'__file__': str(harness), '__name__': '__main__'}
stdout = io.StringIO()
with contextlib.redirect_stdout(stdout):
    exec(compile(source, str(harness), 'exec'), namespace)
payload = json.loads(stdout.getvalue().splitlines()[-1])
payload['review_events'] = namespace['_review_events']
payload['program'] = program
payload['extra'] = extra
payload['interpreter_unavailable_injected'] = name == 'no_interp'
payload['second_g28_callback_feed_injected'] = name == 'g28_feed_second'
payload['worker_stderr'] = namespace['err'].getvalue()
print(json.dumps(payload, default=lambda v: sorted(v) if isinstance(v, (set, frozenset)) else str(v)))
