"""R264 (Codex R263 PM263-02): the new proof.check_workers over the ORIGINAL
R263 evidence and over Codex's mutations of it, the same cases as
per-worker-mock.r263.codex-worker-proof.py (which the old checker accepted).

    python3 -I docs/reviews/per-worker-mock.r264.worker-proof.py <checkout> <docs/reviews with the .logs>

The original records predate the report's `metadata.run` and the gate's own
run id, so each log is checked against the run its `bound` lines name (one
run per log, or the case says so); check_report_run is the gate's added
binding and is shown on the originals as what they lack. Reads only.
"""
import copy
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(sys.argv[1]) / "scripts"))
from test_select import proof  # noqa: E402

root = Path(sys.argv[2])


def load(name):
    p = root / f"per-worker-mock.{name}.gate-round.logs"
    return (json.loads((p / "playwright.json").read_text()), json.loads((p / "list-run.json").read_text()),
            [json.loads(s) for s in (p / "mock-events.jsonl").read_text().splitlines()])


def run_of(ev):
    runs = {e["run"] for e in ev if e.get("event") == "bound"}
    assert len(runs) == 1, runs
    return runs.pop()


def summary(errors):
    return {"rejected": bool(errors), "error_count": len(errors), "first": errors[:3]}


out = {}
for name in ("r263-selected", "r263-full-w2", "r263-full-w3"):
    r, listing, ev = load(name)
    out[name] = {"results": len(proof.playwright_results(r)), "execution_errors": proof.check_executed(listing, r),
                 "worker_errors": proof.check_workers(r, ev, run_of(ev)),
                 "report_run": proof.check_report_run(r, run_of(ev))}

r, _, ev = load("r263-full-w3")
RUN = run_of(ev)


def case(name, x, report=r, run=RUN):
    out[name] = {"expected": "reject", **summary(proof.check_workers(report, x, run))}


def set_on(pred, field, value):
    x = copy.deepcopy(ev)
    for e in x:
        if pred(e):
            e[field] = value
    return x


tests = lambda e: e["event"] in ("test-start", "test-end")  # noqa: E731
case("bound_owner_wrong", set_on(lambda e: e["event"] == "bound", "workerIndex", 999))
case("slot_wrong", set_on(tests, "slot", 15))
case("bound_lies_about_endpoint", set_on(lambda e: e["event"] == "bound", "endpoint", "http://localhost:4500/"))
case("events_from_another_run", set_on(tests, "run", "old-other-run"))
case("report_worker_mismatch", set_on(tests, "workerIndex", 999))
shifted = copy.deepcopy(ev)
for e in shifted:
    if "workerIndex" in e:
        e["workerIndex"] += 100
case("all_event_workers_disagree_with_report", shifted)
case("missing_bound_control", [e for e in ev if not (e["event"] == "bound" and e["workerIndex"] == 0)])
case("missing_stopped", [e for e in ev if e["event"] != "stopped"])
pair = [e for e in ev if tests(e)][:2]
case("duplicate_pair", ev + copy.deepcopy(pair))
case("foreign_pair", ev + [{**e, "title": e["title"] + " (foreign)"} for e in copy.deepcopy(pair)])

r2, _, ev2 = load("r263-full-w2")
case("w2_report_with_w3_event_log", ev, report=r2)
case("w2_report_with_both_original_event_logs", ev + ev2, report=r2, run=run_of(ev2))
case("w2_report_with_both_logs_under_w3s_run", ev + ev2, report=r2)
print(json.dumps(out, indent=2, ensure_ascii=False))
