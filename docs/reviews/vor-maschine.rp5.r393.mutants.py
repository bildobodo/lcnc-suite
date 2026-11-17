#!/usr/bin/env python3
"""Replay 5b mutants (plan R389 'Mutanten'): each applied in the tree, judged, restored.

    mutants.py OUTDIR [NAME ...]

Kinds:
  browser — a short browser run (subset.sh) of SPECS with the mutant in place; red when the
            replay names FINDING, or a named test fails (TEST)
  offline — the replay re-judges the BASELINE run's recorded logs with the mutated checker
            (no browser), plus the named synthetic guard; red when either is red as named
Every mutant restores the tree with `git checkout` and the run refuses a dirty tree at start.
"""
import json, os, subprocess, sys
from pathlib import Path

TREE = Path.home() / "lcnc-suite-5b"
PY = str(Path.home() / "lcnc-suite-pl/lcnc-gateway/.venv/bin/python3")
SUBSET = str(Path.home() / "claude-work/replay5b/subset.sh")
REC = "lcnc-webui/e2e/httpRecord.ts"
HP = "scripts/test_select/http_paths.py"
SPECS = ["e2e/http-paths.spec.ts", "e2e/macros.spec.ts", "e2e/g30.spec.ts"]

MUTANTS = {
    "H1": ("the catch-all forwards without the id", "browser",
           [(REC, "    await route.continue({ headers: { ...route.request().headers(), [REQ_HEADER]: `req:${id}` } });",
             "    await route.continue();")],
           {"finding": "reached the mock without an id"}),
    "H2": ("a contact assigned by its URL instead of its id", "offline",
           [(HP, "        if isinstance(rid, str) and rid.startswith(\"req:\"):\n            by_req[rid[4:]].append(m)",
             "        if isinstance(rid, str) and rid.startswith(\"req:\"):\n"
             "            for _rid, _r in req.items():\n"
             "                if _r.get(\"path\") == m.get(\"path\") and _r.get(\"method\") == m.get(\"method\"):\n"
             "                    by_req[_rid].append(m)")],
           {"finding": "fulfilled in the browser AND a contact under its id"}),
    "H3": ("the record keeps the query's values", "browser",
           [(REC, "method: r.method(), host: u.host, path: u.pathname,", "method: r.method(), host: u.host, path: u.pathname + u.search,")],
           {"finding": "a query in the recorded path", "test": "an invented token in a query and a header appears in no record"}),
    "H4": ("a wrapped fulfill that records nothing", "browser",
           [(REC, '            write({ k: "act", id, act: "fulfill", status, response: o?.response !== undefined });\n',
             '            void status;\n')],
           {"finding": "as replaced 0 time(s), expected 1"}),
    "H5": ("the SPA fallback counted as a served route", "offline",
           [(HP, 'c = "fallback" if contacts[0].get("served") == "fallback" else \\\n', 'c = "served" if contacts[0].get("served") == "fallback" else \\\n')],
           {"finding": "GET /g30 as fallback 0 time(s), expected 1",
            "guard": "test_a_forwarded_request_with_its_one_contact_is_served_and_the_fallback_is_not"}),
    "H6": ("a real redirect hop covers an id-less contact (the synthetic condition dropped)", "offline",
           [(HP, "            if pre_fulfill and 300 <= int(pre_fulfill[-1].get(\"status\") or 0) < 400 and not by_req.get(first) \\\n"
                 "                    and pre.get(\"ctx\") == r[\"ctx\"]:",
             "            if pre.get(\"ctx\") == r[\"ctx\"]:")],
           {"guard": "test_each_finding_is_red_for_its_own_reason"}),
    "H7": ("an id-less contact is never a finding", "offline",
           [(HP, "                findings.append(f\"{name.get(key, '?')}: {m.get('method')} {m.get('path')} reached the mock without an id \"\n"
                 "                                f\"— no synthetic redirect hop of the attempt covers it\")",
             "                pass")],
           {"guard": "test_each_finding_is_red_for_its_own_reason"}),
    "H8": ("the closing mark not written", "browser",
           [(REC, '  write({ k: "closing", ctx, sw: context.serviceWorkers().length });\n',
             '  void ctx; void context;\n')],
           {"finding": "no named path"}),
}


def run(cmd, **kw):
    return subprocess.run(cmd, cwd=TREE, text=True, capture_output=True, **kw)


def apply(edits):
    for f, old, new in edits:
        p = TREE / f
        t = p.read_text()
        if t.count(old) != 1:
            raise SystemExit(f"mutant edit not found exactly once in {f}: {old[:70]!r}")
        p.write_text(t.replace(old, new))


def restore():
    run(["git", "checkout", "--", "."])


def judge_replay(d: Path) -> dict:
    r = json.loads((d / "replay.json").read_text()) if (d / "replay.json").is_file() else {}
    return r


def main():
    out = Path(sys.argv[1])
    names = sys.argv[2:] or list(MUTANTS)
    out.mkdir(parents=True, exist_ok=True)
    if run(["git", "status", "--porcelain", "--untracked-files=no"]).stdout.strip():
        raise SystemExit("tree not clean")
    head = run(["git", "rev-parse", "HEAD"]).stdout.strip()
    summary = {}
    base = out / "baseline"
    if any(MUTANTS[n][1] == "offline" for n in names) and not (base / "replay.json").is_file():
        r = subprocess.run([SUBSET, str(base), *SPECS], text=True, capture_output=True)
        (out / "baseline.log").write_text(r.stdout + r.stderr)
        b = judge_replay(base)
        summary["baseline"] = {"verdict": b.get("verdict"), "findings": b.get("findings", [])[:5]}
        if b.get("verdict") != "PASS":
            raise SystemExit(f"the baseline is not green: {b.get('findings', [])[:3]}")
    for n in names:
        what, kind, edits, want = MUTANTS[n]
        d = out / n
        apply(edits)
        try:
            res = {"what": what, "kind": kind, "head": head}
            if kind == "browser":
                r = subprocess.run([SUBSET, str(d), *SPECS], text=True, capture_output=True)
                (d / "mutant.log").write_text(r.stdout + r.stderr)
                if "build failed" in r.stdout:
                    raise SystemExit(f"{n}: the mutant does not build — no result (see {d}/build.log)")
                rep = judge_replay(d)
                pw = json.loads((d / "playwright.json").read_text()) if (d / "playwright.json").is_file() else {}
                failed = [s["title"] for suite in pw.get("suites", []) for s in _specs(suite)
                          if any(t.get("status") == "unexpected" for t in s.get("tests", []))]
                res |= {"replay": rep.get("verdict"), "findings": rep.get("findings", [])[:8], "failed_tests": failed}
                red = ("finding" in want and any(want["finding"] in f for f in rep.get("findings", []))) or \
                      ("test" in want and want["test"] in failed)
            else:
                rid = json.loads(next((base / "replay").glob("*.jsonl")).open().readline())["run"]
                d.mkdir(parents=True, exist_ok=True)
                r = run([PY, "-I", "scripts/test_select/replay.py", "--dir", str(base / "replay"), "--events",
                         str(base / "mock-events.jsonl"), "--run", rid, "--http", str(base / "http"), "--out", str(d / "replay.json")])
                rep = judge_replay(d)
                g = run([PY, "-m", "pytest", "-q", "-p", "no:cacheprovider", "scripts/test_select/test_http_paths.py"])
                guard_red = "guard" in want and f"{want['guard']}" in g.stdout and " failed" in g.stdout
                res |= {"replay": rep.get("verdict"), "findings": rep.get("findings", [])[:8],
                        "guard_failed": [l for l in g.stdout.splitlines() if l.startswith("FAILED")][:8]}
                red = ("finding" in want and any(want["finding"] in f for f in rep.get("findings", []))) or guard_red
            res["red"] = bool(red)
        finally:
            restore()
        summary[n] = res
        print(n, "RED" if res["red"] else "GREEN", "—", what, flush=True)
        (out / "summary.json").write_text(json.dumps(summary, indent=1))
    if run(["git", "status", "--porcelain", "--untracked-files=no"]).stdout.strip():
        raise SystemExit("tree not clean after the mutants")


def _specs(suite):
    for s in suite.get("specs", []):
        yield s
    for sub in suite.get("suites", []):
        yield from _specs(sub)


if __name__ == "__main__":
    main()
