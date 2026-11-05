"""R284 plan audit; no LinuxCNC import, network or machine commands.

python3 -B this.py /path/to/git-archive-1bc47a1e
The sampled timeline is a counterexample to an observation contract,
not a measurement of native execution times.
"""
from pathlib import Path
import hashlib
import json
import sys

root = Path(sys.argv[1])
files = [
    'lcnc-gateway/gateway.py', 'lcnc-gateway/status_runtime.py',
    'subroutines/tool_length_probe/tool_touch_off.ngc',
    'examples/sim_config/xyz3/sim.var',
    'subroutines/probe_basic/probe_z_minus_wco.ngc',
]
src = {f: (root / f).read_text() for f in files}
assert 'POLL_HZ = 30' in src[files[0]]
assert src[files[2]].rfind('M50 P1') < src[files[2]].index('o<tool_touch_off> endsub')
var = dict((int(k), float(v)) for k, v in
           (ln.split() for ln in src[files[3]].splitlines() if ln.strip()))
trip_z = -180 + 50
probe = []
for start in [-122, -115]:
    end = start - var[3020]
    probe.append({'start_joint_z': start, 'contact_joint_z': trip_z,
                  'distance_to_contact_mm': start - trip_z,
                  'search_depth_mm': var[3020], 'end_joint_z_if_no_contact': end,
                  'contact_reachable': end <= trip_z})

# Correct routine: enable true at 1001 ms, routine done at 1002 ms.
# Polls at 1000 and 1033.333 ms: no status with true while still in the routine.
times = [966.6666667, 1000., 1033.3333333]
samples = [{'ms': t, 'feed_override_enabled': t >= 1001.,
            'routine_active': t < 1002.} for t in times]
assert any(not s['feed_override_enabled'] and s['routine_active'] for s in samples)
assert not any(s['feed_override_enabled'] and s['routine_active'] for s in samples)
assert samples[-1]['feed_override_enabled'] and not samples[-1]['routine_active']

out = {'source_commit': '1bc47a1e', 'kind': 'offline plan counterexample',
       'files': {f: hashlib.sha256((root / f).read_bytes()).hexdigest() for f in files},
       'sources': {
           f: [{'line': i, 'text': ln} for i, ln in enumerate(src[f].splitlines(), 1)
               if any(needle in ln for needle in needles)]
           for f, needles in [(files[0], ['POLL_HZ = 30']),
                              (files[1], ['feed_override_enabled=']),
                              (files[2], ['M50 P1', 'o<tool_touch_off> endsub'])]},
       'probe_geometry': probe,
       'periodic_status_counterexample': {
           'kind': 'synthetic timing example, not a live measurement',
           'm50_p1_ms': 1001., 'routine_end_ms': 1002., 'observations': samples,
           'correct_order_in_controller': True,
           'true_observed_before_end': False,
           'true_observed_after_end': True,
           'conclusion': 'The requirement to observe the return edge before routine end rejects a valid execution between polls.'}}
print(json.dumps(out, ensure_ascii=False, indent=2))
