"""Unit tests for the pure table-composition geometry (twp_transform.py).

The module lives in the TWP fork (examples/sim_config/twp/python/) so it is
importable by the remap; it is deliberately linuxcnc-free so it can be pinned
here off-machine.  The SIGN of the rotation is derived from the kins comp's
TCP forward and is additionally live-falsified by the phase-L2 parity probe —
these tests pin the geometry (pivot line, orthonormality, additivity), not
the physical sign.
"""
import math
import os
import sys
import unittest

sys.path.insert(
    0,
    os.path.join(
        os.path.dirname(os.path.abspath(__file__)),
        "..", "examples", "sim_config", "twp", "python",
    ),
)

from twp_transform import compose_table_a  # noqa: E402

Y_RA = -1000.0
Z_RA = -2000.0


def _dot(a, b):
    return sum(x * y for x, y in zip(a, b))


def _norm(a):
    return math.sqrt(_dot(a, a))


def _close(a, b, tol=1e-12):
    return all(abs(x - y) <= tol for x, y in zip(a, b))


class TestComposeTableA(unittest.TestCase):
    def test_zero_delta_is_identity(self):
        z, x, o = compose_table_a((0, 0, 1), (1, 0, 0), (1350, -150, -1450), 0.0, Y_RA, Z_RA)
        self.assertTrue(_close(z, (0, 0, 1)))
        self.assertTrue(_close(x, (1, 0, 0)))
        self.assertTrue(_close(o, (1350, -150, -1450)))

    def test_point_on_axis_line_is_invariant(self):
        # Any point on the x-parallel line through (Y_RA, Z_RA) must not move,
        # for any delta.
        for da in (7.0, 90.0, 180.0, -33.25):
            _z, _x, o = compose_table_a((0, 0, 1), (1, 0, 0), (123.0, Y_RA, Z_RA), da, Y_RA, Z_RA)
            self.assertTrue(_close(o, (123.0, Y_RA, Z_RA), tol=1e-9), (da, o))

    def test_hand_computed_90(self):
        # dA=+90 => Rx(-90): (0,0,1)->(0,1,0), (0,1,0)->(0,0,-1)
        z, x, o = compose_table_a((0, 0, 1), (0, 1, 0), (0.0, Y_RA, Z_RA + 10.0), 90.0, Y_RA, Z_RA)
        self.assertTrue(_close(z, (0, 1, 0), tol=1e-12))
        self.assertTrue(_close(x, (0, 0, -1), tol=1e-12))
        # origin: rel (0,0,10) -> (0,10,0) -> pivot + that
        self.assertTrue(_close(o, (0.0, Y_RA + 10.0, Z_RA), tol=1e-9))

    def test_hand_computed_180(self):
        z, x, o = compose_table_a((0, 0, 1), (0, 1, 0), (10.0, Y_RA + 5.0, Z_RA), 180.0, Y_RA, Z_RA)
        self.assertTrue(_close(z, (0, 0, -1), tol=1e-12))
        self.assertTrue(_close(x, (0, -1, 0), tol=1e-12))
        self.assertTrue(_close(o, (10.0, Y_RA - 5.0, Z_RA), tol=1e-9))

    def test_orthonormality_preserved(self):
        z0 = (0.36, 0.48, 0.8)
        x0 = (0.8, 0.36, -0.48)  # z0.x0 = 0.288+0.1728-0.384 != 0 -> orthogonalize
        # Build a genuinely orthonormal pair first.
        d = _dot(x0, z0)
        x0 = tuple(xi - d * zi for xi, zi in zip(x0, z0))
        n = _norm(x0)
        x0 = tuple(xi / n for xi in x0)
        self.assertAlmostEqual(_dot(x0, z0), 0.0, places=12)
        z, x, _o = compose_table_a(z0, x0, (0, 0, 0), 37.31, Y_RA, Z_RA)
        self.assertAlmostEqual(_norm(z), 1.0, places=12)
        self.assertAlmostEqual(_norm(x), 1.0, places=12)
        self.assertAlmostEqual(_dot(z, x), 0.0, places=12)

    def test_additivity(self):
        z0, x0, o0 = (0.2, 0.5, math.sqrt(1 - 0.04 - 0.25)), (0, 1, 0), (1350.0, -150.0, -1450.0)
        z1, x1, o1 = compose_table_a(z0, x0, o0, 12.5, Y_RA, Z_RA)
        z2, x2, o2 = compose_table_a(z1, x1, o1, 27.5, Y_RA, Z_RA)
        z3, x3, o3 = compose_table_a(z0, x0, o0, 40.0, Y_RA, Z_RA)
        self.assertTrue(_close(z2, z3, tol=1e-10))
        self.assertTrue(_close(x2, x3, tol=1e-10))
        self.assertTrue(_close(o2, o3, tol=1e-8))


if __name__ == "__main__":
    unittest.main()
