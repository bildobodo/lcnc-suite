"""R430: failure kills one lease, leaves its other stops and a new booking intact."""
import gateway
from test_jog_lease_gateway import _Lease, JS, linuxcnc


class TestR430FailureClass(_Lease):
    def failed_x(self):
        attempts = []
        def jog(*args):
            if args[0] == JS:
                attempts.append(args)
                if args[2] == 0 and sum(a[2] == 0 for a in attempts) == 1:
                    raise linuxcnc.error("X stop refused")
            self.cmd.calls.append(("jog", args, {}))
        self.cmd.jog = jog
        return attempts

    def test_r430_failed_x_leaves_y_owed_and_refuses_renewal(self):
        msg = self.receive({"cmd":"jog_cont_multi", "lease":1,
                            "axes":[{"axis":0,"vel":5.0},{"axis":1,"vel":5.0}]})
        self.assertTrue(self.send_as(msg)["ok"])
        attempts = self.failed_x()
        self.assertEqual(self.change(1, [0], []).get("stop_failed"), [0])
        lease = self.lease(1)
        self.assertEqual((lease.state, lease.ended_by), ("ended", "stop_failed"))
        deadline = lease.deadline
        self.receive({"cmd":"jog_renew", "lease":1})
        self.assertEqual(lease.deadline, deadline)
        self.expire(1)
        self.assertEqual([a[2] for a in attempts], [0, 1])
        self.assertNotIn(1, gateway._active_jogs)
        self.assertIn(0, gateway._active_jogs)
        self.end(1)
        self.assertEqual([a[2] for a in attempts], [0, 1])

    def test_r430_new_gesture_on_failed_axis_owes_its_own_stop(self):
        self.assertTrue(self.jog(1)["ok"])
        attempts = self.failed_x()
        self.assertEqual(self.change(1, [0], []).get("stop_failed"), [0])
        old = gateway._jog_stop_failed[0]
        self.assertTrue(self.jog(2, vel=-5.0)["ok"])
        self.assertNotEqual(gateway._jog_row_owner(gateway._active_jogs[0]), old)
        self.assertNotIn(0, gateway._jog_stop_failed)
        self.end(1)
        self.assertEqual([a[2] for a in attempts], [0])
        self.expire(2)
        self.assertEqual([a[2] for a in attempts], [0, 0])
        self.assertNotIn(0, gateway._active_jogs)
