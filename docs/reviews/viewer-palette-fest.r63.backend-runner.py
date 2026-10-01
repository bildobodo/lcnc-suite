"""Run R63 mode/jog tests with an explicit XYZAC fake (axis 3 exists).

No change to tests or product: the fake's default axis_mask=7 is XYZ, while
the jog tests target axis 3. Set this fixture before importing gateway.
Usage: python3 this.py /path/to/archive
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(sys.argv[1]).resolve()/'lcnc-gateway'))
import fake_linuxcnc
lc = fake_linuxcnc.install()
lc.stat.axis_mask = 0b00101111  # XYZAC, wire indices 0..4
assert lc.__lcnc_fake__
suite = unittest.defaultTestLoader.loadTestsFromNames([
    'test_gateway_util.TestModeSwitchIgnoredMessage',
    'test_command_dispatch.TestGoToZeroAndJogStopDispatch',
])
result = unittest.TextTestRunner(verbosity=2).run(suite)
sys.exit(not result.wasSuccessful())
