#!/usr/bin/env python3
"""The per-worker mock's isolation harness (Codex R261/R262 PM261-03/-04):
each case is an INNER Playwright run (playwright.proof.config.ts, e2e-proof/)
the harness starts with its own environment and judges from the OUTSIDE —
the report, the participants' marks and the fixture's event log. An inner
run may fail on purpose; the case passes only when it failed (or passed)
exactly as expected, for the expected reason.

    lcnc-gateway/.venv/bin/python3 scripts/test_select/proof_harness.py --out <result.json>

Cases: isolation on own mocks (two workers at once, a barrier); the same on
ONE shared mock (must fail on A's state check after B's confirmed reset —
a barrier, slot or bind failure is no counter-proof); file after file in one
worker; a worker ending hard and its replacement; a slow predecessor released
from the handoff wait's logged start within and beyond the limit; a foreign
server on the slot port. Never beside a gate's browser run (it binds the slot
ports).
"""
from __future__ import annotations

import argparse
import json
import os
import socket
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WEB = ROOT / "lcnc-webui"
HANDOFF_MS = 5_000           # e2e/mockFixture.ts
SHARED_PORT = 4590           # the negative case's one mock, outside the slot range


def busy(port: int) -> bool:
    for host in ("127.0.0.1", "::1"):
        try:
            with socket.create_connection((host, port), timeout=0.3):
                return True
        except OSError:
            pass
    return False


class Inner:
    """One inner run's directory, environment and results."""

    def __init__(self, name: str, dirs: list[str], workers: int, extra: dict | None = None):
        self.dir = Path(tempfile.mkdtemp(prefix=f"lcnc-proof-{name}-"))
        self.dirs, self.workers = dirs, workers
        self.env = {**os.environ, "LCNC_PROOF_DIR": str(self.dir), "LCNC_PROOF_WORKERS": str(workers),
                    "LCNC_E2E_EVENTS": str(self.dir / "events.jsonl"),
                    "LCNC_E2E_RUN": f"proof-{name}-{os.getpid()}-{time.time_ns()}",
                    "PLAYWRIGHT_JSON_OUTPUT_FILE": str(self.dir / "report.json"),
                    "PLAYWRIGHT_JSON_OUTPUT_NAME": str(self.dir / "report.json"), **(extra or {})}
        for k in ("LCNC_E2E_WORKERS",):
            self.env.pop(k, None)

    def run(self) -> int:
        r = subprocess.run(["npx", "playwright", "test", "-c", "playwright.proof.config.ts", *self.dirs,
                            "--reporter=json"], cwd=WEB, env=self.env, capture_output=True, text=True)
        (self.dir / "stderr.txt").write_text(r.stderr[-20000:])
        self.rc = r.returncode
        return r.returncode

    def events(self) -> list[dict]:
        f = self.dir / "events.jsonl"
        return [json.loads(l) for l in f.read_text().splitlines()] if f.is_file() else []

    def mark(self, name: str) -> dict | None:
        f = self.dir / name
        return json.loads(f.read_text()) if f.is_file() else None

    def results(self) -> dict[str, dict]:
        """title → {status, error}"""
        f = self.dir / "report.json"
        if not f.is_file():
            return {}
        out = {}

        def walk(s):
            for spec in s.get("specs", []):
                for t in spec.get("tests", []):
                    rs = t.get("results", [])
                    out[spec["title"]] = {"status": rs[-1]["status"] if rs else "none",
                                          "error": " ".join(e.get("message", "") for r in rs for e in r.get("errors", []))}
            for x in s.get("suites", []):
                walk(x)
        for s in json.loads(f.read_text()).get("suites", []):
            walk(s)
        return out


def expect(cond: bool, what: str, problems: list[str]) -> None:
    if not cond:
        problems.append(what)


def overlap(evs: list[dict], a: str, b: str) -> bool:
    span = {}
    for e in evs:
        if e.get("event") in ("test-start", "test-end"):
            span.setdefault(e["title"], {})[e["event"]] = e["t"]
    sa, sb = span.get(a, {}), span.get(b, {})
    return bool(sa and sb) and sa.get("test-start", 1e18) < sb.get("test-end", -1) and sb.get("test-start", 1e18) < sa.get("test-end", -1)


def case_own() -> dict:
    run, p = Inner("own", ["e2e-proof/own"], 2), []
    rc = run.run()
    res, ev = run.results(), run.events()
    a_set, b_chk, a_fin = run.mark("A-set"), run.mark("B-checked"), run.mark("A-final")
    expect(rc == 0, f"exit {rc}", p)
    expect(all(r["status"] == "passed" for r in res.values()) and len(res) == 2, f"results {res}", p)
    expect(bool(a_set and b_chk and a_fin), "a participant missed a phase", p)
    if a_set and b_chk:
        expect(a_set["parallelIndex"] != b_chk["parallelIndex"], "both on one worker", p)
        expect(a_set["instance"] != b_chk["instance"], "both on one mock", p)
    expect(overlap(ev, "A on its own worker's mock", "B on its own worker's mock"), "the two tests did not overlap", p)
    if a_fin:
        expect(len(a_fin["axes"]) == 9 and a_fin["quiet"] is True, f"A lost its state: {a_fin}", p)
    return {"case": "isolation on own mocks", "pass": not p, "problems": p, "dir": str(run.dir)}


def case_shared() -> dict:
    """The NEGATIVE case: one mock both workers use; A must lose its state."""
    p = []
    instance = f"shared-{time.time_ns()}"
    mock = subprocess.Popen(["node", "e2e/mock-gateway.mjs"], cwd=WEB, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                            stderr=subprocess.DEVNULL, text=True,
                            env={**os.environ, "MOCK_PORT": str(SHARED_PORT), "MOCK_INSTANCE": instance,
                                 "MOCK_EXIT_ON_STDIN_EOF": "1"})
    try:
        line = mock.stdout.readline()
        while line and not line.startswith("MOCK-BOUND"):
            line = mock.stdout.readline()
        expect(line.strip() == f"MOCK-BOUND {SHARED_PORT} {instance}", f"the shared mock did not bind: {line!r}", p)
        run = Inner("shared", ["e2e-proof/shared"], 2, {"LCNC_PROOF_SHARED": f"http://localhost:{SHARED_PORT}/"})
        rc = run.run()
        res = run.results()
        a_set, b_chk, a_fin = run.mark("A-set"), run.mark("B-checked"), run.mark("A-final")
        expect(rc != 0, "the shared run passed — the sentinel would not see contamination", p)
        expect(bool(a_set and b_chk and a_fin), f"a participant missed a phase (no counter-proof): {res}", p)
        if a_set and b_chk:
            expect(a_set["parallelIndex"] != b_chk["parallelIndex"], "not two actual workers", p)
        a, b = res.get("A on the one shared mock", {}), res.get("B on the one shared mock", {})
        expect(b.get("status") == "passed", f"B did not pass: {b}", p)
        expect(a.get("status") == "failed" and "A's own state after B's reset" in a.get("error", ""),
               f"A did not fail on its state check: {a}", p)
        expect("barrier" not in a.get("error", ""), "A failed on the barrier, not on the state", p)
        if a_fin:
            expect(a_fin["axes"] == ["X", "Y", "Z"], f"the expected deviation (A's state reset by B) missing: {a_fin}", p)
    finally:
        mock.stdin.close()
        mock.wait(timeout=10)
    return {"case": "isolation on ONE shared mock (negative)", "pass": not p, "problems": p, "dir": str(run.dir)}


def case_sequence() -> dict:
    run, p = Inner("sequence", ["e2e-proof/sequence"], 1), []
    rc = run.run()
    res = run.results()
    dirty, clean = run.mark("dirty"), run.mark("clean")
    expect(rc == 0 and all(r["status"] == "passed" for r in res.values()) and len(res) == 2, f"exit {rc}: {res}", p)
    expect(bool(dirty and clean) and dirty["instance"] == clean["instance"], "not the same worker's mock", p)
    return {"case": "file after file in one worker", "pass": not p, "problems": p, "dir": str(run.dir)}


def crash_run(name: str, release_after_s: float | None) -> tuple[Inner, dict]:
    extra = {}
    if release_after_s is not None:
        extra["MOCK_EXIT_HOLD_UNTIL"] = ""   # set below, once the dir exists
    run = Inner(name, ["e2e-proof/crash"], 1, extra)
    release = run.dir / "release"
    timing: dict = {}
    if release_after_s is not None:
        run.env["MOCK_EXIT_HOLD_UNTIL"] = str(release)

        def releaser():
            t0 = time.time()
            while time.time() - t0 < 120:
                waits = [e for e in run.events() if e.get("event") == "handoff-wait"]
                if waits:
                    timing["handoff_wait_t"] = waits[0]["t"]
                    time.sleep(release_after_s)
                    timing["released_t"] = int(time.time() * 1000)
                    release.write_text("go")
                    return
                time.sleep(0.05)
        th = threading.Thread(target=releaser, daemon=True)
        th.start()
    run.run()
    if release_after_s is not None:
        release.write_text("go")      # let every held mock leave, whatever happened
    return run, timing


def case_crash() -> dict:
    run, _ = crash_run("crash", None)
    p, res, ev = [], run.results(), run.events()
    crashed, replaced = run.mark("crashed"), run.mark("replaced")
    after = res.get("the replacement worker binds a new mock on the slot, at the baseline", {})
    expect(run.rc != 0, "the crash did not fail the inner run", p)
    expect(after.get("status") == "passed", f"the replacement test: {after}", p)
    expect(bool(crashed and replaced) and crashed["instance"] != replaced["instance"], "no new mock", p)
    bound = [e for e in ev if e.get("event") == "bound"]
    expect(len({e["workerIndex"] for e in bound}) >= 2 and len({e["slot"] for e in bound}) == 1, f"bound: {bound}", p)
    return {"case": "a worker ending hard, its replacement", "pass": not p, "problems": p, "dir": str(run.dir)}


def case_delay(within: bool) -> dict:
    after_s = 1.0 if within else HANDOFF_MS / 1000 + 2.5
    run, timing = crash_run("delay-in" if within else "delay-out", after_s)
    p, res, ev = [], run.results(), run.events()
    after = res.get("the replacement worker binds a new mock on the slot, at the baseline", {})
    expect("handoff_wait_t" in timing, "no handoff wait was logged — the predecessor was not held", p)
    if within:
        expect(after.get("status") == "passed", f"the replacement within the limit: {after}", p)
        bound_after = [e for e in ev if e.get("event") == "bound" and e["t"] >= timing.get("handoff_wait_t", 1e18)]
        expect(bool(bound_after), "no new mock bound after the handoff wait", p)
    else:
        expect(after.get("status") == "failed" and "handoff timed out" in after.get("error", ""),
               f"the replacement beyond the limit did not fail on the handoff: {after}", p)
        expect(any(e.get("event") == "handoff-timeout" for e in ev), "no handoff-timeout event", p)
    return {"case": f"a slow predecessor released {after_s} s after the handoff wait began",
            "pass": not p, "problems": p, "timing": timing, "dir": str(run.dir)}


def case_foreign() -> dict:
    p = []
    srv = subprocess.Popen([sys.executable, "-m", "http.server", "4500", "--bind", "127.0.0.1"],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, cwd=tempfile.mkdtemp())
    try:
        for _ in range(50):
            if busy(4500):
                break
            time.sleep(0.1)
        run = Inner("foreign", ["e2e-proof/foreign"], 1)
        rc = run.run()
        res = run.results()
        one = res.get("a test whose worker finds its slot's port taken", {})
        expect(rc != 0 and one.get("status") == "failed", f"the run did not refuse: {one}", p)
        expect("held by a process this run did not start" in one.get("error", ""), f"the reason: {one.get('error', '')[:200]}", p)
        expect(srv.poll() is None, "the foreign server was stopped", p)
    finally:
        srv.terminate()
        srv.wait(timeout=10)
    return {"case": "a foreign server on the slot port", "pass": not p, "problems": p, "dir": str(run.dir)}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", type=Path, required=True)
    a = ap.parse_args(argv)
    taken = [port for port in (*range(4500, 4504), SHARED_PORT) if busy(port)]
    if taken:
        print(f"proof_harness: ports {taken} are taken — never beside a gate's browser run", file=sys.stderr)
        return 2
    cases = [case_own(), case_shared(), case_sequence(), case_crash(), case_delay(True), case_delay(False), case_foreign()]
    result = {"pass": all(c["pass"] for c in cases), "cases": cases}
    a.out.write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n")
    for c in cases:
        print(f"{'PASS' if c['pass'] else 'FAIL'}  {c['case']}" + ("" if c["pass"] else f": {c['problems']}"))
    return 0 if result["pass"] else 1


if __name__ == "__main__":
    sys.exit(main())
