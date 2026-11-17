"""Replay step 5b: each HTTP request of the browser with its response path
(FI265-02 Rest A/B, Codex R268/R269; deltas R389–R391; R393 VM-I28..I32).
Called by replay.check with the browser's HTTP record (e2e/httpRecord.ts: one
log per worker) and the mocks' lines; the join is by the request's own id the
mock logged (`x-e2e-req: req:<id>` / `fetch:<op>`), never by URL or order.

The record is BOUND before anything is judged (R393 VM-I30): every file is a
worker of this run; every context belongs to an attempt of this run with that
attempt's project, in the worker that attempt ran in; ids are unique; no
action, end or fetch stands without its request; every context of the run has
its closing mark; an assigned contact carries its request's attempt.

The classes (`CLASSES`), in the order they are decided:
  aborted          a spec's `abort`
  rewritten        a spec rewrote the request (`continue` / `fallback` /
                   `fetch` with another url or method): its served answer is
                   no evidence of the ORIGINAL route (R393 VM-I29)
  replaced         a spec's `fulfill`, no server contact
  fetched          `fetch` with exactly ONE contact the mock answered with its
                   handler, a static file, a 403 or a 404, then `fulfill` — the
                   server contact is assigned, the answer replaced
  fetch-fallback   `fetch` whose one contact was the mock's SPA fallback, then
                   `fulfill`: a fallback stays a fallback (R393 VM-I28)
  fetch-unknown    `fetch` then `fulfill`, the fetch's contacts not exactly one
                   or its contact closed without an answer: the replacement is
                   proven, the server contact is not
  ws-handshake     Firefox reports the WS upgrade as a request: joined to the
                   mock's open line by the id when it carries one; no HTTP
                   evidence
  other-server     forwarded to a host that is not this attempt's mock (the
                   preview server of smoke.spec)
  redirect-chain   forwarded and the start of a redirect chain: unknown, however
                   many contacts its id carries (R269, R393 VM-I28)
  served           forwarded, exactly one contact the mock answered with its
                   handler, a static file, a 403 or a 404, at the request's path
  fallback         forwarded, exactly one contact the mock's SPA FALLBACK
                   answered (index.html, any method) — never a served route
  contact-closed   forwarded, exactly one contact that ended without its answer:
                   the mock was reached, no response is proven (R393 VM-I28)
  several          forwarded, more than one contact under its id: unknown
  redirect-hop     a hop of a redirect chain without a route call: unknown;
                   a SYNTHETIC hop (its predecessor fulfilled with a 3xx, no
                   contact under the chain's first id) may cover ONE id-less
                   contact of its attempt with its method, path and query
                   key names (R390 VM389-01) — covered, it stays unassigned
  closing          no end, its request line written AFTER its context's closing
                   mark — the order of the worker's record, never the clock
  held             a spec handler entered, no action, no end
  aborted-early    no contact and the transport failed: forwarded, or before any
                   route call (a beacon the browser drops as its page navigates)
  unknown          anything else — a FINDING (R389 D4)

Findings (R389 D4, R390, R393): a binding problem of the record (above); a
request whose id was first given at the route; a service worker a context
held at its close; a `fulfill` AND a contact under the same request id
without a fetch; a contact under an id the browser never recorded; a contact
at another method or path than its request with no recorded rewrite; an
id-less contact of a test attempt no synthetic hop covers; an attempt whose
page loaded at its mock without its context in the record; a query value in
the record; an `unknown`; an expectation of replay_http_expect.json that ran
and was not seen.
"""
from __future__ import annotations

import json
import re
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any
from urllib.parse import unquote

EXPECT = Path(__file__).with_name("replay_http_expect.json")
#: the classes that are a server's answer to the request's own route — evidence of a route
EVIDENCE = frozenset({"served", "fetched"})
CLASSES = ("aborted", "rewritten", "replaced", "fetched", "fetch-fallback", "fetch-unknown", "ws-handshake",
           "other-server", "redirect-chain", "served", "fallback", "contact-closed", "several", "redirect-hop",
           "closing", "held", "aborted-early", "unknown")
READ_KINDS = frozenset({"ctx", "req", "act", "fetched", "end", "closing"})
#: the mock's answers that are its own: a handler, a file, a refusal by status
ANSWERED = frozenset({"handler", "static", "403", "404"})
FILE = re.compile(r"-w(\d+)\.jsonl$")
READY_PROBE = ("GET", "/ready")


def read_record(http_dir: Path, run: str) -> tuple[list[dict], list[str]]:
    """Every line of this run's HTTP record, in file order — or the problems.
    Each line gets its place `_o` (file, line) and its file's worker `_w`: a
    worker writes its record in order and a context lives in one worker, so
    `_o` orders a context's lines exactly where the millisecond clock cannot."""
    lines, problems = [], []
    files = sorted(http_dir.glob(f"{run}-w*.jsonl")) if http_dir.is_dir() else []
    if not files:
        problems.append(f"no HTTP record of run {run} in {http_dir}")
    for fi, f in enumerate(files):
        w = FILE.search(f.name)
        if not w:
            problems.append(f"{f.name}: a record file that names no worker")
            continue
        for n, raw in enumerate(f.read_text().splitlines(), 1):
            try:
                rec = json.loads(raw)
            except ValueError:
                problems.append(f"{f.name}:{n}: not JSON")
                continue
            if not isinstance(rec, dict) or rec.get("k") not in READ_KINDS:
                problems.append(f"{f.name}:{n}: a line of unknown kind")
                continue
            rec["_o"], rec["_w"], rec["_f"] = (fi, n), int(w.group(1)), f.name
            lines.append(rec)
    return lines, problems


def _key3(method: Any, path: Any, qkeys: Any) -> tuple:
    return (method, path, tuple(qkeys) if isinstance(qkeys, list) else ())


def _same_path(req_path: Any, contact_path: Any) -> bool:
    """The browser records the URL's (encoded) path, the mock its decoded one;
    a parameter is a template on both sides."""
    return isinstance(req_path, str) and isinstance(contact_path, str) and unquote(req_path) == contact_path


def judge(http_dir: Path, run: str, attempts: dict, name: dict, bound: dict[str, dict],
          mock_http: list[tuple[str, dict]], mock_opens: list[tuple[str, dict]],
          loaded: set, expect: list[dict] | None = None) -> dict:
    """The HTTP paths of the run, each attempt's observations and the findings.
    attempts: (test, retry) → {file, title, project, instance, status};
    name: (test, retry) → the attempt's name; bound: instance → {port, workerIndex}."""
    lines, findings = read_record(http_dir, run)
    expect = json.loads(EXPECT.read_text()) if expect is None else expect
    workers = {b["workerIndex"]: inst for inst, b in bound.items() if isinstance(b.get("workerIndex"), int)}
    ctx: dict[str, dict] = {}
    req: dict[str, dict] = {}
    acts: dict[str, list[dict]] = defaultdict(list)
    ops: dict[str, str] = {}
    end: dict[str, dict] = {}
    closing: dict[str, tuple] = {}
    bad_files: set[str] = set()

    # ── the binding of the record (R393 VM-I30) ─────────────────────────────
    for r in lines:
        if r["_w"] not in workers and r["_f"] not in bad_files:
            bad_files.add(r["_f"])
            findings.append(f"{r['_f']}: a record of worker {r['_w']}, which no mock of this run was bound to")
    for r in lines:
        if r["k"] != "ctx":
            continue
        c = r.get("ctx")
        if c in ctx:
            findings.append(f"context {c}: a second context line — ids are unique")
            continue
        key = (r.get("test"), r.get("retry"))
        a = attempts.get(key)
        if r.get("run") != run:
            findings.append(f"context {c}: a context of run {str(r.get('run'))[:60]!r}, not {run}")
        elif a is None:
            findings.append(f"context {c}: a context of no attempt of this run {key}")
        else:
            if r.get("project") != a.get("project"):
                findings.append(f"context {c}: names project {r.get('project')!r}, its attempt ran in {a.get('project')!r}")
            inst = a.get("instance")
            if workers.get(r["_w"]) != inst:
                findings.append(f"context {c}: written by worker {r['_w']}, its attempt ran on mock {inst}")
        ctx[c] = r
    for r in lines:
        k = r["k"]
        if k == "req":
            rid = r.get("id")
            if rid in req:
                findings.append(f"request {rid}: a second request line — ids are unique")
                continue
            if r.get("ctx") not in ctx:
                findings.append(f"request {rid}: of a context the record never opened ({r.get('ctx')})")
            req[rid] = r
            if r.get("at") != "request":
                findings.append(f"request {rid} {r.get('method')} {r.get('path')}: its id was first given at the route — "
                                f"its request event is missing")
            if "?" in str(r.get("path")):
                findings.append(f"request {rid}: a query in the recorded path — the record keeps key names only")
        elif k == "closing":
            c = r.get("ctx")
            if c not in ctx:
                findings.append(f"a closing mark of a context the record never opened ({c})")
                continue
            closing.setdefault(c, r["_o"])           # a context closed twice keeps its first mark
            if r.get("sw"):
                findings.append(f"context {c}: {r['sw']} service worker(s) at its close — they are blocked")
    for r in lines:
        k, rid = r["k"], r.get("id")
        if k in ("act", "end", "fetched") and rid not in req:
            findings.append(f"a {k} line of a request the record never saw ({rid})")
            continue
        if k == "act":
            acts[rid].append(r)
            if r.get("act") == "fetch":
                if r.get("op") in ops:
                    findings.append(f"fetch {r.get('op')}: a second fetch line — ids are unique")
                ops[r.get("op")] = rid
        elif k == "end":
            end[rid] = r
    for c, r in ctx.items():
        if r.get("run") == run and c not in closing:
            findings.append(f"context {c}: no closing mark — the record of a finished run ends every context")

    def attempt_of(c: Any) -> tuple | None:
        x = ctx.get(c, {})
        return (x.get("test"), x.get("retry")) if x.get("run") == run else None

    # ── the mocks' contacts ─────────────────────────────────────────────────
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
    # an assigned contact carries its request's attempt (R393 VM-I30)
    for rid, contacts in list(by_req.items()) + [(ops.get(op), cs) for op, cs in by_op.items()]:
        r = req.get(rid) if rid else None
        if r is None:
            continue
        x = ctx.get(r.get("ctx"), {})
        for m in contacts:
            o = m.get("origin")
            if o is None and (m.get("method"), m.get("path")) == READY_PROBE:
                continue                              # the worker's probe: no cookie by construction
            if not (isinstance(o, dict) and o.get("run") == run and o.get("test") == x.get("test")
                    and o.get("retry") == x.get("retry") and o.get("project") == x.get("project")):
                findings.append(f"request {rid} {r.get('method')} {r.get('path')}: its contact carries another origin "
                                f"({str(o)[:100]})")
    ws_joined = {m["req_id"][4:] for _, m in mock_opens if isinstance(m.get("req_id"), str) and m["req_id"].startswith("req:")}

    def first_of(rid: str) -> str:
        seen = set()
        while req.get(rid, {}).get("from") and rid not in seen:
            seen.add(rid)
            rid = req[rid]["from"]
        return rid

    starts_chain = {r["from"] for r in req.values() if r.get("from")}

    def rewrite_of(rid: str, r: dict) -> dict | None:
        """The recorded rewrite of a request — its effective method, host or
        path differ from the request's own (R393 VM-I29)."""
        for x in acts.get(rid, []):
            to = x.get("to")
            if isinstance(to, dict) and (to.get("method") != r.get("method") or to.get("path") != r.get("path")
                                         or to.get("host") != r.get("host")):
                return to
        return None

    classes: dict[str, str] = {}
    synthetic: dict[tuple | None, list[str]] = defaultdict(list)   # attempt → synthetic hops
    for rid, r in req.items():
        a = [x["act"] for x in acts.get(rid, [])]
        terminal = [x for x in a if x != "handler"]
        key = attempt_of(r.get("ctx"))
        inst = attempts.get(key, {}).get("instance") if key else None
        port = bound.get(inst, {}).get("port") if inst else None
        mock_host = f"localhost:{port}" if port else None
        mark = closing.get(r.get("ctx"))
        e = end.get(rid)
        contacts = by_req.get(rid, [])
        if "abort" in terminal:
            c = "aborted"
        elif rewrite_of(rid, r) is not None:
            c = "rewritten"
        elif "fulfill" in terminal:
            if "fetch" in terminal:
                fops = [x["op"] for x in acts[rid] if x["act"] == "fetch"]
                fc = [m for op in fops for m in by_op.get(op, [])]
                one = fc[0] if len(fops) == 1 and len(fc) == 1 else None
                if one is None or one.get("closed"):
                    c = "fetch-unknown"
                elif not (one.get("method") == r.get("method") and _same_path(r.get("path"), one.get("path"))):
                    c = "rewritten"
                    findings.append(f"request {rid} {r['method']} {r['path']}: its fetch reached {one.get('method')} "
                                    f"{one.get('path')} with no recorded rewrite")
                else:
                    c = "fetch-fallback" if one.get("served") == "fallback" else \
                        "fetched" if one.get("served") in ANSWERED else "fetch-unknown"
            else:
                c = "replaced"
                if contacts:
                    findings.append(f"request {rid} {r['method']} {r['path']}: fulfilled in the browser AND a contact "
                                    f"under its id without a fetch")
        elif r.get("path") == "/ws" and r.get("type") == "document":
            c = "ws-handshake"
        elif "continue" in terminal or "catch-all" in terminal:
            if mock_host and r.get("host") != mock_host and not contacts:
                c = "other-server"
            elif rid in starts_chain:
                c = "redirect-chain"
            elif len(contacts) == 1:
                one = contacts[0]
                if not (one.get("method") == r.get("method") and _same_path(r.get("path"), one.get("path"))):
                    c = "rewritten"
                    findings.append(f"request {rid} {r['method']} {r['path']}: its contact is {one.get('method')} "
                                    f"{one.get('path')} with no recorded rewrite")
                elif one.get("closed"):
                    c = "contact-closed"
                elif one.get("served") == "fallback":
                    c = "fallback"
                elif one.get("served") in ANSWERED:
                    c = "served"
                else:
                    c = "unknown"
            elif len(contacts) > 1:
                c = "several"
            elif e is None and mark is not None and r["_o"] > mark:
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
                    and pre.get("ctx") == r.get("ctx"):
                synthetic[key].append(rid)
        elif e is None and mark is not None and r["_o"] > mark:
            c = "closing"
        elif "handler" in a and e is None:
            c = "held"
        elif e is not None and e.get("transport") == "failed" and not contacts:
            c = "aborted-early"
        else:
            c = "unknown"
        if c == "unknown":
            findings.append(f"{name.get(key, '?')}: request {rid} {r.get('method')} {r.get('path')} — no named path "
                            f"(actions {terminal or a}, end {e.get('transport') if e else 'none'})")
        classes[rid] = c

    # R390 VM389-01: an id-less contact of a test attempt is red unless a
    # SYNTHETIC hop of the same attempt with its method, path and query key
    # names covers it — one contact per hop; covered, it stays unassigned
    unassigned = 0
    covered: Counter = Counter()
    for key, contacts in idless.items():
        room = Counter(_key3(req[h]["method"], unquote(req[h]["path"]), req[h].get("qkeys")) for h in synthetic.get(key, []))
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
    per: dict[tuple | None, Counter] = defaultdict(Counter)
    routes: dict[str, Counter] = defaultdict(Counter)
    fallback_paths: Counter = Counter()
    for rid, r in req.items():
        key, c = attempt_of(r.get("ctx")), classes[rid]
        e = end.get(rid) or {}
        route = r.get("route")
        variant = r.get("variant") if route else None
        what = route if route else ("page" if r.get("path") in ("/", "/index.html") else
                                    "static" if str(r.get("path", "")).startswith(("/static/", "/assets/")) else "other")
        per[key][(what, variant if route else None, r.get("path") if what == "other" else None, c,
                  e.get("transport", "none"), status_of(rid))] += 1
        if route:
            routes[route][c] += 1
        if c in ("fallback", "fetch-fallback"):
            fallback_paths[f"{r['method']} {r['path']}"] += 1

    # the counter-cases' expectations (replay_http_expect.json): each listed
    # (method, path, class[, status][, variant]) seen exactly n times in an attempt of that test
    for x in expect:
        for key, att in attempts.items():
            if att.get("file") != x["file"] or att.get("title") != x["title"]:
                continue
            for want in x["expect"]:
                n = sum(1 for rid, r in req.items() if attempt_of(r.get("ctx")) == key and r["method"] == want["method"]
                        and r["path"] == want["path"] and classes[rid] == want["class"]
                        and ("status" not in want or status_of(rid) == want["status"])
                        and ("variant" not in want or r.get("variant") == want["variant"]))
                if n != want["n"]:
                    findings.append(f"{name.get(key, '?')}: {want['method']} {want['path']} as {want['class']}"
                                    f"{' ' + str(want['status']) if 'status' in want else ''}"
                                    f"{' (' + want['variant'] + ')' if 'variant' in want else ''} {n} time(s), expected {want['n']}")
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
