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

    def test_rows_go_only_on_evidence_of_a_hidden_page(self):
        rows = [self.row(t) for t in (98, 101, 104, 107, 110)] + [
            self.row(113, vis="hidden"), self.row(116, vis_changes=1), self.row(119, raf_pauses=1),
            self.row(122), self.row(140), self.row(143), self.row(146), self.row(152)]
        keep, excl, interior, cov = bpc2.page_rows(rows, {"p"}, 100 * S, 150 * S)
        # a paused render loop is no evidence of a hidden page (Codex R184): 119 stays
        self.assertEqual([r["t_wall_ns"] // S for r in keep], [101, 104, 107, 110, 119, 122, 140, 143, 146])
        self.assertEqual(excl, {"hidden": 1, "visibility_changed": 1})
        self.assertEqual([r["t_wall_ns"] // S for r in interior], [107, 110, 119, 122, 140, 143, 146])
        self.assertEqual((cov["complete"], cov["gaps_over_4_5_s"], cov["largest_gap_s"]), (False, 1, 18.0))

    def test_a_row_whose_actual_window_ran_long_is_an_edge_row(self):
        """Codex R185: the row's own span (win_ms), not the timer's 3 s, says
        how far back it reaches — 8 s at 107 may hold the phase before."""
        rows = [self.row(107, win_ms=8000.0), self.row(110, win_ms=3000.0), self.row(112, win_ms=8000.0)]
        _, _, interior, _ = bpc2.page_rows(rows, {"p"}, 100 * S, 120 * S)
        self.assertEqual([r["t_wall_ns"] // S for r in interior], [110, 112])

    def test_a_late_row_of_a_visible_page_stays_in_the_quantile(self):
        """Codex R183 VP183-04 visible_stall_rows: 60 ages of 100 ms in the row
        that arrived 5 s after the one before."""
        fast, slow = {"10": 60}, {"100": 60}
        rows = [self.row(107, age_h=fast), self.row(112, age_h=slow), self.row(115, age_h=fast), self.row(118, age_h=fast)]
        keep, excl, interior, cov = bpc2.page_rows(rows, {"p"}, 100 * S, 120 * S)
        self.assertEqual(len(keep), 4)
        q = bpc2.quant(bpc2.pool(keep, "age_h"))
        self.assertEqual(q["p95"], 110)
        self.assertFalse(cov["complete"])          # 100 → 107 and 112 gaps: incomplete, not filtered
        self.assertEqual(bpc2.target(keep, interior, cov)["verdict"], "not proven")

    def test_a_visible_stall_with_a_long_frame_gap_keeps_its_peak(self):
        """Codex R184 VP183-04 rest: a visible page, no visibility change, two
        frames 5.2 s apart (raf_pauses 1) and a frame that waited 5190 ms."""
        rows = [self.row(100 + 3 * i, age_h={"10": 30}) for i in range(1, 7)]
        rows[3].update(raf_pauses=1, age_h={"10": 29, "5000": 1})
        keep, excl, interior, cov = bpc2.page_rows(rows, {"p"}, 100 * S, 120 * S)
        self.assertEqual((len(keep), excl), (6, {}))
        self.assertEqual(bpc2.quant(bpc2.pool(keep, "age_h"), (1.0,))["p100"], 5500)

    def test_the_target_needs_a_complete_phase_and_agreeing_edges(self):
        rows = [self.row(100 + 3 * i, age_h={"10": 30}) for i in range(1, 7)]
        keep, _, interior, cov = bpc2.page_rows(rows, {"p"}, 100 * S, 120 * S)
        self.assertTrue(cov["complete"])
        self.assertEqual(bpc2.target(keep, interior, cov)["verdict"], "met")
        rows[0]["age_h"] = {"200": 300}            # the first row (an edge row) decides it
        keep, _, interior, cov = bpc2.page_rows(rows, {"p"}, 100 * S, 120 * S)
        t = bpc2.target(keep, interior, cov)
        self.assertEqual((t["verdict"], t["why"]), ("not proven", "the phase edges decide it"))


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
    def supersede(self, early=False, extra=False):
        recs, log = [], []
        for j in range(1, 5):
            t, to = j * 10, ("G55" if j % 2 else "G54")
            recs.append(ev("gcode.spawn_start", t, job=j, basis=f"b{j}", active_idx=2 if to == "G55" else 1))
            log.append({"switch": j, "to": to, "job": j, "basis": f"b{j}"})
            if j < 4:
                if early and j == 2:
                    recs.append(ev("gcode.publish", t + 3, job=j, basis=f"b{j}", active_idx=1))
                else:
                    recs.append(ev("gcode.reparse_superseded", t + 3, job=j))
                    recs.append(ev("gcode.parse_cancelled", t + 3.1, job=j))
        recs.append(ev("gcode.publish", 49, job=4, basis="b4", active_idx=1))
        if extra:
            recs.append(ev("gcode.spawn_start", 60, job=5, basis="b5", active_idx=1))
            recs.append(ev("gcode.publish", 65, job=5, basis="b5", active_idx=1))
        return recs, log

    def test_s_against_the_switch_log(self):
        sampled = {"status": "sampled", "workers_at_once_max": 1}
        recs, log = self.supersede()
        js, ov = bpc2.jobs(recs)
        self.assertEqual(bpc2.s_verdict(js, ov, sampled, log)["verdict"], "S met")
        self.assertEqual(bpc2.s_verdict(js, ov, sampled, None)["verdict"], "S not met")      # Codex s_missing_switches
        recs, log = self.supersede(extra=True)
        js, ov = bpc2.jobs(recs)
        v = bpc2.s_verdict(js, ov, sampled, log)                                               # Codex s_extra_job
        self.assertEqual(v["verdict"], "S not met")
        self.assertIn("jobs no switch asked for: [5]", v["why"])
        recs, log = self.supersede(early=True)
        js, ov = bpc2.jobs(recs)
        self.assertIn("job 2 was not superseded", bpc2.s_verdict(js, ov, sampled, log)["why"][0])
        recs, log = self.supersede()
        log[1]["basis"] = "other"
        js, ov = bpc2.jobs(recs)
        self.assertIn("parsed fixture", bpc2.s_verdict(js, ov, sampled, log)["why"][0])
        self.assertEqual(bpc2.s_verdict(js, ov, {"status": "not collected"}, self.supersede()[1])["verdict"], "S not met")

    def pinned(self, spawn=20, pub=25):
        return [ev("gcode.spawn_start", spawn, job=7, pinned=True, basis="x", active_idx=1),
                ev("gcode.publish", pub, job=7, pinned=True, basis="x", active_idx=1)]

    def page(self, tag, perf_ms, pg="p", **kw):
        return {"tag": "browser." + tag, "page": pg, "t_wall_ns": int(perf_ms * 10**6), "t_perf_ms": perf_ms, **kw}

    # R by the R185 contract: VM monotonic ms for the parse and g; the page
    # clock is OFF ms away and never compared with them — order only.
    OFF = 1.79e12

    def span(self, p0_ms, p1_ms, job=7, pid=500):
        return {"tag": "gcode.parse_span", "pinned": True, "job": job, "pid": pid, "file": "bpc_run.ngc",
                "t_wall_ns": 0, "p0_ns": None if p0_ms is None else int(p0_ms * 1e6),
                "p1_ns": None if p1_ms is None else int(p1_ms * 1e6)}

    def hb(self, seq, hs, g, hr, pid=500):
        return [seq, self.OFF + hs, self.OFF + hr, g, pid]

    def r(self, spans, hbs, slices, run_gen=1, ahead=0.1, age_neg=0, pg="p", wpg=None, pages=("p", "q")):
        perf = [{"tag": "browser.viewer.perf", "page": pg, "t_wall_ns": 10, "hb_pairs": hbs, "age_neg": age_neg}]
        wit = [{"tag": "browser.collision.sweep_witness", "page": wpg or pg, "t_wall_ns": 10, "id": 3, "run_gen": run_gen,
                "range_from": None, "shard": 1, "gen": 1, "ahead_ms": ahead,
                "s": [x for a, b in slices for x in (self.OFF + a, self.OFF + b)]}]
        pairs, ahead_pages = bpc2.hb_pairs_of(perf, set(pages), 0, 100)
        sl, ahead_words = bpc2.slices_of(wit, set(pages))
        return bpc2.r_verdict(spans, pairs, sl, ahead_pages, ahead_words)

    def test_r_proven_by_two_heartbeats_inside_the_parse_and_a_slice_between(self):
        """Codex R185's example: the parse 20–25 s, A answered at 20.15 s, B
        sent at 24.85 s, both gateway stamps inside — a slice at 22 s is the
        witness, with its original stamps and names."""
        v = self.r([self.span(20_000, 25_000)],
                   [self.hb(4, 20_050, 20_100, 20_150), self.hb(5, 24_850, 24_900, 24_950)], [(22_000, 22_020)])
        self.assertEqual(v["verdict"], "R overlap proven")
        pr = v["proof"]
        self.assertEqual((pr["parse"]["job"], pr["heartbeat_a"]["seq"], pr["heartbeat_b"]["seq"], pr["slice"]["id"],
                          pr["slice"]["shard"], pr["sweep"]), (7, 4, 5, 3, 1, "full"))
        self.assertEqual(pr["window_page_ms"], [self.OFF + 20_152, self.OFF + 24_848])

    def test_r_counterexamples_read_not_proven(self):
        A, B = self.hb(4, 20_050, 20_100, 20_150), self.hb(5, 24_850, 24_900, 24_950)
        cases = {
            # a parse that ended before A's stamp (done while A travelled)
            "ended before": ([self.span(20_000, 20_090)], [A, B], [(22_000, 22_020)]),
            # R185 VP185-01: the parse really ran 10–12 s while the gateway's
            # records spanned 10–30 s — its own bounds hold no stamp
            "own bounds elsewhere": ([self.span(10_000, 12_000)], [A, B], [(22_000, 22_020)]),
            "one heartbeat inside": ([self.span(20_000, 24_000)], [A, B], [(22_000, 22_020)]),
            # A's answer came after B was sent: no window
            "answer after the next send": ([self.span(20_000, 25_000)],
                                           [self.hb(4, 20_050, 20_100, 24_900), self.hb(5, 24_850, 24_920, 24_950)],
                                           [(22_000, 22_020)]),
            "slice outside": ([self.span(20_000, 25_000)], [A, B], [(26_000, 26_020), (19_000, 20_140)]),
            # touching the window within the stamps' resolution only
            "slice at the edge": ([self.span(20_000, 25_000)], [A, B], [(24_847, 24_851)]),
            "another gateway": ([self.span(20_000, 25_000, pid=501)], [A, B], [(22_000, 22_020)]),
            "no end stamp": ([self.span(20_000, None)], [A, B], [(22_000, 22_020)]),
            "no parse": ([], [A, B], [(22_000, 22_020)]),
        }
        for name, (spans, hbs, sl) in cases.items():
            self.assertEqual(self.r(spans, hbs, sl)["verdict"], "R overlap not proven", name)
        why = self.r([self.span(20_000, None)], [A, B], [(22_000, 22_020)])["parses"][0]["why"]
        self.assertIn("no end", why)

    def test_r_takes_no_witness_from_a_clock_that_read_ahead_or_a_check_of_no_run(self):
        A, B = self.hb(4, 20_050, 20_100, 20_150), self.hb(5, 24_850, 24_900, 24_950)
        good = ([self.span(20_000, 25_000)], [A, B], [(22_000, 22_020)])
        self.assertEqual(self.r(*good)["verdict"], "R overlap proven")
        v = self.r(*good, ahead=3000.0)            # the collision worker created after a host sleep
        self.assertEqual(v["verdict"], "R overlap not proven")
        self.assertEqual(v["witness_words_ahead"][0]["ahead_ms"], 3000.0)
        self.assertEqual(self.r(*good, ahead=None)["verdict"], "R overlap not proven")
        v = self.r(*good, age_neg=2)               # the WebSocket worker read ahead of the page
        self.assertEqual((v["verdict"], v["pages_ws_worker_ahead"]), ("R overlap not proven", ["p"]))
        self.assertEqual(self.r(*good, run_gen=None)["verdict"], "R overlap not proven")
        # one page's heartbeats and another page's slice are two clocks
        self.assertEqual(self.r(*good, pg="q")["verdict"], "R overlap proven")
        self.assertEqual(self.r(*good, wpg="q")["verdict"], "R overlap not proven")
        self.assertEqual(self.r(*good, pages=("q",))["verdict"], "R overlap not proven")   # not the measured page


class AnchorStill(unittest.TestCase):
    def client(self, **st):
        c = drive2.Client2()
        c.env, c.env_at = {"clients": [], "armed": True}, time.monotonic()
        c.st.update(st)
        return c

    def test_the_anchor_needs_a_known_standstill(self):
        """Codex R183 VP183-03 anchor_not_still."""
        self.assertIsNone(drive2.not_still(self.client(estop=False, interp_state=1, inpos=True, current_vel=0.0)))
        self.assertIsNone(drive2.not_still(self.client(estop=True)))
        self.assertIn("not idle", drive2.not_still(self.client(estop=False, interp_state=2, inpos=False, current_vel=10)))
        self.assertIn("not known to stand", drive2.not_still(self.client(estop=False, interp_state=1, inpos=False, current_vel=10)))
        self.assertIn("not known to stand", drive2.not_still(self.client(estop=False, interp_state=1)))
        stale = self.client(estop=False, interp_state=1, inpos=True, current_vel=0.0)
        stale.env_at -= 3
        self.assertIn("no fresh status", drive2.not_still(stale))

    def test_no_e_stop_is_sent_unless_still(self):
        sent = []

        class C(drive2.Client2):
            async def cmd(self, o, timeout=60.0):
                sent.append(o["cmd"])
        c = C()
        c.env, c.env_at = {"clients": [], "armed": True}, time.monotonic()
        c.st.update(estop=False, interp_state=1, inpos=False, current_vel=10)
        with self.assertRaises(drive2.Stop):
            asyncio.run(drive2.anchored_reset(c))
        self.assertEqual(sent, [])


if __name__ == "__main__":
    unittest.main()
