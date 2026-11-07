#!/usr/bin/env python3
"""The round gate (test strategy step 4, Codex R248–R251, R256): the checks a
round needs, chosen by the selector from a NAMED base, with the proof of what
ran.

    python3 -I scripts/test_select/round_gate.py --base <commit> \\
        --out docs/reviews/<topic>.gate-round.json [--note "…"]

The tree must be clean (its head is the gate's head). In order, never two at
once (plan()): the selector's own guards first — the rule table must hold for
THIS tree before anything may be left out (TS256-03) —, the selection, lint,
build, the light unit set, the heavy files it names, the backend offline gate
when selected, the browser run: the ports free (no server already listening
is ever tested in place of this tree's, TS256-05), the full or the select
config, no focused test, its listing matched test for test to what ran
(TS256-04) and the order against the full chain. Unit runs are matched to
their listing the same way and refuse `.only`. The record names every check
run and left out with its reason; the Firefox core and the live checks a path
asks for stand as pending (an offline PASS is not an acceptance). PASS only
when every check that ran passed, without a skip, a retry or an empty run.
"""
from __future__ import annotations

import argparse
import json
import os
import platform
import socket
import subprocess
import sys
import time
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from test_select import proof, selector  # noqa: E402
from test_select.rules import FULL, HEAVY_UNIT  # noqa: E402
from test_support.heavy_lock import heavy_lock  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
WEB = ROOT / "lcnc-webui"
PREVIEW_PORT = 4173      # the gatewayless preview (smoke)
SLOT_BASE = proof.SLOT_BASE   # e2e/mockSlot.mjs: worker slot i's mock listens on SLOT_BASE + i
WORKERS = int(os.environ.get("LCNC_E2E_WORKERS", "3"))   # the gate configs read the same variable


def ports(workers: int = WORKERS) -> list[int]:
    """Every port a browser run binds: the preview and one mock per worker slot."""
    return [PREVIEW_PORT, *range(SLOT_BASE, SLOT_BASE + workers)]


def resources() -> dict:
    """CPU and peak memory of this process's cgroup — the gate unit, browsers
    and mock children included (read at the end of the run)."""
    try:
        rel = Path("/proc/self/cgroup").read_text().strip().split("::", 1)[1]
        cg = Path("/sys/fs/cgroup") / rel.lstrip("/")
        cpu = dict(l.split() for l in (cg / "cpu.stat").read_text().splitlines())
        peak = cg / "memory.peak"
        return {"cgroup": rel, "cpu_s": round(int(cpu["usage_usec"]) / 1e6),
                "memory_peak_mb": round(int(peak.read_text()) / 2**20) if peak.exists() else None}
    except (OSError, IndexError, KeyError, ValueError) as e:
        return {"error": f"cgroup accounting unread: {e}"}


MERGE_REASON = "a merge: the full offline gate on the integrated state (Codex R279 FI-I17)"


def as_merge(sel: dict) -> dict:
    """A merge runs everything a round may leave out — every heavy unit
    file, the backend, the whole browser run — whatever the change selects.
    The round's selection is kept beside it in the record."""
    return {**sel,
            "unit": {**sel["unit"], "heavy": sorted(HEAVY_UNIT), "heavy_reasons": {f: [MERGE_REASON] for f in HEAVY_UNIT}},
            "backend": {"run": True, "reasons": [MERGE_REASON]},
            "browser": {"run": FULL, "reasons": [MERGE_REASON]}}


def plan(sel: dict) -> list[str]:
    """The checks of a round, in order. The selection guards are first in
    EVERY round — a UI-only round too, whose backend run they used to ride."""
    steps = ["selection-guards", "lint", "build", "unit-light"]
    if sel["unit"]["heavy"]:
        steps.append("unit-heavy")
    if sel["backend"]["run"]:
        steps.append("backend")
    if sel["browser"]["run"]:
        steps += ["ports-free", "browser"]
    return steps


def run(name: str, cmd: list[str], cwd: Path, logs: Path, env: dict | None = None) -> dict:
    started = time.monotonic()
    with (logs / f"{name}.log").open("w") as out:
        rc = subprocess.run(cmd, cwd=cwd, stdout=out, stderr=subprocess.STDOUT,
                            env={**os.environ, **(env or {})}).returncode
    return {"name": name, "command": " ".join(cmd), "status": "PASS" if rc == 0 else "FAIL",
            "exit": rc, "seconds": round(time.monotonic() - started)}


def fail(check: dict, *why: str) -> None:
    check["status"] = "FAIL"
    check.setdefault("why", []).extend(why)


def vitest_counts(report: Path) -> dict:
    if not report.is_file() or report.stat().st_size == 0:
        return {"error": f"no report {report.name}"}
    v = json.loads(report.read_text())
    return {"files": len(v.get("testResults", [])), "tests": v["numTotalTests"],
            "passed": v["numPassedTests"], "failed": v["numFailedTests"],
            "skipped": v["numPendingTests"] + v["numTodoTests"]}


def playwright_counts(report: Path) -> dict:
    if not report.is_file() or report.stat().st_size == 0:
        return {"error": f"no report {report.name}"}
    st = json.loads(report.read_text())["stats"]
    return {"tests": st["expected"] + st["unexpected"] + st["flaky"] + st["skipped"],
            "passed": st["expected"], "failed": st["unexpected"], "flaky": st["flaky"],
            "skipped": st["skipped"]}


def spec_times(report: Path) -> list[dict]:
    times: dict[str, float] = {}

    def walk(suite: dict):
        for spec in suite.get("specs", []):
            for t in spec.get("tests", []):
                times[spec["file"]] = times.get(spec["file"], 0) + sum(r.get("duration", 0) for r in t.get("results", []))
        for s in suite.get("suites", []):
            walk(s)

    for s in json.loads(report.read_text()).get("suites", []):
        walk(s)
    return [{"file": f, "ms": round(ms)} for f, ms in sorted(times.items(), key=lambda kv: -kv[1])]


def judge(check: dict, counts: dict) -> None:
    """No PASS on a missing report, an empty run, a skip, a retry or a failure."""
    check.update(counts)
    why = [counts["error"]] if "error" in counts else []
    if "error" not in counts:
        if counts.get("tests", 0) == 0:
            why.append("an empty run")
        why += [f"{counts[k]} {k}" for k in ("failed", "skipped", "flaky") if counts.get(k)]
    if why:
        fail(check, *why)


def output(cmd: list[str], cwd: Path) -> str:
    r = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)
    return r.stdout.strip() if r.returncode == 0 else f"unknown ({r.stderr.strip()[:80]})"


def listening(port: int) -> bool:
    for host in ("127.0.0.1", "::1"):
        try:
            with socket.create_connection((host, port), timeout=0.5):
                return True
        except OSError:
            continue
    return False


def unit(name: str, files: list[str], exclude: list[str], logs: Path) -> dict:
    """A vitest run matched to its own listing; `.only` refused."""
    listed, report = logs / f"{name}.list.json", logs / f"{name}.json"
    args = [*files, *[x for f in exclude for x in ("--exclude", f)]]
    lst = subprocess.run(["npx", "vitest", "list", *args, f"--json={listed}"], cwd=WEB,
                         capture_output=True, text=True)
    c = run(name, ["npx", "vitest", "run", *args, "--allowOnly=false", "--retry=0", "--reporter=default",
                   "--reporter=json", f"--outputFile.json={report}"], WEB, logs)
    judge(c, vitest_counts(report))
    if lst.returncode != 0 or not listed.is_file():
        fail(c, f"vitest list failed: {lst.stderr.strip()[-300:]}")
    elif report.is_file() and report.stat().st_size:
        problems = proof.check_unit_executed(json.loads(listed.read_text()), json.loads(report.read_text()))
        if problems:
            fail(c, *problems[:20])
        c["listed"] = len(json.loads(listed.read_text()))
    return c


JSON_OUT = ("PLAYWRIGHT_JSON_OUTPUT_FILE", "PLAYWRIGHT_JSON_OUTPUT_NAME")


def listing_env(env: dict) -> dict:
    return {k: v for k, v in {**os.environ, **env}.items() if k not in JSON_OUT}


def listing(config: str, env: dict, target: Path) -> tuple[dict, str | None]:
    """`--list` of a config, its JSON on stdout (never into the run's report
    file: the output variables are the run's only)."""
    r = subprocess.run(["npx", "playwright", "test", "-c", config, "--list", "--reporter=json"], cwd=WEB,
                       capture_output=True, text=True, env=listing_env(env))
    target.write_text(r.stdout)
    if r.returncode != 0 or not r.stdout.strip():
        return {}, f"{config} --list failed (exit {r.returncode}): {r.stderr.strip()[-300:]}"
    try:
        data = json.loads(r.stdout)
    except json.JSONDecodeError as e:
        return {}, f"{config} --list printed no JSON ({e}): {r.stdout[:200]!r}"
    if data.get("errors"):
        return data, f"{config} --list reports errors: {str(data['errors'])[:300]}"
    return data, None


def browser(sel: dict, logs: Path) -> list[dict]:
    names = sel["browser"]["run"]
    report, events = logs / "playwright.json", logs / "mock-events.jsonl"
    # ONE run: its own id, named by every event and by the report, and a
    # fresh event log — the fixture appends, so a log of an earlier run with
    # the same --out would otherwise vouch for this one (Codex R263 PM263-02)
    run_id = f"gate-{uuid.uuid4()}"
    events.unlink(missing_ok=True)
    env = {"PLAYWRIGHT_JSON_OUTPUT_FILE": str(report), "PLAYWRIGHT_JSON_OUTPUT_NAME": str(report),
           "LCNC_E2E_EVENTS": str(events), "LCNC_E2E_RUN": run_id, "LCNC_E2E_WORKERS": str(WORKERS)}
    checks = []
    if names == FULL:
        config = "playwright.gate.config.ts"
    else:
        config, env = "playwright.select.config.ts", {**env, "LCNC_E2E_SELECTION": str(logs / "selection.json")}
    listed, err = listing(config, env, logs / "list-run.json")
    if names != FULL and not err:
        full, err = listing("playwright.gate.config.ts", {}, logs / "list-full.json")
        if not err:
            problems = proof.check_listing(full, listed, names)
            checks.append({"name": "browser-listing", "status": "FAIL" if problems else "PASS",
                           **({"why": problems} if problems else {"files": len(names)})})
            if problems:
                return checks
    if err:
        return checks + [{"name": "browser-listing", "status": "FAIL", "why": [err]}]
    c = run("browser-full" if names == FULL else "browser-selected",
            ["npx", "playwright", "test", "-c", config, "--forbid-only", "--trace", "off", "--reporter=line,json"],
            WEB, logs, env)
    judge(c, playwright_counts(report))
    checks.append(c)
    if report.is_file() and report.stat().st_size:
        ran = json.loads(report.read_text())
        problems = proof.check_executed(listed, ran)
        checks.append({"name": "browser-executed", "status": "FAIL" if problems else "PASS",
                       **({"why": problems[:20]} if problems else {"tests": len(proof.playwright_tests(listed))})})
        log = [json.loads(l) for l in events.read_text().splitlines()] if events.is_file() else []
        owners = proof.check_report_run(ran, run_id) + (
            proof.check_workers(ran, log, run_id) if log else ["the fixture's event log is missing or empty"])
        checks.append({"name": "browser-workers", "status": "FAIL" if owners else "PASS", "run": run_id,
                       **({"why": owners[:20]} if owners else {"mocks": len({e["instance"] for e in log if e.get("event") == "bound"})})})
    return checks


#: the install probe's deadline in the merge gate (installer with fresh
#: downloads, start, browser, restore): past it the unit is stopped — its
#: ExecStopPost restores — and the check is FAIL (Codex R329 FI329-04)
INSTALL_PROBE_S = 3000


def install_probe_refusal(host=None) -> str | None:
    """Why the install probe could not take the LAN instance now, or None:
    its record refuses a waiting trip (restore_lan.TakeOverRefused); an
    instance that cannot be read is no refusal here — the probe names it."""
    from test_support import restore_lan as rl
    from test_support.system_host import SystemHost
    host = host or SystemHost()
    try:
        trip = host.lan_trip()
    except Exception:  # noqa: BLE001 — no LAN instance, or none readable: the probe's own record decides
        return None
    if trip:
        return (f"the LAN instance has an unacknowledged trip ({trip}) — the install probe may not take it; "
                f"acknowledge it, then run the merge gate again")
    return None


def _unit_state(unit: str) -> dict | None:
    """systemd's view of the unit (LoadState, ActiveState, its main process's
    exit), or None when it was not read."""
    r = subprocess.run(["systemctl", "--user", "show", unit, "-p", "LoadState", "-p", "ActiveState",
                        "-p", "ExecMainStatus", "--no-pager"], capture_output=True, text=True)
    props = dict(line.split("=", 1) for line in r.stdout.splitlines() if "=" in line)
    return props if r.returncode == 0 and props.get("ActiveState") else None


def _ended(props: dict | None) -> bool:
    """Ended: gone, or inactive / failed — "deactivating" still runs the
    unit's ExecStopPost (the restore)."""
    return bool(props) and (props.get("LoadState") == "not-found" or props.get("ActiveState") in ("inactive", "failed"))


def install_probe(logs: Path, sha: str, unit: str | None = None, probe_s: float = INSTALL_PROBE_S,
                  unread_s: float = 60.0, sleep=None) -> dict:
    """The merge gate's install probe (package I, operator 2026-11-07): a
    fresh clone of the gate's commit `sha` installed by `install.sh --yes
    --no-root` in its own environment and started (scripts/install_probe.py),
    in its own user unit whose ExecStopPost is the probe's restore.

    It runs AFTER the gate's heavy section and takes the heavy lock ITSELF —
    the probe through its run, its restore after it (Codex R330 FI-I60: the
    gate as the lock's owner left a running probe unlocked when the gate
    ended). Each call has its OWN run folder and id; PASS only with THIS
    run's report (its run id and the gate's commit), the probe's PASS, the
    LAN returned complete, isolation [] and the unit's own restore complete
    (FI-I59: a second call on the same --out read the first call's PASS).
    An end of the gate while it waits (an interrupt, an exception) stops the
    unit and waits for its END — its restore included — before it goes on;
    a unit whose state is not read for `unread_s` is stopped and named."""
    import uuid
    from test_support.install_cases import gate_status
    sleep = sleep or time.sleep
    run_id = uuid.uuid4().hex[:12]
    run_dir = logs / f"install-probe-{run_id}"
    unit = unit or f"install-probe-gate-{run_id}"
    py = sys.executable
    cmd = ["systemd-run", "--user", f"--unit={unit}", "-p", f"WorkingDirectory={ROOT}",
           "-p", f"ExecStopPost={py} -I {ROOT / 'scripts/test_support/install_restore.py'} "
                 f"--from {run_dir / 'pre.json'} --out {run_dir / 'restore-post.json'}",
           py, "-I", str(ROOT / "scripts/install_probe.py"), "--run-dir", str(run_dir), "--commit", sha,
           "--run-id", run_id]
    t0 = time.monotonic()
    started = subprocess.run(cmd, capture_output=True, text=True)
    if started.returncode:
        return {"name": "install-probe", "status": "FAIL", "run": str(run_dir),
                "why": [f"the probe unit did not start: {started.stderr.strip()}"]}
    why_end: list[str] = []
    unread_since = None

    def stop_and_wait(limit=600.0):
        # `systemctl stop` returns once the stop job is done, ExecStopPost included
        subprocess.run(["systemctl", "--user", "stop", unit], capture_output=True, timeout=limit + 30)
        end = time.monotonic() + limit
        while time.monotonic() < end:
            if _ended(_unit_state(unit)):
                return True
            sleep(2)
        return False
    try:
        while True:
            props = _unit_state(unit)
            if _ended(props):
                break
            now = time.monotonic()
            if props is None:
                unread_since = unread_since or now
                if now - unread_since > unread_s:
                    why_end.append(f"the unit's state was not read for {unread_s:.0f} s — stopped")
                    if not stop_and_wait():
                        why_end.append("its end is not confirmed")
                    break
            else:
                unread_since = None
            if now - t0 > probe_s:
                why_end.append(f"the probe ran past {probe_s:.0f} s and was stopped")
                if not stop_and_wait():
                    why_end.append("its end is not confirmed")
                break
            sleep(2)
    except BaseException:
        # the gate ends while its probe runs: the probe's own lock holds, but
        # the gate leaves nothing running behind it — stopped, its restore awaited
        stop_and_wait()
        raise
    finally:
        subprocess.run(["systemctl", "--user", "reset-failed", unit], capture_output=True)

    def load(name):
        p = run_dir / name
        try:
            return json.loads(p.read_text()) if p.is_file() else None
        except ValueError:
            return None
    report, post = load("report.json"), load("restore-post.json")
    status, why = gate_status(report, post)
    if report is not None and (report.get("run_id") != run_id or report.get("commit") != sha):
        status, why = "FAIL", [f"the report is not this run's (run {report.get('run_id')}, commit "
                               f"{report.get('commit')}; this run {run_id}, commit {sha})"] + why
    if why_end:
        status, why = "FAIL", why_end + why
    return {"name": "install-probe", "status": status, "seconds": round(time.monotonic() - t0), "run": str(run_dir),
            "run_id": run_id, "rows": [f"{r.get('case')}: {r.get('status')}" for r in (report or {}).get("rows", [])],
            **({"why": why} if why else {})}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--base", required=True)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--note", default="")
    ap.add_argument("--merge", action="store_true",
                    help="the merge gate: every heavy unit file, the backend, the whole browser run and the install probe")
    a = ap.parse_args(argv)
    out = a.out if a.out.is_absolute() else ROOT / a.out
    logs = out.with_suffix(".logs")
    logs.mkdir(parents=True, exist_ok=True)
    record: dict = {"kind": "merge" if a.merge else "round", "note": a.note}

    def finish(verdict: str, **extra) -> int:
        record.update(verdict=verdict, resources=resources(), **extra)
        out.write_text(json.dumps(record, indent=2, ensure_ascii=False) + "\n")
        print(f"round_gate: {verdict} → {out}")
        return 0 if verdict == "PASS" else 1

    checks: list[dict] = []
    guards = run("selection-guards", [sys.executable, "-B", "-m", "pytest", "-q", "-p", "no:cacheprovider",
                                      str(ROOT / "scripts/test_select/test_selector.py")], ROOT, logs)
    checks.append(guards)
    if guards["status"] != "PASS":
        return finish("FAIL", checks=checks, why=["the selection's guards are red: the rule table does not hold "
                                                  "for this tree, nothing may be left out"])
    try:
        if subprocess.run(["git", "status", "--porcelain", "--untracked-files=no"], cwd=ROOT,
                          capture_output=True, text=True, check=True).stdout:
            raise selector.SelectError("the tree has uncommitted changes: commit them, the gate binds a head")
        sel = selector.select(ROOT, a.base, "HEAD", selector.vitest_changed(ROOT, a.base))
    except selector.SelectError as e:
        return finish("FAIL", checks=checks, why=[str(e)])
    if a.merge:
        record["round_selection"] = {k: sel[k] for k in ("unit", "browser", "backend")}
        sel = as_merge(sel)
    (logs / "selection.json").write_text(json.dumps(sel, indent=2, ensure_ascii=False) + "\n")
    record.update(base=sel["base"], head=sel["head"], uncommitted=0, plan=plan(sel), env={
        "nproc": os.cpu_count(), "arch": platform.machine(),
        "node": output(["node", "--version"], WEB), "playwright": output(["npx", "playwright", "--version"], WEB)})
    record["selection"] = {k: sel[k] for k in ("unmatched", "unit", "browser", "backend", "firefox", "live")}
    omitted = []

    # The heavy sections hold the ONE heavy lock (Codex R269): another gate, a
    # load run or the native stage waits for this one, and this one for them.
    lock_from = time.monotonic()
    with heavy_lock(f"round_gate {record['kind']} {sel['head'][:8]}"):
        record["heavy_lock_wait_s"] = round(time.monotonic() - lock_from, 1)
        if a.merge:
            # the install probe takes the LAN instance at the END: a trip it may
            # not take (the operator's to acknowledge) refuses the merge NOW,
            # not after the heavy hour (rehearsal 2026-11-07: a VM pause had
            # tripped it before the gate began)
            refusal = install_probe_refusal()
            if refusal:
                checks.append({"name": "install-probe", "status": "FAIL", "why": [refusal]})
                return finish("FAIL", checks=checks, omitted=omitted, pending=[])
        checks.append(run("lint", ["npm", "run", "lint"], WEB, logs))
        checks.append(run("build", ["npm", "run", "build"], WEB, logs))
        checks.append(unit("unit-light", [], [f.removeprefix("lcnc-webui/") for f in HEAVY_UNIT], logs))

        heavy = sel["unit"]["heavy"]
        if heavy:
            c = unit("unit-heavy", [f.removeprefix("lcnc-webui/") for f in heavy], [], logs)
            if c.get("files") != len(heavy):
                fail(c, f"{c.get('files')} heavy files ran, {len(heavy)} selected")
            c["selected"] = heavy
            checks.append(c)
        else:
            omitted.append({"check": "unit-heavy", "reason": "no heavy file changed, reached or read for"})

        if sel["backend"]["run"]:
            checks.append(run("backend", [sys.executable, str(ROOT / "scripts/test_suite.py"), "offline", "--component",
                                          "backend", "--out-dir", str(logs / "backend")], ROOT, logs))
        else:
            omitted.append({"check": "backend", "reason": "; ".join(sel["backend"]["reasons"])})

        if sel["browser"]["run"]:
            busy = [p for p in ports() if listening(p)]
            checks.append({"name": "ports-free", "status": "FAIL" if busy else "PASS",
                           **({"why": [f"port {p} already serves something: a foreign server would be tested in "
                                       f"place of this tree's" for p in busy]} if busy else {})})
            if not busy:
                checks += browser(sel, logs)
            report = logs / "playwright.json"
            if report.is_file() and report.stat().st_size:
                record["browser_specs"] = spec_times(report)
        else:
            omitted.append({"check": "browser", "reason": "; ".join(sel["browser"]["reasons"])})

    if a.merge:
        # the installer, from a fresh clone, and what it installed started
        # (package I) — a merge only; it takes the VM's one LinuxCNC. AFTER
        # the heavy section: the probe holds the heavy lock itself, through its
        # restore, whatever happens to this process (Codex R330 FI-I60)
        checks.append(install_probe(logs, sel["head"]))

    pending = []
    if sel["firefox"].get("needed"):
        pending.append({"check": "firefox-core", "status": sel["firefox"]["status"]})
    for check, paths in sel["live"].items():
        pending.append({"check": check, "status": "pending: a live check, run before main", "paths": paths})
    return finish("PASS" if all(c["status"] == "PASS" for c in checks) else "FAIL",
                  checks=checks, omitted=omitted, pending=pending)


def guarded(argv: list[str] | None = None) -> int:
    """A crash of the runner itself is a FAIL with its reason in the record,
    never a missing record."""
    try:
        return main(argv)
    except Exception as e:   # noqa: BLE001 — every crash is recorded
        import traceback
        ap = argparse.ArgumentParser(add_help=False)
        ap.add_argument("--out", type=Path)
        out = ap.parse_known_args(argv)[0].out
        if out is not None:
            out = out if out.is_absolute() else ROOT / out
            prior = json.loads(out.read_text()) if out.is_file() else {}
            prior.update(verdict="FAIL", why=prior.get("why", []) + [f"the runner crashed: {e!r}"],
                         traceback=traceback.format_exc()[-2000:])
            out.write_text(json.dumps(prior, indent=2, ensure_ascii=False) + "\n")
        raise


if __name__ == "__main__":
    sys.exit(guarded())
