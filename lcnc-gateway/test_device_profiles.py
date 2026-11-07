"""Device profiles over the real WebSocket path (settings split, operator
2026-11-07, plan Codex R335–R337): a connection is bound to its device by its
FIRST hello — never swapped inside it —, the first settings it gets are its
own device's, a device's change reaches only that device's connections, an
unbound connection saves no device section, and GET /settings and GET
/devices read without making a profile."""
import json
import tempfile
import time
import unittest
import unittest.mock
from pathlib import Path

import fake_linuxcnc

linuxcnc = fake_linuxcnc.install()  # MUST precede `import gateway`

from fastapi.testclient import TestClient  # noqa: E402

import gateway  # noqa: E402
from settings_store import SettingsStore  # noqa: E402
from test_ws_command_worker import _Harness, _drain  # noqa: E402

TOK_A = "a" * 32
TOK_B = "b" * 32


def _hello(ws, token=None, session="dev"):
    msg = {"cmd": "hello", "session": session, "resume_armed": False}
    if token is not None:
        msg["device_token"] = token
    ws.send_json(msg)
    frames = _drain(ws, 4.0, 0.5, stop=lambda f: f.get("type") == "settings_init")
    return frames[-1][1]


def _settings_frames(ws, seconds):
    return [f for _, f in _drain(ws, seconds, 0.5) if f.get("type") in ("settings_init", "settings_changed")]


class TestDeviceBinding(unittest.TestCase):
    def setUp(self):
        d = tempfile.TemporaryDirectory()
        self.addCleanup(d.cleanup)
        self.path = Path(d.name, "settings.json")
        self.store = SettingsStore(self.path, lambda: "dev.ini")
        p = unittest.mock.patch.object(gateway, "_settings_store", self.store)
        p.start()
        self.addCleanup(p.stop)
        h = _Harness()
        h.__enter__()
        self.addCleanup(h.__exit__)

    def test_no_settings_before_the_hello_then_the_own_devices(self):
        with TestClient(gateway.app) as client:
            with client.websocket_connect("/ws") as ws:
                early = _settings_frames(ws, 1.0)
                self.assertEqual(early, [], "settings before the hello bound the connection")
                init = _hello(ws, TOK_A)
                self.assertIsInstance(init["device"]["id"], str)
                self.assertEqual(init["settings"]["simulation"], {"enabled": False})   # OP1
                self.assertIn("simulation", init["revs"])
        self.assertEqual(self.store.find_device(TOK_A), init["device"]["id"])

    def test_the_same_token_is_the_same_device_on_every_connection(self):
        with TestClient(gateway.app) as client:
            with client.websocket_connect("/ws") as w1, client.websocket_connect("/ws") as w2:
                a1 = _hello(w1, TOK_A, "s1")["device"]["id"]
                a2 = _hello(w2, TOK_A, "s2")["device"]["id"]
                self.assertEqual(a1, a2)
                devs = client.get("/devices", headers={"X-Device-Token": TOK_A}).json()["devices"]
                self.assertEqual([(d["id"], d["tabs"], d["online"], d["this"]) for d in devs], [(a1, 2, True, True)])
                self.assertNotIn("token_sha256", json.dumps(devs))

    def test_a_devices_change_reaches_only_its_own_connections(self):
        with TestClient(gateway.app) as client:
            with client.websocket_connect("/ws") as a1, client.websocket_connect("/ws") as a2, \
                    client.websocket_connect("/ws") as b:
                _hello(a1, TOK_A, "a1")
                _hello(a2, TOK_A, "a2")
                _hello(b, TOK_B, "b")
                a1.send_json({"cmd": "save_settings", "section": "simulation", "data": {"enabled": True},
                              "base_rev": 0, "req_id": "sim"})
                reply = [f for _, f in _drain(a1, 4.0, 0.5, stop=lambda f: f.get("req_id") == "sim")][-1]
                self.assertEqual((reply["ok"], reply["rev"]), (True, 1), reply)
                pushed = _settings_frames(a2, 2.0)
                self.assertTrue(pushed and pushed[-1]["settings"]["simulation"] == {"enabled": True}, pushed)
                self.assertEqual(_settings_frames(b, 2.0), [], "another device saw this device's change")

    def test_a_machine_change_reaches_every_device(self):
        with TestClient(gateway.app) as client:
            with client.websocket_connect("/ws") as a, client.websocket_connect("/ws") as b:
                _hello(a, TOK_A, "a")
                _hello(b, TOK_B, "b")
                self.store.save_section("keyboard", {"jogEnabled": False}, base_rev=0, writer="t")
                pushed = _settings_frames(b, 2.0)
                self.assertTrue(pushed and pushed[-1]["settings"]["keyboard"] == {"jogEnabled": False}, pushed)

    def test_an_unbound_connection_reads_the_template_and_saves_no_device_section(self):
        with TestClient(gateway.app) as client:
            with client.websocket_connect("/ws") as ws:
                init = _hello(ws, None)
                self.assertEqual(init["device"], {"id": None, "name": ""})
                ws.send_json({"cmd": "save_settings", "section": "display", "data": {"theme": "dark"},
                              "base_rev": 0, "req_id": "d"})
                r = [f for _, f in _drain(ws, 4.0, 0.5, stop=lambda f: f.get("req_id") == "d")][-1]
                self.assertEqual((r["ok"], r["error"]), (False, gateway.DEVICE_UNBOUND), r)
        self.assertEqual(self.store.list_devices(), [])

    def test_a_later_hello_never_swaps_the_binding(self):
        with TestClient(gateway.app) as client:
            with client.websocket_connect("/ws") as ws:
                first = _hello(ws, TOK_A)["device"]["id"]
                ws.send_json({"cmd": "hello", "session": "dev", "resume_armed": False, "device_token": TOK_B})
                ws.send_json({"cmd": "get_settings"})
                again = [f for _, f in _drain(ws, 4.0, 0.5, stop=lambda f: f.get("type") == "settings_init")][-1]
                self.assertEqual(again["device"]["id"], first)
        self.assertIsNone(self.store.find_device(TOK_B), "a second hello made a profile")

    def test_the_settings_read_never_makes_a_profile(self):
        with TestClient(gateway.app) as client:
            r = client.get("/settings", headers={"X-Device-Token": TOK_A}).json()
            self.assertEqual(r["device"], {"id": None, "name": ""})
            self.assertEqual(r["settings"]["simulation"], {"enabled": False})
            self.assertFalse(self.path.exists())
            pid, _ = self.store.bind(TOK_A, None)
            self.store.save_section("display", {"theme": "dark"}, device=pid, base_rev=0, writer="t")
            r = client.get("/settings", headers={"X-Device-Token": TOK_A}).json()
            self.assertEqual((r["device"]["id"], r["settings"]["display"]), (pid, {"theme": "dark"}))
            r = client.get("/settings").json()
            self.assertNotIn("display", r["settings"])

    def test_a_connected_device_is_never_deleted_and_an_offline_one_only_armed(self):
        with TestClient(gateway.app) as client:
            with client.websocket_connect("/ws") as a, client.websocket_connect("/ws") as b:
                _hello(a, TOK_A, "a")
                b_id = _hello(b, TOK_B, "b")["device"]["id"]
                a.send_json({"cmd": "device_delete", "device": b_id, "req_id": "x"})
                r = [f for _, f in _drain(a, 4.0, 0.5, stop=lambda f: f.get("req_id") == "x")][-1]
                self.assertFalse(r["ok"], r)    # not armed — and B is connected
            # B is gone now; A comes back disarmed
            with client.websocket_connect("/ws") as a:
                _hello(a, TOK_A, "a2")
                a.send_json({"cmd": "device_delete", "device": b_id, "req_id": "y"})
                r = [f for _, f in _drain(a, 4.0, 0.5, stop=lambda f: f.get("req_id") == "y")][-1]
                self.assertEqual((r["ok"], r["error"]), (False, gateway.NOT_ARMED), r)
        self.assertIn(b_id, [d["id"] for d in self.store.list_devices()])


class TestBindAndDelete(unittest.TestCase):
    """R338 SS-I04: a bound connection always points at a stored profile —
    the binding is claimed under the store's lock, so a delete either sees
    the connection (refused) or ran before (the bind makes a NEW profile and
    says so once)."""

    def setUp(self):
        d = tempfile.TemporaryDirectory()
        self.addCleanup(d.cleanup)
        self.store = SettingsStore(Path(d.name, "settings.json"), lambda: "dev.ini")
        p = unittest.mock.patch.object(gateway, "_settings_store", self.store)
        p.start()
        self.addCleanup(p.stop)
        saved = dict(gateway._clients)
        self.addCleanup(lambda: (gateway._clients.clear(), gateway._clients.update(saved)))
        gateway._clients.clear()
        self.admin = gateway.ClientState(ip="a", ws=None, armed=True)
        gateway._clients[1] = self.admin

    def _bind(self, client):
        import asyncio
        asyncio.run(gateway._bind_device(client, 2, "10.0.0.7", {"device_token": TOK_B}))

    def test_a_delete_after_the_bind_is_refused(self):
        old, _ = self.store.bind(TOK_B, None)
        c = gateway.ClientState(ip="b", ws=None)
        gateway._clients[2] = c
        real = self.store.bind
        seen = []

        def bind(token, address, claim=None):
            def claim_then_try_delete(pid):
                claim(pid)
                # inside the lock, right after the claim: the delete's
                # admission (asked under the same lock) sees the connection
                seen.append(any(x.device_id == pid for x in gateway._clients.values()))
            return real(token, address, claim_then_try_delete)
        with unittest.mock.patch.object(self.store, "bind", bind):
            self._bind(c)
        self.assertEqual(seen, [True])
        import asyncio
        r = asyncio.run(gateway._ws_device_command(self.admin, {"cmd": "device_delete", "device": old}))
        self.assertEqual((r["ok"], r["error"]), (False, gateway.DEVICE_CONNECTED))
        self.assertEqual(self.store.find_device(TOK_B), c.device_id)

    def test_a_delete_before_the_bind_gives_a_new_profile_and_says_so(self):
        import asyncio
        old, _ = self.store.bind(TOK_B, None)
        r = asyncio.run(gateway._ws_device_command(self.admin, {"cmd": "device_delete", "device": old}))
        self.assertTrue(r["ok"], r)
        c = gateway.ClientState(ip="b", ws=None)
        gateway._clients[2] = c
        self._bind(c)
        self.assertNotEqual(c.device_id, old)
        self.assertEqual(self.store.find_device(TOK_B), c.device_id)
        self.assertTrue(c.device_created)
        self.assertEqual(settings_view_id(c.device_id), c.device_id)

    def test_a_connection_gone_during_its_bind_holds_nothing(self):
        old, _ = self.store.bind(TOK_B, None)
        c = gateway.ClientState(ip="b", ws=None)   # never registered: it left during the bind
        self._bind(c)
        import asyncio
        r = asyncio.run(gateway._ws_device_command(self.admin, {"cmd": "device_delete", "device": old}))
        self.assertTrue(r["ok"], "a profile no live connection holds may go")


def settings_view_id(pid):
    return gateway.settings_view(pid)["device"]["id"]


if __name__ == "__main__":
    unittest.main()
