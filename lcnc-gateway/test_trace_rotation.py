"""The trace's ONE coordinated section per line (P3, machine day 2026-11-21
F23; Codex R425 MT425-02, R426).

Every writer — the Python processes through lcnc_trace's
CoordinatedFileHandler and the launcher's `_trace_append` — takes the log's
stable lock and checks identity, size, the open end and writes the complete
line inside it. These tests run REAL processes (two writers rotating, a
writer under a file-size limit, a rotator killed holding the lock) and the
launcher's own shell block; nothing here imports the gateway.

Red proofs (recorded in docs/decisions.md 2026-11-21 P3): the two-writer
rotation and the cross-process fragment case fail against the pre-P3
lcnc_trace (RotatingFileHandler) — `python3 test_trace_rotation.py --red
<dir holding the old lcnc_trace.py>` runs both against it.
"""
from __future__ import annotations

import errno
import json
import re
import signal
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
LAUNCHER = HERE.parent / "lcnc-suite"

# A child writer: lcnc_trace from `moddir`, a small file size, many backups
# (nothing deleted — every record must be found in exactly one file).
_WRITER = r"""
import json, os, sys, time
moddir, folder, proc, count, max_bytes, backups = sys.argv[1:7]
sys.path.insert(0, moddir)
import lcnc_trace as tr
tr._TRACE_MAX_BYTES = int(max_bytes)
tr._TRACE_BACKUPS = int(backups)
tr.init(proc, log_dir=folder)
for i in range(int(count)):
    tr.emit("w.seq", seq=i, pad="x" * 60)
"""


def _run_writers(moddir: Path, folder: Path, n: int = 600, max_bytes: int = 6000, backups: int = 400,
                 procs=("gateway", "hal_reader")) -> list[subprocess.CompletedProcess]:
    ps = [subprocess.Popen([sys.executable, "-c", _WRITER, str(moddir), str(folder), p, str(n),
                            str(max_bytes), str(backups)]) for p in procs]
    return [p.wait(timeout=120) for p in ps]


def _all_lines(folder: Path, name: str = "trace.ndjson") -> list[tuple[str, bytes]]:
    pat = re.compile(r"\A" + re.escape(name) + r"(?:\.[1-9][0-9]*)?\Z")
    out = []
    for f in sorted(folder.iterdir()):
        if pat.match(f.name):
            for line in f.read_bytes().split(b"\n"):
                if line:
                    out.append((f.name, line))
    return out


def _records(folder: Path, name: str = "trace.ndjson") -> tuple[list[dict], list[bytes]]:
    recs, damaged = [], []
    for _f, line in _all_lines(folder, name):
        try:
            r = json.loads(line)
        except ValueError:
            damaged.append(line)
            continue
        recs.append(r)
    return recs, damaged


def two_writer_verdict(moddir: Path, folder: Path) -> dict:
    """Two processes write 600 records each across ~25 rotations: how many of
    each are found, how often, and in which files after their last rotation."""
    _run_writers(moddir, folder)
    recs, damaged = _records(folder)
    seen: dict[tuple[str, int], int] = {}
    for r in recs:
        if r.get("tag") == "w.seq":
            key = (r["proc"], r["seq"])
            seen[key] = seen.get(key, 0) + 1
    want = {(p, i) for p in ("gateway", "hal_reader") for i in range(600)}
    return {"missing": len(want - set(seen)), "twice": sum(1 for v in seen.values() if v > 1),
            "damaged": len(damaged), "files": len([f for f in folder.iterdir() if f.name.startswith("trace.ndjson")])}


def test_two_writers_rotating_keep_every_record_exactly_once(tmp_path):
    v = two_writer_verdict(HERE, tmp_path)
    assert v == {"missing": 0, "twice": 0, "damaged": 0, "files": v["files"]}, v
    assert v["files"] > 10, v   # it did rotate, many times
    # the lock files are no generations of the logs
    assert (tmp_path / "trace.lock").exists() and not list(tmp_path.glob("trace.ndjson*.lock"))


def test_a_rotation_by_another_writer_is_followed_at_the_next_line(tmp_path):
    """Writer A keeps its fd; B rotates; A's next record lands in the NEW
    trace.ndjson — never appended to the renamed `.1` (the machine day's
    split: gateway → .1, hal_reader → .2)."""
    sys.path.insert(0, str(HERE))
    import lcnc_trace as tr
    h = tr.CoordinatedFileHandler(str(tmp_path / "trace.ndjson"), str(tmp_path / "trace.lock"),
                                  max_bytes=0, backups=5, report_prefix="trace")
    assert h.append(b'{"t_wall_ns":1,"tag":"a.before"}\n')
    subprocess.run([sys.executable, "-c",
                    "import sys; sys.path.insert(0, sys.argv[1]); import lcnc_trace as tr; "
                    "h = tr.CoordinatedFileHandler(sys.argv[2] + '/trace.ndjson', sys.argv[2] + '/trace.lock', "
                    "max_bytes=0, backups=5, report_prefix='trace'); h.doRollover()",
                    str(HERE), str(tmp_path)], check=True)
    assert h.append(b'{"t_wall_ns":2,"tag":"a.after"}\n')
    assert b"a.after" in (tmp_path / "trace.ndjson").read_bytes()
    assert b"a.after" not in (tmp_path / "trace.ndjson.1").read_bytes()
    assert b"a.before" in (tmp_path / "trace.ndjson.1").read_bytes()


def _handler(tmp_path, **kw):
    sys.path.insert(0, str(HERE))
    import lcnc_trace as tr
    return tr, tr.CoordinatedFileHandler(str(tmp_path / "trace.ndjson"), str(tmp_path / "trace.lock"),
                                         max_bytes=kw.get("max_bytes", 0), backups=5,
                                         report_prefix=kw.get("prefix", "trace"))


def test_a_held_lock_drops_and_counts_and_the_next_section_reports(tmp_path):
    """No unlocked write: while another process holds the lock past the
    budget the record is DROPPED and counted; the next section writes
    `trace.write_lost` first, then its own line."""
    tr, h = _handler(tmp_path)
    holder = subprocess.Popen([sys.executable, "-c",
                               "import fcntl, os, sys, time; fd = os.open(sys.argv[1], os.O_RDWR | os.O_CREAT); "
                               "fcntl.flock(fd, fcntl.LOCK_EX); print('held', flush=True); time.sleep(30)",
                               str(tmp_path / "trace.lock")], stdout=subprocess.PIPE, text=True)
    try:
        assert holder.stdout.readline().strip() == "held"
        t0 = time.monotonic()
        assert not h.append(b'{"t_wall_ns":1,"tag":"while.held"}\n')
        waited = time.monotonic() - t0
        assert tr._LOCK_BUDGET_S <= waited < tr._LOCK_BUDGET_S + 0.2, waited
        assert h.pending_report()["lost"] == 1 and h.pending_report()["why"] == {"lock_busy": 1}
        assert not (tmp_path / "trace.ndjson").exists() or b"while.held" not in (tmp_path / "trace.ndjson").read_bytes()
    finally:
        holder.kill()
        holder.wait()
    assert h.append(b'{"t_wall_ns":2,"tag":"after"}\n')
    lines = [json.loads(x) for x in (tmp_path / "trace.ndjson").read_bytes().splitlines()]
    assert [x["tag"] for x in lines] == ["trace.write_lost", "after"]
    assert lines[0]["count"] == 1 and lines[0]["why"] == {"lock_busy": 1} and lines[0]["log"] == "trace.ndjson"
    assert h.pending_report()["lost"] == 0


def test_a_rotator_killed_holding_the_lock_frees_it(tmp_path):
    tr, h = _handler(tmp_path)
    holder = subprocess.Popen([sys.executable, "-c",
                               "import fcntl, os, sys, time; fd = os.open(sys.argv[1], os.O_RDWR | os.O_CREAT); "
                               "fcntl.flock(fd, fcntl.LOCK_EX); print('held', flush=True); time.sleep(30)",
                               str(tmp_path / "trace.lock")], stdout=subprocess.PIPE, text=True)
    assert holder.stdout.readline().strip() == "held"
    holder.send_signal(signal.SIGKILL)
    holder.wait()
    assert h.append(b'{"t_wall_ns":1,"tag":"after.kill"}\n')


def test_a_rotation_chain_left_half_done_loses_nothing(tmp_path):
    """A rotator that died between two renames left `.1` missing (it had moved
    `.1 → .2` but not the live file → `.1`): the next rotation shifts the
    chain past the gap and keeps every generation."""
    (tmp_path / "trace.ndjson").write_bytes(b'{"t_wall_ns":3,"tag":"live"}\n' * 40)
    (tmp_path / "trace.ndjson.2").write_bytes(b'{"t_wall_ns":2,"tag":"old1"}\n')
    (tmp_path / "trace.ndjson.3").write_bytes(b'{"t_wall_ns":1,"tag":"old2"}\n')
    tr, h = _handler(tmp_path, max_bytes=1000)
    assert h.append(b'{"t_wall_ns":4,"tag":"next"}\n')
    tags = {f.name: [json.loads(x)["tag"] for x in f.read_bytes().splitlines()]
            for f in tmp_path.iterdir() if f.name.startswith("trace.ndjson")}
    assert tags["trace.ndjson"] == ["next"]
    assert set(tags["trace.ndjson.1"]) == {"live"} and tags["trace.ndjson.3"] == ["old1"]
    assert tags["trace.ndjson.4"] == ["old2"]


def test_an_injected_enospc_mid_line_is_ended_counted_and_reported(tmp_path):
    tr, h = _handler(tmp_path)
    assert h.append(b'{"t_wall_ns":1,"tag":"first"}\n')
    real = h.raw_write
    calls = {"n": 0}

    def half_then_enospc(fd, buf):
        calls["n"] += 1
        if calls["n"] == 1:
            return real(fd, buf[:10])
        if calls["n"] == 2:
            raise OSError(errno.ENOSPC, "No space left on device")
        return real(fd, buf)
    h.raw_write = half_then_enospc
    assert not h.append(b'{"t_wall_ns":2,"tag":"lost.line","pad":"xxxxxxxxxxxxxxxx"}\n')
    assert h.pending_report()["why"] == {"ENOSPC": 1}
    h.raw_write = real
    assert h.append(b'{"t_wall_ns":3,"tag":"third"}\n')
    raw = (tmp_path / "trace.ndjson").read_bytes().splitlines()
    assert json.loads(raw[0])["tag"] == "first"
    assert raw[1] == b'{"t_wall_n'                # the fragment, ended by its own writer: ONE damaged line
    rep = json.loads(raw[2])
    assert rep["tag"] == "trace.write_lost" and rep["count"] == 1 and rep["why"] == {"ENOSPC": 1}
    assert json.loads(raw[3])["tag"] == "third"


def test_a_failed_report_keeps_its_count_and_the_line_is_counted_too(tmp_path):
    tr, h = _handler(tmp_path)
    h._count_loss("lock_busy")
    real = h.raw_write
    h.raw_write = lambda fd, buf: (_ for _ in ()).throw(OSError(errno.ENOSPC, "full"))
    assert not h.append(b'{"t_wall_ns":2,"tag":"x"}\n')
    assert h.pending_report()["lost"] == 2 and h.pending_report()["why"] == {"lock_busy": 1, "ENOSPC": 1}
    h.raw_write = real
    assert h.append(b'{"t_wall_ns":3,"tag":"y"}\n')
    lines = [json.loads(x) for x in (tmp_path / "trace.ndjson").read_bytes().splitlines()]
    assert [x["tag"] for x in lines] == ["trace.write_lost", "y"] and lines[0]["count"] == 2


def test_a_crash_log_loss_is_an_error_record_with_a_crash_tag(tmp_path):
    tr, h = _handler(tmp_path, prefix="crash")
    h._count_loss("lock_busy")
    assert h.append(b'{"t_wall_ns":2,"tag":"crash.thread","level":"error"}\n')
    rep = json.loads((tmp_path / "trace.ndjson").read_bytes().splitlines()[0])
    assert rep["tag"] == "crash.write_lost" and rep["level"] == "error"


def test_a_write_reaching_the_handler_inside_its_section_never_unlocks_it(tmp_path):
    """A record that reaches the handler again while its own section runs (a
    console note's failure traced through emit()) is counted, never written
    and never UNLOCKS: flock belongs to the open file description, so a
    nested unlock would release the outer section's lock. The console note
    of a new loss reason is said after the section."""
    tr, h = _handler(tmp_path)
    unlocks: list[bool] = []
    real_unlock, real_write = h._unlock, h.raw_write
    h._unlock = lambda: (unlocks.append(h._in_section), real_unlock())[1]
    nested: list[bool] = []

    def write_and_reenter(fd, buf):
        if not nested:
            nested.append(h.append(b'{"t_wall_ns":9,"tag":"nested"}\n'))
            assert h._notes_due == ["reentrant"]       # not said inside the section
        return real_write(fd, buf)
    h.raw_write = write_and_reenter
    assert h.append(b'{"t_wall_ns":1,"tag":"outer"}\n')
    assert nested == [False] and unlocks == [False]   # ONE unlock, the outer one, after the section
    assert h._notes_due == [] and h.pending_report()["why"] == {"reentrant": 1}
    h.raw_write = real_write
    assert h.append(b'{"t_wall_ns":2,"tag":"next"}\n')
    tags = [json.loads(x)["tag"] for x in (tmp_path / "trace.ndjson").read_bytes().splitlines()]
    assert tags == ["outer", "trace.write_lost", "next"]


def test_close_writes_a_pending_report(tmp_path):
    tr, h = _handler(tmp_path)
    h._count_loss("lock_busy")
    h.close()
    rep = json.loads((tmp_path / "trace.ndjson").read_bytes().splitlines()[0])
    assert rep["tag"] == "trace.write_lost" and rep["count"] == 1


# ── Codex R426: a fragment of a writer that ENDED, closed by the next one ──
_FSIZE_WRITER = r"""
import os, resource, sys
moddir, folder = sys.argv[1:3]
sys.path.insert(0, moddir)
import lcnc_trace as tr
tr.init("gateway", log_dir=folder)
size = os.path.getsize(os.path.join(folder, "trace.ndjson"))
resource.setrlimit(resource.RLIMIT_FSIZE, (size + 64, resource.RLIM_INFINITY))
tr.emit("big.line", pad="y" * 400)    # 64 bytes go in, then EFBIG (SIGXFSZ is ignored by Python)
"""


def fragment_verdict(moddir: Path, folder: Path) -> dict:
    """Process A writes 64 bytes of a line and ends (its file-size limit,
    EFBIG); process B then writes a record. Is B's record readable?"""
    subprocess.run([sys.executable, "-c", _FSIZE_WRITER, str(moddir), str(folder)], check=True)
    subprocess.run([sys.executable, "-c",
                    "import sys; sys.path.insert(0, sys.argv[1]); import lcnc_trace as tr; "
                    "tr.init('hal_reader', log_dir=sys.argv[2]); tr.emit('b.after')",
                    str(moddir), str(folder)], check=True)
    recs, damaged = _records(folder)
    # B's own records: its boot (its FIRST write — the one a fragment would
    # swallow) and b.after
    return {"b_records": sorted(r["tag"] for r in recs
                                if r.get("proc") == "hal_reader" and r.get("tag") in ("boot", "b.after")),
            "damaged": len(damaged),
            "fragment_closed": [r for r in recs if r.get("tag") == "trace.fragment_closed"]}


def test_a_fragment_another_process_left_is_closed_before_the_next_record(tmp_path):
    v = fragment_verdict(HERE, tmp_path)
    assert v["b_records"] == ["b.after", "boot"] and v["damaged"] == 1, v
    assert len(v["fragment_closed"]) == 1 and v["fragment_closed"][0]["proc"] == "hal_reader", v


def test_the_same_writer_resumes_after_efbig_and_reports_it(tmp_path):
    out = subprocess.run([sys.executable, "-c", _FSIZE_WRITER + r"""
resource.setrlimit(resource.RLIMIT_FSIZE, (resource.RLIM_INFINITY, resource.RLIM_INFINITY))
tr.emit("resumed")
""", str(HERE), str(tmp_path)], check=True, capture_output=True, text=True)
    recs, damaged = _records(tmp_path)
    tags = [r["tag"] for r in recs]
    assert tags[-2:] == ["trace.write_lost", "resumed"], tags
    rep = recs[-2]
    assert rep["why"] == {"EFBIG": 1} and rep["count"] == 1 and len(damaged) == 1
    assert "a record was not written (EFBIG)" in out.stderr   # said once on the console too


# ── The launcher's two lines take the same section ──────────────────────
def _launcher_block() -> str:
    text = LAUNCHER.read_text()
    start = text.index("# >>> trace-append")
    end = text.index("# <<< trace-append")
    return text[start:end]


def _bash(folder: Path, script: str) -> subprocess.CompletedProcess:
    prelude = (f'set -euo pipefail\nLCNC_RESOLVED_LOG_DIR="{folder}"\n'
               f'_log() {{ printf "%s\\n" "$*" >> "{folder}/launcher.log"; }}\n')
    return subprocess.run(["bash", "-c", prelude + _launcher_block() + "\n" + script],
                          capture_output=True, text=True, timeout=60)


def test_the_launcher_writes_its_lines_only_through_the_section():
    """Both launcher sites (`_preflight_trace`, the proc.status loop) go
    through `_trace_append`; no other line of the launcher appends to the
    trace (a `>>` per line alone was the pre-P3 path)."""
    text = LAUNCHER.read_text()
    outside = text.replace(_launcher_block(), "")
    assert not re.search(r'>>\s*"\$LCNC_RESOLVED_LOG_DIR/trace\.ndjson"', outside)
    pre = outside[outside.index("_preflight_trace() {"):]
    assert "_trace_append" in pre[:pre.index("\n}\n")]
    loop = outside[outside.index("_start_proc_status_loop() {"):]
    loop = loop[:loop.index("\n}\n")]
    assert "_trace_reset_counts" in loop and '_trace_append "$(printf' in loop


def test_the_launcher_line_goes_in_and_a_held_lock_is_counted_then_reported(tmp_path):
    r = _bash(tmp_path, r'''
_trace_append '{"t_wall_ns":1,"tag":"l.one"}'
exec 8>>"$LCNC_RESOLVED_LOG_DIR/trace.lock"; flock 8
( _trace_append '{"t_wall_ns":2,"tag":"l.lost"}'; echo "lost=$_TRACE_LOST why=${!_TRACE_LOST_WHY[*]}" )
_trace_append '{"t_wall_ns":2,"tag":"l.lost"}'
flock -u 8
_trace_append '{"t_wall_ns":3,"tag":"l.after"}'
echo "end=$_TRACE_LOST"
''')
    assert r.returncode == 0, r.stderr
    assert "lost=1 why=lock_busy" in r.stdout and "end=0" in r.stdout
    lines = [json.loads(x) for x in (tmp_path / "trace.ndjson").read_bytes().splitlines()]
    assert [x["tag"] for x in lines] == ["l.one", "trace.write_lost", "l.after"], lines
    assert lines[1]["count"] == 1 and lines[1]["why"] == {"lock_busy": 1} and lines[1]["proc"] == "launcher"
    assert "trace line not written (lock_busy)" in (tmp_path / "launcher.log").read_text()


def test_the_launcher_closes_a_fragment_before_its_line(tmp_path):
    (tmp_path / "trace.ndjson").write_bytes(b'{"t_wall_ns":1,"tag":"ok"}\n{"t_wall_ns":2,"ta')
    r = _bash(tmp_path, r'''
_trace_append '{"t_wall_ns":3,"tag":"l.line"}'
_trace_append '{"t_wall_ns":4,"tag":"l.next"}'
''')
    assert r.returncode == 0, r.stderr
    raw = (tmp_path / "trace.ndjson").read_bytes().splitlines()
    assert raw[1] == b'{"t_wall_ns":2,"ta'
    tags = [json.loads(x)["tag"] for x in raw[2:]]
    assert tags == ["l.line", "trace.fragment_closed", "l.next"], tags


def test_the_launcher_under_a_file_size_limit_counts_resumes_and_reports(tmp_path):
    """The launcher's section killed by SIGXFSZ mid-line (EFBIG): counted in
    the caller's shell; the same shell, the limit lifted, ends the fragment,
    reports the loss and writes its next line."""
    ok = b'{"t_wall_ns":1,"tag":"ok"}\n'
    (tmp_path / "trace.ndjson").write_bytes(ok * (1000 // len(ok)))   # just under 1024 bytes
    pad = "z" * 300
    r = _bash(tmp_path, rf'''
ulimit -c 0
ulimit -S -f 1        # 1024 bytes (bash counts -f in 1024-byte blocks)
_trace_append '{{"t_wall_ns":2,"tag":"l.big","pad":"{pad}"}}'
echo "lost=$_TRACE_LOST why=${{!_TRACE_LOST_WHY[*]}}"
ulimit -S -f unlimited
_trace_append '{{"t_wall_ns":3,"tag":"l.next"}}'
echo "after=$_TRACE_LOST frag=$_TRACE_FRAGMENTS"
''')
    assert r.returncode == 0, r.stderr
    assert "lost=1 why=EFBIG" in r.stdout and "after=0 frag=1" in r.stdout, r.stdout
    raw = (tmp_path / "trace.ndjson").read_bytes().splitlines()
    tail = raw[1000 // len(ok):]
    big = f'{{"t_wall_ns":2,"tag":"l.big","pad":"{pad}"}}'.encode()
    assert 0 < len(tail[0]) < len(big) and big.startswith(tail[0])   # the cut line: ONE damaged line
    rest = [json.loads(x) for x in tail[1:]]
    assert [x["tag"] for x in rest] == ["trace.write_lost", "l.next"], rest
    assert rest[0]["why"] == {"EFBIG": 1}


def test_the_proc_status_loop_counts_in_its_own_shell(tmp_path):
    """The loop's shell is long-lived: it starts with its own count (none
    inherited from the main shell) and keeps it across its lines."""
    r = _bash(tmp_path, r'''
_trace_count_loss lock_busy
( _trace_reset_counts; echo "loop=$_TRACE_LOST"; _trace_append '{"t_wall_ns":1,"tag":"p"}'; echo "loop_after=$_TRACE_LOST" )
echo "main=$_TRACE_LOST"
''')
    assert r.returncode == 0, r.stderr
    assert "loop=0" in r.stdout and "loop_after=0" in r.stdout and "main=1" in r.stdout
    tags = [json.loads(x)["tag"] for x in (tmp_path / "trace.ndjson").read_bytes().splitlines()]
    assert tags == ["p"]


if __name__ == "__main__" and len(sys.argv) == 3 and sys.argv[1] == "--red":
    # the red proof: the same scenarios against another lcnc_trace (pre-P3)
    import tempfile
    old = Path(sys.argv[2])
    with tempfile.TemporaryDirectory() as d1, tempfile.TemporaryDirectory() as d2:
        print("two writers:", json.dumps(two_writer_verdict(old, Path(d1))))
        print("fragment:", json.dumps(fragment_verdict(old, Path(d2)), default=str))


# ── Codex R428 ────────────────────────────────────────────────────────────
def _json_rows(path):
    rows = []
    for line in path.read_bytes().splitlines():
        try:
            rows.append(json.loads(line))
        except ValueError:
            pass
    return rows


def test_a_loss_counted_while_its_report_is_written_stays_pending(tmp_path):
    """MT-I12 (Codex R428's probe): a reentrant loss while the report of an
    earlier one is written is not erased with it — reported later, or still
    pending; never lost."""
    import os
    import lcnc_trace
    from test_trace_bundle import _rec
    path = tmp_path / "trace.ndjson"
    h = lcnc_trace.CoordinatedFileHandler(str(path), str(tmp_path / "trace.lock"),
                                          max_bytes=0, backups=5, report_prefix="trace")

    def full(fd, data):
        raise OSError(errno.ENOSPC, "injected full disk")
    h.raw_write = full
    assert h.append(_rec(1, "lost.enospc")) is False
    called = False

    def report_reenters(fd, data):
        nonlocal called
        if not called:
            called = True
            assert h.append(_rec(2, "lost.reentrant")) is False
        return os.write(fd, data)
    h.raw_write = report_reenters
    try:
        assert h.append(_rec(3, "after"))
        h.raw_write = os.write
        assert h.append(_rec(4, "next"))
        reports = [r for r in _json_rows(path) if r.get("tag") == "trace.write_lost"]
        assert sum(r["count"] for r in reports) + h.pending_report()["lost"] == 2, (reports, h.pending_report())
        assert sum(r["count"] for r in reports) == 2, "the second loss rode the next section's report"
    finally:
        h.close()


def test_a_fragment_is_closed_in_its_own_file_before_a_rotation(tmp_path):
    """MT-I13, the writer: the open end a dead writer left is ended where it
    is, before the rotation moves the file to `.1` — the generation never
    ends open, the new record is whole."""
    import lcnc_trace
    from test_trace_bundle import _rec
    path = tmp_path / "crash.log"
    path.write_bytes(b'{"cut":')
    h = lcnc_trace.CoordinatedFileHandler(str(path), str(tmp_path / "crash.lock"),
                                          max_bytes=32, backups=5, report_prefix="crash")
    try:
        assert h.append(_rec(2, "crash.after", level="error"))
    finally:
        h.close()
    assert (tmp_path / "crash.log.1").read_bytes() == b'{"cut":\n', "closed before it moved"
    assert "crash.after" in [r.get("tag") for r in _json_rows(path)]
