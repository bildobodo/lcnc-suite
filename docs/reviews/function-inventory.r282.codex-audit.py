"""R282: read-only plan/source audit. No LinuxCNC imports or live connections.

Run: python3 function-inventory.r282.codex-audit.py /path/to/archive > audit.json
The archive reviewed was git archive 1bc47a1e.
"""
import ast
import hashlib
import json
import sys
from pathlib import Path

root = Path(sys.argv[1]).resolve()
files = [
    'scripts/install_examples.py', 'lcnc-gateway/gateway.py',
    'scripts/test_support/live_session.py', 'scripts/perf_matrix.py',
    'scripts/macro_live_check.py', 'scripts/test_suite.py',
    'scripts/toolsetter_readback_check.py', 'scripts/inventory/functions.py',
    'scripts/inventory/functions.json', 'lcnc-webui/src/App.vue',
    'subroutines/tool_length_probe/tool_touch_off.ngc',
    'subroutines/probe_basic/probe_z_minus_wco.ngc',
    'examples/sim_config/sim_toolsetter/sim_toolsetter.comp',
    'examples/sim_config/lcnc_suite_sim_3axis_xyz.ini',
    'examples/sim_config/hallib/lcnc_webui.hal',
]
out = {'reviewed_commit': '1bc47a1e', 'kind': 'static-plan-audit',
       'live_connections': 0, 'machine_commands': 0,
       'files': {f: hashlib.sha256((root / f).read_bytes()).hexdigest() for f in files}}

def hits(file, needles):
    return [{'line': i, 'text': line} for i, line in enumerate(
        (root / file).read_text().splitlines(), 1) if any(n in line for n in needles)]

out['sources'] = {
    'launcher': hits(files[0], ['managed[("DISPLAY", "DISPLAY")]', '"--repo"']),
    'gateway_paths': hits(files[1], ['BASE_DIR =', 'SETTINGS_PATH =', 'TOOL_LIBRARY_PATH =']),
    'auto_confirmation': hits(files[2], ['confirmed =', 'if requested', 'confirm_tool_change']),
    'm600_requests': hits(files[10], ['M6 T#<tool_selected>']),
    'trip_recovery': hits(files[3], ['"sigstop_trip"', 'SIGSTOP)', 'SIGCONT)',
                                  'safety_trip_ack', 'sticky_ok', 'recovered_ok']),
    'ui_goto_routes': hits(files[9], ['@goToG30=', '@goToHome=', '@goToZero=']),
    'macro_sampler': hits(files[4], ['def run_sampled', 'actual_position[:3]',
                                   'asyncio.sleep(0.005)', 'def retract_first',
                                   'time.monotonic() - t0 < 120', 'return await task, samples']),
    'hb_measure_boundary': hits(files[1], ['_hb_pre_send_gap > 100',
                                         'pre-send-to-pre-send gap',
                                         '_hal_send({"heartbeat"']),
    'latch_order': hits(files[14], ['addf oneshot.0', 'addf webui-hb-latch',
                                   'setp oneshot.0.width']),
}

wanted = {
    'F-HOME': ['S2c'], 'F-JOG': ['S5'], 'F-GOTO': ['S1c'],
    'F-OVERRIDE': ['S2'], 'F-PROBE': ['S3'], 'F-TOOLMEASURE': ['S5', 'S6b'],
    'F-ESTOP': ['S4', 'S4b'], 'SYS-CONN': ['S1', 'S4'],
    'F-SURFACE': ['S2'], 'F-COMP': ['S4'],
}
out['statements'] = [dict(function=f['id'], **s)
                     for f in json.loads((root / files[8]).read_text())['functions']
                     for s in f.get('statements', []) if s['id'] in wanted.get(f['id'], [])]

# Evaluate only the pure coordinate predicate, never the module's live imports.
tree = ast.parse((root / files[4]).read_text())
node = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'retract_first')
env = {}
exec(compile(ast.Module(body=[node], type_ignores=[]), files[4], 'exec'), env)
out['pure_predicate_limit'] = {
    'input': [[10, 10, -20], [10, 10, -20]], 'target': [100, 100], 'tol_mm': .003,
    'result': env['retract_first']([(10, 10, -20), (10, 10, -20)], (100, 100), .003),
    'interpretation': 'No-motion samples satisfy the path predicate. Existing macro callers add end-position checks; the new runner must likewise prove execution and complete observation. This is not a product defect.'}

vals = {}
section = ''
for line in (root / files[13]).read_text().splitlines():
    line = line.strip()
    if line.startswith('[') and line.endswith(']'):
        section = line[1:-1]
    elif '=' in line and not line.startswith(('#', ';')):
        key, value = line.split('=', 1)
        vals[section, key.strip()] = value.strip()
v = float(vals['TRAJ', 'MAX_LINEAR_VELOCITY'])
out['profile_units'] = {
    'startup': vals['RS274NGC', 'RS274NGC_STARTUP_CODE'],
    'traj_limit_mm_per_second': v,
    'g94_feed_mm_per_minute_for_that_limit': 60 * v,
    'half_override_plateau_mm_per_second': .5 * v,
    'servo_period_ns': int(vals['EMCMOT', 'SERVO_PERIOD']),
    'axis_z_limit_mm_per_second': float(vals['AXIS_Z', 'MAX_VELOCITY']),
    'note': 'Do not use the numeric TRAJ value directly as an F word, and account for the selected axis and acceleration.'}
print(json.dumps(out, ensure_ascii=False, indent=2))
