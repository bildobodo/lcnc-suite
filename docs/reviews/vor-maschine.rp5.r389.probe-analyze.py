#!/usr/bin/env python3
"""Replay 5b feasibility probe: join the browser's request events (httpProbe.ts:
breq/broute/bfin/bfail per id) with the mock's http lines (req_id = the catch-all's
x-e2e-req) of one browser run.  probe-analyze.py LOGS_DIR PREFIX
  PREFIX = mock-events (Chromium full run) | firefox-mock-events (Firefox core)
The replay dir is LOGS_DIR/replay (Chromium) or LOGS_DIR/firefox-replay."""
import collections, glob, json, os, sys

logs, prefix = sys.argv[1], sys.argv[2]
rdir = os.path.join(logs, "replay" if prefix == "mock-events" else "firefox-replay")
API = ("/ready", "/health", "/telemetry", "/upload", "/save", "/macros", "/macro", "/macro-upload", "/tool-table",
       "/import-tool-library", "/tool-library-files", "/tool-library-file", "/files", "/gcode", "/subfile", "/preview",
       "/surface_points", "/comp_grid", "/g30", "/settings", "/devices", "/camera")

def cls(path):
    if path in ("/", "/index.html"): return "page"
    for a in API:
        if path == a or path.startswith(a + "/"): return "api " + a
    if path.startswith("/static/") or path.startswith("/assets/") or path.startswith("/fonts/"): return "static"
    return "other"

breq, broute, bend = {}, {}, {}
for fn in sorted(glob.glob(os.path.join(logs, f"{prefix}.jsonl.http-*.jsonl"))):
    for line in open(fn):
        e = json.loads(line)
        k = e["kind"]
        if k == "breq": breq[e["id"]] = e
        elif k == "broute": broute.setdefault(e["id"], []).append(e)
        elif k in ("bfin", "bfail"): bend.setdefault(e["id"], []).append(e)

mock = []
for fn in sorted(glob.glob(os.path.join(rdir, "*.jsonl"))):
    for line in open(fn):
        e = json.loads(line)
        if e.get("kind") == "http": mock.append(e)
by_id = collections.defaultdict(list)
for m in mock:
    if m.get("req_id"): by_id[m["req_id"]].append(m)

out = {"browser_requests": len(breq), "mock_http_lines": len(mock)}
out["browser_by_type"] = dict(collections.Counter(e["type"] for e in breq.values()))
out["browser_hosts"] = dict(collections.Counter(e["host"] for e in breq.values()))
out["service_worker_requests"] = sum(1 for e in breq.values() if e["sw"])
out["redirect_hops"] = sum(1 for e in breq.values() if e["from"])
out["route_seen"] = sum(1 for i in breq if i in broute)
out["route_before_request_event"] = sum(1 for v in broute.values() for r in v if not r["known_at_route"])
out["route_twice"] = sum(1 for v in broute.values() if len(v) > 1)
out["browser_end"] = dict(collections.Counter(("finished" if x[-1]["kind"] == "bfin" else "failed") for x in bend.values()))
out["browser_no_end"] = sum(1 for i in breq if i not in bend)
out["browser_failed_errors"] = dict(collections.Counter(x[-1].get("error") for x in bend.values() if x[-1]["kind"] == "bfail").most_common(8))
out["mock_with_req_id"] = sum(1 for m in mock if m.get("req_id"))
out["mock_without_req_id"] = dict(collections.Counter(f"{m['method']} {cls(m['path'])}" for m in mock if not m.get("req_id")).most_common(15))
out["mock_contacts_per_id"] = dict(collections.Counter(len(v) for v in by_id.values()))
out["mock_ids_browser_never_saw"] = sum(1 for i in by_id if i not in breq)
out["mock_served"] = dict(collections.Counter(m.get("served") for m in mock))
out["mock_closed"] = [f"{m['method']} {m['path']}" for m in mock if m.get("closed")][:20]
out["mock_closed_count"] = sum(1 for m in mock if m.get("closed"))
out["mock_options"] = sum(1 for m in mock if m["method"] == "OPTIONS")
out["fallback_served"] = dict(collections.Counter(f"{m['method']} {m['path']}" for m in mock if m.get("served") == "fallback").most_common(20))
# the join: a routed browser request (the catch-all continued it) and its mock contacts
j = collections.Counter()
for i, e in breq.items():
    routed, n = i in broute, len(by_id.get(i, []))
    j[("caught" if routed else "spec handler / not routed") + f", {n} mock contact(s)"] += 1
out["join"] = dict(j)
# routed, no mock contact: what were they
out["caught_no_contact"] = dict(collections.Counter(
    f"{breq[i]['method']} {cls(breq[i]['path'])} {(bend.get(i) or [{'kind': 'none'}])[-1]['kind']}"
    for i in breq if i in broute and not by_id.get(i)).most_common(15))
# not routed by the catch-all, yet a mock contact without id: candidates (same path)
out["not_caught_by_class"] = dict(collections.Counter(
    f"{breq[i]['method']} {cls(breq[i]['path'])}" for i in breq if i not in broute).most_common(20))
# the worker paths
for p in ("/ready", "/preview"):
    ids = [i for i, e in breq.items() if e["path"] == p]
    out[f"worker {p}"] = {"browser_events": len(ids), "caught": sum(1 for i in ids if i in broute),
                          "mock_lines": sum(1 for m in mock if m["path"] == p),
                          "mock_lines_with_id": sum(1 for m in mock if m["path"] == p and m.get("req_id"))}
# api routes: how the mock served them
api = collections.Counter()
for m in mock:
    c = cls(m["path"])
    if c.startswith("api"): api[f"{m['method']} {c} → {m.get('served')} {m.get('status')}"] += 1
out["api_mock_served"] = dict(api.most_common(40))
print(json.dumps(out, indent=1))
