"""R277 independent gateway checks, fake LinuxCNC only; retain the real policy.
Run in an archive of b3e15974 via pytest (conftest installs the fake).
"""
from unittest.mock import patch
import test_button_gates as base
import gateway


class TestCompensationWithPolicy(base._Handlers):
    def call(self, msg, outcome=True, armed=True, **status):
        sent = []
        with patch.object(gateway, '_hal_send', lambda message: sent.append(message) or outcome):
            reply = self._send(msg, armed=armed, **status)
        return reply, sent

    def test_valid_values_and_transport_outcomes(self):
        for msg in [dict(cmd='set_compensation', enable=True), dict(cmd='set_compensation', enable=False),
                    *[dict(cmd='set_compensation_method', method=m) for m in [0, 1, 2]]]:
            for outcome in [True, False, None]:
                with self.subTest(msg=msg, outcome=outcome):
                    reply, sent = self.call(msg, outcome)
                    self.assertEqual(reply['ok'], outcome is True, reply)
                    self.assertEqual(len(sent), 1)

    def test_omitted_or_invalid_values_send_nothing(self):
        for msg in [dict(cmd='set_compensation'),
                    *[dict(cmd='set_compensation', enable=v) for v in [None, 0, 1, '', 'false', [], {}]],
                    dict(cmd='set_compensation_method'),
                    *[dict(cmd='set_compensation_method', method=v) for v in [None, -1, 3, '', 'invalid']]]:
            with self.subTest(msg=msg):
                reply, sent = self.call(msg)
                self.assertFalse(reply['ok'], reply)
                self.assertEqual(sent, [])

    def test_policy_still_blocks_and_disable_remains_possible(self):
        for msg in [dict(cmd='set_compensation', enable=False), dict(cmd='set_compensation_method', method=0)]:
            reply, sent = self.call(msg, armed=False)
            self.assertFalse(reply['ok'], reply)
            self.assertEqual(sent, [])
        for tilt in [False, None]:
            reply, sent = self.call(dict(cmd='set_compensation', enable=True), rotary_at_zero=tilt)
            self.assertFalse(reply['ok'], reply)
            self.assertEqual(sent, [])
            reply, sent = self.call(dict(cmd='set_compensation', enable=False), rotary_at_zero=tilt)
            self.assertTrue(reply['ok'], reply)
            self.assertEqual(sent, [{'compensation_enable': False}])
        reply, sent = self.call(dict(cmd='set_compensation_method', method=0), eoffset_enabled=None)
        self.assertFalse(reply['ok'], reply)
        self.assertEqual(sent, [])
