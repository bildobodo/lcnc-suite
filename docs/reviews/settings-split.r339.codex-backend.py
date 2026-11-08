"""R338 boundary probes: real store/handlers, fake controller, no live access."""
import asyncio
import json
import tempfile
import threading
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
import fake_linuxcnc
fake_linuxcnc.install()
import gateway
from settings_store import SettingsStore, UnknownDevice


class R338(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.store = SettingsStore(Path(self.tmp.name) / 'settings.json', lambda: 'fixture.ini')
        self.a, _ = self.store.bind('a' * 32, 'review-A')
        self.b, _ = self.store.bind('b' * 32, 'review-B')
        self.admin = SimpleNamespace(device_id=self.a, conn_key='admin-A', device_bound=True)
        self.clients = {1: self.admin}
        for name, value in [('_settings_store', self.store), ('_clients', self.clients),
                            ('_writer_refusal', lambda _key: None)]:
            p = patch.object(gateway, name, value); p.start(); self.addCleanup(p.stop)

    def test_foreign_reply_has_no_target(self):
        self.store.save_section('simulation', {'enabled': True}, device=self.b, base_rev=0, writer='B')
        r = asyncio.run(gateway._ws_save_settings(self.admin, {
            'cmd':'save_settings','device':self.b,'section':'simulation',
            'data':{'enabled':False},'base_rev':0,'req_id':'foreign-conflict'}))
        print('FOREIGN_STALE', json.dumps(r))
        self.assertFalse(r['ok'])
        self.assertTrue(r['stale'])
        self.assertEqual(r['data'], {'enabled':True})
        self.assertEqual(self.store.view_for(self.a)['settings']['simulation'], {'enabled':False})

    def test_control_connected_profile_delete_is_refused(self):
        self.clients[2] = SimpleNamespace(device_id=self.b)
        r = asyncio.run(gateway._ws_device_command(self.admin, {'cmd':'device_delete', 'device':self.b}))
        self.assertFalse(r['ok'])
        self.assertEqual(self.store.find_device('b'*32), self.b)

    def test_bind_and_delete_have_one_presence_commit(self):
        """Stop in the normal gap after bind's file commit, before its result
        reaches the event loop. The delete runs through its real lock/admit."""
        bound = threading.Event(); release = threading.Event()
        original = self.store.bind
        newcomer = SimpleNamespace(device_id=None, device_bound=False, conn_key='new-B')
        self.clients[2] = newcomer
        def bind_then_wait(token, addr, claim=None):
            result = original(token, addr, claim)
            bound.set()
            if not release.wait(5):
                raise AssertionError('test synchronization timed out')
            return result
        async def run():
            t = asyncio.create_task(gateway._bind_device(newcomer, 2, 'review-B', {'device_token':'b'*32}))
            try:
                for _ in range(500):
                    if bound.is_set(): break
                    await asyncio.sleep(.002)
                self.assertTrue(bound.is_set())
                removed = await gateway._ws_device_command(self.admin, {'cmd':'device_delete','device':self.b})
            finally:
                release.set()
            await t
            return removed
        with patch.object(self.store, 'bind', bind_then_wait):
            r = asyncio.run(run())
        actual = {'delete_ok':r['ok'], 'bound_id':newcomer.device_id,
                  'stored_id':self.store.find_device('b'*32),
                  'view_id':self.store.view_for(newcomer.device_id)['device']['id']}
        print('BIND_DELETE', json.dumps(actual))
        self.assertTrue(not r['ok'] or newcomer.device_id is None
                        or self.store.find_device('b'*32) == newcomer.device_id,
                        'successful binding must not refer to a deleted profile')

    def test_rename_is_a_real_change_in_the_device_list(self):
        self.store.rename_device(self.b, 'Panel B')
        row = next(x for x in self.store.list_devices() if x['id'] == self.b)
        self.assertTrue(row['changed'])

if __name__ == '__main__':
    unittest.main(verbosity=2)
