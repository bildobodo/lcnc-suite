"""R64 fixture check: stale XYZ cache must not block A/C or leak widening.
Run from any CWD: python3 fixture-probe.py /path/to/archive
"""
import json
import sys
import unittest
from pathlib import Path

root=Path(sys.argv[1]).resolve()
sys.path.insert(0,str(root/'lcnc-gateway'))
import fake_linuxcnc
lc=fake_linuxcnc.install()
assert lc.__lcnc_fake__ and lc.stat.axis_mask == 7
import test_command_dispatch as tests
import gateway

seed=gateway.MachineLimits(n_axes=3, n_joints=3)
gateway._machine_limits=seed
names=[
 'test_command_dispatch.TestHandlerExecution.test_teleop_jog_translates_list_index_to_canonical_axis',
 'test_command_dispatch.TestGoToZeroAndJogStopDispatch.test_mode_switch_ignored_while_jogging_is_refused_loudly',
 'test_command_dispatch.TestGoToZeroAndJogStopDispatch.test_an_ignored_switch_without_a_jog_never_names_one',
]
results=[]
for name in names:
    result=unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromName(name))
    assert result.wasSuccessful(), name
    assert gateway._machine_limits is seed, 'fixture did not restore prior limits'
    assert lc.stat.axis_mask == 7, 'fixture widened fake class instead of its instance'
    results.append(dict(test=name, passed=True, cached_xyz_restored=True, fake_class_still_xyz=True))
out=dict(commit='f1b7e27',fake_linuxcnc=True,results=results)
(root/'evidence/viewer-palette-fest.r64.fixture-probe.json').write_text(json.dumps(out,indent=2)+'\n')
print(json.dumps(out,indent=2))
