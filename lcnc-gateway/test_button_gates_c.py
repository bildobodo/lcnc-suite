"""Button gates package C (BG-01): with the outer armed fieldset gone, a
disarmed client reaches every control its catalog gate leaves open — what
needs arm, the gateway refuses itself. Shutdown ends LinuxCNC: it relied on
the client's `armed` catalog gate alone (command_policy said "always", the
handler had no require_armed), so any connected tab could send it."""
import unittest
from unittest import mock

import fake_linuxcnc
linuxcnc = fake_linuxcnc.install()

import gateway  # noqa: E402
from command_policy import COMMAND_GATES, NOT_ARMED  # noqa: E402
from test_button_gates import _Handlers  # noqa: E402


class TestShutdownNeedsArm(_Handlers):
    def setUp(self):
        super().setUp()
        self.calls = []
        p = mock.patch.object(gateway, "_request_process_shutdown", lambda why: self.calls.append(why))
        p.start()
        self.addCleanup(p.stop)

    def test_the_policy_names_arm(self):
        self.assertEqual(COMMAND_GATES["shutdown"], "armed")

    def test_a_disarmed_client_cannot_shut_down(self):
        r = self._send({"cmd": "shutdown"}, armed=False)
        self.assertFalse(r["ok"], r)
        self.assertIn(NOT_ARMED, r["error"])
        self.assertEqual(self.calls, [])

    def test_an_armed_client_shuts_down(self):
        r = self._send({"cmd": "shutdown"}, armed=True)
        self.assertTrue(r["ok"], r)
        self.assertEqual(self.calls, ["web UI shutdown"])


if __name__ == "__main__":
    unittest.main()
