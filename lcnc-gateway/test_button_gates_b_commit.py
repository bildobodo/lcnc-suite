"""Button gates package B, Codex R211 (BG-22 – BG-26): where a write's
commit-time admission decides, and on what.

- BG-22: an ADMITTED tool-table persist — the file, the reload, the
  metadata — ends under _cmd_lock even when its handler is cancelled (an
  abort preempts WS handlers); no second writer runs inside it.
- BG-23: a WS tool edit names its connection; the write reads that
  connection's CURRENT arm, never the bool the dispatcher saw.
- BG-24: a settings save and the global reset decide inside the store's
  lock, right before the write — a refusal writes nothing and bumps nothing.
- BG-25: a macro write runs the whole sourceWrite rule: a load or a run from
  line in progress refuses it as it refuses a program write.
- BG-26: no controller status (STAT None) is no known idle interpreter.

Adopted from Codex's R211 probes (docs/reviews/button-gates.r211.backend.py
on feat/backlog-integration); fake LinuxCNC and temporary files only.
"""
import asyncio
import json
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

import fake_linuxcnc
linuxcnc = fake_linuxcnc.install()

import gateway  # noqa: E402
from link_fixture import without_connection  # noqa: E402
from command_policy import NOT_ARMED, STATE_UNKNOWN  # noqa: E402
from settings_store import SettingsStore  # noqa: E402
from test_button_gates import _payload  # noqa: E402
from test_button_gates_b import _Admission, _FakeRequest, _FakeUpload, _Pending  # noqa: E402
from test_macros_gateway import _Folder, _body, FACE, rev  # noqa: E402


async def until(event):
    for _ in range(1000):
        if event.is_set():
            return
        await asyncio.sleep(.002)
    raise AssertionError("probe synchronization timed out")


def _row(z, t=1):
    return [{"T": t, "P": t, "Z": z, "D": 3., "remark": ""}]


class TestMacroWritesRunTheSourceWriteRule(_Folder):
    """BG-25: the macro gate refuses where a program write refuses."""

    def setUp(self):
        super().setUp()
        for name, val in (("_source_lock", None), ("_rfl_task", None), ("_rfl_flag_task", None)):
            p = patch.object(gateway, name, val)
            p.start()
            self.addCleanup(p.stop)
        p = patch.object(gateway._status_runtime, "_changing", False)
        p.start()
        self.addCleanup(p.stop)
        self.before = (self.mdir / "face_top.ngc").read_bytes()

    def put(self):
        async def run():
            try:
                return await gateway.put_macro(_body(FACE + "(review)\n"), name="face_top", base=rev(FACE),
                                               rename_from=None, rename_base=None, x_conn_key=self.conn_key)
            except gateway.HTTPException as e:
                return {"http": e.status_code, "detail": e.detail}
        return asyncio.run(run())

    def delete(self):
        async def run():
            try:
                return await gateway.delete_macro(name="face_top", base=rev(FACE), x_conn_key=self.conn_key)
            except gateway.HTTPException as e:
                return {"http": e.status_code, "detail": e.detail}
        return asyncio.run(run())

    def assert_untouched(self, result):
        self.assertTrue((self.mdir / "face_top.ngc").exists(), result)
        self.assertEqual((self.mdir / "face_top.ngc").read_bytes(), self.before, result)
        self.assertEqual(result.get("http"), 409, result)

    def test_a_program_load_refuses_a_macro_save(self):
        gateway._status_runtime._changing = True
        self.assertIsNotNone(gateway._write_admission_refusal(self.conn_key))
        self.assert_untouched(self.put())

    def test_a_run_from_line_refuses_a_macro_save(self):
        gateway._rfl_task = _Pending()
        self.assertIsNotNone(gateway._write_admission_refusal(self.conn_key))
        self.assert_untouched(self.put())

    def test_a_program_load_refuses_a_macro_delete(self):
        gateway._status_runtime._changing = True
        self.assert_untouched(self.delete())

    def test_no_controller_status_refuses_a_macro_save(self):
        with without_connection():
            self.assert_untouched(self.put())

    def test_control_an_idle_machine_saves(self):
        self.assertNotEqual(self.put().get("http"), 409)
        self.assertNotEqual((self.mdir / "face_top.ngc").read_bytes(), self.before)


class TestNoControllerStatusIsNoKnownIdle(_Admission):
    """BG-26: STAT None closes sourceWrite and toolTableWrite, named."""

    def test_the_rule_names_the_unknown_state(self):
        with without_connection():
            self.assertEqual(gateway._write_admission_refusal(self.writer.conn_key), STATE_UNKNOWN)
            self.assertEqual(gateway._write_admission_refusal(self.writer.conn_key, tool_table=True),
                             STATE_UNKNOWN)

    def test_a_program_upload_publishes_nothing(self):
        with tempfile.TemporaryDirectory() as d, without_connection(), \
                patch.object(gateway, "get_nc_files_dir", lambda: d), \
                patch.object(gateway, "_program_name_refusal", lambda _: None):
            gateway._source_lock = None

            async def run():
                try:
                    return await gateway.upload_gcode(_FakeUpload(b"G0 X1\n"), 0, x_conn_key=self.writer.conn_key)
                except gateway.HTTPException as e:
                    return {"http": e.status_code, "detail": e.detail}
            result = asyncio.run(run())
            self.assertFalse(Path(d, "prog.ngc").exists(), result)


class TestWsToolEditsReadTheCurrentWriter(_Admission):
    """BG-23: the dispatcher's arm is not the commit's."""

    MSGS = {
        "save_tool": {"cmd": "save_tool", "tool_number": 1, "z_offset": 12},
        "add_tool": {"cmd": "add_tool", "tool_number": 2, "z_offset": 1},
        "delete_tool": {"cmd": "delete_tool", "tool_number": 1},
        "renumber_tool": {"cmd": "renumber_tool", "old_tool_number": 1, "tool_number": 2},
    }

    def run_edit(self, msg, during_read):
        gateway._shared_status = _payload()
        gateway._cmd_lock = None
        replies, writes = [], []

        def read(_path, _strict=False):
            during_read()   # the status loop / a disconnect, while the file is read
            return _row(0.)

        async def reply(ws, m):
            replies.append(m)

        async def reload():
            pass
        with patch.object(gateway, "parse_tool_table", read), \
                patch.object(gateway, "get_tool_tbl_path", lambda: "/tmp/bg-r211-unused.tbl"), \
                patch.object(gateway, "write_tool_table", lambda *a: writes.append(a)), \
                patch.object(gateway, "load_tool_library", lambda: {}), \
                patch.object(gateway, "save_tool_library", lambda *a, **k: None), \
                patch.object(gateway, "_reload_tool_table_and_bump", reload), \
                patch.object(gateway, "ws_send_json", reply):
            asyncio.run(gateway._execute_client_command(901, self.writer, None, dict(msg)))
        return replies, writes

    def test_a_disarm_while_the_table_is_read_writes_nothing(self):
        for cmd, msg in self.MSGS.items():
            with self.subTest(cmd=cmd):
                self.writer.armed = True
                replies, writes = self.run_edit(msg, lambda: setattr(self.writer, "armed", False))
                self.assertEqual(writes, [], cmd)
                self.assertFalse(replies[-1]["ok"], replies)
                self.assertIn(NOT_ARMED, replies[-1]["error"])

    def test_a_disconnect_while_the_table_is_read_writes_nothing(self):
        def gone():
            gateway._clients.pop(901, None)
        replies, writes = self.run_edit(self.MSGS["save_tool"], gone)
        self.assertEqual(writes, [])
        self.assertIn(gateway.CONN_UNKNOWN, replies[-1]["error"])

    def test_control_an_armed_writer_writes(self):
        for cmd, msg in self.MSGS.items():
            with self.subTest(cmd=cmd):
                replies, writes = self.run_edit(msg, lambda: None)
                self.assertEqual(len(writes), 1, (cmd, replies))
                self.assertTrue(replies[-1]["ok"], replies)


class TestAnAdmittedPersistEndsUnderItsLock(_Admission):
    """BG-22: a cancelled tool-table persist keeps _cmd_lock to its END —
    file, reload, metadata — and the next writer runs after it."""

    def _cancel_case(self, ws_first=False, cancels=1):
        entered, release, finished = threading.Event(), threading.Event(), threading.Event()
        second_entered = threading.Event()
        gateway._cmd_lock = None
        order = []
        real_write = gateway.write_tool_table
        with tempfile.TemporaryDirectory() as d:
            table, meta = Path(d, "tool.tbl"), Path(d, "library.json")

            def write(path, tools):
                z = tools[0]["Z"]
                if z == 12:
                    entered.set()
                    if not release.wait(5):
                        raise AssertionError("release timeout")
                else:
                    second_entered.set()
                real_write(path, tools)
                order.append(f"table Z{z:g}")
                if z == 12:
                    finished.set()

            async def reload():
                order.append("reload")

            def save(library):
                meta.write_text(json.dumps(library))
                order.append(f"metadata {library['writer']}")
            real_write(str(table), _row(0.))
            gateway._shared_status = _payload()

            async def reply(ws, msg):
                order.append("reply")

            async def run():
                first = (gateway._execute_client_command(901, self.writer, None,
                                                         {"cmd": "save_tool", "tool_number": 1, "z_offset": 12})
                         if ws_first else
                         gateway._persist_imported_tools(str(table), _row(12.), {"writer": "A"}, self.writer.conn_key))
                a = asyncio.create_task(first)
                b = None
                try:
                    await until(entered)
                    for _ in range(cancels):
                        a.cancel()
                        await asyncio.sleep(.01)
                    locked = gateway._get_cmd_lock().locked()
                    b = asyncio.create_task(gateway._persist_imported_tools(
                        str(table), _row(99.), {"writer": "B"}, self.writer.conn_key))
                    await asyncio.sleep(.04)
                    overtook = second_entered.is_set()
                finally:
                    release.set()
                    try:
                        await a
                    except asyncio.CancelledError:
                        pass
                    await until(finished)
                    if b is not None:
                        await b
                self.assertTrue(locked, "the lock was released under a write still running")
                self.assertFalse(overtook, "a second import overtook a cancelled, still writing first")
                self.assertEqual(order, ["table Z12", "reload", "metadata A", "table Z99", "reload", "metadata B"])
                self.assertIn("99", table.read_text())
                self.assertEqual(json.loads(meta.read_text()), {"writer": "B"})
            with patch.object(gateway, "get_tool_tbl_path", lambda: str(table)), \
                    patch.object(gateway, "ws_send_json", reply), \
                    patch.object(gateway, "write_tool_table", write), \
                    patch.object(gateway, "load_tool_library", lambda: {"writer": "A"}), \
                    patch.object(gateway, "save_tool_library", save), \
                    patch.object(gateway, "_reload_tool_table_and_bump", reload):
                asyncio.run(run())

    def test_a_cancelled_import_keeps_the_serialization(self):
        self._cancel_case()

    def test_a_cancelled_ws_edit_keeps_the_serialization(self):
        self._cancel_case(ws_first=True)

    def test_a_second_cancel_too(self):
        self._cancel_case(ws_first=True, cancels=2)


class TestSettingsDecideInsideTheStoreLock(_Admission):
    """BG-24: the admission runs after the store's lock is taken — for the
    saves and for a change of another device's profile (settings split)."""

    TOKEN = "c" * 32

    def _case(self, kind="http", disconnect=False, retain_arm=False, section="keyboard"):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d, "settings.json")
            store = SettingsStore(path, lambda: "probe.ini")
            own, _ = store.bind(self.TOKEN, None)
            other, _ = store.bind("d" * 32, None)
            self.writer.device_id = own
            store.save_section("keyboard", {"jogEnabled": False}, base_rev=0, writer="setup")
            store.save_section("panels", {"x": 0}, device=own, base_rev=0, writer="setup")
            before, version = path.read_bytes(), store.version
            entered = threading.Event()
            store._lock.acquire()   # a preceding writer is still in the store
            owner, name = (store, "reset_device") if kind == "device_reset" else (gateway, "save_settings_section")
            original = getattr(owner, name)

            def blocked(*args, **kw):
                entered.set()       # the gateway's own checks ran; the store lock is not taken
                return original(*args, **kw)

            async def run():
                if kind == "device_reset":
                    t = asyncio.create_task(gateway._ws_device_command(
                        self.writer, {"cmd": "device_reset", "device": other}))
                elif kind == "ws":
                    t = asyncio.create_task(gateway._ws_save_settings(
                        self.writer, {"cmd": "save_settings", "section": section, "data": {"x": 1},
                                      "base_rev": 1}))
                else:
                    t = asyncio.create_task(gateway.put_settings_section(
                        section, _FakeRequest({"data": {"x": 1}, "base_rev": 1}),
                        x_conn_key=self.writer.conn_key, x_device_token=self.TOKEN))
                try:
                    await until(entered)
                    if disconnect:
                        gateway._clients.pop(901)
                    elif not retain_arm:
                        self.writer.armed = False
                finally:
                    store._lock.release()
                return await t
            with patch.object(gateway, "_settings_store", store), \
                    patch.object(store, "find_device", lambda tok: own if tok == self.TOKEN else None), \
                    patch.object(owner, name, blocked):
                result = asyncio.run(run())
            return before != path.read_bytes(), store.version != version, result

    def test_a_disarm_while_a_save_waits_writes_nothing(self):
        changed, bumped, result = self._case()
        self.assertFalse(changed, result)
        self.assertFalse(bumped)
        self.assertEqual(getattr(result, "status_code", None), 403)

    def test_a_disconnect_while_a_save_waits_writes_nothing(self):
        changed, bumped, result = self._case(disconnect=True)
        self.assertFalse(changed, result)
        self.assertFalse(bumped)

    def test_a_disarm_while_another_devices_reset_waits_changes_nothing(self):
        changed, bumped, result = self._case(kind="device_reset")
        self.assertFalse(changed, result)
        self.assertFalse(bumped)
        self.assertEqual((result["ok"], result["error"]), (False, NOT_ARMED))

    def test_a_ws_save_decides_inside_the_lock_too(self):
        changed, bumped, result = self._case(kind="ws")
        self.assertFalse(changed, result)
        self.assertFalse(result["ok"])
        self.assertIn(NOT_ARMED, result["error"])

    def test_an_own_device_section_still_needs_no_arm(self):
        changed, _, result = self._case(kind="ws", section="panels")
        self.assertTrue(changed, result)
        changed, _, result = self._case(section="panels")
        self.assertTrue(changed, result)

    def test_control_an_armed_writer_saves_and_resets(self):
        self.assertTrue(self._case(retain_arm=True)[0])
        self.assertTrue(self._case(kind="device_reset", retain_arm=True)[0])
        self.assertTrue(self._case(kind="ws", retain_arm=True)[0])


if __name__ == "__main__":
    unittest.main()
