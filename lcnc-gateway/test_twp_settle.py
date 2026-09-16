"""The datum settle after M535 keys on the datum-write EPOCH (2026-09-05).

`_settle_datum_after_m535` used to key on the datum VALUE changing, so a
touch-off landing on the same datum burned the whole 3 s timeout (measured
3089 / 3082 ms live). Now M535 bumps twp-helper-comp.twp-datum-seq after it
published the datum, and the settle returns the tick that shows the new
epoch. A helper without the pin falls back to the value test, said once.

Harness: fake linuxcnc binding, `gateway._reader_get` replaced by a scripted
snapshot sequence (a new snapshot per seq read — the settle reads the seq
first each tick, then the datum from the same snapshot), `lcnc_trace.emit`
recorded.
"""
import asyncio
import time
import unittest

import fake_linuxcnc

linuxcnc = fake_linuxcnc.install()  # MUST precede `import gateway`

import lcnc_trace  # noqa: E402
import gateway  # noqa: E402


def _snap(seq, x, y=2.0, z=3.0):
    d = {"twp_ox": x, "twp_oy": y, "twp_oz": z}
    if seq is not None:
        d["twp_datum_seq"] = float(seq)
    return d


class _Script:
    def __init__(self, snaps):
        self.snaps = list(snaps)
        self.i = 0
        self.seq_reads = 0

    def get(self, field):
        if field == "twp_datum_seq":
            self.seq_reads += 1
            if self.seq_reads > 1 and self.i < len(self.snaps) - 1:
                self.i += 1
        return self.snaps[self.i].get(field)


def _settle(snaps, before, before_seq, timeout_s=3.0):
    sc = _Script(snaps)
    events = []
    orig = (gateway._reader_get, lcnc_trace.emit)
    real = lcnc_trace.emit

    def rec(tag, level="info", msg="", **fields):
        events.append((tag, dict(fields)))
        return real(tag, level, msg, **fields)
    gateway._reader_get = sc.get
    lcnc_trace.emit = rec
    t0 = time.monotonic()
    try:
        out = asyncio.run(gateway._settle_datum_after_m535(
            before, before_seq=before_seq, timeout_s=timeout_s, period_s=0.005))
    finally:
        gateway._reader_get, lcnc_trace.emit = orig
    return out, events, time.monotonic() - t0, sc


def _tags(events, tag):
    return [f for t, f in events if t == tag]


class TestDatumSettleEpoch(unittest.TestCase):
    def test_returns_on_seq_advance_with_same_datum(self):
        out, ev, dt, sc = _settle([_snap(5, 1.0), _snap(5, 1.0), _snap(6, 1.0)],
                                  before=[1.0, 2.0, 3.0], before_seq=5.0)
        self.assertEqual(out, [1.0, 2.0, 3.0])
        self.assertLess(dt, 0.2, "same-datum touch-off must not burn the timeout")
        settled = _tags(ev, "twp.datum_settled")
        self.assertTrue(settled and settled[0]["seq_before"] == 5.0 and settled[0]["seq_now"] == 6.0)
        self.assertFalse(settled[0]["changed"])
        self.assertEqual(_tags(ev, "twp.datum_settle_timeout"), [])
        self.assertEqual(_tags(ev, "twp.datum_seq_unavailable"), [])

    def test_value_change_alone_does_not_settle_the_epoch(self):
        # A moved value with the OLD seq is a mid-pass sample (or an older
        # publish): the epoch rule waits for the seq.
        out, ev, dt, sc = _settle([_snap(5, 1.0), _snap(5, 9.0), _snap(5, 9.0), _snap(6, 9.0)],
                                  before=[1.0, 2.0, 3.0], before_seq=5.0)
        self.assertEqual(out, [9.0, 2.0, 3.0])
        self.assertEqual(sc.seq_reads, 4)
        self.assertTrue(_tags(ev, "twp.datum_settled")[0]["changed"])

    def test_falls_back_to_value_when_seq_missing(self):
        out, ev, dt, sc = _settle([_snap(None, 1.0), _snap(None, 1.0), _snap(None, 9.0)],
                                  before=[1.0, 2.0, 3.0], before_seq=None)
        self.assertEqual(out, [9.0, 2.0, 3.0])
        self.assertEqual(len(_tags(ev, "twp.datum_seq_unavailable")), 1, "said once, not per tick")
        self.assertEqual(_tags(ev, "twp.datum_settled"), [])
        self.assertEqual(_tags(ev, "twp.datum_settle_timeout"), [])

    def test_timeout_adopts_current_with_warn(self):
        out, ev, dt, sc = _settle([_snap(5, 1.0)], before=[1.0, 2.0, 3.0], before_seq=5.0,
                                  timeout_s=0.1)
        self.assertEqual(out, [1.0, 2.0, 3.0])
        to = _tags(ev, "twp.datum_settle_timeout")
        self.assertTrue(to and to[0]["seq_before"] == 5.0 and to[0]["seq_now"] == 5.0, to)

    def test_unreadable_datum_returns_none_traced(self):
        out, ev, dt, sc = _settle([{"twp_datum_seq": 5.0}], before=None, before_seq=5.0,
                                  timeout_s=0.05)
        self.assertIsNone(out)
        self.assertTrue(_tags(ev, "twp.datum_unreadable"))


if __name__ == "__main__":
    unittest.main()
