"""R349: pure policy/map observations; never import gateway or LinuxCNC.

Run against a git archive of c7f72261, not the live checkout:
  PYTHONDONTWRITEBYTECODE=1 <venv-python> r349-probe.py <archive-root>
"""
import hashlib
import json
from pathlib import Path
import sys

root = Path(sys.argv[1]).resolve()
sys.path.insert(0, str(root / 'lcnc-gateway'))
from command_policy import MachineLimits, validate_payload
from gateway_util import joint_jog_map

messages = [
    {'cmd': 'home'},
    {'cmd': 'home', 'joint': None},
    {'cmd': 'unhome'},
    {'cmd': 'set_feed_override'},
    {'cmd': 'set_feed_override', 'scale': None},
    {'cmd': 'spindle_forward'},
    {'cmd': 'set_optional_stop'},
    {'cmd': 'set_optional_stop', 'value': 'false'},
    {'cmd': 'set_block_delete', 'value': 'false'},
    {'cmd': 'arm'},
]
observations = []
for msg in messages:
    try:
        corrected = validate_payload(msg['cmd'], msg, MachineLimits(n_axes=3, n_joints=3))
        observations.append({'payload': msg, 'refused': False, 'corrections': corrected})
    except ValueError as e:
        observations.append({'payload': msg, 'refused': True, 'reason': str(e)})

maps = []
for label, letters, n in [('identity', ['X', 'Y', 'Z'], 3),
                           ('permuted', ['X', 'Z', 'Y'], 3),
                           ('gantry', ['X', 'X', 'Y', 'Z'], 4),
                           ('undeclared', None, 3)]:
    rows, why = joint_jog_map(letters, n, ['X', 'Y', 'Z'], [10.0] * n)
    maps.append({'case': label, 'rows': rows, 'reason': why})

sources = ['lcnc-gateway/command_policy.py', 'lcnc-gateway/gateway_util.py',
           'lcnc-gateway/gateway.py', 'lcnc-webui/src/SetupStrip.vue',
           'lcnc-webui/src/App.vue', 'lcnc-webui/e2e/probe-click.spec.ts',
           'scripts/twp_parity.py']
print(json.dumps({
    'source_commit': 'c7f7226180a03a3b0761a4fb6ffe3c167309b3b7',
    'scope': 'pure helpers only; no gateway dispatch, controller, socket or motion',
    'payload_observations': observations,
    'mapping_observations': maps,
    'source_sha256': {p: hashlib.sha256((root / p).read_bytes()).hexdigest() for p in sources},
}, ensure_ascii=False, indent=2))
