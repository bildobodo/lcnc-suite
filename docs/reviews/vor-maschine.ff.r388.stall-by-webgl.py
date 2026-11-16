#!/usr/bin/env python3
"""Stall signature per browser graphics state (R388): each Firefox replay file's run is
matched to the browser records of that run (webgl true/false/none); loads and loads
without hello (stall-count.py's rule) are summed per state.   stall-by-webgl.py DIR..."""
import glob, importlib.util, json, os, sys, collections
spec = importlib.util.spec_from_file_location("sc", os.path.join(os.path.dirname(os.path.abspath(__file__)), "vor-maschine.ff.r388.stall-count.py"))
sc = importlib.util.module_from_spec(spec); spec.loader.exec_module(sc)
tot = collections.defaultdict(lambda: [set(), 0, 0])
for d in map(os.path.expanduser, sys.argv[1:]):
    webgl = {}
    for ev in glob.glob(os.path.join(d, "**", "*events*.jsonl"), recursive=True):
        for line in open(ev):
            try: e = json.loads(line)
            except ValueError: continue
            if e.get("event") == "browser" and str(e.get("run", "")).startswith("firefox"):
                webgl.setdefault(e["run"], set()).add(e.get("webgl"))
    for fn in glob.glob(os.path.join(d, "**", "*.jsonl"), recursive=True):
        parts = os.path.relpath(fn, d).split(os.sep)
        if len(parts) < 2 or "replay" not in parts[-2]:
            continue
        with open(fn) as f:
            head = json.loads(f.readline())
        run = head.get("run", "")
        if not str(run).startswith("firefox"):
            continue
        state = "/".join(sorted(map(str, webgl.get(run, {"unrecorded"}))))
        n, m, _ = sc.count_file(fn)
        t = tot[state]; t[0].add((d, run)); t[1] += n; t[2] += m
for state, (runs, n, m) in sorted(tot.items()):
    print(f"webgl {state:12s} runs {len(runs):3d} loads {n:5d} without hello {m}")
