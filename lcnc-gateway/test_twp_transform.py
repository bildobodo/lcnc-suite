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

from twp_transform import (  # noqa: E402
    compose_table_a, to_table_frame, from_table_frame,
    to_table_frame_vector, from_table_frame_vector, calc_shortest_distance)

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


class TestFrameDirections(unittest.TestCase):
    """The plane is STORED table-relative, so the two directions must be exact
    inverses at every table angle — that round trip is what lets G53.x orient
    to where the face IS while the stored definition never changes."""

    Z0 = (0.258819, -0.482963, 0.836516)     # the corpus plane's normal
    X0 = (0.965926, 0.129410, -0.224144)
    O0 = (1350.0, -150.0, -1450.0)

    def test_round_trip_is_the_identity_at_every_table_angle(self):
        for a in (0.0, 7.5, 20.0, 90.0, 180.0, -33.25, 359.9):
            z1, x1, o1 = to_table_frame(self.Z0, self.X0, self.O0, a, Y_RA, Z_RA)
            z2, x2, o2 = from_table_frame(z1, x1, o1, a, Y_RA, Z_RA)
            self.assertTrue(_close(z2, self.Z0, 1e-9), a)
            self.assertTrue(_close(x2, self.X0, 1e-9), a)
            self.assertTrue(_close(o2, self.O0, 1e-7), a)

    def test_at_a_zero_table_the_frames_coincide(self):
        # The datum: table coords == machine coords at A = 0, which is why
        # every existing program (all of which define at A=0) is unaffected.
        z, x, o = to_table_frame(self.Z0, self.X0, self.O0, 0.0, Y_RA, Z_RA)
        self.assertTrue(_close(z, self.Z0))
        self.assertTrue(_close(x, self.X0))
        self.assertTrue(_close(o, self.O0))

    def test_the_two_directions_are_opposite_rotations(self):
        a = 25.0
        z_t, _x, _o = to_table_frame(self.Z0, self.X0, self.O0, a, Y_RA, Z_RA)
        z_m, _x2, _o2 = from_table_frame(self.Z0, self.X0, self.O0, a, Y_RA, Z_RA)
        # Equal and opposite about the table axis: neither is the identity,
        # and applying one then the other returns the original (above).
        self.assertFalse(_close(z_t, self.Z0, 1e-6))
        self.assertFalse(_close(z_m, self.Z0, 1e-6))
        self.assertFalse(_close(z_t, z_m, 1e-6))


class TestVectorTransform(unittest.TestCase):
    """to_table_frame_vector is rotation-ONLY: a free vector has no position,
    so the pivot line must never enter. Its defining property is that it
    equals the DIFFERENCE of two point transforms — for ANY pivot."""

    V = (17.0, -42.5, 88.25)
    P = (1350.0, -150.0, -1450.0)

    def test_vector_is_difference_of_point_transforms_for_any_pivot(self):
        z0, x0 = (0, 0, 1), (1, 0, 0)
        for a in (0.0, 20.0, 90.0, -33.25, 180.0):
            want = to_table_frame_vector(self.V, a)
            for py, pz in ((Y_RA, Z_RA), (0.0, 0.0), (123.4, -9876.5)):
                _z, _x, o_pv = to_table_frame(
                    z0, x0,
                    tuple(p + v for p, v in zip(self.P, self.V)),
                    a, py, pz)
                _z, _x, o_p = to_table_frame(z0, x0, self.P, a, py, pz)
                got = tuple(b - c for b, c in zip(o_pv, o_p))
                self.assertTrue(_close(got, want, 1e-8), (a, py, pz, got, want))

    def test_matches_the_point_paths_direction_vector_rotation(self):
        # to_table_frame rotates its DIRECTION vectors by exactly this
        # rotation — the vector helper must agree with it for unit vectors.
        for a in (0.0, 20.0, -70.0, 145.0):
            z, _x, _o = to_table_frame((0, 0, 1), (1, 0, 0), (0, 0, 0), a, Y_RA, Z_RA)
            self.assertTrue(_close(to_table_frame_vector((0, 0, 1), a), z, 1e-12), a)

    def test_round_trip(self):
        for a in (0.0, 20.0, 90.0, -33.25):
            self.assertTrue(_close(
                from_table_frame_vector(to_table_frame_vector(self.V, a), a),
                self.V, 1e-9), a)

    def test_a_zero_is_the_exact_identity(self):
        self.assertEqual(to_table_frame_vector(self.V, 0.0), self.V)

    def test_hand_computed_sense(self):
        # to_table_frame's sense is Rx(+a_now): (0,1,0) at a=90 -> (0,0,1).
        self.assertTrue(_close(to_table_frame_vector((0, 1, 0), 90.0),
                               (0.0, 0.0, 1.0), 1e-12))

    def test_point_path_on_a_vector_is_the_g683_bug(self):
        # Documents the defect class this helper exists for: pushing a free
        # vector through the POINT path adds (I - Rx(A))*pivot — ~776 mm at
        # A=20 with this config's pivot. If someone "simplifies" the vector
        # helper back onto to_table_frame, this pins the magnitude they are
        # reintroducing.
        a = 20.0
        _z, _x, o_pt = to_table_frame((0, 0, 1), (1, 0, 0), self.V, a, Y_RA, Z_RA)
        o_vec = to_table_frame_vector(self.V, a)
        err = _norm(tuple(b - c for b, c in zip(o_pt, o_vec)))
        th = math.radians(a)
        want = _norm((0.0,
                      (1 - math.cos(th)) * Y_RA + math.sin(th) * Z_RA,
                      -math.sin(th) * Y_RA + (1 - math.cos(th)) * Z_RA))
        self.assertAlmostEqual(err, want, places=6)
        self.assertGreater(err, 700.0)
        self.assertLess(err, 850.0)


class TestCalcShortestDistance(unittest.TestCase):
    """Extracted from remap.py; the elif chain is the fix — upstream's final
    `else` bound to `if mode == 2`, clobbering every mode-1 result."""

    def test_mode0_wraparound(self):
        self.assertAlmostEqual(calc_shortest_distance(170, -170, 0), 20.0)
        self.assertAlmostEqual(calc_shortest_distance(-170, 170, 0), -20.0)
        self.assertAlmostEqual(calc_shortest_distance(0, 90, 0), 90.0)

    def test_mode1_positive_only_takes_the_long_way(self):
        # The clobbered case: shortest is -90, positive-only must be +270.
        self.assertAlmostEqual(calc_shortest_distance(0, -90, 1), 270.0)
        self.assertAlmostEqual(calc_shortest_distance(0, 90, 1), 90.0)

    def test_mode2_negative_only_takes_the_long_way(self):
        self.assertAlmostEqual(calc_shortest_distance(0, 90, 2), -270.0)
        self.assertAlmostEqual(calc_shortest_distance(0, -90, 2), -90.0)

    def test_zero_move(self):
        self.assertAlmostEqual(calc_shortest_distance(35, 35, 0), 0.0)
        self.assertAlmostEqual(calc_shortest_distance(35, 35, 1), 0.0)
        # Upstream-inherited asymmetry, pinned deliberately: mode 2 treats
        # dist 0 as ">= 0, go the other way" and returns a full -360. The
        # extraction only fixes the else-binding; changing this would change
        # P2 semantics beyond what the fix claims.
        self.assertAlmostEqual(calc_shortest_distance(35, 35, 2), -360.0)


if __name__ == "__main__":
    unittest.main()
