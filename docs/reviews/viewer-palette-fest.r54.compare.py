"""Classify every canon point per axis from a main and a shadow parse:
d = shadow − main in the machine frame; 0 → independent, ε_a → depends on
the start offset in axis a, else coupled. Slack per axis/direction over the
points dependent in that axis (joint = machine frame under identity kins)."""
import json, sys
import numpy as np
TOL = 1e-9
def classify(main, shadow, eps, limits):
    a, b = np.load(main), np.load(shadow)
    res = {"aligned": True, "why": []}
    for st in ("feed", "rapid"):
        for k in ("seq", "line"):
            if a[f"{st}_{k}"].shape != b[f"{st}_{k}"].shape or not np.array_equal(a[f"{st}_{k}"], b[f"{st}_{k}"]):
                res["aligned"] = False; res["why"].append(f"{st}_{k}")
    if not np.array_equal(a["unknown"], b["unknown"]):
        res["aligned"] = False; res["why"].append("unknown_start")
    if not res["aligned"]:
        return res
    m = np.concatenate([a["feed_m"], a["rapid_m"]]); mb = np.concatenate([b["feed_m"], b["rapid_m"]])
    line = np.concatenate([a["feed_line"], a["rapid_line"]])
    d = mb - m
    e = np.zeros(6); e[:3] = eps
    scale = np.maximum(1.0, np.abs(m))
    indep = np.abs(d) <= TOL * scale
    ident = np.abs(d - e) <= TOL * scale
    ident[:, 3:] = False
    for i in range(3):
        if e[i] == 0:
            ident[:, i] = False      # an axis the shadow did not move: only d = 0 is independent
    coupled = ~(indep | ident)
    res["points"] = int(len(m))
    out = {}
    for i, ax in enumerate("XYZABC"):
        if (ax not in limits or e[i] == 0) and not coupled[:, i].any() and not ident[:, i].any():
            continue
        dep_i = ident[:, i]; cp = coupled[:, i]
        row = {"dep": int(dep_i.sum()), "coupled": int(cp.sum()), "indep": int(indep[:, i].sum())}
        if dep_i.any():
            ls = np.unique(line[dep_i]); row["dep_lines"] = [int(x) for x in ls[:8]] + (["…"] if len(ls) > 8 else [])
            row["dep_line_count"] = int(len(ls))
            if ax in limits:
                lo, hi = limits[ax]; v = m[dep_i, i]
                inside_hi = v <= hi; inside_lo = v >= lo
                row["slack_hi"] = round(float(np.min(hi - v[inside_hi])), 6) if inside_hi.any() else None
                row["over_hi"] = round(float(np.min(v[~inside_hi] - hi)), 6) if (~inside_hi).any() else None
                row["slack_lo"] = round(float(np.min(v[inside_lo] - lo)), 6) if inside_lo.any() else None
                row["over_lo"] = round(float(np.min(lo - v[~inside_lo])), 6) if (~inside_lo).any() else None
        if cp.any():
            ls = np.unique(line[cp]); row["coupled_lines"] = [int(x) for x in ls[:8]]
            row["coupled_d"] = [round(float(x), 6) for x in np.unique(np.round(d[cp, i], 6))[:6]]
        out[ax] = row
    res["axes"] = out
    return res
if __name__ == "__main__":
    main, shadow, eps, limits = sys.argv[1], sys.argv[2], json.loads(sys.argv[3]), json.loads(sys.argv[4])
    print(json.dumps(classify(main, shadow, eps, limits)))
