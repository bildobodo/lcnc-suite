#!/usr/bin/env python3
"""The round gate (test strategy step 4, Codex R248–R251): the checks a round
needs, chosen by the selector from a NAMED base, with the proof of what ran.

    python3 -I scripts/test_select/round_gate.py --base <commit> \\
        --out docs/reviews/<topic>.gate-round.json [--note "…"]

The tree must be clean (its head is the gate's head). In order, never two at
once: the selection, lint, build, the light unit set, the heavy files it
names, the backend offline gate when selected, the browser run — the full
config for a full selection, else the select config between its listing proof
and its order proof. The record names every check run and every check left
out, with its reason; the Firefox core and the live checks a path asks for
stand as pending (an offline PASS is not an acceptance). PASS only when every
check that ran passed, without a skip, a retry or an empty run.
"""
from __future__ import annotations

import argparse
import json
import os
import platform
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from test_select import proof, selector  # noqa: E402
from test_select.rules import FULL, HEAVY_UNIT  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
WEB = ROOT / "lcnc-webui"


def run(name: str, cmd: list[str], cwd: Path, logs: Path, env: dict | None = None) -> dict:
    started = time.monotonic()
    with (logs / f"{name}.log").open("w") as out:
        rc = subprocess.run(cmd, cwd=cwd, stdout=out, stderr=subprocess.STDOUT,
                            env={**os.environ, **(env or {})}).returncode
    return {"name": name, "command": " ".join(cmd), "status": "PASS" if rc == 0 else "FAIL",
            "exit": rc, "seconds": round(time.monotonic() - started)}


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
    why = []
    if "error" in counts:
        why.append(counts["error"])
    else:
        if counts.get("tests", 0) == 0:
            why.append("an empty run")
        for k in ("failed", "skipped", "flaky"):
            if counts.get(k):
                why.append(f"{counts[k]} {k}")
    if why and check["status"] == "PASS":
        check["status"] = "FAIL"
    if why:
        check["why"] = why


def output(cmd: list[str], cwd: Path) -> str:
    r = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)
    return r.stdout.strip() if r.returncode == 0 else f"unknown ({r.stderr.strip()[:80]})"


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--base", required=True)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--note", default="")
    a = ap.parse_args(argv)
    out = a.out if a.out.is_absolute() else ROOT / a.out
    logs = out.with_suffix(".logs")
    logs.mkdir(parents=True, exist_ok=True)

    record: dict = {"kind": "round", "note": a.note}
    try:
        if subprocess.run(["git", "status", "--porcelain", "--untracked-files=no"], cwd=ROOT,
                          capture_output=True, text=True, check=True).stdout:
            raise selector.SelectError("the tree has uncommitted changes: commit them, the gate binds a head")
        sel = selector.select(ROOT, a.base, "HEAD", selector.vitest_changed(ROOT, a.base))
    except selector.SelectError as e:
        record.update(verdict="FAIL", why=[str(e)])
        out.write_text(json.dumps(record, indent=2, ensure_ascii=False) + "\n")
        print(f"round_gate: {e}", file=sys.stderr)
        return 2
    (logs / "selection.json").write_text(json.dumps(sel, indent=2, ensure_ascii=False) + "\n")
    record.update(base=sel["base"], head=sel["head"], uncommitted=0, env={
        "nproc": os.cpu_count(), "arch": platform.machine(),
        "node": output(["node", "--version"], WEB),
        "playwright": output(["npx", "playwright", "--version"], WEB)})
    record["selection"] = {k: sel[k] for k in ("unmatched", "unit", "browser", "backend", "firefox", "live")}
    checks, omitted = [], []

    checks.append(run("lint", ["npm", "run", "lint"], WEB, logs))
    checks.append(run("build", ["npm", "run", "build"], WEB, logs))

    light = logs / "vitest-light.json"
    exclude = [x for f in HEAVY_UNIT for x in ("--exclude", f.removeprefix("lcnc-webui/"))]
    c = run("unit-light", ["npx", "vitest", "run", *exclude, "--reporter=default", "--reporter=json",
                           f"--outputFile.json={light}"], WEB, logs)
    judge(c, vitest_counts(light))
    checks.append(c)

    heavy = sel["unit"]["heavy"]
    if heavy:
        report = logs / "vitest-heavy.json"
        c = run("unit-heavy", ["npx", "vitest", "run", *[f.removeprefix("lcnc-webui/") for f in heavy],
                               "--reporter=default", "--reporter=json", f"--outputFile.json={report}"], WEB, logs)
        judge(c, vitest_counts(report))
        if c.get("files") != len(heavy):
            c["status"] = "FAIL"
            c.setdefault("why", []).append(f"{c.get('files')} heavy files ran, {len(heavy)} selected")
        c["selected"] = heavy
        checks.append(c)
    else:
        omitted.append({"check": "unit-heavy", "reason": "no heavy file changed, reached or read for"})

    if sel["backend"]["run"]:
        c = run("backend", [sys.executable, str(ROOT / "scripts/test_suite.py"), "offline", "--component",
                            "backend", "--out-dir", str(logs / "backend")], ROOT, logs)
        checks.append(c)
    else:
        omitted.append({"check": "backend", "reason": "; ".join(sel["backend"]["reasons"])})

    browser = sel["browser"]["run"]
    report = logs / "playwright.json"
    pw_env = {"PLAYWRIGHT_JSON_OUTPUT_FILE": str(report), "PLAYWRIGHT_JSON_OUTPUT_NAME": str(report)}
    if browser == FULL:
        c = run("browser-full", ["npx", "playwright", "test", "--trace", "off", "--reporter=line,json"],
                WEB, logs, pw_env)
        judge(c, playwright_counts(report))
        checks.append(c)
    elif browser:
        sel_file = logs / "selection.json"
        listing = {}
        for name, extra, env in (("full", [], {}), ("selected", ["-c", "playwright.select.config.ts"],
                                                    {"LCNC_E2E_SELECTION": str(sel_file)})):
            target = logs / f"list-{name}.json"
            with target.open("w") as fh:
                subprocess.run(["npx", "playwright", "test", *extra, "--list", "--reporter=json"], cwd=WEB,
                               stdout=fh, stderr=subprocess.DEVNULL, env={**os.environ, **env})
            listing[name] = json.loads(target.read_text()) if target.stat().st_size else {}
        problems = proof.check_listing(listing["full"], listing["selected"], browser)
        checks.append({"name": "browser-listing", "status": "FAIL", "why": problems} if problems
                      else {"name": "browser-listing", "status": "PASS", "files": len(browser)})
        if not problems:
            c = run("browser-selected", ["npx", "playwright", "test", "-c", "playwright.select.config.ts",
                                         "--trace", "off", "--reporter=line,json"],
                    WEB, logs, {**pw_env, "LCNC_E2E_SELECTION": str(sel_file)})
            judge(c, playwright_counts(report))
            checks.append(c)
            if report.is_file() and report.stat().st_size:
                chain = proof.full_chain((WEB / "playwright.config.ts").read_text())
                order = proof.check_order(json.loads(report.read_text()), chain)
                checks.append({"name": "browser-order", "status": "FAIL" if order else "PASS",
                               **({"why": order} if order else {})})
    else:
        omitted.append({"check": "browser", "reason": "; ".join(sel["browser"]["reasons"])})
    if report.is_file() and report.stat().st_size:
        record["browser_specs"] = spec_times(report)

    pending = []
    if sel["firefox"].get("needed"):
        pending.append({"check": "firefox-core", "status": sel["firefox"]["status"]})
    for check, paths in sel["live"].items():
        pending.append({"check": check, "status": "pending: a live check, run before main", "paths": paths})
    record.update(checks=checks, omitted=omitted, pending=pending,
                  verdict="PASS" if all(c["status"] == "PASS" for c in checks) else "FAIL")
    out.write_text(json.dumps(record, indent=2, ensure_ascii=False) + "\n")
    print(f"round_gate: {record['verdict']} → {out}")
    return 0 if record["verdict"] == "PASS" else 1


if __name__ == "__main__":
    sys.exit(main())
