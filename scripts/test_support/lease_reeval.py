"""Re-evaluate a jog-lease native report from its lease_raw (Codex R427 MT-I10): the
same judges on the stored courses, marks and records.

  python3 -I scripts/test_support/lease_reeval.py <tree> <report.json>"""
import json, sys
sys.path.insert(0, sys.argv[1] + "/scripts")
from test_support import native_cases as nc
d = json.load(open(sys.argv[2]))
raw = d["lease_raw"]
tup = lambda rows: [tuple(r) for r in rows]
out = {}
k = raw["kept"]
out["jog-lease-kept"] = nc.eval_lease_kept("jog-lease-kept", 1, tup(k["samples"]), k["t_moving"], k["t_end"],
                                           [tuple(n) for n in k["notices"]])
e = raw["expired"]
out["jog-lease-expired"] = nc.eval_lease_expired("jog-lease-expired", 2, 0, tup(e["samples"]), e["t_moving"], e["t_last"],
                                                 [tuple(n) for n in e["notices"]], e["trace"])
p = raw["page"]
marks = d["lease_page_probe"]["marks"]
to_mono = lambda wall_s: p["mono0"] + (wall_s - p["wall0"])
gaps = d["lease_page_probe"].get("timer_gaps")
out["jog-lease-page-kept"] = nc.eval_lease_page_kept("jog-lease-page-kept", marks, tup(p["samples"]), p["trace"], to_mono, gaps)
out["jog-lease-page-blocked"] = nc.eval_lease_page_blocked("jog-lease-page-blocked", 0, marks, tup(p["samples"]), p["trace"],
                                                           to_mono, gaps)
print(json.dumps({"report": sys.argv[2], "commit": d["commit"][:8], "rows": out}, indent=1, default=str))
