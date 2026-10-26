"""R212: independent late-cancel and store-admission probes.
Only fake LinuxCNC, fake command channel and temporary files; no live sockets.
"""
import asyncio
import json
import tempfile
import threading
import time
from pathlib import Path
from unittest.mock import patch
import fake_linuxcnc
linuxcnc = fake_linuxcnc.install()
assert linuxcnc.__lcnc_fake__
import gateway
from settings_store import SettingsStore
from test_button_gates import _payload
from test_button_gates_b import _Admission, _FakeRequest
from ws_fanout import ClientState

async def until(event):
    for _ in range(1000):
        if event.is_set(): return
        await asyncio.sleep(.002)
    raise AssertionError('probe synchronization timed out')

class TestLatePreemption(_Admission):
    def case(self, stage, kind):
        gateway._cmd_lock = None
        gateway._shared_status = _payload()
        entered, release = threading.Event(), threading.Event()
        order, replies = [], []
        def pause(at):
            if stage == at:
                entered.set()
                if not release.wait(5): raise AssertionError('test release missing')
        class Cmd:
            def load_tool_table(self):
                pause('reload')
                order.append('reload')
            def abort(self): order.append('abort')
        with tempfile.TemporaryDirectory() as d:
            table, meta = Path(d,'tool.tbl'), Path(d,'library.json')
            row=lambda z:[{'T':1,'P':1,'Z':z,'D':3.,'remark':''}]
            real_write=gateway.write_tool_table
            real_write(str(table),row(0))
            def write(path,rows):
                real_write(path,rows)
                order.append('table')
            def read():
                pause('metadata-read')
                return {'writer':'A'}
            def save(data):
                pause('metadata-write')
                meta.write_text(json.dumps(data))
                order.append('metadata')
            async def reply(ws,msg): replies.append(msg)
            observer=ClientState(ip='observer',ws=None,armed=False)
            async def run():
                op=(gateway._execute_client_command(901,self.writer,None,
                     {'cmd':'save_tool','tool_number':1,'z_offset':12,'req_id':'edit'})
                    if kind=='ws' else
                    gateway._persist_imported_tools(str(table),row(12),{'writer':'A'},self.writer.conn_key))
                task=asyncio.create_task(op)
                if kind=='ws':
                    self.writer.cmd_inflight_task=task
                    self.writer.cmd_inflight='save_tool'
                    self.writer.cmd_inflight_since_mono=time.monotonic()
                stop=None
                try:
                    await until(entered)
                    # WS: the actual preemption entry; HTTP: cancellation of
                    # its request task (HTTP requests are not WS inflight work).
                    for _ in range(2):
                        if kind=='ws':
                            self.assertEqual(gateway._preempt_inflight(by='abort',from_client=902),1)
                        else: task.cancel()
                        await asyncio.sleep(.01)
                    stop=asyncio.create_task(gateway._execute_client_command(902,observer,None,
                        {'cmd':'abort','req_id':'stop'}))
                    await asyncio.sleep(.02)
                    self.assertTrue(gateway._get_cmd_lock().locked())
                    self.assertNotIn('abort',order)
                    self.assertFalse(task.done())
                finally:
                    release.set()
                    try: await task
                    except asyncio.CancelledError: pass
                    if stop is not None: await stop
                self.assertEqual(order,['table','reload','metadata','abort'])
                self.assertTrue(any(x.get('req_id')=='stop' and x['ok'] for x in replies))
                self.assertTrue(task.cancelled())
                self.assertIn('12.000000',table.read_text())
                self.assertEqual(json.loads(meta.read_text())['writer'],'A')
                print(json.dumps({'case':self._testMethodName,'kind':kind,'stage':stage,
                    'order':order,'stop_reply':replies[-1]}))
            with patch.object(gateway,'CMD',Cmd()), \
                 patch.object(gateway,'get_tool_tbl_path',lambda:str(table)), \
                 patch.object(gateway,'write_tool_table',write), \
                 patch.object(gateway,'load_tool_library',read), \
                 patch.object(gateway,'save_tool_library',save), \
                 patch.object(gateway,'ws_send_json',reply):
                asyncio.run(run())
    def test_ws_cancel_in_reload(self): self.case('reload','ws')
    def test_ws_cancel_in_metadata_read(self): self.case('metadata-read','ws')
    def test_ws_cancel_in_metadata_write(self): self.case('metadata-write','ws')
    def test_http_cancel_in_reload(self): self.case('reload','http')
    def test_http_cancel_in_metadata_write(self): self.case('metadata-write','http')

class TestSettingsPreparation(_Admission):
    def case(self, mode, free=False):
        with tempfile.TemporaryDirectory() as d:
            path=Path(d,'settings.json')
            def ini():
                # This preparation runs AFTER the store lock is taken.
                # Admission must still be after it, not merely after the lock.
                self.writer.armed=False
                return 'probe.ini'
            store=SettingsStore(path,ini)
            section='panels' if free else 'keyboard'
            with patch.object(gateway,'_settings_store',store):
                if mode=='reset':
                    result=asyncio.run(gateway.delete_settings(x_conn_key=self.writer.conn_key))
                elif mode=='ws':
                    result=asyncio.run(gateway._ws_save_settings(self.writer,
                        {'cmd':'save_settings','section':section,'data':{'x':1},'req_id':'draft'}))
                else:
                    result=asyncio.run(gateway.put_settings_section(section,_FakeRequest({'data':{'x':1}}),
                        x_conn_key=self.writer.conn_key))
            self.assertEqual(path.exists(),free)
            self.assertEqual(store.version,1 if free else 0)
            if mode=='ws':
                self.assertEqual(result['ok'],free)
                self.assertEqual(result['req_id'],'draft')
            elif not free: self.assertEqual(result.status_code,403)
            print(json.dumps({'case':self._testMethodName,'mode':mode,'free':free,
                'version':store.version,'exists':path.exists()}))
    def test_ws_admission_after_store_preparation(self): self.case('ws')
    def test_http_admission_after_store_preparation(self): self.case('http')
    def test_empty_reset_still_admits_and_never_bumps_on_refusal(self): self.case('reset')
    def test_display_control_stays_free(self): self.case('ws',free=True)

class TestMetadataRefreshCancellation(_Admission):
    def test_two_cancels_keep_the_lock_and_publish_the_refresh_version(self):
        entered, release = threading.Event(), threading.Event()
        gateway._cmd_lock = None
        with tempfile.TemporaryDirectory() as d:
            path=Path(d,'metadata.json')
            def save(data,ini_key=None):
                entered.set()
                if not release.wait(5): raise AssertionError('release missing')
                path.write_text(json.dumps(data))
            async def operation():
                async with gateway._get_cmd_lock():
                    await gateway._save_refreshed_metadata({'library':{'writer':'refresh'},'ini_key':'probe.ini'},
                        self.writer.conn_key)
            async def run():
                task=asyncio.create_task(operation())
                try:
                    await until(entered)
                    for _ in range(2):
                        task.cancel()
                        await asyncio.sleep(.01)
                    self.assertTrue(gateway._get_cmd_lock().locked())
                    self.assertFalse(task.done())
                finally:
                    release.set()
                    try: await task
                    except asyncio.CancelledError: pass
                self.assertEqual(json.loads(path.read_text()),{'writer':'refresh'})
                self.assertEqual(gateway._tool_table_version,301)
                self.assertTrue(gateway._tool_meta_dirty)
                self.assertFalse(gateway._get_cmd_lock().locked())
                print(json.dumps({'case':self._testMethodName,'version':gateway._tool_table_version,
                                  'dirty':gateway._tool_meta_dirty,'cancelled':task.cancelled()}))
            with patch.object(gateway,'save_tool_library',save), \
                 patch.object(gateway,'_tool_table_version',300), \
                 patch.object(gateway,'_tool_meta_dirty',False):
                asyncio.run(run())
