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
        gateway._jog_stop_failed.clear()
        self.addCleanup(gateway._jog_stop_failed.clear)
        # an earlier test's in-process lifespan leaves the flag set at its
        # teardown (gateway.lifespan) — the expiry skips everything then
        p = mock.patch.object(gateway, "_shutting_down", False)
        p.start()
        self.addCleanup(p.stop)
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


class TestTheOwedStop(_Lease):
    """Codex R427 MT-I08: an end stops new starts at its receipt, but its
    STOP stays owed until it ran — a refused, dropped or waiting end never
    settles it; the lease's timer stops what it still owns at the deadline."""

    def fire(self, lease_id, ck=None):
        """The lease's timer fires: the expiry task it creates runs here."""
        created = []
        with mock.patch.object(gateway.asyncio, "create_task",
                               side_effect=lambda coro: created.append(coro) or mock.Mock()), \
                mock.patch.object(gateway, "register_bg_task"), \
                mock.patch.object(gateway, "_arm_lease_timer") as arm:
            gateway._on_lease_timer((ck or self.ck, lease_id))
        gateway._cmd_lock = None
        for coro in created:
            _run(coro)
        return arm

    def test_an_end_whose_command_never_ran_is_stopped_at_its_deadline(self):
        self.jog(1)
        self.receive({"cmd": "jog_lease_end", "lease": 1})    # read; its command refused (queue full)
        self.assertEqual(self.stops(), [])
        self.assertEqual(self.lease(1).state, "ended")
        arm = self.fire(1)                                    # before the deadline: waits for it
        arm.assert_called_once()
        self.assertEqual(self.stops(), [])
        self.run_out(1)
        self.fire(1)
        self.assertEqual(self.stops(), [(JS, 1, 0)])
        self.assertIsNone(self.lease(1), "settled by its expiry")
        self.assertEqual(self.notes[0][1]["reason"], "source", "an ended gesture: no page-delay words")

    def test_the_end_handler_settles_once_its_stop_ran(self):
        self.jog(1)
        self.assertEqual(self.end(1), {"ok": True})
        self.assertEqual(self.stops(), [(JS, 1, 0)])
        self.assertIsNone(self.lease(1))

    def test_an_end_whose_stop_failed_is_said_once_never_retried(self):
        self.jog(1)
        recorded = self.cmd.calls

        def jog(*a):
            if a[0] == JS:
                raise linuxcnc.error("channel gone")
            recorded.append(("jog", a, {}))
        self.cmd.jog = jog
        r = self.end(1)
        self.assertEqual(r["stop_failed"], [0])
        self.assertIsNone(self.lease(1), "a reported failure settles: no silent retry")
        self.assertEqual(self.owner(0), (self.ck, 1), "the booking stays: an operator stop still reaches it")

    def test_an_abort_written_settles_what_it_ended_one_not_written_leaves_the_stop_owed(self):
        self.jog(1, axis=0)
        gateway._end_client_leases(self.ck, why="abort")
        self.assertEqual(self.send_as({"cmd": "abort"})["ok"], True)
        self.assertEqual(gateway._jog_leases.unsettled(("abort",)), [])
        # the next gesture's abort is refused at its write: the stop stays owed
        self.jog(2, axis=1)
        gateway._end_client_leases(self.ck, why="abort")

        def refuse(*a):
            raise linuxcnc.error("abort refused")
        self.cmd.abort = refuse
        self.send_as({"cmd": "abort"})
        self.assertEqual([lz.lease_id for lz in gateway._jog_leases.unsettled(("abort",))], [2])
        self.run_out(2)
        self.fire(2)
        self.assertIn((JS, 1, 1), self.stops())

    def test_an_estop_written_settles_the_ends_of_abort_and_estop(self):
        self.jog(1)
        gateway._end_client_leases(self.ck, why="estop")
        self.send_as({"cmd": "estop"})
        self.assertEqual(gateway._jog_leases.unsettled(("estop", "abort")), [])

    def test_a_client_stop_settles_only_a_lease_no_booking_names(self):
        self.jog(1, axis=0)
        self.jog(2, axis=1)
        gateway._end_client_leases(self.ck, why="disarm")
        gateway._active_jogs.pop(0)                 # X's stop was written; Y's failed (still booked)
        gateway._settle_leases_ended_by(("disarm",), self.ck, only_unowned=True)
        self.assertEqual([lz.lease_id for lz in gateway._jog_leases.unsettled(("disarm",))], [2])
        self.run_out(2)
        self.fire(2)
        self.assertEqual(self.stops(), [(JS, 1, 1)], "the owed stop of the failed one, at its deadline")


class TestTheReportedFailure(_Lease):
    """Codex R428: a failed stop is said once, in the reply that met it —
    never hidden behind "page delayed" (MT-I11), never tried again by an
    expiry that was already waiting (MT-I08 rest)."""

    def refuse_stops(self):
        attempts = []

        def jog(*args):
            if args[0] == JS:
                attempts.append(args)
                raise linuxcnc.error("stop refused")
            self.cmd.calls.append(("jog", args, {}))
        self.cmd.jog = jog
        return attempts

    def test_a_queued_expiry_does_not_retry_a_reported_end_failure(self):
        """Codex R428's probe: the end waits for the write lock, the expiry
        behind it; the end's stop fails and is said — the expiry finds the
        lease settled and writes nothing."""
        self.assertTrue(self.jog(1)["ok"])
        attempts = self.refuse_stops()
        tasks = []

        async def scenario():
            gateway._cmd_lock = asyncio.Lock()
            await gateway._cmd_lock.acquire()
            msg = self.receive({"cmd": "jog_lease_end", "lease": 1})
            end = asyncio.create_task(gateway.handle_command(msg, True, self.ck))
            await asyncio.sleep(0)
            self.run_out(1)
            with mock.patch.object(gateway, "register_bg_task", tasks.append):
                gateway._on_lease_timer((self.ck, 1))
            await asyncio.sleep(0)
            gateway._cmd_lock.release()
            reply = await end
            await asyncio.gather(*tasks)
            return reply
        reply = _run(scenario())
        self.assertEqual(reply.get("stop_failed"), [0])
        self.assertEqual(len(attempts), 1, "the settled failure was tried again by the waiting expiry")
        self.assertEqual([n for n in self.notes if n[1].get("id") == 1], [],
                         "a settled lease's waiting expiry says nothing either (R428: nothing owed)")

    def test_a_partial_start_cleanup_reports_its_failed_stop(self):
        """Codex R428's probe: X written, the lease dies before Y, X's stop
        fails — the reply says the stop failed, not "page delayed"."""
        msg = self.receive({"cmd": "jog_cont_multi", "lease": 1,
                            "axes": [{"axis": 0, "vel": 5.0}, {"axis": 1, "vel": 5.0}]})
        attempts = self.refuse_stops()
        reply = self.at_the_write(msg, lambda: self.run_out(1), at=3)
        self.assertEqual(reply.get("stop_failed"), [0], reply)
        self.assertEqual(reply.get("error"), gateway.JOG_LEASE_STOP_FAILED)
        self.assertNotIn("expired", reply, "a failed stop is not shown as a page delay")
        self.assertEqual(len(attempts), 1)
        # the lease's own expiry later: X's failure was said — not tried again
        lz = self.lease(1)
        if lz is not None:
            gateway._cmd_lock = None
            _run(gateway._expire_jog_lease(lz))
        self.assertEqual(len(attempts), 1, "a reported failure is not retried by the lease")
        self.assertEqual(self.owner(0), (self.ck, 1), "the booking stays: an operator stop still reaches it")

    def test_a_partial_start_cleanup_that_stops_is_still_an_expiry(self):
        msg = self.receive({"cmd": "jog_cont_multi", "lease": 1,
                            "axes": [{"axis": 0, "vel": 5.0}, {"axis": 1, "vel": 5.0}]})
        reply = self.at_the_write(msg, lambda: self.run_out(1), at=3)
        self.assertEqual(reply, {"ok": False, "error": jog_lease.JOG_LEASE_DEAD, "expired": True})


class TestTheFailedBooking(_Lease):
    """Codex R429: a reported stop failure belongs to exactly its booking
    (owner, generation) and lives as long as it (MT-I08 rest); it kills the
    lease — nothing more starts under it (MT-I14); a new generation of the
    axis owes its own stop; an operator's stop still reaches the booking."""

    def stops_fail_once(self):
        attempts = []

        def jog(*args):
            if args[0] == JS:
                attempts.append(args)
                if len(attempts) == 1:
                    raise linuxcnc.error("first stop refused")
            self.cmd.calls.append(("jog", args, {}))
        self.cmd.jog = jog
        return attempts

    def test_an_expiry_failure_is_not_retried_by_the_late_gesture_end(self):
        self.assertTrue(self.jog(1)["ok"])
        attempts = self.stops_fail_once()
        self.expire(1)
        self.assertEqual(self.notes[-1][1]["stop_failed"], [0])
        self.assertIsNone(self.lease(1))
        self.end(1)
        self.assertEqual(len(attempts), 1, "the forgotten lease must not erase the booking's memory")

    def test_a_failed_change_admits_no_new_start_of_the_same_gesture(self):
        self.assertTrue(self.jog(1)["ok"])
        self.stops_fail_once()
        first = self.receive({"cmd": "jog_change", "lease": 1, "stop": [0], "axes": []})
        second = self.receive({"cmd": "jog_change", "lease": 1, "stop": [], "axes": [{"axis": 0, "vel": -5.0}]})
        self.assertEqual(self.send_as(first).get("stop_failed"), [0])
        result = self.send_as(second)
        self.assertFalse(result["ok"], result)
        self.assertEqual(len(self.starts()), 1, "no start after the lease died")
        self.assertEqual(self.lease(1).ended_by, "stop_failed")

    def test_a_newly_written_generation_owes_its_own_stop(self):
        """The memory names the booking, never the axis: a new write of X
        (here an operator's own unleased jog) is stopped by its own path."""
        self.assertTrue(self.jog(1)["ok"])
        attempts = self.stops_fail_once()
        self.assertEqual(self.change(1, [0], []).get("stop_failed"), [0])
        self.assertEqual(gateway._jog_stop_failed[0][0], (self.ck, 1))
        self.assertTrue(self.jog(2)["ok"], "another gesture takes X: a new generation")
        self.assertNotIn(0, gateway._jog_stop_failed, "the new generation is not exempted")
        self.expire(2)
        self.assertEqual(len(attempts), 2)
        self.assertNotIn(0, gateway._active_jogs)

    def test_an_explicit_operator_stop_still_reaches_the_failed_booking(self):
        self.assertTrue(self.jog(1)["ok"])
        attempts = self.stops_fail_once()
        self.expire(1)
        result = self.send_as({"cmd": "jog_stop", "axis": 0})
        self.assertTrue(result["ok"], result)
        self.assertEqual(len(attempts), 2)
        self.assertNotIn(0, gateway._active_jogs)
        self.assertNotIn(0, gateway._jog_stop_failed, "the memory ends with the booking")


class TestTheWriteLink(_Lease):
    """Codex R427 MT-I09: a lease's stop is bound to the Link its jog was
    written through — never applied to a replacement Link, the booking kept
    and the failure said; on the same Link its own jog stops."""

    def new_link(self):
        old = gateway._link
        newer = _RecordingCmd()
        new = gateway._publish_link(old.stat, newer, old.err, old.pid)
        self.assertIsNot(new, old)
        return newer

    def test_the_booking_carries_the_writes_link(self):
        self.jog(1)
        self.assertIs(gateway._jog_row_link(gateway._active_jogs[0]), gateway._link)

    def test_an_old_leases_expiry_never_writes_through_a_new_link(self):
        """Codex R427's probe: B must not receive the JOG_STOP of A's lease."""
        self.assertTrue(self.jog(1)["ok"])
        newer = self.new_link()
        self.expire(1)
        self.assertEqual([a for n, a, _k in newer.calls if n == "jog"], [])
        self.assertEqual(self.owner(0), (self.ck, 1), "kept: nothing confirmed a stop")
        self.assertEqual(self.notes[0][1]["stop_failed"], [0])
        self.assertEqual(self.notes[0][1]["error"], gateway.JOG_LEASE_STOP_FAILED)

    def test_an_end_and_a_changes_stop_half_on_a_new_link_say_the_stop_failed(self):
        self.jog(1, axis=0)
        self.jog(1, axis=1)
        newer = self.new_link()
        r = self.change(1, [0], [])
        self.assertEqual(r.get("stop_failed"), [0], r)
        r = self.end(1)
        # X's failure was said by the change (R428: once) — the end says Y's
        self.assertEqual(r["stop_failed"], [1], r)
        self.assertEqual([a for n, a, _k in newer.calls if n == "jog"], [])
        self.assertEqual(self.owner(0), (self.ck, 1), "both bookings stay for an operator stop")

    def test_the_write_thread_refuses_a_link_changed_after_the_lock(self):
        self.jog(1)
        owner = gateway._jog_row_owner(gateway._active_jogs[0])
        row = gateway._active_jogs[0]
        gateway._active_jogs[0] = row[:4] + (object(),)    # booked through another Link meanwhile
        gateway._cmd_lock = None
        with self.assertRaises(gateway._WriteRefused) as cm:
            _run(gateway._send_jog_stop(0, owner=owner))
        self.assertEqual(str(cm.exception), gateway.JOG_STOP_LINK_CHANGED)
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


class TestTheRefusedEnd(_Ws):
    def test_an_end_the_full_queue_refused_still_stops_by_the_deadline(self):
        """Codex R427 MT-I08 probe, at the product's queue limits: a slow
        command holds only the client's FIFO (not `_cmd_lock`), harmless
        ends fill the stop buffer, the gesture's own end is refused — the
        lease's timer still writes JOG_STOP."""
        real = self.real_handle

        async def handle(msg, armed, conn_key=None):
            if msg.get("cmd") == "zz_slow":
                await asyncio.sleep(1.8)
                return {"ok": True}
            return await real(msg, armed, conn_key)
        gateway.handle_command = handle
        with TestClient(gateway.app) as client, client.websocket_connect("/ws") as ws:
            self.arm(ws)
            ws.send_json({"cmd": "jog_cont", "axis": 0, "vel": 5.0, "lease": 1, "req_id": "start"})
            self.pump(ws, 2, until=lambda f: f.get("req_id") == "start", renew=[1])
            self.assertTrue(self.reply("start")["ok"])
            ws.send_json({"cmd": "zz_slow", "req_id": "slow"})
            self.pump(ws, 0.1, renew=[1])
            for n in range(4 * gateway._WS_CMD_QUEUE_MAX):
                ws.send_json({"cmd": "jog_lease_end", "lease": 100 + n, "req_id": f"fill-{n}"})
            ws.send_json({"cmd": "jog_lease_end", "lease": 1, "req_id": "end"})
            self.pump(ws, 1.5, until=lambda f: f.get("req_id") == "end")
            self.assertIn("queue full", (self.reply("end") or {}).get("error", "").lower())
            self.pump(ws, 1.0)
            self.assertIn(JS, [w[0] for w in self.writes()],
                          f"the refused end's stop was lost: {self.writes()}")


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
            told = [f for f in self.frames if f.get("type") == "jog_lease_expired" and f.get("id") == 5]
            self.assertEqual(told[0].get("reason"), "abort",
                             "the page hears a STOP ended it — never the page-delay words")

    def test_a_disarm_ends_them(self):
        with TestClient(gateway.app) as client, client.websocket_connect("/ws") as ws:
            self.arm(ws)
            ws.send_json({"cmd": "jog_cont", "axis": 0, "vel": 5.0, "lease": 6, "req_id": "j6"})
            self.pump(ws, 2.0, until=lambda f: f.get("req_id") == "j6", renew=[6])
            ws.send_json({"cmd": "arm", "armed": False, "req_id": "d6"})
            self.pump(ws, 2.0, until=lambda f: f.get("type") == "reply" and f.get("armed") is False)
            self.assertEqual(self.writes()[-1], (JS, 1, 0), "the disarm stops the jog")
            self.assertFalse(gateway._jog_leases.is_live((self.conn_key, 6), time.monotonic()))
            self.pump(ws, 1.0, until=lambda f: f.get("type") == "jog_lease_expired" and f.get("id") == 6)
            told = [f for f in self.frames if f.get("type") == "jog_lease_expired" and f.get("id") == 6]
            self.assertEqual(told[0].get("reason"), "disarm")
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
