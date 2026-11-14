"""The replay check's guards (test strategy step 5 — Codex R251 TS248-04
Rest A/B, R265–R269 FI265-02, R349 VM349-01): synthetic mock logs, each
case red for ITS reason alone.

    python3 -m pytest scripts/test_select/test_replay.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))
import replay  # noqa: E402

RUN = "run-1"
A = ("tid-a", 0)
B = ("tid-b", 0)


def origin(key, run=RUN):
    return {"run": run, "test": key[0], "project": "e2e", "retry": key[1]}


class Mock:
    """One mock instance's replay log and its events."""

    def __init__(self, inst="m1"):
        self.inst, self.lines, self.t, self.conn = inst, [{"kind": "head", "run": RUN, "instance": inst, "t": 0}], 0, 0

    def tick(self):
        self.t += 10
        return self.t

    def open(self, o):
        self.conn += 1
        self.lines.append({"kind": "open", "conn": self.conn, "origin": o, "t": self.tick()})
        return self.conn

    def frame(self, conn, msg):
        self.lines.append({"kind": "frame", "conn": conn, "msg": msg, "t": self.tick()})

    def raw(self, conn, text):
        self.lines.append({"kind": "frame", "conn": conn, "raw": text, "t": self.tick()})

    def http(self, o, path="/", status=200, method="GET"):
        self.lines.append({"kind": "http", "method": method, "path": path, "origin": o, "status": status, "t": self.tick()})

    def page(self, key):
        """A test's page: its load, its socket, its hello."""
        self.http(origin(key))
        c = self.open(origin(key))
        self.frame(c, {"cmd": "hello", "session": "s", "resume_armed": False, "device_token": None,
                       "device_storage": "ok"})
        return c


def write(tmp_path, mocks, attempts, *, end=True):
    d = tmp_path / "replay"
    d.mkdir(exist_ok=True)
    events = []
    for m in mocks:
        events.append({"run": RUN, "event": "bound", "instance": m.inst})
        lines = m.lines + ([{"kind": "end", "t": m.tick()}] if end else [])
        (d / f"{RUN}-{m.inst}.jsonl").write_text("".join(json.dumps(x) + "\n" for x in lines))
    for (key, inst, file, title, status, start, stop) in attempts:
        common = {"run": RUN, "testId": key[0], "retry": key[1], "file": file, "title": title, "project": "e2e",
                  "instance": inst}
        events += [{**common, "event": "test-start", "t": start}, {**common, "event": "test-end", "t": stop, "status": status}]
    ev = tmp_path / "events.jsonl"
    ev.write_text("".join(json.dumps(e) + "\n" for e in events))
    return d, ev


def attempt(key, inst="m1", file="x.spec.ts", title="t", status="passed", start=0, stop=10**9):
    return (key, inst, file, title, status, start, stop)


def run(tmp_path, mocks, attempts, refusals=(), **kw):
    d, ev = write(tmp_path, mocks, attempts, **kw)
    return replay.check(d, ev, RUN, list(refusals))


def test_a_clean_page_passes(tmp_path):
    m = Mock()
    c = m.page(A)
    m.frame(c, {"cmd": "heartbeat", "seq": 1})
    m.frame(c, {"cmd": "mdi", "text": "G0 X1", "vars": {"3014": 1}})        # a declared number in every example
    r = run(tmp_path, [m], [attempt(A)])
    assert r["verdict"] == "PASS", r["findings"]
    assert r["per_attempt"] == {"x.spec.ts › t [retry 0]": {"heartbeat": 1, "hello": 1, "mdi": 1}}


# ── 1. complete ──────────────────────────────────────────────────────────────
def test_a_log_without_its_end_fails(tmp_path):
    m = Mock()
    m.page(A)
    r = run(tmp_path, [m], [attempt(A)], end=False)
    assert any("no end line" in f for f in r["findings"])


def test_a_bound_mock_without_a_log_fails(tmp_path):
    d, ev = write(tmp_path, [], [attempt(A)])
    ev.write_text(json.dumps({"run": RUN, "event": "bound", "instance": "ghost"}) + "\n")
    r = replay.check(d, ev, RUN, [])
    assert r["findings"] == [f"{RUN}-ghost.jsonl: no replay log for a mock the run bound"]


def test_a_log_of_an_unbound_instance_fails(tmp_path):
    m = Mock()
    m.page(A)
    d, ev = write(tmp_path, [m], [attempt(A)])
    (d / f"{RUN}-stray.jsonl").write_text(json.dumps({"kind": "head", "run": RUN, "instance": "stray"}) + "\n")
    r = replay.check(d, ev, RUN, [])
    assert any("never bound" in f for f in r["findings"])


def test_no_event_of_the_run_is_no_pass(tmp_path):
    d, ev = write(tmp_path, [], [])
    r = replay.check(d, ev, RUN, [])
    assert r["verdict"] == "FAIL" and "names no mock" in r["findings"][0]


# ── 2. origin ────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("o, why", [
    (None, "without an origin"),
    (origin(A, run="other-run"), "no attempt of this run"),
    (origin(("tid-unknown", 0)), "no attempt of this run"),
    ({"infra": "infra:something"}, "unnamed infrastructure origin"),
])
def test_a_connection_of_no_attempt_fails(tmp_path, o, why):
    m = Mock()
    m.page(A)
    m.open(o)
    r = run(tmp_path, [m], [attempt(A)])
    assert len(r["findings"]) == 1 and why in r["findings"][0], r["findings"]


def test_the_baseline_reads_and_a_baseline_that_sends_fails(tmp_path):
    m = Mock()
    m.page(A)
    c = m.open({"infra": "infra:baseline"})
    assert run(tmp_path, [m], [attempt(A)])["verdict"] == "PASS"
    m.frame(c, {"cmd": "arm", "armed": True})
    assert any("infrastructure origin infra:baseline sent" in f for f in run(tmp_path, [m], [attempt(A)])["findings"])


def test_the_named_no_cookie_socket_only_inside_its_spec(tmp_path):
    m = Mock()
    m.page(A)
    c = m.open(None)
    m.frame(c, {"cmd": "hello", "session": replay.NO_COOKIE_SESSION})
    inside = attempt(A, file=replay.NO_COOKIE_SPEC, start=0, stop=10**9)
    assert run(tmp_path, [m], [inside])["verdict"] == "PASS"
    other_spec = attempt(A, file="other.spec.ts")
    assert any("without an origin" in f for f in run(tmp_path, [m], [other_spec])["findings"])
    m.frame(c, {"cmd": "arm", "armed": True})                         # anything more than its hello
    assert any("without an origin" in f for f in run(tmp_path, [m], [inside])["findings"])


def test_two_workers_overlapping_keep_their_attempts(tmp_path):
    m1, m2 = Mock("m1"), Mock("m2")
    a, b = m1.page(A), m2.page(B)
    for _ in range(3):                         # interleaved in time
        m1.frame(a, {"cmd": "cycle_pause"})
        m2.frame(b, {"cmd": "abort"})
    r = run(tmp_path, [m1, m2], [attempt(A, "m1", title="a"), attempt(B, "m2", title="b")])
    assert r["verdict"] == "PASS", r["findings"]
    assert r["per_attempt"]["x.spec.ts › a [retry 0]"]["cycle_pause"] == 3
    assert r["per_attempt"]["x.spec.ts › b [retry 0]"]["abort"] == 3
    assert "abort" not in r["per_attempt"]["x.spec.ts › a [retry 0]"]


def test_a_retry_is_its_own_attempt(tmp_path):
    m = Mock()
    retry = ("tid-a", 1)
    m.page(A)
    c = m.page(retry)
    m.frame(c, {"cmd": "abort"})
    r = run(tmp_path, [m], [attempt(A, status="failed"), attempt(retry)])
    assert set(r["per_attempt"]) == {"x.spec.ts › t [retry 0]", "x.spec.ts › t [retry 1]"}
    assert "abort" in r["per_attempt"]["x.spec.ts › t [retry 1]"]


def test_a_late_frame_on_an_old_connection_keeps_its_attempt(tmp_path):
    m = Mock()
    old = m.page(A)
    m.page(B)                                  # the next test started
    m.frame(old, {"cmd": "abort"})             # A's connection, after it
    r = run(tmp_path, [m], [attempt(A, title="a", stop=15), attempt(B, title="b", start=16)])
    assert r["per_attempt"]["x.spec.ts › a [retry 0]"].get("abort") == 1
    assert "abort" not in r["per_attempt"]["x.spec.ts › b [retry 0]"]


# ── 3. vacuity ───────────────────────────────────────────────────────────────
def test_a_loaded_page_without_a_hello_fails(tmp_path):
    m = Mock()
    m.http(origin(A))
    r = run(tmp_path, [m], [attempt(A)])
    assert r["findings"] == ["x.spec.ts › t [retry 0]: the page loaded and its replay shows no hello"]


# ── 4./5. form, the reader's frames ─────────────────────────────────────────
@pytest.mark.parametrize("msg, why", [
    ({"cmd": "abort", "speed": 3}, "undeclared fields ['speed']"),      # an unknown top-level field
    ({"cmd": "warp_drive"}, "no command the UI declares"),                              # an invented command
    ({"cmd": "heartbeat", "seq": -1}, "the reader refuses ['seq']"),
    ({"cmd": "tab_visibility", "hidden": "yes"}, "the reader refuses ['hidden']"),
    ({"cmd": "save_settings", "section": "nonsense", "data": {}}, "the reader refuses ['section']"),
    ({"seq": 1}, "without a string cmd"),
])
def test_a_frame_outside_its_form_fails(tmp_path, msg, why):
    m = Mock()
    c = m.page(A)
    m.frame(c, msg)
    r = run(tmp_path, [m], [attempt(A)])
    assert len(r["findings"]) == 1 and why in r["findings"][0], r["findings"]


def test_a_non_json_frame_fails(tmp_path):
    m = Mock()
    c = m.page(A)
    m.raw(c, "not json")
    assert any("no JSON object" in f for f in run(tmp_path, [m], [attempt(A)])["findings"])


# ── 6. the gateway's payload check ───────────────────────────────────────────
@pytest.mark.parametrize("msg, why", [
    ({"cmd": "touchoff", "axes": {"Q": 1.0}}, "refused"),                 # a wrong key in touchoff.axes
    ({"cmd": "mdi", "text": "G0", "vars": {"3999": 1}}, "refused"),       # a number no example declares
    ({"cmd": "set_feed_override"}, "refused"),                            # the value that decides the action, missing
])
def test_a_payload_the_gateway_refuses_fails_with_each_var_file(tmp_path, msg, why):
    m = Mock()
    c = m.page(A)
    m.frame(c, msg)
    r = run(tmp_path, [m], [attempt(A)])
    assert r["findings"] and all(why in f for f in r["findings"]), r["findings"]


def test_a_correction_is_a_finding(tmp_path, monkeypatch):
    cp, _, _ = replay._policy()
    monkeypatch.setattr(cp, "validate_payload", lambda cmd, msg, limits: {"vel": 1.0})
    m = Mock()
    c = m.page(A)
    m.frame(c, {"cmd": "jog_cont", "axis": 0, "vel": 99.0})
    assert any("corrected ['vel']" in f for f in run(tmp_path, [m], [attempt(A)])["findings"])


# ── 7. probe ─────────────────────────────────────────────────────────────────
def test_a_probe_through_mdi_fails(tmp_path):
    m = Mock()
    c = m.page(A)
    m.frame(c, {"cmd": "mdi", "text": "O<probe_xy_hole> CALL"})
    assert any("probe routine through MDI" in f for f in run(tmp_path, [m], [attempt(A)])["findings"])


def test_a_passed_probe_click_needs_its_probe_run(tmp_path):
    m = Mock()
    m.page(A)
    click = attempt(A, file=replay.PROBE_SPEC)
    assert any("no probe_run" in f for f in run(tmp_path, [m], [click])["findings"])
    m2 = Mock()
    c = m2.page(A)
    m2.frame(c, {"cmd": "probe_run", "routine": "probe_xy_hole", "vars": {"3014": 1}})
    r = run(tmp_path, [m2], [click])
    assert r["verdict"] == "PASS", r["findings"]
    assert r["per_attempt"]["probe-click.spec.ts › t [retry 0]"]["probe_run:probe_xy_hole"] == 1


# ── expected refusals ────────────────────────────────────────────────────────
EXPECT = {"file": "x.spec.ts", "title": "t", "cmd": "touchoff", "payload": {"axes": {"Q": 1.0}}, "refusal": "refused"}


def test_an_expected_refusal_is_no_finding_and_another_still_is(tmp_path):
    m = Mock()
    c = m.page(A)
    m.frame(c, {"cmd": "touchoff", "axes": {"Q": 1.0}})
    r = run(tmp_path, [m], [attempt(A)], refusals=[EXPECT])
    assert r["verdict"] == "PASS" and len(r["expected"]) == 1, r["findings"]
    m.frame(c, {"cmd": "touchoff", "axes": {"R": 1.0}})                  # another payload, same test
    assert any("touchoff refused" in f for f in run(tmp_path, [m], [attempt(A)], refusals=[EXPECT])["findings"])


def test_an_expected_refusal_that_never_came_fails(tmp_path):
    m = Mock()
    m.page(A)
    r = run(tmp_path, [m], [attempt(A)], refusals=[EXPECT])
    assert any("expected refusal not seen" in f for f in r["findings"])


def test_the_shipped_expectations_are_well_formed():
    for x in json.loads(replay.REFUSALS.read_text()):
        assert set(x) >= {"file", "title", "cmd", "payload", "refusal", "why"}, x
