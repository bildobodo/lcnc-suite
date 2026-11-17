"""Replay step 5b: each HTTP request of the browser with its response path
(FI265-02 Rest A/B, Codex R268/R269; deltas R389–R391). Called by replay.check
with the browser's HTTP record (e2e/httpRecord.ts: one log per worker) and the
mocks' lines; the join is by the request's own id the mock logged
(`x-e2e-req: req:<id>` / `fetch:<op>`), never by URL or order.

The classes (`CLASS`), in the order they are decided:
  aborted          a spec's `abort`
  replaced         a spec's `fulfill`, no server contact
  fetched          a spec's `fetch` with exactly ONE contact, then `fulfill`
                   — the server contact is assigned, the answer replaced
  fetch-unknown    `fetch` then `fulfill`, the fetch's contacts not exactly
                   one (a redirect through the fetch): the replacement is
                   proven, the server contact is not
  ws-handshake     Firefox reports the WS upgrade as a request: joined to the
                   mock's open line by the id when it carries one; no HTTP
                   evidence
  other-server     forwarded to a host that is not this attempt's mock (the
                   preview server of smoke.spec)
  served           forwarded, exactly one contact the mock answered with its
                   handler, a static file, a 403 or a 404
  fallback         forwarded, exactly one contact the mock's SPA FALLBACK
                   answered (index.html, any method) — never a served route
  several          forwarded, more than one contact under its id (a server
                   redirect keeps the header): unknown
  redirect-hop     a hop of a redirect chain without a route call: unknown;
                   a SYNTHETIC hop (its predecessor fulfilled with a 3xx, no
                   contact under the chain's first id) may cover ONE id-less
                   contact of its attempt with its method, path and query
                   key names (R390 VM389-01) — covered, it stays unassigned
  closing          no end, issued at or after its context's closing mark
  held             a spec handler entered, no action, no end (the spec held
                   it until the context closed)
  aborted-early    no contact and the transport failed: forwarded, or before any
                   route call (a beacon the browser drops as its page navigates)
  unknown          anything else — a FINDING (R389 D4)

Findings (R389 D4, R390): a request whose id was first given at the route; a
service worker a context held at its close; a `fulfill` AND a contact under
the same request id without a fetch; a contact under an id the browser never
recorded; an id-less contact of a test attempt no synthetic hop covers; an
attempt whose page loaded at its mock without its context in the HTTP
record; a query value in the record; an `unknown`; an expected path
(replay_http_expect.json) that ran and was not seen as named.
"""
from __future__ import annotations

import json
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

EXPECT = Path(__file__).with_name("replay_http_expect.json")
#: the classes that are a server's answer to a forwarded request — evidence of a route
EVIDENCE = frozenset({"served", "fetched"})
CLASSES = ("aborted", "replaced", "fetched", "fetch-unknown", "ws-handshake", "other-server", "served", "fallback",
           "several", "redirect-hop", "closing", "held", "aborted-early", "unknown")
READ_KINDS = frozenset({"ctx", "req", "act", "fetched", "end", "closing"})


def read_record(http_dir: Path, run: str) -> tuple[list[dict], list[str]]:
    """Every line of this run's HTTP record, in file order — or the problems."""
    lines, problems = [], []
    files = sorted(http_dir.glob(f"{run}-w*.jsonl")) if http_dir.is_dir() else []
    if not files:
        problems.append(f"no HTTP record of run {run} in {http_dir}")
    for f in files:
        for n, raw in enumerate(f.read_text().splitlines(), 1):
            try:
                rec = json.loads(raw)
            except ValueError:
                problems.append(f"{f.name}:{n}: not JSON")
                continue
            if not isinstance(rec, dict) or rec.get("k") not in READ_KINDS:
                problems.append(f"{f.name}:{n}: a line of unknown kind")
                continue
            lines.append(rec)
    return lines, problems


def _key3(method: Any, path: Any, qkeys: Any) -> tuple:
    return (method, path, tuple(qkeys) if isinstance(qkeys, list) else ())


def judge(http_dir: Path, run: str, attempts: dict, name: dict, ports: dict[str, int],
          mock_http: list[tuple[str, dict]], mock_opens: list[tuple[str, dict]],
          loaded: set, expect: list[dict] | None = None) -> dict:
    """The HTTP paths of the run, each attempt's observations and the findings.
    attempts: (test, retry) → {file, title, project, instance, status};
    name: (test, retry) → the attempt's name in the result; ports: instance → port."""
    lines, findings = read_record(http_dir, run)
    expect = json.loads(EXPECT.read_text()) if expect is None else expect
    ctx: dict[str, dict] = {}
    req: dict[str, dict] = {}
    acts: dict[str, list[dict]] = defaultdict(list)
    ops: dict[str, str] = {}
    end: dict[str, dict] = {}
    for r in lines:
        k = r["k"]
        if k == "ctx":
            ctx[r["ctx"]] = r
        elif k == "req":
            req[r["id"]] = r
            if r.get("at") != "request":
                findings.append(f"request {r['id']} {r.get('method')} {r.get('path')}: its id was first given at the route — "
                                f"its request event is missing")
            if "?" in str(r.get("path")):
                findings.append(f"request {r['id']}: a query in the recorded path — the record keeps key names only")
        elif k == "act":
            acts[r["id"]].append(r)
            if r.get("act") == "fetch":
                ops[r["op"]] = r["id"]
        elif k == "end":
            end[r["id"]] = r
        elif k == "closing":
            ctx.setdefault(r["ctx"], {})["closing"] = r["t"]
            if r.get("sw"):
                findings.append(f"context {r['ctx']}: {r['sw']} service worker(s) at its close — they are blocked")

    def attempt_of(c: str) -> tuple | None:
        x = ctx.get(c, {})
        return (x.get("test"), x.get("retry")) if x.get("run") == run else None

    by_req: dict[str, list[dict]] = defaultdict(list)
    by_op: dict[str, list[dict]] = defaultdict(list)
    idless: dict[tuple, list[dict]] = defaultdict(list)
    for inst, m in mock_http:
        rid = m.get("req_id")
        if isinstance(rid, str) and rid.startswith("req:"):
            by_req[rid[4:]].append(m)
            if rid[4:] not in req:
                findings.append(f"{inst}: {m.get('method')} {m.get('path')}: a contact under id {rid} the browser never recorded")
        elif isinstance(rid, str) and rid.startswith("fetch:"):
            by_op[rid[6:]].append(m)
            if rid[6:] not in ops:
                findings.append(f"{inst}: {m.get('method')} {m.get('path')}: a contact under fetch {rid} no route recorded")
        elif rid is None:
            o = m.get("origin")
            if isinstance(o, dict) and o.get("run") == run and "test" in o:
                idless[(o["test"], o.get("retry"))].append(m)
        else:
            findings.append(f"{inst}: {m.get('method')} {m.get('path')}: a contact with an id of no form {str(rid)[:40]!r}")
    ws_joined = {m["req_id"][4:] for _, m in mock_opens if isinstance(m.get("req_id"), str) and m["req_id"].startswith("req:")}

    def first_of(rid: str) -> str:
        seen = set()
        while req.get(rid, {}).get("from") and rid not in seen:
            seen.add(rid)
            rid = req[rid]["from"]
        return rid

    classes: dict[str, str] = {}
    synthetic: dict[tuple, list[str]] = defaultdict(list)   # attempt → synthetic hops
    for rid, r in req.items():
        a = [x["act"] for x in acts.get(rid, [])]
        terminal = [x for x in a if x != "handler"]
        key = attempt_of(r["ctx"])
        inst = attempts.get(key, {}).get("instance")
        mock_host = f"localhost:{ports[inst]}" if inst in ports else None
        closing = ctx.get(r["ctx"], {}).get("closing")
        e = end.get(rid)
        if "abort" in terminal:
            c = "aborted"
        elif "fulfill" in terminal:
            if "fetch" in terminal:
                fops = [x["op"] for x in acts[rid] if x["act"] == "fetch"]
                contacts = [m for op in fops for m in by_op.get(op, [])]
                c = "fetched" if len(fops) == 1 and len(contacts) == 1 else "fetch-unknown"
            else:
                c = "replaced"
                if by_req.get(rid):
                    findings.append(f"request {rid} {r['method']} {r['path']}: fulfilled in the browser AND a contact "
                                    f"under its id without a fetch")
        elif r.get("path") == "/ws" and r.get("type") == "document":
            c = "ws-handshake"
        elif "continue" in terminal or "catch-all" in terminal:
            contacts = by_req.get(rid, [])
            if mock_host and r.get("host") != mock_host and not contacts:
                c = "other-server"
            elif len(contacts) == 1:
                c = "fallback" if contacts[0].get("served") == "fallback" else \
                    "aborted-early" if contacts[0].get("closed") else "served"
            elif len(contacts) > 1:
                c = "several"
            elif e is None and closing is not None and r["t"] >= closing:
                c = "closing"
            elif e is not None and e.get("transport") == "failed":
                c = "aborted-early"
            else:
                c = "unknown"
        elif r.get("from"):
            c = "redirect-hop"
            first = first_of(rid)
            pre = req.get(r["from"], {})
            pre_fulfill = [x for x in acts.get(r["from"], []) if x["act"] == "fulfill"]
            if pre_fulfill and 300 <= int(pre_fulfill[-1].get("status") or 0) < 400 and not by_req.get(first) \
                    and pre.get("ctx") == r["ctx"]:
                synthetic[key].append(rid)
        elif e is None and closing is not None and r["t"] >= closing:
            c = "closing"
        elif "handler" in a and e is None:
            c = "held"
        elif e is not None and e.get("transport") == "failed" and not by_req.get(rid):
            c = "aborted-early"
        else:
            c = "unknown"
        if c == "unknown":
            findings.append(f"{name.get(key, '?')}: request {rid} {r['method']} {r['path']} — no named path "
                            f"(actions {terminal or a}, end {e.get('transport') if e else 'none'})")
        classes[rid] = c

    # R390 VM389-01: an id-less contact of a test attempt is red unless a
    # SYNTHETIC hop of the same attempt with its method, path and query key
    # names covers it — one contact per hop; covered, it stays unassigned
    unassigned = 0
    covered: Counter = Counter()
    for key, contacts in idless.items():
        room = Counter(_key3(req[h]["method"], req[h]["path"], req[h].get("qkeys")) for h in synthetic.get(key, []))
        for m in contacts:
            k3 = _key3(m.get("method"), m.get("path"), m.get("qkeys"))
            if room[k3] > 0:
                room[k3] -= 1
                unassigned += 1
                covered[key] += 1
            else:
                findings.append(f"{name.get(key, '?')}: {m.get('method')} {m.get('path')} reached the mock without an id "
                                f"— no synthetic redirect hop of the attempt covers it")

    # every attempt whose page loaded at its mock is in the record
    recorded = {attempt_of(c) for c in ctx}
    for key in sorted(loaded - recorded, key=str):
        findings.append(f"{name.get(key, '?')}: the page loaded at its mock and the HTTP record has no context of the attempt")

    def status_of(rid: str) -> Any:
        contacts = by_req.get(rid, [])
        if classes[rid] in ("served", "fallback") and contacts:
            return contacts[0].get("status")
        return (end.get(rid) or {}).get("status")

    # per attempt: each request with its route, variant, path, transport and status (folded after the projection)
    per: dict[tuple, Counter] = defaultdict(Counter)
    routes: dict[str, Counter] = defaultdict(Counter)
    fallback_paths: Counter = Counter()
    for rid, r in req.items():
        key, c = attempt_of(r["ctx"]), classes[rid]
        e = end.get(rid) or {}
        status = status_of(rid)
        route = r.get("route")
        variant = r.get("variant") if route else None
        what = route if route else ("page" if r.get("path") in ("/", "/index.html") else
                                    "static" if str(r.get("path", "")).startswith(("/static/", "/assets/")) else "other")
        per[key][(what, variant if route else None, r.get("path") if what == "other" else None, c,
                  e.get("transport", "none"), status)] += 1
        if route:
            routes[route][c] += 1
        if c == "fallback":
            fallback_paths[f"{r['method']} {r['path']}"] += 1

    # the counter-cases' expectations (replay_http_expect.json): each listed
    # (method, path, class) seen exactly n times in an attempt of that test
    for x in expect:
        for key, att in attempts.items():
            if att.get("file") != x["file"] or att.get("title") != x["title"]:
                continue
            for want in x["expect"]:
                n = sum(1 for rid, r in req.items() if attempt_of(r["ctx"]) == key and r["method"] == want["method"]
                        and r["path"] == want["path"] and classes[rid] == want["class"]
                        and ("status" not in want or status_of(rid) == want["status"]))
                if n != want["n"]:
                    findings.append(f"{name.get(key, '?')}: {want['method']} {want['path']} as {want['class']}"
                                    f"{' ' + str(want['status']) if 'status' in want else ''} {n} time(s), expected {want['n']}")
            if covered[key] != x.get("covered", 0):
                findings.append(f"{name.get(key, '?')}: {covered[key]} id-less contact(s) covered by a synthetic hop, "
                                f"expected {x.get('covered', 0)}")

    def rows(c: Counter) -> list[dict]:
        return [{"what": w, "variant": v, "path": p, "class": cl, "transport": tr, "status": st, "n": n}
                for (w, v, p, cl, tr, st), n in sorted(c.items(), key=lambda kv: str(kv[0]))]
    return {
        "requests": len(req), "contexts": len(ctx),
        "classes": {c: n for c in CLASSES if (n := sum(1 for v in classes.values() if v == c))},
        "routes": {r: dict(sorted(c.items())) for r, c in sorted(routes.items())},
        "fallback_paths": dict(fallback_paths.most_common()),
        "idless_covered_by_synthetic_hops": unassigned,
        "ws_handshakes_joined": sum(1 for rid, c in classes.items() if c == "ws-handshake" and rid in ws_joined),
        "per_attempt": {name.get(k, str(k)): rows(c) for k, c in sorted(per.items(), key=lambda kv: name.get(kv[0], str(kv[0])))},
        "measuring_effect": ("the catch-all route: a request a page issues while its context closes no longer reaches "
                             "the mock (class closing, R389 probe); Firefox no longer asks for /favicon.ico"),
        "findings": findings,
    }
