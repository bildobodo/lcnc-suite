"""R496: the last table read cannot outlive the writer/owner admission.
Real dispatcher, isolated FakeConnection. No live/NML connection.
"""
import json
import threading
from unittest.mock import patch

from test_tool_load_gateway import _Load, gateway


class TestR496AfterTableRead(_Load):
    def attempt(self, kind):
        self.hand_edit()
        msg = self.message()
        real_admit = gateway._write_admission_refusal
        real_table = gateway._stat_tool_table
        phase = threading.local()
        reached = []

        def admit(*args, **kwargs):
            phase.last = kwargs.get('controller') is not None
            try:
                return real_admit(*args, **kwargs)
            finally:
                phase.last = False

        def table(*args, **kwargs):
            got = real_table(*args, **kwargs)
            if getattr(phase, 'last', False) and not reached:
                reached.append(True)
                self.assertEqual(self.io.loads, 0)
                if kind == 'disarmed':
                    self.writer.armed = False
                elif kind == 'new owner':
                    self.another()
                elif kind == 'unread table':
                    return None
            return got

        with patch.object(gateway, '_write_admission_refusal', admit), \
                patch.object(gateway, '_stat_tool_table', table):
            reply = self.send(msg)
        self.assertEqual(reached, [True])
        print('R496', json.dumps({'case': kind, 'reply': reply, 'loads': self.io.loads,
                                 'other_loads': [x.loads for x in self.others]}, ensure_ascii=False))
        return reply

    def test_disarm_during_last_table_read_refuses(self):
        self.not_requested(self.attempt('disarmed'), gateway.NOT_ARMED)

    def test_owner_change_during_last_table_read_refuses(self):
        self.not_requested(self.attempt('new owner'), gateway.LINK_CHANGED)

    def test_unread_last_table_refuses(self):
        reply = self.attempt('unread table')
        self.assertFalse(reply['ok'])
        self.assertEqual(self.io.loads, 0)
        self.assertNotIn('load', reply)

    def test_unchanged_last_table_requests_once(self):
        reply = self.attempt('unchanged')
        self.assertTrue(reply['ok'])
        self.assertEqual(reply['load'], 'requested')
        self.assertEqual(self.io.loads, 1)
