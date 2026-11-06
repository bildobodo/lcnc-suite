#!/usr/bin/env python3
"""R314 plan countermodels, plus the real hello branch without server imports.

Usage: python3 this-file.py /path/to/git-archive-of-6f90c072
No sockets, HAL, subprocesses, product mutations or machine commands.
Synthetic clock examples are contract counterexamples, not live measurements.
"""
import ast
import asyncio
import copy
import hashlib
import json
from pathlib import Path
import statistics
import sys
from types import SimpleNamespace

ROOT = Path(sys.argv[1])
MS = 1_000_000
T = MS


def verdict(lo, hi):
    return "PASS" if hi <= 250 * MS else "FAIL" if lo > 250 * MS else "incomplete"


def proposed(lp, i, j):
    lo = sum(lp[i + 1:j]) - T
    hi = sum(lp[i:j + 1]) + T
    return {"lower_ms": lo / MS, "upper_ms": hi / MS,
            "verdict": verdict(lo, hi)}


def median_ok(lp):
    return abs(statistics.median(lp) - T) <= .05 * T


def bound_example():
    # One 100-ms delay AFTER controller 201's timestamp but BEFORE its
    # sampler. It appears in lp[202], not lp[201]. All calls are sequential.
    controllers = [k * MS + (100 * MS if k >= 202 else 0) for k in range(403)]
    captures = [c + MS // 10 for c in controllers]
    captures[201] += 100 * MS
    assert all(controllers[k] <= captures[k] < controllers[k + 1]
               for k in range(len(controllers) - 1))
    lp = [T] + [b - a for a, b in zip(controllers, controllers[1:])]
    edges = [(1, MS // 2), (201, 300 * MS + MS // 2),
             (301, 400 * MS + MS // 2)]
    for index, when in edges:
        assert captures[index - 1] < when <= captures[index]
    pairs = []
    for (i, a), (j, b) in zip(edges, edges[1:]):
        p = proposed(lp, i, j)
        # Safe envelope if the controller clock itself is valid and intact:
        # C_k <= S_k <= C_(k+1), edge_i in [S_(i-1), S_i].
        lo = max(0, controllers[j - 1] - controllers[i + 1])
        hi = controllers[j + 1] - controllers[i - 1]
        pairs.append({"i": i, "j": j, "actual_ms": (b-a)/MS,
                      "v6": p,
                      "next_controller_envelope": {"lower_ms": lo/MS,
                          "upper_ms": hi/MS, "verdict": verdict(lo, hi)}})
    assert median_ok(lp)
    assert all(p["v6"]["verdict"] == "PASS" for p in pairs)
    assert pairs[0]["actual_ms"] == 300
    assert pairs[0]["next_controller_envelope"]["verdict"] == "incomplete"
    return {"median_passes": True, "pairs": pairs,
            "number_gaps": 0, "overflow": False}


def wrap_example():
    true_lp = [T] * 220
    true_lp[100] += 4_300 * MS
    pin_lp = [x % 2**32 for x in true_lp]
    p = proposed(pin_lp, 1, 201)
    assert median_ok(pin_lp) and p["verdict"] == "PASS"
    return {"long_period_ns": true_lp[100], "u32_pin_ns": pin_lp[100],
            "median_passes": True, "v6": p,
            "controller_span_ms": sum(true_lp[1:202])/MS,
            "explanation": "u32 truncation is not a sampler FIFO overrun"}


def scale_example():
    lp = [960_000] * 270
    p = proposed(lp, 1, 256)
    assert median_ok(lp) and p["verdict"] == "PASS"
    return {"hypothetical_ticks_per_ns": .96, "median_passes": True,
            "actual_edge_gap_ms": 255, "v6": p,
            "scope": "shows that a median is no proof of units; not an assertion about this VM's clock"}


def post_w_example():
    # W is set at 2099 ms (after the observed server event), during a
    # delay after C_0. The first W capture S_0 happens at 2100.1 ms.
    c = [0] + [(2100+k) * MS for k in range(1, 101)]
    s = [2100 * MS + MS//10] + [t + MS//10 for t in c[1:]]
    lp = [b-a for a, b in zip(c, c[1:])]
    assert s[0] > 2099 * MS
    assert all(c[k] <= s[k] < c[k+1] for k in range(len(c)-1))
    actual = s[-1] - s[0]
    assert sum(lp) >= 2000 * MS and actual == 100 * MS
    return {"marker_set_ms": 2099, "first_W_capture_ms": s[0]/MS,
            "last_W_capture_ms": s[-1]/MS,
            "v6_sum_ms_even_excluding_first_W_period": sum(lp)/MS,
            "actual_W_observation_ms": actual/MS,
            "motion_mm_at_F6000": actual / 1e9 * 100,
            "conservative_capture_lower_ms": max(0, c[-1]-c[1])/MS}


def hello_example():
    gateway = ROOT / "lcnc-gateway/gateway.py"
    clientfile = ROOT / "scripts/test_support/live_session.py"
    tree = ast.parse(gateway.read_text())
    candidates = [n for n in ast.walk(tree) if isinstance(n, ast.If)
                  and ast.unparse(n.test) == "msg.get('cmd') == 'hello'"]
    assert len(candidates) == 1
    block = copy.deepcopy(candidates[0])
    assert isinstance(block.body[-1], ast.Continue)
    block.body[-1] = ast.Return(value=ast.Constant(None))
    fn = ast.AsyncFunctionDef(name="exercise", args=ast.arguments(
        posonlyargs=[], args=[], kwonlyargs=[], kw_defaults=[], defaults=[]),
        body=[block], decorator_list=[])
    module = ast.fix_missing_locations(ast.Module(body=[fn], type_ignores=[]))
    compiled = compile(module, str(gateway) + "::<hello branch only>", "exec")

    client_tree = ast.parse(clientfile.read_text())
    cls = next(n for n in client_tree.body if isinstance(n, ast.ClassDef)
               and n.name == "SimulatorClient")
    start = next(n for n in cls.body if isinstance(n, ast.FunctionDef) and n.name == "start")
    stmt = next(n for n in start.body if isinstance(n, ast.Expr)
                and isinstance(n.value, ast.Call) and n.value.args
                and isinstance(n.value.args[0], ast.Constant)
                and n.value.args[0].value == "hello")
    calls = []
    fake_self = SimpleNamespace(session="native-A-r314-test",
        request=lambda cmd, **kw: calls.append({"cmd": cmd, **kw}))
    # Execute only the source's request expression, never start() itself.
    exec(compile(ast.fix_missing_locations(ast.Module(body=[copy.deepcopy(stmt)],
        type_ignores=[])), str(clientfile) + "::<hello request only>", "exec"),
        {"self": fake_self})
    assert len(calls) == 1
    results = []
    for message in [calls[0], dict(calls[0], resume_armed=True)]:
        events, replies = [], []
        client = SimpleNamespace(armed=False, conn_key="offline", session_id=None)
        async def ws_send_json(ws, reply):
            replies.append(reply)
        env = {"msg": message, "client_id": "test-client", "client": client,
               "_clients": {"test-client": client}, "ws": None,
               "ws_send_json": ws_send_json,
               "_peek_armed_resume_hold": lambda sid: "no_match",
               "_trace": SimpleNamespace(emit=lambda kind, **kw: events.append(
                   {"event": kind, **kw}))}
        exec(compiled, env)
        asyncio.run(env["exercise"]())
        results.append({"message": message, "events": events, "replies": replies})
    assert not results[0]["events"]
    assert results[1]["events"] == [{"event": "session.resume_denied_no_match",
        "client_id": "test-client", "session_id": "native-A-r314-test"}]
    assert all(r["replies"][0]["armed"] is False for r in results)
    return {"gateway_line": candidates[0].lineno, "request_line": stmt.lineno,
            "cases": results, "real_gateway_imported": False,
            "source_sha256": {str(p.relative_to(ROOT)): hashlib.sha256(
                p.read_bytes()).hexdigest() for p in (gateway, clientfile)}}


print(json.dumps({"code_commit": "6f90c072", "after_controller_delay": bound_example(),
    "u32_wrap": wrap_example(), "median_unit": scale_example(),
    "post_event_duration": post_w_example(), "hello_binding": hello_example()},
    indent=2))
