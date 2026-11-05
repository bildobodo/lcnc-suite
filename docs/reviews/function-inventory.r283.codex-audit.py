"""R283 plan counterexamples; stdlib plus pure repository drift checker.

Run from anywhere: python3 -B this.py /path/to/git-archive-1bc47a1e
No LinuxCNC import, process control, network, or writes in the source archive.
"""
import ast
import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
from typing import Optional

sys.dont_write_bytecode = True
root = Path(sys.argv[1]).resolve()
files = [
    'lcnc-gateway/status_runtime.py',
    'examples/sim_config/xyz3/sim.var',
    'examples/sim_config/sim_toolsetter/sim_toolsetter.comp',
    'subroutines/probe_basic/probe_z_minus_wco.ngc',
    'scripts/config_sync_check.py', 'scripts/toolsetter_readback_check.py',
    'examples/sim_config/hallib/lcnc_webui.hal',
    'lcnc-webui/tsconfig.app.json', 'scripts/install_examples.py',
    'lcnc-webui/e2e/keyboard-guards.spec.ts',
    'lcnc-webui/e2e/joint-jog.spec.ts', 'lcnc-webui/e2e/strip-actions.spec.ts',
]
out = {'source_commit': '1bc47a1e', 'kind': 'plan audit, not a native run',
       'files': {f: hashlib.sha256((root / f).read_bytes()).hexdigest() for f in files}}

tree = ast.parse((root / files[0]).read_text())
method = next(n for n in ast.walk(tree) if isinstance(n, ast.FunctionDef) and n.name == 'track_tool_change')
ns = {'Optional': Optional}
exec(compile(ast.Module(body=[method], type_ignores=[]), files[0], 'exec'), ns)
state = SimpleNamespace(tool_change_seq=0, _tc_prev=False, tool_change_tool=None)
before = ns['track_tool_change'](state, False, None)
pending = ns['track_tool_change'](state, True, 1)
try:
    compare = pending > before
except TypeError as exc:
    compare = {'error': type(exc).__name__, 'message': str(exc)}
out['tool_change'] = {'before_request_seq': before, 'pending_seq': pending,
                      'literal_greater_than_previous': compare,
                      'wire_field': 'tool_change_tool',
                      'reader_internal_field': 'tool_prep_number'}

var = dict((int(k), float(v)) for k, v in
           (ln.split() for ln in (root / files[1]).read_text().splitlines() if ln.strip()))
start_z, length, plate_z = -100., 50., -180.
trip_z = plate_z + length
end_z = start_z - var[3020]
out['probe_geometry'] = {
    'start_joint_z': start_z, 'fixed_table_length': length, 'plate_z': plate_z,
    'trip_joint_z': trip_z, 'distance_to_contact_mm': start_z - trip_z,
    'shipped_3020_mm': var[3020], 'search_end_joint_z': end_z,
    'search_end_tip_z': end_z - length, 'contact_reachable': end_z <= trip_z,
    'note': 'R283 sets #3015/#3016/#3030 but leaves #3020 at its shipped value.'}

with tempfile.TemporaryDirectory(prefix='r283-links-', dir='/tmp') as td:
    a, b = Path(td) / 'source.tsbuildinfo', Path(td) / 'copy.tsbuildinfo'
    a.write_text('source')
    os.link(a, b)
    same = a.stat().st_ino == b.stat().st_ino
    b.write_text('written in copy')
    out['hardlink'] = {'same_inode': same, 'source_after_copy_write': a.read_text(),
                       'all_files_were_under_tmp': True}

sys.path.insert(0, str(root / 'scripts'))
from config_sync_check import drifted_lines
hal = (root / files[6]).read_text()
old = 'addf webui-hb-latch servo-thread\n'
mut = hal.replace(old, '').replace('addf oneshot.0 servo-thread\n', old + 'addf oneshot.0 servo-thread\n')
missing, local = drifted_lines(hal, mut)
out['reordered_hal'] = {'missing': missing, 'local': local,
                        'refused_by_shipped_hal_comparison': bool(missing or local),
                        'note': 'Pure string mutation only; no HAL file or running configuration changed.'}
print(json.dumps(out, indent=2, ensure_ascii=False))
