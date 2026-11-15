"""The trip latch's provenance in every status frame (package 3b, the
latch-sticky measurement contract, Codex R375–R377): what the product must
hold so the native driver can tell a fresh display of the trip from an old one.

- The INPUT of the trip automaton is unchanged: exactly what
  reader_get("trip_latched") gives, from ONE read of the reader's state at
  the evaluation (a stale TRUE still trips) — VM375-01.
- The reader brackets its latch read on CLOCK_MONOTONIC and numbers its
  snapshots — VM375-02.
- The poller publishes ONE object per tick with ONE rebind, `t_pub` stamped
  right before it, no await between the read and the publication; a client
  loop reads it ONCE per frame — Q-L3.
- `trip_basis` rides every full and delta frame, JSON and msgpack, and a frame
  never mixes two ticks even when a tick is published while it is built.
"""
import ast
import inspect
import json
import os
import tempfile
import textwrap
import time
import unittest

import fake_linuxcnc

linuxcnc = fake_linuxcnc.install()  # MUST precede `import gateway`

from fastapi.testclient import TestClient  # noqa: E402

import gateway  # noqa: E402
import gateway_util  # noqa: E402
import link_fixture  # noqa: E402
import ws_fanout  # noqa: E402
from test_helpers_admission import _HelperHarness  # noqa: E402
from test_ws_smoke import _decode  # noqa: E402

LATCH_PIN = "webui-hb-latch.fault-out"


# ── VM375-01: the input unchanged, the provenance beside it ─────────────────
class TheLatchInputIsWhatReaderGetGives(unittest.TestCase):

    def _bridge(self, state):
        b = gateway._hal_bridge
        self.addCleanup(setattr, b, "_reader_state", b._reader_state)
        b._reader_state = state
        return b

    def test_the_input_equals_reader_get_for_every_state(self):
        now = time.monotonic()
        states = [None,
                  ({"type": "snapshot"}, now),
                  ({"type": "snapshot", "trip_latched": False, "seq": 3, "latch_read": [now - 0.02, now - 0.01]}, now),
                  ({"type": "snapshot", "trip_latched": True, "seq": 4}, now - 10.0),      # stale
                  ({"type": "snapshot", "trip_latched": "odd"}, now)]
        for state in states:
            b = self._bridge(state)
            latched, basis = gateway_util.trip_latch_input(b.reader_state(), now, b.stale_sec)
            self.assertEqual(latched, b.reader_get("trip_latched"), state)
            self.assertEqual(basis["latched"], latched, "trip_basis names the input itself")

    def test_a_stale_true_still_trips_and_is_marked_stale(self):
        """Codex R375 VM375-01: after a known FALSE baseline, a present TRUE
        whose arrival is past READER_STALE_SEC trips as before the change;
        the provenance says stale, so the driver never takes it as fresh."""
        now = time.monotonic()
        old = ({"type": "snapshot", "trip_latched": True, "seq": 9, "latch_read": [now - 9.1, now - 9.0]}, now - 9.0)
        latched, basis = gateway_util.trip_latch_input(old, now, 2.0)
        self.assertIs(latched, True)
        self.assertIs(basis["stale"], True)
        tl = gateway_util.evaluate_trip_latch(latched, False, True)
        self.assertTrue(tl["tripped"], "the automaton trips on the stale TRUE, as before")

    def test_the_provenance_carries_seq_read_and_arrival(self):
        now = time.monotonic()
        state = ({"type": "snapshot", "trip_latched": False, "seq": 12, "latch_read": [now - 0.05, now - 0.049]}, now - 0.04)
        latched, basis = gateway_util.trip_latch_input(state, now, 2.0)
        self.assertEqual(basis, {"latched": False, "reader_seq": 12, "read": [now - 0.05, now - 0.049],
                                 "arrival": now - 0.04, "stale": False})

    def test_no_snapshot_or_no_field_is_none(self):
        self.assertEqual(gateway_util.trip_latch_input(None, 1.0, 2.0),
                         (None, {"latched": None, "reader_seq": None, "read": None, "arrival": None, "stale": None}))
        latched, basis = gateway_util.trip_latch_input(({"type": "snapshot"}, 1.0), 1.5, 2.0)
        self.assertIsNone(latched)
        self.assertIsNone(basis["reader_seq"])
        self.assertIsNone(basis["read"])


# ── the source: one read at the evaluation, no await to the publication ─────
def _function(src_obj, name=None):
    tree = ast.parse(textwrap.dedent(inspect.getsource(src_obj)))
    fn = tree.body[0]
    if name is None:
        return fn
    return next(n for n in ast.walk(fn) if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name == name)


def _calls(fn, name):
    return [n for n in ast.walk(fn) if isinstance(n, ast.Call) and isinstance(n.func, ast.Name) and n.func.id == name]


class ThePollerReadsOnceAndPublishesOnce(unittest.TestCase):

    def setUp(self):
        self.fn = _function(gateway._status_poller)

    def test_the_input_comes_from_one_read_at_the_evaluation(self):
        [call] = _calls(self.fn, "trip_latch_input")
        self.assertIsInstance(call.args[0], ast.Call)
        self.assertEqual(call.args[0].func.id, "_reader_state_now", "ONE read of the reader's state")
        [ev] = _calls(self.fn, "evaluate_trip_latch")
        assign = next(n for n in ast.walk(self.fn) if isinstance(n, ast.Assign) and n.value is call)
        self.assertIsInstance(ev.args[0], ast.Name, "the automaton takes a name bound from that read, no new read")
        self.assertEqual(ev.args[0].id, assign.targets[0].elts[0].id, "the automaton takes that read's input")
        # every other read of the latch field — by name or as an attribute call —
        # in its function: the ONE named exception is the safety chain's PRESENCE
        # check (is the latch component loaded at all), never a trip decision
        module = ast.parse(inspect.getsource(gateway))
        reads = []
        for fn in ast.walk(module):
            if not isinstance(fn, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            for n in ast.walk(fn):
                if isinstance(n, ast.Call) and n.args and isinstance(n.args[0], ast.Constant) \
                        and n.args[0].value == "trip_latched":
                    name = n.func.id if isinstance(n.func, ast.Name) else getattr(n.func, "attr", "")
                    if name in ("_reader_get", "_reader_fresh_get", "reader_get", "reader_fresh_get"):
                        reads.append(fn.name)
        self.assertEqual(sorted(set(reads)), ["_safety_chain_reason"],
                         "no second read of the latch for the trip decision; the presence check is the one exception")
        self.assertEqual(reads.count("_safety_chain_reason"), 1)

    def test_no_await_between_the_read_and_the_publication(self):
        [call] = _calls(self.fn, "trip_latch_input")
        pubs = [n for n in ast.walk(self.fn) if isinstance(n, ast.Assign)
                and any(isinstance(t, ast.Name) and t.id == "_published" for t in n.targets)]
        self.assertEqual(len(pubs), 1, "ONE rebind of the publication")
        start, end = call.lineno, pubs[0].lineno
        self.assertLess(start, end)
        awaits = [n.lineno for n in ast.walk(self.fn) if isinstance(n, ast.Await) and start <= n.lineno <= end]
        self.assertEqual(awaits, [], "an await here lets a client or the reader interleave")

    def test_t_pub_is_stamped_right_before_the_rebind(self):
        body = [n for n in ast.walk(self.fn) if isinstance(n, ast.Assign)]
        stamp = next(n for n in body if any(isinstance(t, ast.Name) and t.id == "_t_pub" for t in n.targets))
        pub = next(n for n in body if any(isinstance(t, ast.Name) and t.id == "_published" for t in n.targets))
        self.assertEqual(pub.lineno - stamp.lineno, 1, "nothing between the stamp and the rebind")


class TheClientLoopReadsThePublicationOnce(unittest.TestCase):

    def test_status_loop_reads_published_once_and_no_tick_global(self):
        loop = _function(gateway.ws_endpoint, "status_loop")
        loads = [n for n in ast.walk(loop) if isinstance(n, ast.Name) and isinstance(n.ctx, ast.Load)]
        self.assertEqual(sum(n.id == "_published" for n in loads), 1, "ONE read per frame")
        for stale in ("_shared_status", "_status_gen"):
            self.assertFalse(any(n.id == stale for n in loads), f"{stale} would mix two ticks into one frame")


# ── VM375-02: the reader numbers its snapshots and brackets the latch read ──
class TheReaderBracketsItsLatchRead(_HelperHarness):
    script = "hal_reader.py"
    sock_env = "WEBUI_READER_SOCK"

    def setUp(self):
        fd, self.values = tempfile.mkstemp(suffix=".json")
        os.close(fd)
        with open(self.values, "w") as f:
            json.dump({LATCH_PIN: False}, f)
        self.addCleanup(os.unlink, self.values)
        os.environ["FAKE_HAL_VALUES"] = self.values
        self.addCleanup(os.environ.pop, "FAKE_HAL_VALUES", None)
        super().setUp()

    def test_seq_rises_and_the_read_is_bracketed_on_this_host_s_clock(self):
        import asyncio

        async def run():
            b = self._bridge(self.instance)
            task = asyncio.create_task(b.reader_recv_loop())
            seen = []
            try:
                end = time.monotonic() + 5.0
                while time.monotonic() < end and len(seen) < 6:
                    st = b.reader_state()
                    if st is not None and (not seen or st[0]["seq"] != seen[-1][0]["seq"]):
                        seen.append(st)
                        if len(seen) == 3:
                            with open(self.values, "w") as f:
                                json.dump({LATCH_PIN: True}, f)
                    await asyncio.sleep(0.01)
            finally:
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass
            return seen

        seen = asyncio.run(run())
        self.assertGreaterEqual(len(seen), 6, "snapshots flowing")
        seqs = [s["seq"] for s, _ in seen]
        self.assertEqual(seqs, sorted(set(seqs)), "the number never falls or repeats")
        for snap, arrival in seen:
            r0, r1 = snap["latch_read"]
            self.assertLessEqual(r0, r1)
            self.assertLessEqual(r1, arrival, "read before the gateway's arrival: one clock on one host")
            self.assertLess(arrival - r0, 1.0)
        self.assertIs(seen[0][0]["trip_latched"], False)
        self.assertIs(seen[-1][0]["trip_latched"], True)

    def test_a_latch_read_that_fails_carries_no_bracket(self):
        with open(self.values, "w") as f:
            json.dump({}, f)
        import asyncio

        async def run():
            b = self._bridge(self.instance)
            task = asyncio.create_task(b.reader_recv_loop())
            try:
                end = time.monotonic() + 5.0
                while time.monotonic() < end:
                    st = b.reader_state()
                    if st is not None and st[0].get("seq", 0) >= 2:
                        return st
                    await asyncio.sleep(0.02)
            finally:
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass
            return None

        st = asyncio.run(run())
        self.assertIsNotNone(st)
        self.assertNotIn("trip_latched", st[0])
        self.assertNotIn("latch_read", st[0])


class TheBracketHoldsTheLatchReadAlone(unittest.TestCase):
    """The bracket is the latch's ONE hal.get_value and nothing else: a stamp
    at the snapshot's start would let a reading after SIGCONT pass as old
    (Codex R375 VM375-02) — no run time shows that, so the source holds it."""

    def test_the_stamps_sit_right_around_the_one_read(self):
        src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "hal_reader.py")).read()
        fn = next(n for n in ast.parse(src).body if isinstance(n, ast.FunctionDef) and n.name == "_build_snapshot")
        blocks = [n.body for n in ast.walk(fn) if isinstance(n, ast.If)
                  and isinstance(n.test, ast.Compare) and getattr(n.test.comparators[0], "id", "") == "LATCH_FIELD"]
        self.assertEqual(len(blocks), 1, "one branch for the latch field")
        stmts = [ast.unparse(x) for x in blocks[0]]
        self.assertEqual(stmts[:3], ["r0 = time.monotonic()", "raw = hal.get_value(source)", "r1 = time.monotonic()"])
        self.assertIn("snap['latch_read'] = [r0, r1]", stmts)


# ── the frames: every path carries the tick's trip_basis, never two ticks ───
class EveryFrameCarriesItsTicksBasis(unittest.TestCase):

    def setUp(self):
        if not getattr(gateway.linuxcnc, "__lcnc_fake__", False):
            self.skipTest("needs the fake binding (run under pytest)")
        link_fixture.restore_after(self)
        self.addCleanup(setattr, gateway, "_get_lcnc_pid", gateway._get_lcnc_pid)
        self.addCleanup(setattr, gateway, "_nml_connectable", gateway._nml_connectable)
        gateway._get_lcnc_pid = lambda: 424242
        gateway._nml_connectable = lambda: True
        self.assertTrue(gateway.try_connect_lcnc(), "fake linuxcnc must connect")
        b = gateway._hal_bridge
        self.addCleanup(setattr, b, "_reader_state", b._reader_state)
        # each test starts without a publication: a tick of another test
        # (or a switched one) is never this session's first frame
        self.addCleanup(setattr, gateway, "_published", gateway._published)
        gateway._published = None
        now = time.monotonic()
        self.read = [now - 0.002, now - 0.001]
        b._reader_state = ({"type": "snapshot", "trip_latched": False, "seq": 41, "latch_read": self.read}, now)

    def _path(self, wire, delta):
        for obj, name, value in ((ws_fanout, "WIRE_FORMAT", wire), (gateway, "_WIRE_FORMAT", wire),
                                 (gateway, "_STATUS_DELTA_ENABLED", delta)):
            self.addCleanup(setattr, obj, name, getattr(obj, name))
            setattr(obj, name, value)

    def _frames(self, n, on_frame=None):
        out = []
        with TestClient(gateway.app) as client, client.websocket_connect("/ws") as ws:
            ws.send_json({"cmd": "hello", "session": "trip-basis", "resume_armed": False})
            end, beat = time.monotonic() + 15.0, 0.0
            while time.monotonic() < end and len(out) < n:
                if time.monotonic() - beat > 0.1:
                    ws.send_json({"cmd": "heartbeat"})
                    beat = time.monotonic()
                msg = _decode(ws.receive())
                if msg.get("type") in ("status", "status_delta"):
                    out.append(msg)
                    if on_frame is not None:
                        on_frame(msg)
        self.assertEqual(len(out), n, "status frames within 15 s")
        return out

    def _check(self, frames):
        gens = []
        for f in frames:
            tb = f.get("trip_basis")
            self.assertIsInstance(tb, dict, f"{f['type']} without trip_basis")
            self.assertEqual(tb["epoch"], gateway._TRIP_EPOCH)
            self.assertIs(tb["latched"], False)
            self.assertEqual(tb["reader_seq"], 41)
            self.assertEqual(list(tb["read"]), self.read)
            self.assertIs(tb["stale"], False)
            self.assertLessEqual(tb["arrival"], tb["t_pub"])
            gens.append(tb["gen"])
        self.assertEqual(gens, sorted(set(gens)), "at most one frame per tick, in tick order")

    def test_msgpack_shared_full_frames(self):
        self._path("msgpack", False)
        frames = self._frames(4)
        self.assertEqual({f["type"] for f in frames}, {"status"})
        self._check(frames)

    def test_msgpack_delta_frames(self):
        self._path("msgpack", True)
        frames = self._frames(5)
        self.assertEqual(frames[0]["type"], "status")
        self.assertIn("status_delta", {f["type"] for f in frames[1:]})
        self._check(frames)

    def test_json_full_frames(self):
        self._path("json", False)
        frames = self._frames(4)
        self._check(frames)

    def test_json_delta_frames(self):
        self._path("json", True)
        frames = self._frames(5)
        self.assertIn("status_delta", {f["type"] for f in frames[1:]})
        self._check(frames)

    def _a_tick_published_while_the_frame_is_built(self, wire, delta):
        """Q-L3 (Codex R375): a tick published while a frame is built — here
        during the connection's first frame, at its viewer_init (an await in
        the build) — must not reach that frame: status, data and trip_basis
        are all the tick the frame started from."""
        self._path(wire, delta)
        seen = {}
        real = gateway.build_viewer_init

        def switching(*a, **k):
            pub = gateway._published
            seen["pub"] = pub
            other = dict(pub.status_dict or {}, active_file="/SWITCHED.ngc")
            gateway._published = ws_fanout.StatusPublication(
                gen=pub.gen + 1000, status=pub.status, status_dict=other,
                data_msgpack=(gateway._msgpack_encoder.encode(other) if pub.data_msgpack is not None else None),
                errors=[], clients_list=[], probe_updates={},
                trip_basis={**pub.trip_basis, "gen": pub.gen + 1000, "reader_seq": 999})
            return real(*a, **k)

        self.addCleanup(setattr, gateway, "build_viewer_init", real)
        gateway.build_viewer_init = switching
        [first] = self._frames(1)
        pub = seen["pub"]
        self.assertEqual(first["trip_basis"]["gen"], pub.gen, "the frame's tick, not the one published meanwhile")
        self.assertEqual(first["trip_basis"]["reader_seq"], 41)
        self.assertNotEqual(first["data"].get("active_file"), "/SWITCHED.ngc", "data from the same tick")

    def test_a_tick_published_mid_build_msgpack_shared(self):
        self._a_tick_published_while_the_frame_is_built("msgpack", False)

    def test_a_tick_published_mid_build_msgpack_delta(self):
        self._a_tick_published_while_the_frame_is_built("msgpack", True)

    def test_a_tick_published_mid_build_json_full(self):
        self._a_tick_published_while_the_frame_is_built("json", False)

    def test_a_tick_published_mid_build_json_delta(self):
        self._a_tick_published_while_the_frame_is_built("json", True)

    def _a_tick_published_while_a_delta_frame_is_built(self, wire):
        """Q-L3 for a DELTA frame: a later frame whose build awaits (the tool
        library read on a tool-meta tick, in a thread) while another tick is
        published. Every frame is ONE tick: a frame of the switched tick
        carries its trip_basis AND its data (the delta names its active_file);
        a frame of a real tick carries neither — never a mix."""
        self._path(wire, True)
        stat = link_fixture.current().stat              # a tool in the spindle: the tool-meta read happens
        had, old = hasattr(stat, "tool_in_spindle"), getattr(stat, "tool_in_spindle", None)
        self.addCleanup(lambda: setattr(stat, "tool_in_spindle", old) if had else delattr(stat, "tool_in_spindle"))
        stat.tool_in_spindle = 1
        seen, marked = {}, {}
        real = gateway.load_tool_library

        def switching(*a, **k):
            if marked.get("armed") and "pub" not in seen:
                pub = gateway._published
                seen["pub"] = pub
                other = dict(pub.status_dict or {}, active_file="/SWITCHED.ngc")
                gateway._published = ws_fanout.StatusPublication(
                    gen=pub.gen + 1000, status=pub.status, status_dict=other, data_msgpack=None,
                    errors=[], clients_list=[], probe_updates={},
                    trip_basis={**pub.trip_basis, "gen": pub.gen + 1000, "reader_seq": 999})
            return real(*a, **k)

        self.addCleanup(setattr, gateway, "load_tool_library", real)
        self.addCleanup(setattr, gateway, "_tool_meta_dirty", gateway._tool_meta_dirty)
        gateway.load_tool_library = switching

        def on_frame(msg):
            if "armed" not in marked and msg["type"] == "status_delta":
                marked["armed"] = True
                gateway._tool_meta_dirty = True        # the next build reads the tool library
        frames = self._frames(10, on_frame)
        self.assertIn("pub", seen, f"the switch never happened; types {[f['type'] for f in frames]}")
        fake = seen["pub"].gen + 1000
        for f in frames:
            tb, switched = f["trip_basis"], f["data"].get("active_file") == "/SWITCHED.ngc"
            if tb["gen"] == fake:
                self.assertEqual(tb["reader_seq"], 999)
                self.assertTrue(switched or f["type"] == "status", f"the switched tick without its data: {f}")
            else:
                self.assertEqual(tb["reader_seq"], 41, f"a real tick's frame with the switched provenance: {tb}")
                self.assertFalse(switched, f"a real tick's frame with the switched data: {tb}")

    def test_a_tick_published_mid_build_of_a_delta_frame_json(self):
        self._a_tick_published_while_a_delta_frame_is_built("json")

    def test_a_tick_published_mid_build_of_a_delta_frame_msgpack(self):
        self._a_tick_published_while_a_delta_frame_is_built("msgpack")

    def test_a_published_tick_stays_as_it_was_published(self):
        """Frames built from a tick (the copy for the delta, tool_meta at the
        top level) never change it: what the next client reads is the tick."""
        self._path("json", True)
        kept = {}

        def keep(_msg):
            if "pub" not in kept:
                pub = gateway._published
                kept["pub"] = pub
                kept["before"] = json.dumps([pub.status_dict, pub.trip_basis, pub.errors], sort_keys=True, default=str)
        self._frames(5, keep)
        pub = kept["pub"]
        self.assertIsNot(gateway._published, pub, "later ticks were published and sent")
        self.assertEqual(json.dumps([pub.status_dict, pub.trip_basis, pub.errors], sort_keys=True, default=str),
                         kept["before"])


if __name__ == "__main__":
    unittest.main()
