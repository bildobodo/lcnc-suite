"""Independent R468 probes. Fake controller only; actual gateway read/write paths."""
import json
import unittest
from unittest.mock import patch

from test_tool_proof_gateway import _Tools, TABLE, gateway
from tool_store import ToolLibraryUnreadable
from link_fixture import swap_connection, current, FakeConnection


class CodexR468(_Tools):
    def test_control_cold_strict_library_refuses_array(self):
        self.store._path.write_text('[]')
        r = self.read()
        print('cold-array', json.dumps(r))
        self.assertFalse(r['ok'])
        self.assertIn('not an object', r['error'])

    def test_warm_strict_library_refuses_array(self):
        self.store._path.write_text('[]')
        self.assertEqual(self.store.load(), {})  # the status reader
        r = self.read()
        print('warm-array', json.dumps(r))
        self.assertFalse(r['ok'], 'strict read must not depend on status-cache history')

    def test_store_strict_cache_hit_checks_top_level(self):
        self.store._path.write_text('[]')
        self.store.load()
        with self.assertRaises(ToolLibraryUnreadable):
            self.store.load(True)

    def test_controller_revoked_after_table_proof(self):
        real = self.store.load

        def load(strict=False):
            result = real(strict)
            if strict:
                swap_connection(None)
            return result

        with patch.object(self.store, 'load', load):
            r = self.read()
        print('revoked-after-proof', json.dumps(r))
        self.assertFalse(r.get('ok') and r.get('proof', {}).get('state') == 'complete',
                         'proof must retain its controller binding through publication')

    def test_controller_replaced_after_table_proof(self):
        real = self.store.load
        new = FakeConnection()
        new.stat.tool_table = ()

        def load(strict=False):
            result = real(strict)
            if strict:
                swap_connection(new)
            return result

        with patch.object(self.store, 'load', load):
            r = self.read()
        print('replaced-after-proof', json.dumps(r))
        self.assertFalse(r.get('ok') and r.get('proof', {}).get('state') == 'complete')

    def test_disarm_during_writer_table_check_prevents_write(self):
        msg = {'cmd': 'save_tool', 'tool_number': 1, 'z_offset': 49.0, 'expected': self.expect(1)}
        real = gateway._stat_tool_table
        calls = []

        def table(*a, **kw):
            result = real(*a, **kw)
            calls.append(1)
            if len(calls) == 2:  # basis read first, writer's own rule-R check second
                self.writer.armed = False
            return result

        before = self.table.read_bytes()
        with patch.object(gateway, '_stat_tool_table', table):
            r = self.send(msg)
        print('disarm-at-writer-check', json.dumps({'reply': r, 'loads': self.io.loads,
              'checks': len(calls), 'bytes_changed': self.table.read_bytes() != before}))
        self.assertEqual(self.table.read_bytes(), before, 'the revoked writer must write nothing')
        self.assertEqual(self.io.loads, 0)

    def test_control_unchanged_connection_reads_complete(self):
        r = self.read()
        self.assertTrue(r['ok'])
        self.assertEqual(r['proof']['state'], 'complete')
        self.assertEqual(self.table.read_text(), TABLE)


if __name__ == '__main__':
    unittest.main(verbosity=2)
