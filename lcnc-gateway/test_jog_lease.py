"""The jog lease's decisions, pure (P1b, machine day 2026-11-21): jog_lease.py.

The gateway side over the real receive / queue / lock / write path is
test_jog_lease_gateway.py; these pin the table's rules on monotonic values
passed in: a deadline anchored at receipt, a renewal only for a lease still
alive, a dead lease never revived — by a renewal, a start under its id, or
a forgotten id — and the connection as part of the key."""
import unittest

import jog_lease as jl

TTL = jl.JOG_LEASE_TTL_S


class TestBegin(unittest.TestCase):
    def test_a_new_id_begins_at_receipt(self):
        t = jl.LeaseTable()
        lease, why = t.receive_start("c", 1, "link", now=10.0)
        self.assertIsNone(why)
        assert lease is not None
        self.assertEqual(lease.deadline, 10.0 + TTL)
        self.assertTrue(t.is_live(("c", 1), 10.0 + TTL - 1e-6))
        self.assertFalse(t.is_live(("c", 1), 10.0 + TTL), "the deadline itself is past")

    def test_a_frame_of_a_live_lease_renews_it(self):
        t = jl.LeaseTable()
        t.receive_start("c", 1, "link", now=10.0)
        lease, why = t.receive_start("c", 1, "link", now=10.4)
        self.assertIsNone(why)
        assert lease is not None
        self.assertAlmostEqual(lease.deadline, 10.4 + TTL)
        self.assertEqual(lease.renewals, 1)

    def test_a_start_under_a_dead_id_starts_nothing(self):
        t = jl.LeaseTable()
        t.receive_start("c", 1, "link", now=10.0)
        lease, why = t.receive_start("c", 1, "link", now=10.0 + TTL + 0.01)
        self.assertIsNone(lease)
        self.assertEqual(why, jl.JOG_LEASE_DEAD)
        self.assertEqual(t.get(("c", 1)).state, "expired")

    def test_a_forgotten_id_stays_dead(self):
        t = jl.LeaseTable()
        t.receive_start("c", 5, "link", now=1.0)
        t.end(("c", 5))
        t.forget(("c", 5))
        self.assertIsNone(t.get(("c", 5)))
        for lease_id in (5, 4, 1):
            with self.subTest(lease_id=lease_id):
                lease, why = t.receive_start("c", lease_id, "link", now=2.0)
                self.assertIsNone(lease)
                self.assertEqual(why, jl.JOG_LEASE_DEAD)
        lease, why = t.receive_start("c", 6, "link", now=2.0)
        self.assertIsNotNone(lease, "a higher id is a new gesture")

    def test_two_connections_with_one_id_are_two_leases(self):
        t = jl.LeaseTable()
        t.receive_start("a", 3, "link", now=1.0)
        t.receive_start("b", 3, "link", now=1.2)
        t.end(("a", 3))
        self.assertFalse(t.is_live(("a", 3), 1.3))
        self.assertTrue(t.is_live(("b", 3), 1.3))
        self.assertEqual(t.renew("b", [3], 1.4), [])
        self.assertEqual(t.renew("a", [3], 1.4), [3], "b's renewal never renews a's lease")


class TestRenew(unittest.TestCase):
    def test_a_renewal_before_the_deadline_moves_it(self):
        t = jl.LeaseTable()
        t.receive_start("c", 1, "link", now=0.0)
        self.assertEqual(t.renew("c", [1], 0.45), [])
        self.assertTrue(t.is_live(("c", 1), 0.9))

    def test_a_renewal_after_the_deadline_revives_nothing(self):
        """Read before the late timer: the deadline decides, never the
        order of the callbacks."""
        t = jl.LeaseTable()
        t.receive_start("c", 1, "link", now=0.0)
        self.assertEqual(t.renew("c", [1], TTL + 0.001), [1])
        self.assertFalse(t.is_live(("c", 1), TTL + 0.002))
        self.assertEqual(t.renew("c", [1], TTL + 0.003), [1], "and stays dead")
        self.assertIsNone(t.due(("c", 1), TTL + 0.004), "the late timer finds it dead")

    def test_renewals_delivered_late_in_a_batch_extend_nothing(self):
        """A page that hung sends its stored renewals at once: each is read
        after the deadline — none counts."""
        t = jl.LeaseTable()
        t.receive_start("c", 1, "link", now=0.0)
        late = TTL + 0.9
        dead = [t.renew("c", [1], late + i * 1e-4) for i in range(5)]
        self.assertTrue(all(d == [1] for d in dead))
        self.assertFalse(t.is_live(("c", 1), late))

    def test_unknown_and_ended_ids_are_answered_dead(self):
        t = jl.LeaseTable()
        t.receive_start("c", 1, "link", now=0.0)
        t.receive_start("c", 2, "link", now=0.0)
        t.end(("c", 2))
        self.assertEqual(t.renew("c", [1, 2, 9], 0.1), [2, 9])
        self.assertTrue(t.is_live(("c", 1), 0.5), "the live one in the same frame was renewed")


class TestTimerAndEnd(unittest.TestCase):
    def test_due_re_arms_for_what_a_renewal_added(self):
        t = jl.LeaseTable()
        t.receive_start("c", 1, "link", now=0.0)
        t.renew("c", [1], 0.3)
        left = t.due(("c", 1), TTL)
        self.assertAlmostEqual(left, 0.3)
        self.assertIsNone(t.due(("c", 1), 0.3 + TTL))
        self.assertEqual(t.get(("c", 1)).state, "expired")

    def test_an_ended_lease_is_not_live_and_not_expired(self):
        t = jl.LeaseTable()
        t.receive_start("c", 1, "link", now=0.0)
        t.end(("c", 1))
        self.assertFalse(t.is_live(("c", 1), 0.1))
        self.assertEqual(t.get(("c", 1)).state, "ended")
        t.due(("c", 1), 1.0)
        self.assertEqual(t.get(("c", 1)).state, "ended", "the end stays the reason")

    def test_forget_keeps_a_live_lease(self):
        t = jl.LeaseTable()
        t.receive_start("c", 1, "link", now=0.0)
        t.forget(("c", 1))
        self.assertIsNotNone(t.get(("c", 1)), "only a dead lease is forgotten")

    def test_dropping_a_connection_ends_its_leases_only(self):
        t = jl.LeaseTable()
        t.receive_start("a", 1, "link", now=0.0)
        t.receive_start("a", 2, "link", now=0.0)
        t.receive_start("b", 1, "link", now=0.0)
        gone = t.drop_connection("a")
        self.assertEqual(sorted(lz.lease_id for lz in gone), [1, 2])
        self.assertTrue(all(lz.state == "ended" and lz.ended_by == "disconnect" for lz in gone))
        # their stops are still owed (Codex R427 MT-I08): listed until settled
        self.assertEqual(sorted(lz.lease_id for lz in t.unsettled(("disconnect",), "a")), [1, 2])
        self.assertTrue(t.is_live(("b", 1), 0.1))
        self.assertFalse(t.is_live(("a", 1), 0.1), "nothing starts under them")
        for lz in gone:
            t.forget(lz.key)
        self.assertEqual(len(t), 1)

    def test_an_end_stops_starts_but_owes_its_stop(self):
        """MT-I08: ended is not settled — the lease stays listed (its timer
        stops what it owns at the deadline) until the stop ran."""
        t = jl.LeaseTable()
        t.receive_start("a", 1, "link", now=0.0)
        t.end(("a", 1), by="abort")
        self.assertFalse(t.is_live(("a", 1), 0.1))
        self.assertEqual([lz.lease_id for lz in t.unsettled(("abort",))], [1])
        self.assertEqual(t.unsettled(("estop",)), [])
        self.assertEqual(t.renew("a", [1], now=0.2), [1], "an ended lease is never renewed")
        self.assertEqual(t.get(("a", 1)).state, "ended", "a renewal does not turn it into expired")
        t.end(("a", 1), by="source")
        self.assertEqual(t.get(("a", 1)).ended_by, "abort", "the first end names it")


class TestWireForms(unittest.TestCase):
    def test_renew_ids(self):
        self.assertEqual(jl.parse_renew_ids([1, 2]), [1, 2])
        for bad in (None, [], "1", [0], [-1], [True], [1.5], ["1"], [2**53],
                    list(range(1, jl.RENEW_IDS_MAX + 2))):
            with self.subTest(bad=bad):
                self.assertIsNone(jl.parse_renew_ids(bad))

    def test_lease_id(self):
        self.assertEqual(jl.lease_id_of(7), 7)
        for bad in (None, 0, -3, True, 1.0, "7", 2**53):
            with self.subTest(bad=bad):
                self.assertIsNone(jl.lease_id_of(bad))

    def test_the_renewal_interval_fits_the_validity(self):
        """The page renews every 100 ms (jogLease.ts RENEW_MS); several may
        be lost before a healthy page's lease ends."""
        self.assertGreaterEqual(jl.JOG_LEASE_TTL_S / jl.JOG_RENEW_EXPECTED_S, 4)


if __name__ == "__main__":
    unittest.main()
