#!/usr/bin/env python3
"""R393 measurements on a gate's logs: aborted-early by branch and spec, save+rename in one
test, and the race margin before the closing mark.   measure.py GATE_LOGS [http-subdir replay-subdir events]"""
import collections, glob, json, os, sys

logs = sys.argv[1]
hd, rd, ev = (sys.argv[2:5] if len(sys.argv) > 4 else ("http", "replay", "mock-events.jsonl"))
L = []
for fi, f in enumerate(sorted(glob.glob(os.path.join(logs, hd, "*.jsonl")))):
    for n, raw in enumerate(open(f), 1):
        e = json.loads(raw); e["_o"] = (fi, n); L.append(e)
req = {e["id"]: e for e in L if e["k"] == "req"}
acts = collections.defaultdict(list)
for e in L:
    if e["k"] == "act":
        acts[e["id"]].append(e["act"])
end = {e["id"]: e for e in L if e["k"] == "end"}
ctx = {e["ctx"]: e for e in L if e["k"] == "ctx"}
mark = {e["ctx"]: e["_o"] for e in L if e["k"] == "closing"}
contact = collections.Counter()
for f in glob.glob(os.path.join(logs, rd, "*.jsonl")):
    for raw in open(f):
        m = json.loads(raw)
        if m.get("kind") == "http" and isinstance(m.get("req_id"), str) and m["req_id"].startswith("req:"):
            contact[m["req_id"][4:]] += 1
events = [json.loads(l) for l in open(os.path.join(logs, ev))]
fileof = {(e["testId"], e["retry"]): e["file"] for e in events if e.get("event") == "test-start"}

# 1. aborted-early: no contact, transport failed — forwarded, or never routed
ab = collections.Counter()
for i, r in req.items():
    a = [x for x in acts[i] if x != "handler"]
    e = end.get(i)
    if e and e.get("transport") == "failed" and not contact[i] and "abort" not in a and "fulfill" not in a:
        branch = "forwarded" if ("catch-all" in a or "continue" in a) else "never routed"
        c = ctx.get(r["ctx"], {})
        ab[(branch, r["method"] + " " + (r.get("route") or r["path"]), fileof.get((c.get("test"), c.get("retry")), "?"))] += 1
print("aborted-early:", sum(ab.values()))
for k, v in sorted(ab.items()): print("  ", v, k)
by_branch = collections.Counter(k[0] for k in ab.elements()); print("  by branch", dict(by_branch))
by_spec = collections.Counter(k[2] for k in ab.elements()); print("  by spec", dict(by_spec), "specs", len(by_spec))

# 2. save and rename of PUT /macro in one attempt
va = collections.defaultdict(set)
for i, r in req.items():
    if r.get("route") == "PUT /macro":
        c = ctx.get(r["ctx"], {})
        va[(c.get("test"), c.get("retry"))].add(r["variant"].split(" ")[0])
both = [k for k, v in va.items() if {"save", "rename"} <= v]
print("attempts with PUT /macro:", len(va), "with save AND rename:", len(both), [fileof.get(k) for k in both])

# 3. the race margin: forwarded requests whose line precedes their context's mark, by distance in lines
lines_by_ctx = collections.defaultdict(list)
for e in L:
    c = e.get("ctx") or req.get(e.get("id"), {}).get("ctx")
    if c: lines_by_ctx[c].append(e["_o"])
dist = collections.Counter(); noend_before = 0
for i, r in req.items():
    a = acts[i]
    if not ("catch-all" in a or "continue" in a): continue
    m = mark.get(r["ctx"])
    if m is None or r["_o"] > m: continue
    between = sum(1 for o in lines_by_ctx[r["ctx"]] if r["_o"] < o < m)
    if between <= 10:
        dist[(between, "contact" if contact[i] else "no contact", "end" if i in end else "no end")] += 1
    if not contact[i] and i not in end: noend_before += 1
print("forwarded within 10 record lines before the mark (lines between, contact, end):")
for k, v in sorted(dist.items()): print("  ", v, k)
print("forwarded before the mark with neither contact nor end:", noend_before)
