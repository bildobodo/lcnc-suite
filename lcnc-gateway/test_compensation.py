"""Surface compensation answers by its delivery (Codex R265, the function
inventory's F-COMP S3): only a message written in full is ok — nothing written
says so, an unclear send is never ok — and a request names its value: no
default stands in for a missing switch or method."""
import unittest
import unittest.mock

import gateway
import test_button_gates as base


class TestCompensationDelivery(base._Handlers):
    def _set(self, msg, outcome):
        sent = []
        with unittest.mock.patch.object(gateway, "_hal_send", lambda m: sent.append(m) or outcome), \
                unittest.mock.patch.object(gateway, "check_command", lambda *_a: None):
            r = self._send(msg)
        return r, sent

    def test_a_delivered_request_is_ok(self):
        for msg, pin in (({"cmd": "set_compensation", "enable": True}, {"compensation_enable": True}),
                         ({"cmd": "set_compensation", "enable": False}, {"compensation_enable": False}),
                         ({"cmd": "set_compensation_method", "method": 1}, {"compensation_method": 1})):
            with self.subTest(msg=msg):
                self.assertEqual(self._set(msg, True), ({"ok": True}, [pin]))

    def test_nothing_written_is_not_sent(self):
        for msg in ({"cmd": "set_compensation", "enable": False}, {"cmd": "set_compensation_method", "method": 0}):
            with self.subTest(msg=msg):
                r, _ = self._set(msg, False)
                self.assertEqual(r, {"ok": False, "error": "Compensation not sent — try again"})

    def test_an_unclear_send_is_never_ok(self):
        for msg in ({"cmd": "set_compensation", "enable": True}, {"cmd": "set_compensation_method", "method": 2}):
            with self.subTest(msg=msg):
                r, _ = self._set(msg, None)
                self.assertEqual(r, {"ok": False, "error": "Compensation unclear — check the display"})

    def test_a_missing_value_sends_nothing(self):
        for msg, error in (({"cmd": "set_compensation"}, "Compensation not sent — on or off missing"),
                           ({"cmd": "set_compensation", "enable": "yes"}, "Compensation not sent — on or off missing"),
                           ({"cmd": "set_compensation_method"}, "Method not sent — none given")):
            with self.subTest(msg=msg):
                self.assertEqual(self._set(msg, True), ({"ok": False, "error": error}, []))


if __name__ == "__main__":
    unittest.main()
