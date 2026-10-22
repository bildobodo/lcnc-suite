"""Offline checks of the browser-PC tools (Codex R182 VP182-03 / VP182-04): the
driver's envelope guard and the report's 'not proven' states. No socket, no
machine command — a fake message iterator and synthetic logs.

  ~/lcnc-suite/lcnc-gateway/.venv/bin/python -m unittest test_bpc_tools -v
"""
import asyncio
import json
import os
import sys
import time
import unittest

import tempfile

import msgspec.msgpack

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import bpc2  # noqa: E402
import drive2  # noqa: E402

# The gateway's own envelope builder (as Codex's R182 probe used it); its
# trace module writes nowhere live
os.environ["LCNC_LOG_DIR"] = tempfile.mkdtemp(prefix="bpc-tools-")
sys.path.insert(0, os.path.expanduser("~/lcnc-suite-c2/lcnc-gateway"))
from ws_fanout import build_status_envelope  # noqa: E402


def envelope(clients, armed, trip=None, data=None, kind="status"):
    """A status frame as the gateway builds it (ws_fanout.build_status_envelope:
    data, errors, clients, armed, safety_trip only while set)."""
    msg = build_status_envelope(status_data=data or {"interp_state": 1}, errors=[], clients_list=clients,
                                armed=armed, safety_trip=trip)
    msg["type"] = kind
    return msgspec.msgpack.encode(msg)


class FakeWs:
    def __init__(self, frames):
        self.frames = list(frames)

    def __aiter__(self):
        return self

    async def __anext__(self):
        if not self.frames:
            raise StopAsyncIteration
        return self.frames.pop(0)


def read_all(frames):
    c = drive2.Client2()
    c.ws = FakeWs(frames)
    asyncio.run(c._read())
    return c


class DriverGuard(unittest.TestCase):
    def test_an_armed_remote_page_is_seen(self):
        c = read_all([envelope([{"ip": "127.0.0.1", "armed": True}, {"ip": "192.168.64.1", "armed": True}], True)])
        self.assertIn("1 other client(s) ARMED", drive2.guard_breach(c))

    def test_two_local_armed_clients_are_one_too_many(self):
        """Codex's two_local_clients: an IP filter hid both."""
        c = read_all([envelope([{"ip": "127.0.0.1", "armed": True}, {"ip": "127.0.0.1", "armed": True}], True)])
        self.assertIn("1 other client(s) ARMED", drive2.guard_breach(c))

    def test_only_this_client_armed_passes(self):
        c = read_all([envelope([{"ip": "127.0.0.1", "armed": True}, {"ip": "192.168.64.1", "armed": False}], True)])
        self.assertIsNone(drive2.guard_breach(c))
        self.assertEqual(c.st.get("interp_state"), 1)

    def test_a_trip_stops_and_its_absence_clears_it(self):
        cl = [{"ip": "127.0.0.1", "armed": True}]
        c = read_all([envelope(cl, True, trip={"reason": "hb"})])
        self.assertIn("trip", drive2.guard_breach(c))
        c = read_all([envelope(cl, True, trip={"reason": "hb"}), envelope(cl, True, kind="status_delta")])
        self.assertIsNone(drive2.guard_breach(c))

    def test_no_or_stale_envelope_is_no_pass(self):
        c = drive2.Client2()
        self.assertIn("no fresh status envelope", drive2.guard_breach(c))
        c = read_all([envelope([{"ip": "127.0.0.1", "armed": True}], True)])
        c.env_at -= 3.0
        self.assertIn("no fresh status envelope", drive2.guard_breach(c))
        c = read_all([msgspec.msgpack.encode({"type": "status", "data": {}, "armed": True})])
        self.assertIn("no client list", drive2.guard_breach(c))

    def test_the_guard_cancels_the_running_sequence(self):
        async def scenario():
            c = drive2.Client2()
            c.ws = FakeWs([envelope([{"ip": "127.0.0.1", "armed": True}], True)])
            await c._read()
            seq = asyncio.get_event_loop().create_task(asyncio.sleep(30))
            why = []
            g = asyncio.get_event_loop().create_task(drive2.guard(c, seq, why))
            await asyncio.sleep(0.3)
            self.assertFalse(seq.done())
            c.env["clients"] = [{"ip": "127.0.0.1", "armed": True}, {"ip": "192.168.64.1", "armed": True}]
            c.env_at = time.monotonic()
            with self.assertRaises(asyncio.CancelledError):
                await asyncio.wait_for(seq, 2.0)
            await g
            return why
        why = asyncio.run(scenario())
        self.assertIn("ARMED", why[0])


S = 10**9
HEADER = bpc2.HB_HEADER + "\n"


def wd_log(*lines):
    return HEADER + "".join(l + "\n" for l in lines)


ANCHOR_LOG = wd_log("[HB-DUMP] +1000ms reason=trip_reset n=256", "  +900ms hb=T")


def anchor(**kw):
    a = {"wd_ms": 1000, "wall_ns": 100 * S, "wd_pid": 7, "wd_log_bytes": len(HEADER), "gwlog": 0}
    a.update(kw)
    return a


def ticks(a, b, pid=7, step=1.0):
    out, t = [], a - S
    while t < b + S:
        out.append({"tag": "wd.tick_summary", "pid": pid, "t_wall_ns": int(t)})
        t += step * S
    return out


class WatchdogReceipt(unittest.TestCase):
    a, b = 200 * S, 260 * S

    def test_a_gap_in_the_phase_is_listed_and_one_outside_is_not(self):
        log = ANCHOR_LOG + "[HB-RISING] +130000ms True-to-True gap 450ms\n[HB-RISING] +500000ms True-to-True gap 300ms\n"
        r = bpc2.watchdog(self.a, self.b, anchor(), log, ticks(self.a, self.b), "")
        self.assertEqual(r, {"status": "gaps", "gaps_ms": [450]})      # +130 s = wall 230 s
        r = bpc2.watchdog(self.a, self.b, anchor(), ANCHOR_LOG, ticks(self.a, self.b), "")
        self.assertEqual(r["status"], "bound")

    def test_missing_pieces_are_not_proven(self):
        t = ticks(self.a, self.b)
        self.assertEqual(bpc2.watchdog(self.a, self.b, None, ANCHOR_LOG, t, "")["status"], "not proven")
        self.assertEqual(bpc2.watchdog(self.a, self.b, anchor(), None, t, "")["status"], "not proven")
        self.assertEqual(bpc2.watchdog(self.a, self.b, anchor(), "no header\n", t, "")["status"], "not proven")
        self.assertEqual(bpc2.watchdog(self.a, self.b, anchor(), ANCHOR_LOG, [], "")["status"], "not proven")
        holey = [r for r in t if not (220 * S < r["t_wall_ns"] < 230 * S)]
        self.assertEqual(bpc2.watchdog(self.a, self.b, anchor(), ANCHOR_LOG, holey, "")["status"], "not proven")
        other = ticks(self.a, self.b, pid=8)
        self.assertEqual(bpc2.watchdog(self.a, self.b, anchor(), ANCHOR_LOG, other, "")["status"], "not proven")

    def test_another_instance_or_a_clock_step_is_not_proven(self):
        """Codex's reset_mismatch and clock_step: a later log (the anchor's dump
        gone) or a VM pause after the anchor."""
        restarted = wd_log("[HB-DUMP] +5000ms reason=trip_reset n=256")
        r = bpc2.watchdog(self.a, self.b, anchor(), restarted, ticks(self.a, self.b), "")
        self.assertEqual(r["status"], "not proven")
        gw = "[HB] +1ms iter=1 mono_dt=1048ms wall_dt=42115ms skew=41067ms clients=1\n"
        r = bpc2.watchdog(self.a, self.b, anchor(), ANCHOR_LOG, ticks(self.a, self.b), gw)
        self.assertIn("clock stepped", r["why"])

    def test_a_later_reset_does_not_move_the_mapping(self):
        """The anchor is drive2's own reset, never the log's last one."""
        log = ANCHOR_LOG + "[HB-RISING] +130000ms True-to-True gap 450ms\n[HB-DUMP] +400000ms reason=trip_reset n=256\n"
        r = bpc2.watchdog(self.a, self.b, anchor(), log, ticks(self.a, self.b), "")
        self.assertEqual(r, {"status": "gaps", "gaps_ms": [450]})


class Rows(unittest.TestCase):
    def row(self, t, vis="visible", page="p", **kw):
        return {"tag": "browser.viewer.perf", "page": page, "t_wall_ns": int(t * S), "vis": vis, **kw}

    def test_edges_hidden_and_quiet_rows_are_excluded_by_reason(self):
        rows = [self.row(t) for t in (98, 101, 104, 107, 110, 113)] + [self.row(116, vis="hidden"), self.row(119),
                                                                      self.row(122), self.row(140), self.row(143, raf_pauses=1),
                                                                      self.row(146), self.row(149), self.row(152)]
        keep, excl = bpc2.page_rows(rows, {"p"}, 100 * S, 150 * S)
        self.assertEqual([r["t_wall_ns"] // S for r in keep], [107, 110, 113, 122, 146, 149])
        # 98 lies wholly before the phase; 101, 104 reach before it, 152 past it
        self.assertEqual(excl, {"phase_edge": 3, "hidden": 1, "after_hidden_or_quiet": 2, "render_loop_paused": 1})


class Memory(unittest.TestCase):
    def test_uncovered_samples_are_not_collected(self):
        self.assertEqual(bpc2.rss_block([], 0, 10 * S)["status"], "not collected")
        rr = [{"t_wall_ns": int(t * S), "kind": "gateway", "pid": 1, "rss_kb": 100} for t in (0.2, 0.5, 3.0, 9.5)]
        self.assertEqual(bpc2.rss_block(rr, 0, 10 * S)["status"], "not collected")

    def test_covered_samples_count_workers_at_once(self):
        rr = [{"t_wall_ns": int(t * 0.25 * S), "kind": "gateway", "pid": 1, "rss_kb": 100 + t} for t in range(41)]
        rr += [{"t_wall_ns": 2 * S, "kind": "worker", "pid": 5, "rss_kb": 50},
               {"t_wall_ns": 2 * S, "kind": "worker", "pid": 6, "rss_kb": 60}]
        r = bpc2.rss_block(rr, 0, 10 * S)
        self.assertEqual((r["status"], r["workers_at_once_max"], r["workers_peak_kb"]), ("sampled", 2, [50, 60]))


def ev(tag, t, **kw):
    return {"tag": tag, "t_wall_ns": int(t * S), **kw}


class Verdicts(unittest.TestCase):
    def supersede(self, early=False):
        recs = []
        for j in range(1, 5):
            t = j * 10
            recs.append(ev("gcode.spawn_start", t, job=j, basis=f"b{j}", active_idx=2 - j % 2))
            if j < 4:
                if early and j == 2:
                    recs.append(ev("gcode.publish", t + 3, job=j, basis=f"b{j}", active_idx=1))
                else:
                    recs.append(ev("gcode.reparse_superseded", t + 3, job=j))
                    recs.append(ev("gcode.parse_cancelled", t + 3.1, job=j))
        recs.append(ev("gcode.publish", 49, job=4, basis="b4", active_idx=1))
        return recs

    def test_s_met_and_not_met(self):
        sampled = {"status": "sampled", "workers_at_once_max": 1}
        js, ov = bpc2.jobs(self.supersede())
        self.assertEqual(bpc2.s_verdict(js, ov, sampled, 4)["verdict"], "S met")
        js, ov = bpc2.jobs(self.supersede(early=True))
        v = bpc2.s_verdict(js, ov, sampled, 4)
        self.assertEqual(v["verdict"], "S not met")
        self.assertIn("job 2 was not superseded", v["why"][0])
        js, ov = bpc2.jobs(self.supersede())
        self.assertEqual(bpc2.s_verdict(js, ov, {"status": "not collected"}, 4)["verdict"], "S not met")
        self.assertEqual(bpc2.s_verdict(js, ov, sampled, 6)["verdict"], "S not met")

    def test_r_proven_only_when_the_check_spans_the_pinned_parse(self):
        recs = [ev("browser.collision.run_check_start", 10, page="p"),
                ev("gcode.spawn_start", 20, job=7, pinned=True, basis="x", active_idx=1),
                ev("gcode.publish", 25, job=7, pinned=True, basis="x", active_idx=1),
                ev("browser.collision.run_check_discarded", 26, page="p")]
        js, _ = bpc2.jobs(recs)
        self.assertEqual(bpc2.r_verdict(recs, js, {"p"})["verdict"], "R overlap proven")
        late = recs[:3] + [ev("browser.collision.run_check_start", 25.5, page="p"),
                           ev("browser.collision.run_check_discarded", 26, page="p")]
        js, _ = bpc2.jobs(late)
        self.assertEqual(bpc2.r_verdict(late, js, {"p"})["verdict"], "R overlap not proven")
        none = recs[1:3]
        js, _ = bpc2.jobs(none)
        self.assertEqual(bpc2.r_verdict(none, js, {"p"})["verdict"], "R overlap not proven")


if __name__ == "__main__":
    unittest.main()
