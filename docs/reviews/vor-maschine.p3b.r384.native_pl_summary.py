"""One native run's report for probe live: verdict, restore, crashes, the
probe and scan rows (with each combined row's parts) and every row not PASS.
Usage: python3 native_pl_summary.py RUN_DIR"""
import json
import sys
from pathlib import Path

run = Path(sys.argv[1])
try:
    d = json.loads((run / "report.json").read_text())
except (OSError, ValueError) as e:
    print(f"  no report: {e}")
    raise SystemExit(0)
print(f"  verdict {d.get('verdict')}, restore {d.get('restore', {}).get('outcome')}, crashes {d.get('crashes')}, "
      f"error {d.get('error')}")
KEYS = ("probe-z", "probe-run", "surface-scan", "surface-override-lock")
for r in d.get("rows", []):
    case = r.get("case", "")
    if case.startswith(KEYS):
        parts = r.get("parts") or {}
        ps = ", ".join(f"{k} {p.get('status')}" for k, p in parts.items())
        print(f"  {r.get('status'):10} {case}" + (f" [{ps}]" if ps else "") + f" — {str(r.get('detail'))[:160]}")
bad = [r for r in d.get("rows", []) if r.get("status") != "PASS" and not r.get("case", "").startswith(KEYS)]
for r in bad:
    print(f"  not PASS: {r.get('status')} {r.get('case')} — {str(r.get('detail'))[:140]}")
