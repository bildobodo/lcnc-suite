"""The jog lease in the gateway (P1b, machine day 2026-11-21; plan agreed with
Codex R423–R426): a continuous jog from the WebUI lives only while the page's
main thread renews its lease.

Two levels. The handler level (_Writer: the real handlers, `_cmd_blocking`
and its write thread on a recording CMD) pins ownership and the change: a
lease's stop reaches only an axis whose booking still carries that lease
(Codex R425 MT425-01), a change's new jogs pass the same admissions as
jog_cont, a lease that died between two writes stops what it wrote. The
WebSocket level (the reader, the client's FIFO, `_cmd_lock` and the write
over the fake binding, on real time with the real 500 ms validity) pins the
receipt anchor: renewals keep a jog, their absence ends it, a start that
waits past its deadline is never written, a late renewal revives nothing,
an abort / a disarm / a disconnect end the client's leases.

Lease receipt in the handler level is the reader's own function
(`_receive_jog_lease`), called outside a loop (no timer: a test runs the
expiry itself); a deadline is put in the past on the lease object — the
state the timer would find."""
import asyncio
import json
import threading
import time
import unittest
from unittest import mock

import fake_linuxcnc
linuxcnc = fake_linuxcnc.install()

import msgspec  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import gateway  # noqa: E402
import jog_lease  # noqa: E402
import link_fixture  # noqa: E402
from command_policy import NOT_ARMED  # noqa: E402
from link_fixture import current  # noqa: E402
from test_button_gates import _RecordingCmd, _payload, _run, controller_reads  # noqa: E402
from test_button_gates_d import _Writer  # noqa: E402

JC, JS = linuxcnc.JOG_CONTINUOUS, linuxcnc.JOG_STOP


class _Lease(_Writer):
    def setUp(self):
        super().setUp()
        self.takes_the_mode()
        gateway._active_jogs.clear()
        p = mock.patch.object(gateway, "_jog_leases", jog_lease.LeaseTable())
        p.start()
        self.addCleanup(p.stop)
        self.ck = self.writer.conn_key
        self.notes = []

        async def note(conn_key, frame):
            self.notes.append((conn_key, frame))
        p = mock.patch.object(gateway, "_notify_lease_owner", note)
        p.start()
        self.addCleanup(p.stop)

    # --- the reader's receipt and the lease's clock ----------------------
    def receive(self, msg, ck=None):
        gateway._receive_jog_lease(ck or self.ck, msg)
        return msg

    def lease(self, lease_id, ck=None):
        return gateway._jog_leases.get((ck or self.ck, lease_id))

    def run_out(self, lease_id, ck=None):
        """The lease's deadline is past — what its timer would find."""
        self.lease(lease_id, ck).deadline = time.monotonic() - 0.001

    def expire(self, lease_id, ck=None):
        lz = self.lease(lease_id, ck)
        self.run_out(lease_id, ck)
        self.assertIsNone(gateway._jog_leases.due(lz.key, time.monotonic()))
        gateway._cmd_lock = None
        _run(gateway._expire_jog_lease(lz))

    # --- what was written --------------------------------------------------
    def writes(self):
        return [a for n, a, _k in self.cmd.calls if n == "jog"]

    def starts(self):
        return [a for a in self.writes() if a[0] == JC]

    def stops(self):
        return [a for a in self.writes() if a[0] == JS]

    def owner(self, axis):
        owner = gateway._jog_row_owner(gateway._active_jogs.get(axis))
        return None if owner is None else owner[0]

    def jog(self, lease_id, axis=0, vel=5.0, ck=None, armed=True):
        msg = self.receive({"cmd": "jog_cont", "axis": axis, "vel": vel, "lease": lease_id}, ck)
        return self.send_as(msg, ck, armed)

    def change(self, lease_id, stop, axes, ck=None, armed=True, **extra):
        msg = self.receive({"cmd": "jog_change", "lease": lease_id, "stop": stop, "axes": axes, **extra}, ck)
        return self.send_as(msg, ck, armed)

    def end(self, lease_id, ck=None):
        msg = self.receive({"cmd": "jog_lease_end", "lease": lease_id}, ck)
        return self.send_as(msg, ck)

    def send_as(self, msg, ck=None, armed=True, **over):
        gateway._shared_status = _payload(**{"inpos": True, "current_vel": 0.0, **over})
        gateway._cmd_lock = None
        return _run(gateway.handle_command(msg, armed, ck or self.ck))

    def second_connection(self):
        other = gateway.ClientState(ip="e", ws=None, armed=True)
        gateway._clients[922] = other
        return other.conn_key


class TestTheBooking(_Lease):
    def test_a_leased_jog_is_booked_with_its_lease(self):
        self.assertEqual(self.jog(1), {"ok": True})
        self.assertEqual(self.starts(), [(JC, 1, 0, 5.0)])
        self.assertEqual(self.owner(0), (self.ck, 1))

    def test_a_jog_without_a_lease_keeps_the_jog_until_stop_contract(self):
        with mock.patch.object(gateway._trace, "emit") as emit:
            r = self.send_as({"cmd": "jog_cont", "axis": 0, "vel": 5.0})
        self.assertEqual(r, {"ok": True})
        self.assertIsNone(self.owner(0), "no owner: no lease stops it, the operator's stop does")
        self.assertIn("jog.cont_without_lease", [c.args[0] for c in emit.call_args_list])

    def test_a_step_never_carries_a_lease(self):
        current().stat.motion_mode = linuxcnc.TRAJ_MODE_TELEOP    # the step's mode, as judged
        with mock.patch.object(gateway, "step_span_refusal", return_value=None):   # its travel: not this test's
            r = self.send_as({"cmd": "jog_incr", "axis": 0, "vel": 5.0, "distance": 1.0})
        self.assertEqual(r, {"ok": True})
        self.assertIsNone(self.owner(0))


class TestTheDeadline(_Lease):
    def test_a_start_past_its_deadline_writes_nothing(self):
        msg = self.receive({"cmd": "jog_cont", "axis": 0, "vel": 5.0, "lease": 1})
        self.run_out(1)
        r = self.send_as(msg)
        self.assertEqual(r, {"ok": False, "error": jog_lease.JOG_LEASE_DEAD, "expired": True})
        self.assertEqual(self.writes(), [])
        self.assertNotIn("mode", self.cmd.names(), "nothing at all: not even the switch to MANUAL")

    def test_the_deadline_passing_at_the_write_writes_nothing(self):
        """Every check before the queue passed; the lease runs out after the
        write was queued for its thread — the thread's own check refuses."""
        msg = self.receive({"cmd": "jog_cont", "axis": 0, "vel": 5.0, "lease": 1})
        r = self.at_the_write(msg, lambda: self.run_out(1))
        self.assertEqual(r["ok"], False)
        self.assertTrue(r.get("expired"), r)
        self.assertEqual(self.starts(), [])
        self.assertEqual(gateway._active_jogs, {})

    def test_a_multi_jog_whose_lease_dies_between_its_writes_stops_what_it_wrote(self):
        msg = self.receive({"cmd": "jog_cont_multi", "lease": 1,
                            "axes": [{"axis": 0, "vel": 5.0}, {"axis": 1, "vel": 5.0}]})
        # writes: teleop on (1), the first jog (2), the second jog (3)
        r = self.at_the_write(msg, lambda: self.run_out(1), at=3)
        self.assertEqual(r, {"ok": False, "error": jog_lease.JOG_LEASE_DEAD, "expired": True})
        self.assertEqual(self.starts(), [(JC, 1, 0, 5.0)], "the second axis was never written")
        self.assertEqual(self.stops(), [(JS, 1, 0)], "the first one stops at once")
        self.assertEqual(gateway._active_jogs, {})

    def test_a_lease_begun_on_another_controller_link_starts_nothing(self):
        msg = self.receive({"cmd": "jog_cont", "axis": 0, "vel": 5.0, "lease": 1})
        self.lease(1).link = object()          # the Link was replaced since the receipt
        r = self.send_as(msg)
        self.assertEqual(r["error"], jog_lease.JOG_LEASE_FOREIGN_LINK)
        self.assertNotIn("expired", r, "a Link change is no page delay")
        self.assertEqual(self.writes(), [])


class TestTheExpiry(_Lease):
    def test_the_expiry_stops_the_axes_its_lease_still_owns(self):
        self.jog(1, axis=0)
        self.jog(1, axis=1)          # the same gesture, a second axis (a stick diagonal)
        self.expire(1)
        self.assertEqual(sorted(self.stops()), [(JS, 1, 0), (JS, 1, 1)])
        self.assertEqual(gateway._active_jogs, {})
        self.assertEqual(self.notes, [(self.ck, {"type": "jog_lease_expired", "id": 1, "axes": [0, 1],
                                                 "stop_failed": []})])
        self.assertIsNone(self.lease(1), "forgotten — and its id stays dead")
        self.assertEqual(gateway._jog_leases.renew(self.ck, [1], time.monotonic()), [1])

    def test_an_expired_lease_leaves_an_axis_another_gesture_took(self):
        """Codex R425 MT425-01: A's lease runs out while B already took the
        axis — A's late expiry stops nothing of B's."""
        self.jog(1, axis=0)
        self.jog(2, axis=0)           # another gesture of this page takes X
        self.run_out(1)
        self.expire(1)
        self.assertEqual(self.stops(), [])
        self.assertEqual(self.owner(0), (self.ck, 2))
        self.assertEqual(self.notes[0][1]["axes"], [])

    def test_another_connections_jog_is_never_a_leases_to_stop(self):
        other = self.second_connection()
        self.jog(5, axis=0)
        self.jog(5, axis=0, ck=other)   # the same id on another connection: another lease
        self.expire(5)
        self.assertEqual(self.stops(), [])
        self.assertEqual(self.owner(0), (other, 5))

    def test_a_failed_stop_keeps_its_booking_and_says_so(self):
        self.jog(1)
        recorded = self.cmd.calls

        def jog(*a):
            if a[0] == JS:
                raise linuxcnc.error("channel gone")
            recorded.append(("jog", a, {}))
        self.cmd.jog = jog
        self.expire(1)
        self.assertEqual(self.owner(0), (self.ck, 1), "still booked: an operator stop can still reach it")
        frame = self.notes[0][1]
        self.assertEqual(frame["stop_failed"], [0])
        self.assertEqual(frame["error"], gateway.JOG_LEASE_STOP_FAILED)

    def test_without_a_controller_link_the_expiry_says_so(self):
        self.jog(1)
        with mock.patch.object(gateway, "current_link", return_value=None):
            self.expire(1)
        self.assertEqual(self.stops(), [])
        self.assertEqual(self.notes[0][1]["stop_failed"], [0])

    def test_in_auto_running_nothing_is_sent(self):
        self.jog(1)
        self.controller(task_mode=linuxcnc.MODE_AUTO, interp_state=linuxcnc.INTERP_READING)
        self.expire(1)
        self.assertEqual(self.stops(), [])


class TestTheChange(_Lease):
    def test_a_reversal_under_a_live_lease(self):
        self.jog(1, vel=5.0)
        r = self.change(1, [0], [{"axis": 0, "vel": -5.0}])
        self.assertEqual(r, {"ok": True})
        self.assertEqual(self.writes(), [(JC, 1, 0, 5.0), (JS, 1, 0), (JC, 1, 0, -5.0)])
        self.assertEqual(self.owner(0), (self.ck, 1))

    def test_a_reversal_after_the_deadline_only_stops(self):
        self.jog(1, vel=5.0)
        msg = self.receive({"cmd": "jog_change", "lease": 1, "stop": [0], "axes": [{"axis": 0, "vel": -5.0}]})
        self.run_out(1)
        r = self.send_as(msg)
        self.assertEqual(r, {"ok": False, "error": jog_lease.JOG_LEASE_DEAD, "expired": True})
        self.assertEqual(self.writes(), [(JC, 1, 0, 5.0), (JS, 1, 0)])

    def test_an_ended_gesture_cannot_reopen_as_a_change(self):
        """The pad's Stop ends every lease (jog_lease_end): a later change of
        the same id starts nothing."""
        self.jog(1)
        self.assertEqual(self.end(1), {"ok": True})
        self.assertEqual(self.stops(), [(JS, 1, 0)])
        r = self.change(1, [], [{"axis": 0, "vel": 5.0}])
        self.assertEqual(r["error"], jog_lease.JOG_LEASE_DEAD)
        self.assertEqual(self.starts(), [(JC, 1, 0, 5.0)], "no second start")

    def test_a_stick_diagonal_then_one_axis_then_the_other(self):
        self.jog(1, axis=0)
        self.jog(1, axis=1)
        self.assertEqual(self.change(1, [0], []), {"ok": True})                      # X leaves, Y goes on
        self.assertEqual(self.owner(1), (self.ck, 1))
        self.assertEqual(self.change(1, [1], [{"axis": 0, "vel": 5.0}]), {"ok": True})  # Y leaves, X again
        self.assertEqual(self.writes(), [(JC, 1, 0, 5.0), (JC, 1, 1, 5.0), (JS, 1, 0), (JS, 1, 1), (JC, 1, 0, 5.0)])
        self.assertEqual(set(gateway._active_jogs), {0})

    def test_a_change_stops_only_what_its_lease_owns(self):
        """Codex R425 MT425-01: a named axis owned by another gesture, or by
        nobody, is not stopped by this lease's change."""
        other = self.second_connection()
        self.jog(1, axis=0)
        self.jog(7, axis=1, ck=other)
        gateway._active_jogs[2] = (1, 2)                       # a jog without a lease
        r = self.change(1, [0, 1, 2], [])
        self.assertEqual(r, {"ok": True})
        self.assertEqual(self.stops(), [(JS, 1, 0)])
        self.assertEqual(self.owner(1), (other, 7))
        self.assertIn(2, gateway._active_jogs)

    def test_a_partial_failure_stays_booked_and_is_reported(self):
        """The change's stop is written, its first new axis too, the second
        is refused at its write: the written one stays booked under the lease
        (its expiry or end still reaches it), the refusal is the reply."""
        self.jog(1, axis=0)
        msg = self.receive({"cmd": "jog_change", "lease": 1, "stop": [0],
                            "axes": [{"axis": 1, "vel": 5.0}, {"axis": 2, "vel": 5.0}]})
        # writes: the stop (1), teleop on (2), the first new jog (3), the second (4)
        r = self.at_the_write(msg, lambda: controller_reads(current().stat, homed=False), at=4)
        self.assertFalse(r["ok"], r)
        self.assertNotIn("expired", r, "a refusal of the machine, not of the lease")
        self.assertEqual(self.owner(1), (self.ck, 1))
        self.assertNotIn(2, gateway._active_jogs)
        self.assertNotIn(0, gateway._active_jogs)

    def test_the_start_half_is_admitted_like_jog_cont(self):
        self.jog(1, axis=0)
        r = self.change(1, [0], [{"axis": 0, "vel": -5.0}], armed=False)
        self.assertEqual(r, {"ok": False, "error": NOT_ARMED})
        self.assertEqual(self.writes(), [(JC, 1, 0, 5.0), (JS, 1, 0)], "the stop half ran, nothing started")
        with mock.patch.object(gateway, "_feature_refusal", side_effect=lambda f: "Gamepad switched off"
                               if f == "gamepad" else None):
            self.jog(2, axis=1)
            r = self.change(2, [1], [{"axis": 1, "vel": -5.0}], via="gamepad")
        self.assertEqual(r, {"ok": False, "error": "Gamepad switched off"})
        self.assertEqual(self.stops()[-1], (JS, 1, 1), "the gamepad's stop half passes with the gamepad off")
        self.jog(3, axis=2)
        self.controller(task_mode=linuxcnc.MODE_MDI, interp_state=linuxcnc.INTERP_READING)
        r = self.change(3, [], [{"axis": 2, "vel": 1.0}])
        self.assertFalse(r["ok"])
        self.assertEqual(len(self.starts()), 3, "no start while an MDI runs")

    def test_a_faulted_change_ends_its_lease(self):
        self.jog(1)
        r = self.change(1, [0], [{"axis": 0, "vel": "fast"}])
        self.assertEqual(r, {"ok": True})
        self.assertEqual(self.stops(), [(JS, 1, 0)])
        self.assertIsNone(self.lease(1))
        self.assertEqual(len(self.starts()), 1)

    def test_a_faulted_end_ends_every_lease_of_the_connection(self):
        other = self.second_connection()
        self.jog(1, axis=0)
        self.jog(2, axis=1)
        self.jog(1, axis=2, ck=other)
        r = self.send_as(self.receive({"cmd": "jog_lease_end", "lease": "x"}))
        self.assertEqual(r, {"ok": True})
        self.assertEqual(sorted(self.stops()), [(JS, 1, 0), (JS, 1, 1)])
        self.assertEqual(self.owner(2), (other, 1), "another connection's gesture is not this one's")


# ─── the WebSocket level: receipt, queue, lock and write on real time ────────

def _decode(m):
    if m.get("bytes") is not None:
        return msgspec.msgpack.decode(m["bytes"])
    return json.loads(m["text"])


class _Ws(unittest.TestCase):
    """The real reader, the client's FIFO, `_cmd_lock` and the write over the
    fake binding (a recording CMD), with the controller on, idle, homed."""

    def setUp(self):
        saved = link_fixture.snapshot()
        self.addCleanup(link_fixture.restore, saved)
        orig = (gateway._get_lcnc_pid, gateway._nml_connectable, gateway.handle_command)
        self.addCleanup(lambda: (setattr(gateway, "_get_lcnc_pid", orig[0]),
                                 setattr(gateway, "_nml_connectable", orig[1]),
                                 setattr(gateway, "handle_command", orig[2])))
        gateway._get_lcnc_pid = lambda: 424242
        gateway._nml_connectable = lambda: True
        self.assertTrue(gateway.try_connect_lcnc(), "fake linuxcnc must connect")
        self.cmd = _RecordingCmd()
        conn = link_fixture.FakeConnection(stat=gateway._link.stat, cmd=self.cmd, err=gateway._link.err)
        link_fixture._install(conn)
        controller_reads(conn.stat)
        conn.stat.axis_mask = 0b111
        jogs = dict(gateway._active_jogs)
        self.addCleanup(lambda: (gateway._active_jogs.clear(), gateway._active_jogs.update(jogs)))
        gateway._active_jogs.clear()
        p = mock.patch.object(gateway, "_jog_leases", jog_lease.LeaseTable())
        p.start()
        self.addCleanup(p.stop)
        b = gateway._hal_bridge
        self.addCleanup(setattr, b, "_reader_state", b._reader_state)
        self.bridge = b
        self.fresh_reader()
        self.frames = []
        self.real_handle = orig[2]

    def fresh_reader(self):
        now = time.monotonic()
        self.bridge._reader_state = ({"type": "snapshot", "trip_latched": False, "seq": 1, "latch_read": [now, now],
                                      "axis.z.eoffset-enable": False, "axis.z.eoffset": 0.0}, now)

    def slow_command(self, seconds):
        """A stand-in command `zz_slow` that holds `_cmd_lock` for `seconds`
        on the client's FIFO; every other command runs the real handler."""
        real = self.real_handle

        async def handle(msg, armed, conn_key=None):
            if msg.get("cmd") == "zz_slow":
                async with gateway._get_cmd_lock():
                    await asyncio.sleep(seconds)
                return {"ok": True}
            return await real(msg, armed, conn_key)
        gateway.handle_command = handle

    def pump(self, ws, seconds, until=None, renew=None, every=0.1):
        """Heartbeats (and `renew` ids every `every` s) from their own thread
        — the page's timer never waits for a frame — while receiving for
        `seconds` or until until(frame). Returns the frames read."""
        out = []
        t0 = time.monotonic()
        stop = threading.Event()

        def beat():
            while not stop.is_set():
                ws.send_json({"cmd": "heartbeat"})
                if renew:
                    ws.send_json({"cmd": "jog_renew", "ids": renew})
                self.fresh_reader()
                stop.wait(every)
        beater = threading.Thread(target=beat, daemon=True)
        beater.start()
        try:
            self._receive_loop(ws, t0, seconds, until, out)
        finally:
            stop.set()
            beater.join()
        return out

    def _receive_loop(self, ws, t0, seconds, until, out):
        while time.monotonic() - t0 < seconds:
            f = _decode(ws.receive())
            f["_t"] = time.monotonic()
            out.append(f)
            self.frames.append(f)
            if until is not None and until(f):
                break

    def arm(self, ws):
        ws.send_json({"cmd": "hello", "session": "jog-lease", "resume_armed": False})
        ws.send_json({"cmd": "arm", "armed": True})
        self.pump(ws, 8.0, until=lambda f: gateway._shared_status is not None and any(
            g.get("type") == "reply" and g.get("armed") is True for g in self.frames))
        self.assertIsNotNone(gateway._shared_status, "no status within 8 s")
        self.conn_key = next(c.conn_key for c in gateway._clients.values())

    def reply(self, req_id):
        for f in self.frames:
            if f.get("type") == "reply" and f.get("req_id") == req_id:
                return f
        return None

    def writes(self):
        return [a for n, a, _k in self.cmd.calls if n == "jog"]


class TestTheReceiptAnchor(_Ws):
    def test_renewals_keep_a_jog_and_their_absence_ends_it(self):
        with TestClient(gateway.app) as client, client.websocket_connect("/ws") as ws:
            self.arm(ws)
            ws.send_json({"cmd": "jog_cont", "axis": 0, "vel": 5.0, "lease": 1, "req_id": "j1"})
            self.pump(ws, 1.5, renew=[1])
            self.assertEqual(self.reply("j1")["ok"], True)
            self.assertEqual(self.writes(), [(JC, 1, 0, 5.0)], "1.5 s of renewals: no stop")
            t_last = time.monotonic()
            got = self.pump(ws, 2.0, until=lambda f: f.get("type") == "jog_lease_expired")
            self.assertEqual(got[-1].get("type"), "jog_lease_expired", "the expiry reached the page")
            self.assertEqual((got[-1]["id"], got[-1]["axes"]), (1, [0]))
            self.assertEqual(self.writes()[-1], (JS, 1, 0))
            self.assertEqual(gateway._active_jogs, {})
            took = got[-1]["_t"] - t_last
            self.assertLess(took, jog_lease.JOG_LEASE_TTL_S + 0.6, f"expiry after {took:.3f} s (bounded; the real overrun is the sim probe's)")

    def test_a_start_that_waits_past_its_deadline_is_never_written(self):
        self.slow_command(1.0)
        with TestClient(gateway.app) as client, client.websocket_connect("/ws") as ws:
            self.arm(ws)
            ws.send_json({"cmd": "zz_slow"})
            ws.send_json({"cmd": "jog_cont", "axis": 0, "vel": 5.0, "lease": 2, "req_id": "j2"})
            self.pump(ws, 3.0, until=lambda f: f.get("req_id") == "j2")
            r = self.reply("j2")
            self.assertEqual((r["ok"], r.get("expired")), (False, True), r)
            self.assertEqual(self.writes(), [], "the queue and the lock never extend the deadline")

    def test_renewals_while_it_waits_keep_the_start(self):
        self.slow_command(1.0)
        with TestClient(gateway.app) as client, client.websocket_connect("/ws") as ws:
            self.arm(ws)
            ws.send_json({"cmd": "zz_slow"})
            ws.send_json({"cmd": "jog_cont", "axis": 0, "vel": 5.0, "lease": 3, "req_id": "j3"})
            self.pump(ws, 3.0, until=lambda f: f.get("req_id") == "j3", renew=[3])
            self.assertEqual(self.reply("j3")["ok"], True)
            self.assertEqual(self.writes(), [(JC, 1, 0, 5.0)])
            ws.send_json({"cmd": "jog_lease_end", "lease": 3, "req_id": "e3"})
            self.pump(ws, 2.0, until=lambda f: f.get("req_id") == "e3")
            self.assertEqual(self.writes()[-1], (JS, 1, 0))

    def test_late_renewals_revive_nothing(self):
        with TestClient(gateway.app) as client, client.websocket_connect("/ws") as ws:
            self.arm(ws)
            ws.send_json({"cmd": "jog_cont", "axis": 0, "vel": 5.0, "lease": 4, "req_id": "j4"})
            self.pump(ws, 2.0, until=lambda f: f.get("type") == "jog_lease_expired" and not f.get("late_renewal"))
            for _ in range(5):                       # what a page that hung had stored
                ws.send_json({"cmd": "jog_renew", "ids": [4]})
            ws.send_json({"cmd": "jog_change", "lease": 4, "stop": [], "axes": [{"axis": 0, "vel": 5.0}],
                          "req_id": "c4"})
            self.pump(ws, 2.0, until=lambda f: f.get("req_id") == "c4")
            late = [f for f in self.frames if f.get("type") == "jog_lease_expired" and f.get("late_renewal")]
            self.assertEqual(len(late), 5)
            self.assertEqual(self.reply("c4").get("expired"), True)
            self.assertEqual([w for w in self.writes() if w[0] == JC], [(JC, 1, 0, 5.0)], "never a second start")


class TestTheClientsLeasesEnd(_Ws):
    def test_an_abort_ends_them_and_a_kept_change_starts_nothing(self):
        """A change queued before the abort is a stop: kept, never superseded
        — its stop half runs, its start half finds the lease ended."""
        self.slow_command(1.0)
        with TestClient(gateway.app) as client, client.websocket_connect("/ws") as ws:
            self.arm(ws)
            ws.send_json({"cmd": "zz_slow"})
            ws.send_json({"cmd": "jog_change", "lease": 5, "stop": [], "axes": [{"axis": 0, "vel": 5.0}],
                          "req_id": "c5"})
            ws.send_json({"cmd": "abort", "req_id": "a5"})
            self.pump(ws, 3.0, until=lambda f: f.get("req_id") == "c5", renew=[5])
            self.assertEqual(self.reply("c5").get("error"), jog_lease.JOG_LEASE_DEAD)
            self.assertEqual(self.writes(), [])

    def test_a_disarm_ends_them(self):
        with TestClient(gateway.app) as client, client.websocket_connect("/ws") as ws:
            self.arm(ws)
            ws.send_json({"cmd": "jog_cont", "axis": 0, "vel": 5.0, "lease": 6, "req_id": "j6"})
            self.pump(ws, 2.0, until=lambda f: f.get("req_id") == "j6", renew=[6])
            ws.send_json({"cmd": "arm", "armed": False, "req_id": "d6"})
            self.pump(ws, 2.0, until=lambda f: f.get("type") == "reply" and f.get("armed") is False)
            self.assertEqual(self.writes()[-1], (JS, 1, 0), "the disarm stops the jog")
            self.assertFalse(gateway._jog_leases.is_live((self.conn_key, 6), time.monotonic()))
            self.pump(ws, 0.5, until=lambda f: f.get("type") == "jog_lease_expired", renew=[6])
            self.assertTrue(any(f.get("type") == "jog_lease_expired" and f.get("id") == 6 for f in self.frames),
                            "its renewals are answered dead")

    def test_a_disconnect_drops_them(self):
        with TestClient(gateway.app) as client:
            with client.websocket_connect("/ws") as ws:
                self.arm(ws)
                ws.send_json({"cmd": "jog_cont", "axis": 0, "vel": 5.0, "lease": 7, "req_id": "j7"})
                self.pump(ws, 2.0, until=lambda f: f.get("req_id") == "j7", renew=[7])
                key = self.conn_key
            deadline = time.monotonic() + 3.0
            while gateway._jog_leases.leases_of(key) and time.monotonic() < deadline:
                time.sleep(0.02)
            self.assertEqual(gateway._jog_leases.leases_of(key), [])
            while gateway._active_jogs and time.monotonic() < deadline:
                time.sleep(0.02)
            self.assertEqual(self.writes()[-1], (JS, 1, 0), "the armed disconnect stops it")


if __name__ == "__main__":
    unittest.main()
