#!/usr/bin/env python3
"""The replay (test strategy step 5 — Codex R251 TS248-04, R265–R269
FI265-02, R349 VM349-01): every frame the UI sent to the e2e mocks, read
from the mocks' replay logs and judged OFFLINE by the gateway's own rules.

    python3 -I scripts/test_select/replay.py --dir <replay logs> --events <mock-events.jsonl> \\
        --run <run id> [--out replay.json]

What it proves — and what not (FI265-02): the RECORDED payloads against the
agreed rules. Not that every function was triggered, not the admission in
any machine state, not a write's success, not the machine's effect, not an
answer the browser made up. Outside, and named in every result (`outside`):
the profile's axis and velocity bounds, the gates, the handlers, the HTTP
requests' payloads (step 5b), the coverage against the inventory (5c).

The checks:
  1. complete — every mock the run bound wrote its log: a head naming the
     run and the instance, an end, every line JSON; no log of another
     instance under this run.
  2. origin — every app connection carries an attempt of THIS run the
     fixture logged (test id + retry), or a named infrastructure origin
     that sends nothing; a connection without one is a finding. So is an
     HTTP request without one — but the worker's reconnect probe (GET
     /ready, credentials "omit": no cookie by construction).
  3. vacuity — every attempt whose page loaded shows a `hello`.
  4. form — a frame is a JSON object with a string `cmd`; its fields are
     the frame's or the command's own (`atoms.web.json`: WsCommand's
     members, the worker frames' fields — ONE source, held current by
     webAtoms.test.ts) plus the transport's `req_id`.
  5. the reader's frames — the reader's own rules, mirrored (READER).
  6. every other command — command_policy.validate_payload (a stop:
     widen_stop) against EACH example var file's declared numbers; a
     refusal, a fault or a correction is a finding unless it is EXPECTED
     (replay_refusals.json: file, title, cmd, the partial payload, the
     refusal) — an expectation that ran and saw no refusal is one too.
  7. probe — no `mdi` calls a probe routine (O<probe_…>, VM349-01); every
     passed probe-click attempt sent its probe_run / surface_scan_run.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from pathlib import Path
from typing import Any, Callable

ROOT = Path(__file__).resolve().parents[2]
GATEWAY = ROOT / "lcnc-gateway"
ATOMS = ROOT / "scripts/inventory/atoms.web.json"
EXAMPLES = ROOT / "examples/sim_config"
REFUSALS = Path(__file__).with_name("replay_refusals.json")

#: what the fields of every command may add: the reply's correlation (lcncWs request())
TRANSPORT = frozenset({"cmd", "req_id"})
#: the named infrastructure origins (FI265-02 3) — they read, they send nothing
INFRA = {"infra:baseline": "e2e/ctl.ts appConnectFrames: a fresh client reads the connect frames"}
#: the ONE request without an origin that is no finding: the WebSocket worker's
#: reconnect probe — `fetch(readyUrlFor(…), {credentials: "omit"})` (src/wsWorker.ts)
#: sends no cookie BY CONSTRUCTION; a GET without payload (judged in no step)
READY_PROBE = ("GET", "/ready")
#: the ONE connection without an origin that is no finding: replay-origin.spec's
#: counter-case (a socket from Node without the cookie) — its only frame a hello
#: with this session, inside that spec's attempt on the same mock
NO_COOKIE_SPEC, NO_COOKIE_SESSION = "replay-origin.spec.ts", "replay-origin:no-cookie"
#: the probe-click spec (TS248-04): a passed attempt must have sent its job
PROBE_SPEC = "probe-click.spec.ts"
PROBE_JOBS = frozenset({"probe_run", "surface_scan_run"})
PROBE_MDI = re.compile(r"o\s*<\s*probe_", re.I)
OUTSIDE = [
    "the profile's axis and velocity bounds (MachineLimits holds only the var files' declared numbers)",
    "the gates and the handlers (admission, effect)",
    "HTTP requests' payloads (step 5b) — recorded with their origin, not judged",
    "coverage against the inventory (step 5c)",
]


def _policy():
    """command_policy and settings_store — pure modules (no linuxcnc, no hal)."""
    if str(GATEWAY) not in sys.path:
        sys.path.insert(0, str(GATEWAY))
    import command_policy
    import gateway_util
    import settings_store
    return command_policy, gateway_util, settings_store


# ── the reader's frames: its own rules, mirrored ─────────────────────────────
# The gateway handles these in its reader (gateway.py ws_endpoint), never
# through validate_payload; each rule names what the reader does with it.

def _str(v: Any) -> bool:
    return isinstance(v, str)


def _nonempty_str(v: Any) -> bool:
    return isinstance(v, str) and v != ""


def _bool(v: Any) -> bool:
    return isinstance(v, bool)


def _seq(v: Any) -> bool:
    return isinstance(v, int) and not isinstance(v, bool) and 0 <= v < 2**53


def _opaque(v: Any) -> bool:
    return True


def _reader_rules() -> dict[str, dict[str, Callable[[Any], bool]]]:
    _, _, store = _policy()
    sections = frozenset(store.VALID_SECTIONS)
    return {
        # "hello": a present session is a non-empty string (R363 VM363-03), only the
        # literal true resumes, a token is a string or null (_bind_device, R364)
        "hello": {"session": _nonempty_str, "resume_armed": _bool,
                  "device_token": lambda v: v is None or isinstance(v, str), "device_storage": _str},
        # "heartbeat": a seq outside [0, 2^53) is booked as none
        "heartbeat": {"seq": _seq},
        # "tab_visibility": a JSON boolean, else the state stays
        "tab_visibility": {"hidden": _bool},
        # "safety_trip_ack": the CURRENT trip's id — offline only its form
        "safety_trip_ack": {"id": _nonempty_str},
        # _ws_save_settings: a known section, a non-negative base revision, a device id; the data the store judges
        "save_settings": {"section": lambda v: v in sections, "base_rev": lambda v: _seq(v),
                          "device": _str, "data": _opaque},
        # _ws_device_command
        "device_rename": {"name": _str, "device": _str},
        "device_reset": {"device": _str}, "device_delete": {"device": _str},
        # a JSON boolean, else refused (R363)
        "timing_log": {"enable": _bool}, "halshow_live": {"on": _bool},
        # diagnostics without effect: the data is opaque
        "client_diag": {"data": _opaque},
        "get_settings": {}, "halshow_refresh": {},
    }


# ── the logs ─────────────────────────────────────────────────────────────────

def read_events(path: Path, run: str) -> list[dict]:
    if not path.is_file():
        return []
    out = []
    for line in path.read_text().splitlines():
        if line.strip():
            e = json.loads(line)
            if e.get("run") == run:
                out.append(e)
    return out


def read_logs(replay_dir: Path, run: str, instances: list[str]) -> tuple[dict[str, list[dict]], list[str]]:
    """Each bound instance's log, complete — or the problems."""
    logs: dict[str, list[dict]] = {}
    problems: list[str] = []
    for inst in instances:
        f = replay_dir / f"{run}-{inst}.jsonl"
        if not f.is_file() or f.stat().st_size == 0:
            problems.append(f"{f.name}: no replay log for a mock the run bound")
            continue
        lines: list[dict] = []
        for n, raw in enumerate(f.read_text().splitlines(), 1):
            try:
                rec = json.loads(raw)
            except ValueError:
                problems.append(f"{f.name}:{n}: not JSON")
                continue
            if not isinstance(rec, dict) or "kind" not in rec:
                problems.append(f"{f.name}:{n}: not a record")
                continue
            lines.append(rec)
        if not lines or lines[0].get("kind") != "head" or lines[0].get("run") != run or lines[0].get("instance") != inst:
            problems.append(f"{f.name}: no head naming this run and instance")
        if not lines or lines[-1].get("kind") != "end":
            problems.append(f"{f.name}: no end line — the log is incomplete")
        logs[inst] = lines
    known = {f"{run}-{i}.jsonl" for i in instances}
    for f in sorted(replay_dir.glob(f"{run}-*.jsonl")):
        if f.name not in known:
            problems.append(f"{f.name}: a log of an instance the run never bound")
    return logs, problems


# ── the checks ───────────────────────────────────────────────────────────────

def _subset(part: Any, whole: Any) -> bool:
    if isinstance(part, dict):
        return isinstance(whole, dict) and all(k in whole and _subset(v, whole[k]) for k, v in part.items())
    return part == whole


def _var_sets() -> dict[str, frozenset]:
    _, gu, _ = _policy()
    sets = {}
    for f in sorted(EXAMPLES.glob("*/*.var")):
        sets[str(f.relative_to(ROOT))] = gu.var_file_numbers(f.read_text().splitlines())
    if not sets:
        raise SystemExit(f"no example var file under {EXAMPLES}")
    return sets


def members() -> dict[str, frozenset]:
    """The fields each command and worker frame may carry (atoms.web.json)."""
    a = json.loads(ATOMS.read_text())["adapters"]
    out = {x["id"].split(":", 1)[1]: frozenset(x.get("members", [])) for x in a["commands"]["atoms"]}
    for x in a["frames"]["atoms"]:
        if "members" not in x:
            raise SystemExit(f"{x['id']} names no fields in atoms.web.json — regenerate the inventory")
        out[x["id"].split(":", 1)[1]] = frozenset(x["members"])
    return out


def judge_payload(cmd: str, msg: dict, var_sets: dict[str, frozenset]) -> list[str]:
    """validate_payload (a stop: widen_stop) against each var file: the
    refusals, faults and corrections, each with its var file."""
    cp, _, _ = _policy()
    out = []
    for name, declared in var_sets.items():
        limits = cp.MachineLimits(declared_vars=declared)
        if cmd in cp.STOP_COMMANDS:
            _, fault, _ = cp.widen_stop(cmd, msg, limits)
            if fault:
                out.append(f"stop widened ({fault}) [{name}]")
            continue
        try:
            fixed = cp.validate_payload(cmd, msg, limits)
        except ValueError as e:
            out.append(f"refused: {e} [{name}]")
            continue
        if fixed:
            out.append(f"corrected {sorted(fixed)} [{name}]")
    return out


def _variant(cmd: str, msg: dict) -> str:
    """A command and its relevant variant (FI265-02 5)."""
    if cmd == "mdi" and isinstance(msg.get("text"), str):
        m = re.search(r"o\s*<\s*([\w-]+)\s*>\s*call", msg["text"], re.I)
        return f"mdi:o<{m.group(1).lower()}>" if m else "mdi"
    if cmd in ("save_settings", "probe_run") and isinstance(msg.get("section") or msg.get("routine"), str):
        return f"{cmd}:{msg.get('section') or msg.get('routine')}"
    return cmd


def _named_no_cookie(opened: dict, lines: list[dict], attempts: dict, inst: str) -> bool:
    """The replay-origin spec's own counter-case, and nothing else: every
    frame of the connection a hello with NO_COOKIE_SESSION, opened inside
    that spec's attempt on this mock."""
    frames = [r.get("msg") for r in lines if r.get("kind") == "frame" and r.get("conn") == opened["conn"]]
    if not frames or any(not isinstance(m, dict) or m.get("cmd") != "hello" or m.get("session") != NO_COOKIE_SESSION
                         for m in frames):
        return False
    return any(a["file"] == NO_COOKIE_SPEC and a.get("instance") == inst
               and (a.get("start") or 0) <= opened.get("t", -1) <= (a.get("end") or float("inf"))
               for a in attempts.values())


def check(replay_dir: Path, events_path: Path, run: str, refusals: list[dict] | None = None) -> dict:
    events = read_events(events_path, run)
    instances = [e["instance"] for e in events if e.get("event") == "bound"]
    attempts: dict[tuple[str, int], dict] = {}
    for e in events:
        if e.get("event") in ("test-start", "test-end") and e.get("testId"):
            a = attempts.setdefault((e["testId"], e.get("retry", 0)),
                                    {"file": e["file"], "title": e["title"], "project": e.get("project"),
                                     "instance": e.get("instance")})
            a["start" if e["event"] == "test-start" else "end"] = e.get("t")
            if e["event"] == "test-end":
                a["status"] = e.get("status")
    findings: list[str] = []
    if not instances:
        findings.append(f"the event log names no mock of run {run}")
    logs, problems = read_logs(replay_dir, run, instances)
    findings += problems
    refusals = json.loads(REFUSALS.read_text()) if refusals is None else refusals
    used = [False] * len(refusals)
    shapes, rules, var_sets = members(), _reader_rules(), _var_sets()
    cmds: Counter = Counter()
    per_attempt: dict[tuple[str, int], Counter] = {}
    expected: list[dict] = []
    loaded: set[tuple[str, int]] = set()
    hello: set[tuple[str, int]] = set()
    http: Counter = Counter()
    conns = Counter()

    def where(key: tuple[str, int] | None) -> str:
        a = attempts.get(key) if key else None
        return f"{a['file']} › {a['title']} [retry {key[1]}]" if a and key else "?"

    for inst, lines in logs.items():
        origin_of: dict[int, tuple[str, Any]] = {}
        for rec in lines:
            kind = rec.get("kind")
            if kind == "open":
                o = rec.get("origin")
                if o is None:
                    origin_of[rec["conn"]] = ("none", None)
                    if not _named_no_cookie(rec, lines, attempts, inst):
                        findings.append(f"{inst} conn {rec['conn']}: an app connection without an origin")
                elif isinstance(o, dict) and "infra" in o:
                    origin_of[rec["conn"]] = ("infra", o["infra"])
                    if o["infra"] not in INFRA:
                        findings.append(f"{inst} conn {rec['conn']}: an unnamed infrastructure origin {o['infra']!r}")
                elif isinstance(o, dict) and o.get("run") == run and (o.get("test"), o.get("retry")) in attempts:
                    origin_of[rec["conn"]] = ("test", (o["test"], o["retry"]))
                else:
                    origin_of[rec["conn"]] = ("bad", o)
                    findings.append(f"{inst} conn {rec['conn']}: an origin of no attempt of this run: {str(o)[:160]}")
                conns[origin_of[rec["conn"]][0]] += 1
            elif kind == "http":
                o = rec.get("origin")
                key = (o.get("test"), o.get("retry")) if isinstance(o, dict) and o.get("run") == run else None
                req = f"{rec.get('method')} {rec.get('path')}"
                if key in attempts:
                    http["with origin"] += 1
                    if rec.get("method") == "GET" and rec.get("path") in ("/", "/index.html") \
                            and rec.get("status") == 200:
                        loaded.add(key)
                elif o is None and (rec.get("method"), rec.get("path")) == READY_PROBE:
                    http["ready probe (no cookie by construction)"] += 1
                elif isinstance(o, dict) and o.get("infra") in INFRA:
                    http["infrastructure"] += 1
                else:
                    # FI265-02: a request is the test's, a named infrastructure's
                    # or the named probe's — never nobody's
                    http["without"] += 1
                    findings.append(f"{inst}: {req} without an origin of this run: {str(o)[:120]}")
            elif kind == "frame":
                cls, who = origin_of.get(rec["conn"], ("none", None))
                if cls == "infra":
                    findings.append(f"{inst} conn {rec['conn']}: the infrastructure origin {who} sent a frame")
                    continue
                if cls != "test":
                    continue          # named above, once per connection
                key = who
                msg = rec.get("msg")
                if msg is None:
                    findings.append(f"{where(key)}: a frame that is no JSON object: {str(rec.get('raw'))[:120]!r}")
                    continue
                cmd = msg.get("cmd")
                if not isinstance(cmd, str):
                    findings.append(f"{where(key)}: a frame without a string cmd: {str(msg)[:120]}")
                    continue
                cmds[cmd] += 1
                per_attempt.setdefault(key, Counter())[_variant(cmd, msg)] += 1
                if cmd == "hello":
                    hello.add(key)
                if cmd not in shapes:
                    findings.append(f"{where(key)}: {cmd} is no command the UI declares (WsCommand / worker frames)")
                    continue
                extra = sorted(set(msg) - shapes[cmd] - TRANSPORT)
                if extra:
                    findings.append(f"{where(key)}: {cmd} carries undeclared fields {extra}")
                if cmd in rules:
                    bad = sorted(f for f, ok in rules[cmd].items() if f in msg and not ok(msg[f]))
                    problems_ = [f"the reader refuses {bad}"] if bad else []
                else:
                    problems_ = judge_payload(cmd, msg, var_sets)
                if cmd == "mdi" and isinstance(msg.get("text"), str) and PROBE_MDI.search(msg["text"]):
                    problems_.append("a probe routine through MDI (VM349-01: probe_run is the probe's job)")
                if not problems_:
                    continue
                a = attempts.get(key, {})
                hit = next((i for i, x in enumerate(refusals)
                            if x["file"] == a.get("file") and x["title"] == a.get("title") and x["cmd"] == cmd
                            and _subset(x["payload"], msg) and all(x["refusal"] in p for p in problems_)), None)
                if hit is not None:
                    used[hit] = True
                    expected.append({"where": where(key), "cmd": cmd, "refusal": refusals[hit]["refusal"]})
                else:
                    findings += [f"{where(key)}: {cmd} {p}" for p in problems_]
    for key in sorted(loaded - hello, key=str):
        findings.append(f"{where(key)}: the page loaded and its replay shows no hello")
    for key, a in sorted(attempts.items(), key=lambda kv: str(kv[0])):
        if a["file"] == PROBE_SPEC and a.get("status") == "passed" \
                and not {c.split(":")[0] for c in per_attempt.get(key, Counter())} & PROBE_JOBS:
            findings.append(f"{where(key)}: a passed probe-click attempt with no probe_run / surface_scan_run in the replay")
    ran = {(a["file"], a["title"]) for a in attempts.values()}
    for i, x in enumerate(refusals):
        if not used[i] and (x["file"], x["title"]) in ran:
            findings.append(f"expected refusal not seen: {x['file']} › {x['title']} {x['cmd']} ({x['refusal']})")
    # FI265-02 5: per attempt, its commands with their counts (variants: the
    # O-routine of an mdi, the section of a save — counted under "cmd:variant")
    return {
        "verdict": "FAIL" if findings else "PASS", "run": run, "logs": len(logs),
        "connections": dict(conns), "http": dict(http), "frames": sum(cmds.values()),
        "commands": dict(sorted(cmds.items())), "attempts": len(attempts),
        "per_attempt": {where(k): dict(sorted(c.items())) for k, c in sorted(per_attempt.items(), key=lambda kv: where(kv[0]))},
        "var_files": sorted(var_sets), "expected": expected,
        "findings": findings, "outside": OUTSIDE,
    }


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--dir", type=Path, required=True)
    ap.add_argument("--events", type=Path, required=True)
    ap.add_argument("--run", required=True)
    ap.add_argument("--out", type=Path)
    a = ap.parse_args(argv)
    result = check(a.dir, a.events, a.run)
    text = json.dumps(result, indent=2)
    if a.out:
        a.out.write_text(text + "\n")
    print(text if not a.out else f"{result['verdict']}: {len(result['findings'])} finding(s), {result['frames']} frames")
    return 0 if result["verdict"] == "PASS" else 1


if __name__ == "__main__":
    sys.exit(main())
