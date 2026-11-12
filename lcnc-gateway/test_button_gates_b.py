"""Button gates, package B (review docs/reviews/button-gates.review.md, plan
agreed at Codex R204): who may write, checked where the write happens.

- BG-14: a protected HTTP write names its WebSocket connection (`conn_key`,
  minted per connection at accept, reported in the hello reply, gone the
  moment the connection's cleanup starts). At the commit — inside the
  serialization a start registers under — the writer must still be connected
  and armed, and the state rule must hold: `sourceWrite` (programs, macros)
  or `toolTableWrite` (the tool table). E-Stop does not close them.
- BG-19: settings by section — display sections free, the others need the
  writer's arm (no idle); the global reset is protected.
"""
import os
import shutil
import tempfile
import unittest
from unittest import mock

import fake_linuxcnc
linuxcnc = fake_linuxcnc.install()   # MUST precede `import gateway`
import gateway  # noqa: E402
import settings_store  # noqa: E402
from fastapi import HTTPException  # noqa: E402
from command_policy import COMMAND_GATES, NOT_ARMED, evaluate_permissions, permission_reasons  # noqa: E402
from ws_fanout import ClientState  # noqa: E402
from test_button_gates import _Handlers, _payload, _run, state, running  # noqa: E402


class _Pending:
    def done(self):
        return False


class TestSectionClassification(unittest.TestCase):
    """BG-19 / Q2: ONE classification, in settings_store."""

    def test_the_two_classes_cover_every_section_once(self):
        free, protected = settings_store.FREE_SECTIONS, settings_store.PROTECTED_SECTIONS
        self.assertEqual(free | protected, settings_store.VALID_SECTIONS)
        self.assertEqual(free & protected, frozenset())

    def test_device_sections_are_free(self):
        # settings split (R335): a device saves its own sections without arm
        self.assertEqual(settings_store.FREE_SECTIONS,
                         {"display", "viewer", "panels", "camera", "macroBar", "simulation"})

    def test_machine_is_protected(self):
        # spindleFeedbackUnit / spindleLoadPin scale and select a machine
        # reading (Codex R203)
        self.assertTrue(settings_store.section_needs_arm("machine"))
        self.assertFalse(settings_store.section_needs_arm("viewer"))


class TestWriteGates(unittest.TestCase):
    """sourceWrite / toolTableWrite: armed, the interpreter KNOWN idle; E-Stop
    allowed; the tool table also needs no pending tool change."""

    def test_source_write(self):
        self.assertTrue(evaluate_permissions(state())["sourceWrite"])
        self.assertTrue(evaluate_permissions(state(is_estop=True, is_enabled=False))["sourceWrite"],
                        "program maintenance in E-Stop")
        self.assertFalse(evaluate_permissions(running())["sourceWrite"])
        self.assertFalse(evaluate_permissions(state(interp_known=False, is_idle=False))["sourceWrite"])
        self.assertEqual(permission_reasons(state(armed=False))["sourceWrite"], NOT_ARMED)

    def test_tool_table_write(self):
        self.assertTrue(evaluate_permissions(state(is_estop=True, is_enabled=False))["toolTableWrite"])
        self.assertFalse(evaluate_permissions(running())["toolTableWrite"])
        s = state(tool_change_pending=True)
        self.assertFalse(evaluate_permissions(s)["toolTableWrite"])
        self.assertIn("tool change", permission_reasons(s)["toolTableWrite"].lower())
        self.assertFalse(evaluate_permissions(state(tool_change_pending=None))["toolTableWrite"])

    def test_tool_commands_map_to_it(self):
        for cmd in ("save_tool", "add_tool", "delete_tool", "renumber_tool"):
            with self.subTest(cmd=cmd):
                self.assertEqual(COMMAND_GATES[cmd], "toolTableWrite")


class _Clients(unittest.TestCase):
    """A registry with an armed and a disarmed connection."""

    def setUp(self):
        saved = dict(gateway._clients)
        self.addCleanup(lambda: (gateway._clients.clear(), gateway._clients.update(saved)))
        gateway._clients.clear()
        self.armed = ClientState(ip="a", ws=None, armed=True)
        self.disarmed = ClientState(ip="b", ws=None, armed=False)
        gateway._clients[901] = self.armed
        gateway._clients[902] = self.disarmed


class TestConnKey(_Clients):
    def test_minted_per_connection(self):
        self.assertTrue(isinstance(self.armed.conn_key, str) and len(self.armed.conn_key) >= 16)
        self.assertNotEqual(self.armed.conn_key, self.disarmed.conn_key)

    def test_the_writer_is_its_connection(self):
        self.assertIsNone(gateway._writer_refusal(self.armed.conn_key))
        self.assertEqual(gateway._writer_refusal(self.disarmed.conn_key), NOT_ARMED)
        for key in (None, "", "no-such-key"):
            with self.subTest(key=key):
                self.assertEqual(gateway._writer_refusal(key), gateway.CONN_UNKNOWN)

    def test_a_closed_connection_writes_nothing(self):
        # gone from the registry the moment the cleanup starts (the finally's
        # first step) — no grace for a key whose connection ended
        key = self.armed.conn_key
        gateway._clients.pop(901)
        self.assertEqual(gateway._writer_refusal(key), gateway.CONN_UNKNOWN)


class _Admission(_Handlers):
    """An armed writer on an idle machine — the commit-time rule's inputs."""

    def setUp(self):
        super().setUp()
        saved = (dict(gateway._clients), list(gateway._source_claims), gateway._rfl_task,
                 gateway._rfl_flag_task, gateway._status_runtime._changing)
        self.addCleanup(lambda: (gateway._clients.clear(), gateway._clients.update(saved[0]),
                                 gateway._source_claims.__setitem__(slice(None), saved[1]),
                                 setattr(gateway, "_rfl_task", saved[2]),
                                 setattr(gateway, "_rfl_flag_task", saved[3]),
                                 setattr(gateway._status_runtime, "_changing", saved[4])))
        gateway._clients.clear()
        self.writer = ClientState(ip="a", ws=None, armed=True)
        gateway._clients[901] = self.writer
        gateway._source_claims.clear()
        gateway._rfl_task = gateway._rfl_flag_task = None
        gateway._status_runtime._changing = False
        gateway._reader_is_stale = lambda: False
        gateway._reader_get = {"tool_change": False}.get


class TestWriteAdmission(_Admission):
    """The commit-time rule, on a CURRENT read: writer, claims, transactions,
    the interpreter, the tool-change request."""

    def admit(self, tool_table=False):
        return gateway._write_admission_refusal(self.writer.conn_key, tool_table=tool_table)

    def test_an_idle_machine_admits(self):
        self.assertIsNone(self.admit())
        self.assertIsNone(self.admit(tool_table=True))

    def test_e_stop_admits(self):
        gateway.STAT.task_state = linuxcnc.STATE_ESTOP
        gateway.STAT.estop = 1
        self.assertIsNone(self.admit())

    def test_a_disarmed_writer_is_refused(self):
        self.writer.armed = False
        self.assertEqual(self.admit(), NOT_ARMED)

    def test_an_open_start_is_refused(self):
        gateway._source_claims.append(object())
        self.assertIsNotNone(self.admit())

    def test_run_from_line_starting_is_refused(self):
        gateway._rfl_task = _Pending()
        self.assertIsNotNone(self.admit())

    def test_a_load_in_progress_is_refused(self):
        gateway._status_runtime._changing = True
        self.assertIsNotNone(self.admit())

    def test_a_running_interpreter_is_refused(self):
        gateway.STAT.interp_state = linuxcnc.INTERP_READING
        self.assertIsNotNone(self.admit())

    def test_a_pending_tool_change_refuses_the_table(self):
        gateway._reader_get = {"tool_change": True}.get
        self.assertIsNone(self.admit())
        self.assertIn("tool change", self.admit(tool_table=True).lower())

    def test_an_unknown_tool_change_refuses_the_table(self):
        gateway._reader_is_stale = lambda: True
        self.assertIsNotNone(self.admit(tool_table=True))


class _FakeUpload:
    def __init__(self, data: bytes, filename: str = "prog.ngc"):
        import io
        self._buf = io.BytesIO(data)
        self.filename = filename

    async def read(self, n: int = -1) -> bytes:
        return self._buf.read(n)


class _PausingUpload(_FakeUpload):
    """Pauses after its first chunk: the state changes while the body is
    still arriving — the check that counts is the one at the publish."""
    def __init__(self, data: bytes, on_pause):
        super().__init__(data)
        self.on_pause = on_pause
        self._reads = 0

    async def read(self, n: int = -1) -> bytes:
        self._reads += 1
        if self._reads == 2:
            self.on_pause()
        return self._buf.read(n)


class TestProgramWriters(_Admission):
    def setUp(self):
        super().setUp()
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, True)
        p = mock.patch.object(gateway, "get_nc_files_dir", lambda: self.tmp)
        p.start()
        self.addCleanup(p.stop)
        p = mock.patch.object(gateway, "_program_name_refusal", lambda _p: None)
        p.start()
        self.addCleanup(p.stop)

    def upload(self, key, upload=None):
        return _run(gateway.upload_gcode(upload or _FakeUpload(b"G0 X1\n"), 0, x_conn_key=key))

    def test_an_armed_writer_uploads(self):
        r = self.upload(self.writer.conn_key)
        self.assertTrue(r["ok"])
        self.assertTrue(os.path.isfile(os.path.join(self.tmp, "prog.ngc")))

    def test_no_connection_uploads_nothing(self):
        with self.assertRaises(HTTPException) as e:
            self.upload(None)
        self.assertEqual(e.exception.status_code, 403)
        self.assertFalse(os.path.exists(os.path.join(self.tmp, "prog.ngc")))

    def test_a_disarmed_writer_uploads_nothing(self):
        self.writer.armed = False
        with self.assertRaises(HTTPException) as e:
            self.upload(self.writer.conn_key)
        self.assertEqual(e.exception.status_code, 403)
        self.assertFalse(os.path.exists(os.path.join(self.tmp, "prog.ngc")))

    def test_a_start_while_the_body_arrives_refuses_at_the_publish(self):
        up = _PausingUpload(b"G0 X1\n" * 400000, lambda: gateway._source_claims.append(object()))
        with self.assertRaises(HTTPException) as e:
            self.upload(self.writer.conn_key, up)
        self.assertEqual(e.exception.status_code, 409)
        self.assertEqual([n for n in os.listdir(self.tmp)], [], "nothing published, no temp left")

    def test_a_disarm_while_the_body_arrives_refuses_at_the_publish(self):
        up = _PausingUpload(b"G0 X1\n" * 400000, lambda: setattr(self.writer, "armed", False))
        with self.assertRaises(HTTPException):
            self.upload(self.writer.conn_key, up)
        self.assertEqual(os.listdir(self.tmp), [])

    def test_save_needs_the_writer_too(self):
        path = os.path.join(self.tmp, "prog.ngc")
        with open(path, "w") as f:
            f.write("G0 X0\n")

        class _Req:
            async def stream(self):
                yield b"G0 X2\n"
        self.writer.armed = False
        with self.assertRaises(HTTPException):
            _run(gateway.save_gcode(_Req(), path=path, x_conn_key=self.writer.conn_key))
        with open(path) as f:
            self.assertEqual(f.read(), "G0 X0\n")
        self.writer.armed = True
        r = _run(gateway.save_gcode(_Req(), path=path, x_conn_key=self.writer.conn_key))
        self.assertTrue(r["ok"])


class TestToolTableWriters(_Admission):
    def setUp(self):
        super().setUp()
        self.writes = []
        for name, fn in (("write_tool_table", lambda *a: self.writes.append("tbl")),
                         ("save_tool_library", lambda *a: self.writes.append("lib"))):
            p = mock.patch.object(gateway, name, fn)
            p.start()
            self.addCleanup(p.stop)

        async def _reload():
            self.writes.append("reload")
        p = mock.patch.object(gateway, "_reload_tool_table_and_bump", _reload)
        p.start()
        self.addCleanup(p.stop)

    def persist(self, key):
        return _run(gateway._persist_imported_tools("/tmp/bg-unused.tbl", [], {}, key))

    def test_an_armed_writer_replaces_the_table(self):
        self.persist(self.writer.conn_key)
        self.assertEqual(self.writes, ["tbl", "reload", "lib"])

    def test_a_pending_tool_change_replaces_nothing(self):
        gateway._reader_get = {"tool_change": True}.get
        with self.assertRaises(HTTPException) as e:
            self.persist(self.writer.conn_key)
        self.assertEqual(e.exception.status_code, 409)
        self.assertEqual(self.writes, [])

    def test_a_disarmed_writer_replaces_nothing(self):
        self.writer.armed = False
        with self.assertRaises(HTTPException):
            self.persist(self.writer.conn_key)
        self.assertEqual(self.writes, [])


class _FakeRequest:
    def __init__(self, body, headers=None):
        self._body = body
        self.headers = headers or {}

    async def json(self):
        return self._body


class TestSettingsWrites(_Clients):
    """BG-19 with device profiles (settings split R335–R337): a device saves
    its OWN sections without arm, another device's only armed; a machine
    section needs an armed writer; no whole-INI reset any more."""

    TOKEN = "a" * 32

    def setUp(self):
        super().setUp()
        self.saved = []

        def save(section, data, admit, *, device=None, base_rev=None, writer=None):
            admit()   # the store calls admit under its lock
            self.saved.append((section, data, device))
            return 1
        p = mock.patch.object(gateway, "save_settings_section", save)
        p.start()
        self.addCleanup(p.stop)
        p = mock.patch.object(gateway._settings_store, "find_device",
                              lambda tok: "dev-1" if tok == self.TOKEN else None)
        p.start()
        self.addCleanup(p.stop)
        self.armed.device_id = "dev-armed"
        self.disarmed.device_id = "dev-disarmed"

    def put(self, section, key=None, body_key=None, token=None, body_token=None):
        body = {"data": {"x": 1}, "base_rev": 0}
        if body_key is not None:
            body["conn_key"] = body_key
        if body_token is not None:
            body["device_token"] = body_token
        return _run(gateway.put_settings_section(section, _FakeRequest(body), x_conn_key=key,
                                                 x_device_token=token))

    def test_a_device_section_goes_to_the_tokens_device_without_arm(self):
        self.assertEqual(self.put("viewer", token=self.TOKEN), {"ok": True, "rev": 1})
        self.assertEqual(self.saved, [("viewer", {"x": 1}, "dev-1")])

    def test_a_device_section_without_a_known_token_writes_nothing(self):
        for tok in (None, "b" * 32):
            r = self.put("viewer", token=tok)
            self.assertEqual(getattr(r, "status_code", None), 403)
        self.assertEqual(self.saved, [])

    def test_a_protected_section_needs_an_armed_writer(self):
        r = self.put("keyboard")
        self.assertEqual(getattr(r, "status_code", None), 403)
        r = self.put("keyboard", key=self.disarmed.conn_key)
        self.assertEqual(getattr(r, "status_code", None), 403)
        self.assertEqual(self.saved, [])
        self.assertEqual(self.put("keyboard", key=self.armed.conn_key), {"ok": True, "rev": 1})
        self.assertEqual(self.saved, [("keyboard", {"x": 1}, None)])

    def test_the_page_hide_beacon_names_its_connection_and_device_in_the_body(self):
        self.assertEqual(self.put("machine", body_key=self.armed.conn_key), {"ok": True, "rev": 1})
        r = self.put("machine", body_key=self.disarmed.conn_key)
        self.assertEqual(getattr(r, "status_code", None), 403)
        self.assertEqual(self.put("simulation", body_token=self.TOKEN), {"ok": True, "rev": 1})
        self.assertEqual(self.saved[-1], ("simulation", {"x": 1}, "dev-1"))

    def test_there_is_no_whole_ini_reset_any_more(self):
        self.assertFalse(hasattr(gateway, "delete_settings"))
        self.assertFalse(hasattr(gateway, "reset_settings"))
        self.assertFalse(any(getattr(r, "path", None) == "/settings" and "DELETE" in getattr(r, "methods", ())
                             for r in gateway.app.routes))

    def test_the_ws_save_rule(self):
        def refusal(section, key, foreign=False):
            try:
                gateway._settings_admission(section, key, foreign=foreign)()
            except PermissionError as e:
                return str(e)
            return None
        self.assertIsNone(refusal("panels", self.disarmed.conn_key))
        self.assertEqual(refusal("panels", self.disarmed.conn_key, foreign=True), NOT_ARMED)
        self.assertIsNone(refusal("panels", self.armed.conn_key, foreign=True))
        self.assertEqual(refusal("gamepad", self.disarmed.conn_key), NOT_ARMED)
        self.assertIsNone(refusal("gamepad", self.armed.conn_key))
        self.assertEqual(refusal(None, self.disarmed.conn_key), NOT_ARMED, "a machine reset")

        def save(client, section, **extra):
            return _run(gateway._ws_save_settings(client, {"cmd": "save_settings", "section": section,
                                                            "data": {"x": 1}, "base_rev": 0,
                                                            "req_id": "r", **extra}))
        self.assertTrue(save(self.armed, "gamepad")["ok"])
        self.assertFalse(save(self.disarmed, "gamepad")["ok"])
        r = save(self.disarmed, "panels")
        self.assertEqual((r["ok"], r["req_id"], r["rev"]), (True, "r", 1), r)
        self.assertEqual(self.saved[-1], ("panels", {"x": 1}, "dev-disarmed"))
        # another device's section: armed only
        r = save(self.disarmed, "simulation", device="dev-armed")
        self.assertEqual((r["ok"], r["error"]), (False, NOT_ARMED), r)
        self.assertTrue(save(self.armed, "simulation", device="dev-disarmed")["ok"])
        self.assertEqual(self.saved[-1], ("simulation", {"x": 1}, "dev-disarmed"))
        # a machine section names no device; an unbound connection saves no device section
        self.assertFalse(save(self.armed, "gamepad", device="dev-armed")["ok"])
        self.disarmed.device_id = None
        r = save(self.disarmed, "panels")
        self.assertEqual((r["ok"], r["error"]), (False, gateway.DEVICE_UNBOUND), r)

    def test_a_stale_save_answers_with_the_current_state(self):
        def stale(section, data, admit, *, device=None, base_rev=None, writer=None):
            raise settings_store.Stale(section, {"enabled": False}, 7)
        with mock.patch.object(gateway, "save_settings_section", stale):
            r = _run(gateway._ws_save_settings(self.armed, {"cmd": "save_settings", "section": "simulation",
                                                             "data": {"enabled": True}, "base_rev": 3,
                                                             "req_id": "s"}))
        self.assertEqual((r["ok"], r["stale"], r["data"], r["rev"], r["section"], r["req_id"]),
                         (False, True, {"enabled": False}, 7, "simulation", "s"), r)


class TestDeviceCommands(_Clients):
    """Rename / reset / delete a device profile (R335–R337): the own device
    free, another armed; a connected profile is never deleted."""

    def setUp(self):
        super().setUp()
        self.armed.device_id = "dev-armed"
        self.disarmed.device_id = "dev-disarmed"
        self.calls = []
        store = gateway._settings_store
        for name in ("rename_device", "reset_device", "delete_device"):
            def op(device, *a, _n=name):
                admit = a[-1]
                admit()
                self.calls.append((_n, device))
            p = mock.patch.object(store, name, op)
            p.start()
            self.addCleanup(p.stop)

    def cmd(self, client, cmd, **extra):
        return _run(gateway._ws_device_command(client, {"cmd": cmd, "req_id": "d", **extra}))

    def test_the_own_device_needs_no_arm(self):
        self.assertTrue(self.cmd(self.disarmed, "device_rename", name="Panel")["ok"])
        self.assertTrue(self.cmd(self.disarmed, "device_reset")["ok"])
        self.assertEqual(self.calls, [("rename_device", "dev-disarmed"), ("reset_device", "dev-disarmed")])

    def test_another_device_needs_an_armed_writer(self):
        r = self.cmd(self.disarmed, "device_reset", device="dev-offline")
        self.assertEqual((r["ok"], r["error"]), (False, NOT_ARMED))
        self.assertTrue(self.cmd(self.armed, "device_reset", device="dev-offline")["ok"])
        self.assertEqual(self.calls, [("reset_device", "dev-offline")])

    def test_a_connected_device_is_never_deleted(self):
        r = self.cmd(self.armed, "device_delete")          # its own: connected by definition
        self.assertEqual((r["ok"], r["error"]), (False, gateway.DEVICE_CONNECTED))
        r = self.cmd(self.armed, "device_delete", device="dev-disarmed")   # online
        self.assertEqual((r["ok"], r["error"]), (False, gateway.DEVICE_CONNECTED))
        self.assertEqual(self.calls, [])
        self.assertTrue(self.cmd(self.armed, "device_delete", device="dev-offline")["ok"])
        self.assertEqual(self.calls, [("delete_device", "dev-offline")])

    def test_an_unbound_connection_has_no_own_device(self):
        self.disarmed.device_id = None
        r = self.cmd(self.disarmed, "device_rename", name="x")
        self.assertEqual((r["ok"], r["error"]), (False, gateway.DEVICE_UNBOUND))


class TestWsToolEditAdmittedAtTheWrite(_Admission):
    """A WS tool edit: the dispatcher reads the snapshot; the write itself
    re-reads — a tool change asking for a tool since then refuses it."""

    def test_a_tool_change_raised_since_the_snapshot_writes_nothing(self):
        writes = []
        p = mock.patch.object(gateway, "write_tool_table", lambda *a: writes.append(a))
        p.start()
        self.addCleanup(p.stop)
        p = mock.patch.object(gateway, "parse_tool_table", lambda _p, _strict=False: [{"T": 1, "P": 1, "Z": 0.0, "D": 3.0, "remark": ""}])
        p.start()
        self.addCleanup(p.stop)
        p = mock.patch.object(gateway, "get_tool_tbl_path", lambda: "/tmp/bg-unused.tbl")
        p.start()
        self.addCleanup(p.stop)
        gateway._reader_get = {"tool_change": True}.get   # fresh: a request now
        gateway._shared_status = _payload(tool_change_requested=False)   # the snapshot did not know
        r = _run(gateway.handle_command({"cmd": "save_tool", "tool_number": 1, "z_offset": 1.5},
                                        True, self.writer.conn_key))     # the connection (BG-23)
        self.assertFalse(r["ok"], r)
        self.assertIn("tool change", r["error"].lower())
        self.assertEqual(writes, [])


class TestHelloCarriesTheConnectionsKey(unittest.TestCase):
    """The key is the connection's: in the hello reply, the same for every
    hello on it, refused the moment the connection is gone."""

    def test_the_key_lives_and_dies_with_its_connection(self):
        import json
        import time
        from fastapi.testclient import TestClient

        def replies(ws, n, deadline):
            out = []
            while len(out) < n:
                self.assertLess(time.monotonic(), deadline, "no hello reply with a conn_key")
                ws.send_json({"cmd": "heartbeat"})   # a pong comes back: receive never blocks
                m = ws.receive()
                raw = m.get("text") or m.get("bytes")
                if raw is None:
                    continue
                import msgspec
                msg = json.loads(raw) if isinstance(raw, str) else msgspec.msgpack.decode(raw)
                if msg.get("type") == "reply" and "conn_key" in msg:
                    out.append(msg["conn_key"])
            return out
        deadline = time.monotonic() + 15.0
        with TestClient(gateway.app) as client:
            with client.websocket_connect("/ws") as ws:
                ws.send_json({"cmd": "hello", "session": "bg-key", "resume_armed": False})
                ws.send_json({"cmd": "hello", "session": "bg-key", "resume_armed": False})
                keys = replies(ws, 2, deadline)
                self.assertEqual(keys[0], keys[1], "one key per connection, not per hello")
                self.assertEqual(gateway._writer_refusal(keys[0]), NOT_ARMED, "connected, not armed")
            for _ in range(200):
                if gateway._writer_refusal(keys[0]) == gateway.CONN_UNKNOWN:
                    break
                time.sleep(0.01)
            self.assertEqual(gateway._writer_refusal(keys[0]), gateway.CONN_UNKNOWN)


if __name__ == "__main__":
    unittest.main()
