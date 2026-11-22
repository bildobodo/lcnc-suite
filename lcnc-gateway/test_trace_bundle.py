"""The trip bundle as ONE snapshot of the trace's generations (P3, machine
day F2/F23; Codex R425 MT425-03, R426).

scripts/trace-bundle.py opens every generation under the writers' lock,
records (dev, ino, size), releases the lock and reads only those
descriptors up to those sizes. These tests rotate DURING the read, damage
the last line, leave a gap in the chain, take a trip whose tail is not
written yet, and check crash.log stays its own artifact. The gateway's
snapshot call runs the bundler next to its own module and names a failed
run (`safety.trip_snapshot_failed`, F2: rc 2 was traced as "done").

Red proof (docs/decisions.md 2026-11-21 P3): the pre-P3 bundler read only
`trace.ndjson` by name — `test_the_window_across_a_rotation_is_whole`
fed to it finds the records of `.1` missing.
"""
from __future__ import annotations

import importlib.util
import json
import os
import subprocess
import sys
import time
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
BUNDLER = HERE.parent / "scripts" / "trace-bundle.py"
sys.path.insert(0, str(HERE))


def _bundler():
    spec = importlib.util.spec_from_file_location("trace_bundle_under_test", BUNDLER)
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _rec(t: int, tag: str, **kw) -> bytes:
    return (json.dumps({"t_wall_ns": t, "proc": "gateway", "pid": 1, "tag": tag, "level": "info", **kw}) + "\n").encode()


def test_a_rotation_during_the_read_neither_repeats_nor_loses(tmp_path):
    """A snapshot taken, then a writer rotates (trace.ndjson → .1, a new
    trace.ndjson) BEFORE the bytes are read: the read is the snapshot —
    every record once (never A, A, B), the new file not mixed in."""
    tb = _bundler()
    (tmp_path / "trace.ndjson.1").write_bytes(_rec(1, "a"))
    (tmp_path / "trace.ndjson").write_bytes(_rec(2, "b"))
    snap = tb.take_snapshot(str(tmp_path), "trace.ndjson", "trace.lock")
    try:
        os.replace(tmp_path / "trace.ndjson.1", tmp_path / "trace.ndjson.2")
        os.replace(tmp_path / "trace.ndjson", tmp_path / "trace.ndjson.1")
        (tmp_path / "trace.ndjson").write_bytes(_rec(3, "c"))
        with open(tmp_path / "trace.ndjson.1", "ab") as f:
            f.write(b"appended after the snapshot\n")
        events, counts = tb.parse_trace(tb.read_snapshot(snap))
    finally:
        snap.close()
    assert [e["tag"] for e in events] == ["a", "b"]
    assert sum(c["damaged"] for c in counts.values()) == 0   # the later append is past the recorded size


def test_the_snapshot_holds_the_writers_lock_only_while_opening(tmp_path):
    """A slow reader holds up no writer: after take_snapshot the lock is
    free (a writer gets it at once) while the snapshot's fds stay open."""
    tb = _bundler()
    import lcnc_trace as tr
    (tmp_path / "trace.ndjson").write_bytes(_rec(1, "a"))
    snap = tb.take_snapshot(str(tmp_path), "trace.ndjson", "trace.lock")
    try:
        assert snap.lock == "held"
        h = tr.CoordinatedFileHandler(str(tmp_path / "trace.ndjson"), str(tmp_path / "trace.lock"),
                                      max_bytes=0, backups=5, report_prefix="trace")
        t0 = time.monotonic()
        assert h.append(_rec(2, "written.while.reading"))
        assert time.monotonic() - t0 < tr._LOCK_BUDGET_S
        events, _ = tb.parse_trace(tb.read_snapshot(snap))
        assert [e["tag"] for e in events] == ["a"]
    finally:
        snap.close()


def test_a_busy_lock_is_named_in_the_snapshot(tmp_path):
    tb = _bundler()
    holder = subprocess.Popen([sys.executable, "-c",
                               "import fcntl, os, sys, time; fd = os.open(sys.argv[1], os.O_RDWR | os.O_CREAT); "
                               "fcntl.flock(fd, fcntl.LOCK_EX); print('held', flush=True); time.sleep(30)",
                               str(tmp_path / "trace.lock")], stdout=subprocess.PIPE, text=True)
    try:
        assert holder.stdout.readline().strip() == "held"
        (tmp_path / "trace.ndjson").write_bytes(_rec(1, "a"))
        snap = tb.take_snapshot(str(tmp_path), "trace.ndjson", "trace.lock", lock_wait_s=0.05)
        snap.close()
        assert snap.lock.startswith("not_acquired")
    finally:
        holder.kill()
        holder.wait()


def test_damage_gaps_and_lock_files_are_accounted(tmp_path):
    """A terminated fragment and a cut last line are DAMAGED (counted, named
    per file); a missing generation is a gap; `trace.lock` is never read as
    a generation."""
    tb = _bundler()
    (tmp_path / "trace.ndjson.3").write_bytes(_rec(1, "old"))
    (tmp_path / "trace.ndjson.1").write_bytes(_rec(2, "a") + b'{"t_wall_ns":3,"ta\n' + _rec(4, "b"))
    (tmp_path / "trace.ndjson").write_bytes(_rec(5, "c") + b'{"t_wall_ns":6,"tag":"cut')
    (tmp_path / "trace.lock").write_bytes(b"")
    (tmp_path / "trace.ndjson.lock").write_bytes(b"not a generation")
    events, account = tb.load_trace_ndjson(str(tmp_path))
    assert [e["tag"] for e in events] == ["old", "a", "b", "c"]
    names = [s["name"] for s in account["sources"]]
    assert names == ["trace.ndjson.3", "trace.ndjson.1", "trace.ndjson"]
    by = {s["name"]: s for s in account["sources"]}
    assert by["trace.ndjson.1"]["damaged"] == 1 and by["trace.ndjson"]["damaged"] == 1
    assert by["trace.ndjson"].get("cut_last_line") == 1
    assert account["gaps"] == ["trace.ndjson.2"]


def test_the_tail_wait_is_bounded_on_the_monotonic_clock():
    """The capture waits for trip + 1 s + slack; a trip stamped far ahead (a
    stepped wall clock) never waits more than TAIL_WAIT_MAX_S."""
    tb = _bundler()
    mono = {"t": 0.0}
    slept = []

    def sleep(s):
        slept.append(s)
        mono["t"] += s
    wall = 1_000_000_000_000
    waited = tb.wait_for_tail(wall + 3600 * 10**9, now_ns=lambda: wall, sleep=sleep, monotonic=lambda: mono["t"])
    assert waited == pytest.approx(tb.TAIL_WAIT_MAX_S, abs=1e-9)
    mono["t"] = 0.0
    assert tb.wait_for_tail(wall - 10 * 10**9, now_ns=lambda: wall, sleep=sleep,
                            monotonic=lambda: mono["t"]) == 0.0       # the tail is long written


def _run_bundler(log_dir: Path, out: Path, *args: str) -> subprocess.CompletedProcess:
    return subprocess.run([sys.executable, str(BUNDLER), "--log-dir", str(log_dir), "--out", str(out), *args],
                          capture_output=True, text=True, timeout=30)


def test_the_window_across_a_rotation_is_whole(tmp_path):
    """The trip window spans `.1` and trace.ndjson: both halves are in the
    bundle (F2/F23: the bundler read trace.ndjson alone)."""
    trip = 100 * 10**9
    (tmp_path / "trace.ndjson.1").write_bytes(_rec(trip - 4 * 10**9, "before.in.1") + _rec(trip, "safety.tripped"))
    (tmp_path / "trace.ndjson").write_bytes(_rec(trip + 5 * 10**8, "after.in.0"))
    out = tmp_path / "out"
    r = _run_bundler(tmp_path, out, "--trip-ns", str(trip))
    assert r.returncode == 0, r.stderr
    tags = [json.loads(x)["tag"] for x in (out / "trace-merged.ndjson").read_text().splitlines()]
    assert tags == ["before.in.1", "safety.tripped", "after.in.0"]
    m = json.loads((out / "bundle.json").read_text())
    assert m["requested_window"] == {"start_ns": trip - 5 * 10**9, "end_ns": trip + 10**9}
    assert m["truncated_before"] is True     # the window starts before the oldest record kept
    assert m["tail_missing"] is False        # the capture came after the window's end
    assert m["tail_wait_s"] == 0.0           # a trip long past waits for nothing


def test_a_capture_before_the_tail_says_so(tmp_path):
    """A trip whose window ends past the bounded wait: `tail_missing`."""
    trip = time.time_ns() + 60 * 10**9      # stamped ahead (a stepped clock)
    (tmp_path / "trace.ndjson").write_bytes(_rec(trip - 10**9, "x"))
    out = tmp_path / "out"
    t0 = time.monotonic()
    r = _run_bundler(tmp_path, out, "--trip-ns", str(trip))
    assert r.returncode == 0, r.stderr
    assert time.monotonic() - t0 < 10
    m = json.loads((out / "bundle.json").read_text())
    assert m["tail_missing"] is True and m["tail_wait_s"] <= 1.3


def test_crash_log_is_its_own_artifact_never_counted_twice(tmp_path):
    """A crash record stands in the trace AND in crash.log (lcnc_trace writes
    both): the timeline has it ONCE (from the trace), crash.log is copied
    whole as its own snapshot with its sources."""
    trip = 100 * 10**9
    crash = _rec(trip - 10**9, "crash.thread", level="error")
    (tmp_path / "trace.ndjson").write_bytes(_rec(trip, "safety.tripped") + crash)
    (tmp_path / "crash.log.1").write_bytes(_rec(trip - 50 * 10**9, "crash.signal"))
    (tmp_path / "crash.log").write_bytes(crash)
    (tmp_path / "crash.lock").write_bytes(b"")
    out = tmp_path / "out"
    r = _run_bundler(tmp_path, out, "--trip-ns", str(trip))
    assert r.returncode == 0, r.stderr
    tags = [json.loads(x)["tag"] for x in (out / "trace-merged.ndjson").read_text().splitlines()]
    assert tags.count("crash.thread") == 1
    m = json.loads((out / "bundle.json").read_text())
    assert [s["name"] for s in m["crash"]["sources"]] == ["crash.log.1", "crash.log"]
    copied = (out / "crash-snapshot.log").read_text().splitlines()
    assert [json.loads(x)["tag"] for x in copied] == ["crash.signal", "crash.thread"]


def test_no_trip_found_is_rc_2(tmp_path):
    (tmp_path / "trace.ndjson").write_bytes(_rec(1, "x"))
    r = _run_bundler(tmp_path, tmp_path / "out", "--trip")
    assert r.returncode == 2


# ── the gateway's call ───────────────────────────────────────────────────
def test_the_gateway_runs_the_bundler_beside_it_and_names_a_failure(tmp_path, monkeypatch):
    import fake_linuxcnc
    fake_linuxcnc.install()
    import gateway
    calls, events = [], []
    monkeypatch.setattr(gateway._trace, "log_dir", lambda: str(tmp_path))
    monkeypatch.setattr(gateway._trace, "emit", lambda tag, **kw: events.append((tag, kw)))

    def fake_run(argv, **kw):
        calls.append(argv)
        return subprocess.CompletedProcess(argv, 2, b"", b"[bundler] --trip: no trip detected\n")
    monkeypatch.setattr(gateway.subprocess, "run", fake_run)
    gateway._snapshot_trip(123)
    argv = calls[0]
    assert argv[0] == sys.executable
    assert Path(argv[1]) == BUNDLER and argv[1] == gateway._TRACE_BUNDLER
    assert argv[argv.index("--log-dir") + 1] == str(tmp_path)
    assert [t for t, _ in events] == ["safety.trip_snapshot_failed"]
    assert events[0][1]["rc"] == 2 and "no trip detected" in events[0][1]["stderr_tail"]

    events.clear()
    monkeypatch.setattr(gateway.subprocess, "run",
                        lambda argv, **kw: subprocess.CompletedProcess(argv, 0, b"", b""))
    gateway._snapshot_trip(124)
    assert [t for t, _ in events] == ["safety.trip_snapshot_done"]


def test_a_generation_left_open_keeps_its_boundary_in_the_crash_snapshot(tmp_path):
    """Codex R428 MT-I13, the bundler: generations written before the fix
    (or by any writer) may end open — the copy keeps the boundary, the next
    generation's first record stays one readable line, the open end and the
    damage are named per source."""
    (tmp_path / "crash.log.1").write_bytes(b'{"cut":')
    (tmp_path / "crash.log").write_bytes(json.dumps({"tag": "crash.after", "t_wall_ns": 2}).encode() + b"\n")
    out = tmp_path / "bundle"
    out.mkdir()
    account = _bundler().copy_crash_log(str(tmp_path), str(out))
    assert account["lock"] == "held"
    rows = []
    for line in (out / "crash-snapshot.log").read_bytes().splitlines():
        try:
            rows.append(json.loads(line))
        except ValueError:
            pass
    assert [r.get("tag") for r in rows] == ["crash.after"], (out / "crash-snapshot.log").read_text()
    assert account["open_ends"] == ["crash.log.1"]
    assert account["damaged"] == {"crash.log.1": 1}
