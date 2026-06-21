"""Unit tests for ws_fanout (M3) — envelope matrix, diff, send policy.

The WebSocket is stubbed (record / hang / raise); no gateway import.
"""
import asyncio
import types
import unittest

import msgspec

import ws_fanout
from ws_fanout import ClientState, WsFanout, build_status_envelope, diff_status_data


def _noop_phase(name: str) -> None:
    pass


class TestBuildStatusEnvelope(unittest.TestCase):
    BASE = dict(status_data={"estop": False}, errors=[], clients_list=[], armed=True)

    def test_minimal_has_no_optional_sections(self):
        msg = build_status_envelope(**self.BASE)
        self.assertEqual(
            set(msg), {"type", "data", "errors", "clients", "armed"})
        self.assertEqual(msg["type"], "status")
        self.assertTrue(msg["armed"])

    def test_safety_trip_attached_only_when_present(self):
        trip = {"ts_ns": 123, "reason": "hb"}
        msg = build_status_envelope(**self.BASE, safety_trip=trip)
        self.assertIs(msg["safety_trip"], trip)
        self.assertNotIn("safety_trip", build_status_envelope(**self.BASE))

    def test_disable_reason_attached_only_when_present(self):
        reason = {"kind": "machine_disabled", "message": "disabled unexpectedly"}
        msg = build_status_envelope(**self.BASE, disable_reason=reason)
        self.assertIs(msg["disable_reason"], reason)
        self.assertNotIn("disable_reason", build_status_envelope(**self.BASE))

    def test_reader_stale_flag(self):
        self.assertTrue(
            build_status_envelope(**self.BASE, reader_stale=True)["reader_stale"])
        self.assertNotIn(
            "reader_stale", build_status_envelope(**self.BASE, reader_stale=False))

    def test_config_warning_and_rfl(self):
        warn = {"reason": "units", "units": True}
        rfl = {"phase": "measuring"}
        msg = build_status_envelope(**self.BASE, config_warning=warn, rfl_status=rfl)
        self.assertIs(msg["config_warning"], warn)
        self.assertIs(msg["rfl_status"], rfl)

    def test_empty_probe_results_omitted(self):
        self.assertNotIn(
            "probe_results", build_status_envelope(**self.BASE, probe_results={}))
        msg = build_status_envelope(**self.BASE, probe_results={"z_minus": -1.5})
        self.assertEqual(msg["probe_results"], {"z_minus": -1.5})


class TestDiffStatusData(unittest.TestCase):
    def test_changed_and_added_keys_only(self):
        last = {"a": 1, "b": [1, 2], "c": "x"}
        cur = {"a": 2, "b": [1, 2], "c": "x", "d": True}
        self.assertEqual(diff_status_data(last, cur), {"a": 2, "d": True})

    def test_changed_list_included_whole(self):
        diff = diff_status_data({"pos": [1.0, 2.0]}, {"pos": [1.0, 2.5]})
        self.assertEqual(diff, {"pos": [1.0, 2.5]})

    def test_identical_yields_empty(self):
        self.assertEqual(diff_status_data({"a": 1}, {"a": 1}), {})


class _StubWs:
    """Scriptable WebSocket stand-in: record sends, optionally hang or raise."""

    def __init__(self, mode="ok"):
        self.mode = mode
        self.sent = []
        self.closed = asyncio.Event()
        self.client = types.SimpleNamespace(host="10.0.0.7", port=4242)

    async def send_bytes(self, data):
        if self.mode == "hang":
            await asyncio.sleep(ws_fanout.WS_SEND_TIMEOUT_S + 0.15)
        elif self.mode == "raise":
            raise RuntimeError("WS closed")
        self.sent.append(data)

    async def send_text(self, data):
        await self.send_bytes(data)

    async def close(self, code=1000, reason=None):
        self.closed.set()


class TestWsSendMeasured(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.fan = WsFanout(set_phase=_noop_phase)

    async def test_roundtrip_and_measurement(self):
        ws = _StubWs()
        obj = {"type": "status", "armed": True, "data": {"x": 1.5}}
        encode_ms, nbytes = await self.fan.ws_send_measured(ws, obj)
        self.assertEqual(len(ws.sent), 1)
        self.assertEqual(nbytes, len(ws.sent[0]))
        self.assertGreaterEqual(encode_ms, 0.0)
        # default wire format is msgpack — frame must decode back to the object
        self.assertEqual(msgspec.msgpack.decode(ws.sent[0]), obj)

    async def test_slow_client_dropped(self):
        ws = _StubWs(mode="hang")
        encode_ms, nbytes = await self.fan.ws_send_measured(ws, {"type": "status"})
        self.assertEqual(nbytes, 0)          # timed out → nothing counted
        self.assertEqual(ws.sent, [])
        # close is fire-and-forget — wait for the scheduled task
        await asyncio.wait_for(ws.closed.wait(), timeout=1.0)

    async def test_disconnected_mid_send_returns_zero(self):
        ws = _StubWs(mode="raise")
        encode_ms, nbytes = await self.fan.ws_send_measured(ws, {"type": "status"})
        self.assertEqual(nbytes, 0)
        self.assertFalse(ws.closed.is_set())  # RuntimeError path doesn't force-close

    async def test_ws_send_json_shim(self):
        ws = _StubWs()
        await self.fan.ws_send_json(ws, {"type": "pong"})
        self.assertEqual(msgspec.msgpack.decode(ws.sent[0]), {"type": "pong"})


class TestHiddenFlagAndRegistry(unittest.TestCase):
    def test_hidden_flag_by_ws_identity(self):
        fan = WsFanout(set_phase=_noop_phase)
        ws_a, ws_b = _StubWs(), _StubWs()
        fan.clients[1] = ClientState(ip="a", ws=ws_a, hidden=True)
        fan.clients[2] = ClientState(ip="b", ws=ws_b, hidden=False)
        self.assertTrue(fan.ws_hidden_flag(ws_a))
        self.assertFalse(fan.ws_hidden_flag(ws_b))
        self.assertFalse(fan.ws_hidden_flag(_StubWs()))  # unknown ws

    def test_client_state_defaults(self):
        c = ClientState(ip="x", ws=None)
        self.assertFalse(c.armed)
        self.assertFalse(c.viewer_init_sent)
        self.assertEqual(c.probe_results, {})
        self.assertEqual(c.hb_ring.maxlen, 12)
        # separate instances must not share the mutable defaults
        c2 = ClientState(ip="y", ws=None)
        c.probe_results["k"] = 1
        self.assertEqual(c2.probe_results, {})


if __name__ == "__main__":
    unittest.main()
