"""R470 independent commit/migration boundary probes. Fake LinuxCNC only.
Run with PYTHONPATH=/tmp/r470/tree/lcnc-gateway python -m unittest -v probe.
The assertions express the expected contract, so failures are review evidence.
"""
import asyncio
import json
from unittest.mock import patch

import test_cal_gateway as tc
from link_fixture import FakeConnection, swap_connection
from settings_store import SettingsStore

g = tc.gateway


class BoundaryProbes(tc._Base):
    def dynamic_store(self, legacy=False):
        path = self.dir / 'dynamic-settings.json'
        if legacy:
            path.write_text(json.dumps({str(self.ini): {'probe': {'calOffset': .2, 'slowFr': 50}}}))
        store = SettingsStore(path, g._current_ini_path)
        p = patch.object(g, '_settings_store', store)
        p.start()
        self.addCleanup(p.stop)
        g._cal_record_read = (None, None)
        if not legacy:
            store.write_calibration({'value': .2, 'unit': 'mm', 'state': 'active'}, lambda *_: None)
        return store, path

    def restore_link(self):
        swap_connection(FakeConnection(stat=self.stat, cmd=self.cmd, err=self.err))

    def test_reset_control(self):
        store, path = self.dynamic_store()
        r = self.send({'cmd': 'cal_reset'})
        self.assertTrue(r['ok'], r)
        self.assertEqual(store.calibration()['value'], 0)
        self.assertNotIn('default', json.loads(path.read_text()))

    def test_reset_revoked_before_store_commit_must_write_no_profile(self):
        store, path = self.dynamic_store()
        before = path.read_bytes()
        original = store.write_calibration

        def revoke_then_write(record, admit):
            swap_connection(None)
            return original(record, admit)

        with patch.object(store, 'write_calibration', revoke_then_write):
            r = self.send({'cmd': 'cal_reset'})
        print(json.dumps({'case': 'reset_link_loss', 'reply': r, 'stored': json.loads(path.read_text()),
                          'controller_writes': self.cmd.calls}), flush=True)
        self.assertEqual(path.read_bytes(), before, 'Reset lost its owning Link before the settings commit')
        self.assertFalse(r['ok'], r)

    def test_migration_control(self):
        store, _path = self.dynamic_store(legacy=True)
        asyncio.run(g._cal_migrate_once())
        self.assertEqual(store.calibration()['value'], .2)
        self.assertEqual(store.calibration()['unit'], 'mm')

    def test_migration_link_loss_must_not_mark_original_ini_done(self):
        store, path = self.dynamic_store(legacy=True)
        original = store.migrate_calibration

        def revoke_then_migrate(unit):
            swap_connection(None)
            return original(unit)

        with patch.object(store, 'migrate_calibration', revoke_then_migrate):
            asyncio.run(g._cal_migrate_once())
        self.restore_link()
        # A later status cycle retries for the actual machine.
        asyncio.run(g._cal_migrate_once())
        print(json.dumps({'case': 'migration_link_loss', 'stored': json.loads(path.read_text()),
                          'migration_marks': g._cal_migrated, 'original_record': store.calibration()}), flush=True)
        self.assertIsNotNone(store.calibration(), 'the original INI has been marked done without its migration')
        self.assertEqual(store.calibration()['value'], .2)

    def test_old_page_save_before_migration_must_preserve_legacy_offset(self):
        store, path = self.dynamic_store(legacy=True)
        # A save wins the store lock before the first status-cycle migration.
        # The old page changes only a feed; its calibration value is unchanged.
        r = self.send({'cmd': 'save_settings', 'section': 'probe',
                       'data': {'calOffset': .2, 'slowFr': 60}, 'base_rev': 0})
        self.assertTrue(r['ok'], r)
        asyncio.run(g._cal_migrate_once())
        print(json.dumps({'case': 'legacy_save_first', 'reply': r, 'stored': json.loads(path.read_text())}), flush=True)
        self.assertEqual(store.calibration()['value'], .2, 'migration must read the old offset before a save drops it')


if __name__ == '__main__':
    import unittest
    unittest.main(verbosity=2)
