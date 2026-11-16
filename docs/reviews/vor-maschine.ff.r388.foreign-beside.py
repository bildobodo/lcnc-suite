#!/usr/bin/env python3
"""R388: a browser record of ANOTHER run BESIDE the right ones (Codex R387's
correction: foreign assignments red). Same saved input as Codex' worker proof;
only copies of the events change. Usage: python3 -I this.py ARCHIVE saved-input.json"""
import copy, json, sys
from pathlib import Path
root = Path(sys.argv[1]).resolve()
sys.path.insert(0, str(root / "scripts"))
from test_select import firefox
data = json.loads(Path(sys.argv[2]).read_text())
out = []
for phase in ("core", "guard"):
    report, events, run = (data[phase][k] for k in ("report", "events", "run"))
    workers = firefox.report_workers(report)
    first = next(e for e in events if e.get("event") == "browser")
    for case, log in [("baseline", copy.deepcopy(events)),
                      ("another run's record beside the right ones", events + [dict(first, run="not-this-run")])]:
        b, g = firefox.browser_proofs([(phase, log, run, workers)], "160.0")
        out.append({"phase": phase, "case": case, "workers": sorted(workers),
                    "firefox-browser": b or "PASS", "firefox-graphics": g or "PASS"})
print(json.dumps(out, indent=2, ensure_ascii=False))
