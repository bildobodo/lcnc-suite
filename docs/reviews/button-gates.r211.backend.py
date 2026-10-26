"""R211 independent contract probes; only fake LinuxCNC and temporary files.
Run from archived lcnc-gateway: python -m pytest -v -s test_codex_r211.py.
Assertions state the agreed contract, so counterexamples fail on fcc1b3d4.
"""
import asyncio
import json
import tempfile
import threading
from pathlib import Path
from unittest.mock import patch
import fake_linuxcnc
linuxcnc = fake_linuxcnc.install()
assert linuxcnc.__lcnc_fake__
import gateway
from settings_store import SettingsStore
from test_button_gates import _payload
from test_button_gates_b import _Admission, _FakeRequest, _FakeUpload, _Pending
from test_macros_gateway import _Folder, _body, FACE, rev

async def until(event):
    for _ in range(1000):
        if event.is_set(): return
        await asyncio.sleep(.002)
    raise AssertionError('probe synchronization timed out')

class TestMacroAdmission(_Folder):
    def setUp(self):
        super().setUp()
        for name, val in (('_source_lock', None), ('_rfl_task', None), ('_rfl_flag_task', None)):
            p = patch.object(gateway, name, val); p.start(); self.addCleanup(p.stop)
        p = patch.object(gateway._status_runtime, '_changing', False); p.start(); self.addCleanup(p.stop)

    def save_and_check(self):
        before = (self.mdir / 'face_top.ngc').read_bytes()
        async def run():
            try:
                return await gateway.put_macro(_body(FACE + '(review)\n'), name='face_top', base=rev(FACE),
                    rename_from=None, rename_base=None, x_conn_key=self.conn_key)
            except gateway.HTTPException as e:
                return {'http': e.status_code, 'detail': e.detail}
        result = asyncio.run(run())
        after = (self.mdir / 'face_top.ngc').read_bytes()
        print(json.dumps({'case': self._testMethodName, 'result': result, 'changed': after != before}))
        self.assertEqual(after, before, 'macro published while sourceWrite should be closed')

    def test_macro_during_program_load(self):
        gateway._status_runtime._changing = True
        self.assertIsNotNone(gateway._write_admission_refusal(self.conn_key))
        self.save_and_check()

    def test_macro_during_rfl_transaction(self):
        gateway._rfl_task = _Pending()
        self.assertIsNotNone(gateway._write_admission_refusal(self.conn_key))
        self.save_and_check()

class TestNoController(_Admission):
    def test_program_without_known_interpreter(self):
        with tempfile.TemporaryDirectory() as d, patch.object(gateway, 'STAT', None), \
             patch.object(gateway, 'lcnc_connected', False), \
             patch.object(gateway, 'get_nc_files_dir', lambda: d), \
             patch.object(gateway, '_program_name_refusal', lambda _: None):
            gateway._source_lock = None
            async def run():
                try: return await gateway.upload_gcode(_FakeUpload(b'G0 X1\n'), 0, x_conn_key=self.writer.conn_key)
                except gateway.HTTPException as e: return {'http': e.status_code}
            result = asyncio.run(run())
            changed = Path(d, 'prog.ngc').exists()
            print(json.dumps({'case': self._testMethodName, 'result': result, 'published': changed}))
            self.assertFalse(changed, 'STAT=None is not a known idle interpreter')

class TestWsToolCurrentWriter(_Admission):
    def test_disarm_during_table_read_is_seen_at_commit(self):
        gateway._shared_status = _payload()
        gateway._cmd_lock = None
        replies, writes = [], []
        def read(_):
            # Another task auto-disarms the client while file preparation is underway.
            self.writer.armed = False
            return [{'T': 1, 'P': 1, 'Z': 0., 'D': 3., 'remark': ''}]
        async def reply(ws, msg): replies.append(msg)
        async def reload(): pass
        with patch.object(gateway, 'parse_tool_table', read), \
             patch.object(gateway, 'get_tool_tbl_path', lambda: '/tmp/r211-unused.tbl'), \
             patch.object(gateway, 'write_tool_table', lambda *a: writes.append(a)), \
             patch.object(gateway, 'load_tool_library', lambda: {}), \
             patch.object(gateway, 'save_tool_library', lambda *a: None), \
             patch.object(gateway, '_reload_tool_table_and_bump', reload), \
             patch.object(gateway, 'ws_send_json', reply):
            asyncio.run(gateway._execute_client_command(901, self.writer, None,
                {'cmd': 'save_tool', 'tool_number': 1, 'z_offset': 12}))
        print(json.dumps({'case': self._testMethodName, 'armed_at_write': self.writer.armed,
                          'replies': replies, 'writes': len(writes)}))
        self.assertEqual(writes, [], 'dispatch-time armed=True survived disarm before write')

    def _cancel_case(self, ws_first=False):
        # The admitted first write may finish. It must not lose its lock to
        # a second import and publish a stale table over the latter's metadata.
        entered, release, finished = threading.Event(), threading.Event(), threading.Event()
        second_entered = threading.Event()
        gateway._cmd_lock = None
        order = []
        real_write = gateway.write_tool_table
        with tempfile.TemporaryDirectory() as d:
            table, meta = Path(d, 'tool.tbl'), Path(d, 'library.json')
            def write(path, tools):
                z = tools[0]['Z']
                if z == 12:
                    entered.set()
                    if not release.wait(5): raise AssertionError('release timeout')
                else: second_entered.set()
                real_write(path, tools)
                order.append(f'table Z{z}')
                if z == 12: finished.set()
            async def reload(): order.append('reload')
            def save(library):
                meta.write_text(json.dumps(library))
                order.append(f'metadata {library["writer"]}')
            def row(z): return [{'T': 1, 'P': 1, 'Z': z, 'D': 3., 'remark': ''}]
            real_write(str(table), row(0))
            gateway._shared_status = _payload()
            async def reply(ws, msg): order.append('reply')
            async def run():
                first = (gateway._execute_client_command(901, self.writer, None,
                         {'cmd': 'save_tool', 'tool_number': 1, 'z_offset': 12}) if ws_first else
                         gateway._persist_imported_tools(str(table), row(12), {'writer': 'A'}, self.writer.conn_key))
                a = asyncio.create_task(first)
                b = None
                try:
                    await until(entered)
                    a.cancel()
                    await asyncio.sleep(.02)
                    locked = gateway._get_cmd_lock().locked()
                    b = asyncio.create_task(gateway._persist_imported_tools(str(table), row(99), {'writer': 'B'}, self.writer.conn_key))
                    await asyncio.sleep(.04)
                    overtook = second_entered.is_set()
                finally:
                    release.set()
                    try: await a
                    except asyncio.CancelledError: pass
                    await until(finished)
                    if b is not None: await b
                print(json.dumps({'case': self._testMethodName, 'lock_while_thread_waits': locked,
                    'second_import_overtook': overtook, 'order': order,
                    'table': table.read_text(), 'metadata': json.loads(meta.read_text())}))
                self.assertFalse(overtook, 'second import overtook a cancelled but still writing first import')
            with patch.object(gateway, 'get_tool_tbl_path', lambda: str(table)), \
                 patch.object(gateway, 'ws_send_json', reply), \
                 patch.object(gateway, 'write_tool_table', write), \
                 patch.object(gateway, 'save_tool_library', save), \
                 patch.object(gateway, '_reload_tool_table_and_bump', reload):
                asyncio.run(run())

    def test_cancel_keeps_http_table_serialization(self): self._cancel_case()
    def test_cancel_keeps_ws_table_serialization(self): self._cancel_case(ws_first=True)

class TestSettingsCommit(_Admission):
    def _case(self, reset=False, disconnect=False, retain_arm=False):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d, 'settings.json')
            store = SettingsStore(path, lambda: 'probe.ini')
            store.save_section('keyboard', {'jogEnabled': False})
            before = path.read_bytes()
            entered = threading.Event()
            store._lock.acquire()  # a preceding writer is still in the store
            original = gateway.reset_settings if reset else gateway.save_settings_section
            def blocked(*args):
                entered.set()     # gateway admission ran; the store lock has NOT been taken
                return original(*args)
            async def run():
                if reset: t = asyncio.create_task(gateway.delete_settings(x_conn_key=self.writer.conn_key))
                else: t = asyncio.create_task(gateway.put_settings_section('keyboard',
                    _FakeRequest({'data': {'jogEnabled': True}}), x_conn_key=self.writer.conn_key))
                try:
                    await until(entered)
                    if disconnect: gateway._clients.pop(901)
                    elif not retain_arm: self.writer.armed = False
                finally:
                    store._lock.release()
                return await t
            with patch.object(gateway, '_settings_store', store), \
                 patch.object(gateway, 'reset_settings' if reset else 'save_settings_section', blocked):
                result = asyncio.run(run())
            changed = before != path.read_bytes()
            print(json.dumps({'case': self._testMethodName, 'result': str(result), 'changed': changed,
                              'on_disk': json.loads(path.read_text())}))
            self.assertEqual(changed, retain_arm, 'settings admission preceded the store lock wait')

    def test_disarm_while_settings_wait_for_store_lock(self): self._case()
    def test_disconnect_while_settings_wait_for_store_lock(self): self._case(disconnect=True)
    def test_disarm_while_reset_waits_for_store_lock(self): self._case(reset=True)

    def test_control_connected_armed_settings_save(self): self._case(retain_arm=True)
    def test_control_connected_armed_reset(self): self._case(reset=True, retain_arm=True)
