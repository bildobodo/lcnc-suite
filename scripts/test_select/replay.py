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
     fixture logged, its WHOLE origin (run, test id, retry, project) the
     attempt's, opened on the mock that attempt ran on (R373 VM-I17); or a
     named infrastructure origin that sends nothing; a connection without
     one is a finding. So is an HTTP request without one — but the
     worker's reconnect probe (GET /ready, credentials "omit": no cookie
     by construction). Every frame and close line goes back to an open
     line read before it, an open is never repeated (the first origin
     stays). The ONE named connection without a cookie (replay-origin's
     counter-case) waives the ORIGIN only: one connection inside that
     attempt on its mock, exactly the one frame it sends (R373 VM-I18).
  3. vacuity — every attempt whose page loaded shows a `hello`. The result
     lists EVERY attempt (`attempt_list`): its id, project, retry, mock,
     status, whether it loaded a page at a mock and how many frames it sent.
  4. form — a frame is a JSON object with a string `cmd`; its fields are
     the frame's or the command's own (`atoms.web.json`: WsCommand's
     members, the worker frames' fields — ONE source, held current by
     webAtoms.test.ts) plus the transport's `req_id`.
  5. the reader's frames — the reader's own rules, mirrored: each field
     required or optional as the reader takes it, its presence judged
     before its value (R373 VM-I16); `save_settings.data` an object whose
     content the store judges, `client_diag.data` opaque.
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
#: counter-case (a socket from Node without the cookie), opened inside THAT
#: attempt on its mock — it waives the origin, nothing else: its frames must
#: be exactly NO_COOKIE_FRAMES (replay-origin.spec.ts sends one hello). The
#: attempt is the spec's test whose window holds the open on that mock (one
#: worker runs one test at a time)
NO_COOKIE_SPEC, NO_COOKIE_SESSION = "replay-origin.spec.ts", "replay-origin:no-cookie"
NO_COOKIE_FRAMES = [{"cmd": "hello", "session": NO_COOKIE_SESSION}]
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


def _nonneg_int(v: Any) -> bool:
    return isinstance(v, int) and not isinstance(v, bool) and v >= 0


def _device(v: Any) -> bool:
    """A device named or left to the connection's own: null is "own"."""
    return v is None or _nonempty_str(v)


def _object(v: Any) -> bool:
    return isinstance(v, dict)


def _opaque(v: Any) -> bool:
    return True


REQ, OPT = True, False
Rule = tuple[bool, Callable[[Any], bool]]


def _reader_rules() -> dict[str, dict[str, Rule]]:
    """Each reader frame's fields as the reader takes them: (required, value
    rule). A required field missing is refused before any value is judged
    (R373 VM-I16); an optional one keeps the reader's own default."""
    _, _, store = _policy()
    sections = frozenset(store.VALID_SECTIONS)
    return {
        # "hello" (ws_endpoint): every field optional — a present session is a
        # non-empty string (R363 VM363-03), only the literal true resumes, a
        # token is a string or null (_bind_device, R364)
        "hello": {"session": (OPT, _nonempty_str), "resume_armed": (OPT, _bool),
                  "device_token": (OPT, lambda v: v is None or isinstance(v, str)), "device_storage": (OPT, _str)},
        # "heartbeat": a seq outside [0, 2^53) is booked as none; none is fine
        "heartbeat": {"seq": (OPT, _seq)},
        # "tab_visibility": not a JSON boolean → dropped, the state stays
        "tab_visibility": {"hidden": (REQ, _bool)},
        # "safety_trip_ack": a missing or other id clears nothing — the CURRENT
        # trip's id, offline only its form
        "safety_trip_ack": {"id": (REQ, _nonempty_str)},
        # _ws_save_settings: the section a known string; SettingsStore.save_section:
        # a non-negative base revision and an object, its content the store's;
        # the device own (absent/null) or named — on a device section only (below)
        "save_settings": {"section": (REQ, lambda v: isinstance(v, str) and v in sections),
                          "base_rev": (REQ, _nonneg_int), "device": (OPT, _device), "data": (REQ, _object)},
        # _ws_device_command: absent/null = the connection's own device; a
        # rename a string name; a delete of the OWN device is always refused,
        # so a delete names another
        "device_rename": {"name": (REQ, _str), "device": (OPT, _device)},
        "device_reset": {"device": (OPT, _device)},
        "device_delete": {"device": (REQ, _nonempty_str)},
        # a JSON boolean, else refused (R363)
        "timing_log": {"enable": (REQ, _bool)}, "halshow_live": {"on": (REQ, _bool)},
        # diagnostics without effect: no data or any data (a dict reaches the trace)
        "client_diag": {"data": (OPT, _opaque)},
    }


def judge_reader(cmd: str, msg: dict, rules: dict[str, dict[str, Rule]]) -> list[str]:
    """The reader's verdict on one of its frames: the missing required
    fields, then the present fields whose value it refuses."""
    rule = rules[cmd]
    missing = sorted(f for f, (req, _) in rule.items() if req and f not in msg)

    def ok(check: Callable[[Any], bool], v: Any) -> bool:
        try:
            return bool(check(v))
        except Exception:            # a value the rule cannot even read is refused, never a crash
            return False
    bad = sorted(f for f, (_, check) in rule.items() if f in msg and not ok(check, msg[f]))
    out = []
    if missing:
        out.append(f"the reader refuses: missing {missing}")
    if bad:
        out.append(f"the reader refuses {bad}")
    if cmd == "save_settings" and msg.get("device") is not None and "section" not in bad \
            and isinstance(msg.get("section"), str) and msg["section"] not in _device_sections():
        out.append(f"the reader refuses a device on the machine section {msg['section']!r}")
    return out


def _device_sections() -> frozenset:
    _, _, store = _policy()
    return frozenset(store.DEVICE_SECTIONS)


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


def _attempt_of(o: Any, run: str, inst: str, attempts: dict) -> tuple[tuple[str, int] | None, str]:
    """The attempt a cookie origin names — its WHOLE origin (run, test id,
    retry, project) the attempt's, on the mock the attempt ran on (R373
    VM-I17) — or None and why not."""
    if not isinstance(o, dict) or o.get("run") != run:
        return None, "an origin of no attempt of this run"
    key = (o.get("test"), o.get("retry"))
    a = attempts.get(key)
    if a is None:
        return None, "an origin of no attempt of this run"
    if o.get("project") != a.get("project"):
        return None, f"an origin naming project {o.get('project')!r}, its attempt ran in {a.get('project')!r}"
    if a.get("instance") != inst:
        return None, f"an origin of an attempt on mock {a.get('instance')}, here on mock {inst}"
    return key, ""


def _no_cookie_attempt(opened: dict, attempts: dict, inst: str) -> tuple[str, int] | None:
    """The replay-origin counter-case's attempt this cookie-less connection
    was opened in, on this mock — or None: the ONE named exception."""
    hits = [k for k, a in attempts.items()
            if a["file"] == NO_COOKIE_SPEC and a.get("instance") == inst
            and (a.get("start") or 0) <= opened.get("t", -1) <= (a.get("end") or float("inf"))]
    return hits[0] if len(hits) == 1 else None


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
    per_attempt: dict[tuple[str, int], Counter] = {k: Counter() for k in attempts}
    expected: list[dict] = []
    loaded: set[tuple[str, int]] = set()
    hello: set[tuple[str, int]] = set()
    http: Counter = Counter()
    conns = Counter()
    frames_by: Counter = Counter()
    no_cookie: list[dict] = []

    # each attempt's name in the result — unique by construction: two attempts
    # of one file and title (two projects) carry their project and test id
    base = {k: f"{a['file']} › {a['title']} [retry {k[1]}]" for k, a in attempts.items()}
    twice = Counter(base.values())
    name = {k: n if twice[n] == 1 else f"{n} [{attempts[k].get('project')} {k[0]}]" for k, n in base.items()}

    def where(key: tuple[str, int] | None) -> str:
        return name.get(key, "?") if key else "?"

    for inst, lines in logs.items():
        # conn → (class, attempt key | infra name | None); class: test,
        # no-cookie exception, infra, no origin, bad origin
        origin_of: dict[Any, tuple[str, Any]] = {}
        exception_frames: dict[Any, list] = {}
        orphans: Counter = Counter()
        for rec in lines:
            kind = rec.get("kind")
            if kind == "open":
                c, o = rec.get("conn"), rec.get("origin")
                if c in origin_of:
                    findings.append(f"{inst} conn {c}: a second open line — the first origin stays")
                    continue
                if o is None:
                    key = _no_cookie_attempt(rec, attempts, inst)
                    if key is not None:
                        origin_of[c] = ("no-cookie exception", key)
                        exception_frames[c] = []
                    else:
                        origin_of[c] = ("no origin", None)
                        findings.append(f"{inst} conn {c}: an app connection without an origin")
                elif isinstance(o, dict) and "infra" in o:
                    origin_of[c] = ("infra", o["infra"])
                    if o["infra"] not in INFRA:
                        findings.append(f"{inst} conn {c}: an unnamed infrastructure origin {o['infra']!r}")
                else:
                    key, why = _attempt_of(o, run, inst, attempts)
                    if key is not None:
                        origin_of[c] = ("test", key)
                    else:
                        origin_of[c] = ("bad origin", o)
                        findings.append(f"{inst} conn {c}: {why}: {str(o)[:160]}")
                conns[origin_of[c][0]] += 1
            elif kind == "close":
                if rec.get("conn") not in origin_of:
                    findings.append(f"{inst} conn {rec.get('conn')}: a close line without its open")
            elif kind == "http":
                o = rec.get("origin")
                req = f"{rec.get('method')} {rec.get('path')}"
                key, why = _attempt_of(o, run, inst, attempts) if isinstance(o, dict) and "infra" not in o \
                    else (None, "")
                if key is not None:
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
                    # or the named probe's — never nobody's (R373: never another
                    # project's or another mock's attempt either)
                    http["without"] += 1
                    findings.append(f"{inst}: {req} without an origin of this run{': ' + why if why else ''}: "
                                    f"{str(o)[:120]}")
            elif kind == "frame":
                c = rec.get("conn")
                if c not in origin_of:
                    # R373 VM-I17: a frame goes back to an open line read before
                    # it, or it is a finding of its own — never a silent skip
                    cls, who = "no open", None
                    orphans[c] += 1
                else:
                    cls, who = origin_of[c]
                frames_by[cls] += 1
                key = who if cls in ("test", "no-cookie exception") else None
                label = where(key) if key else f"{inst} conn {c} ({cls})"
                if cls == "infra":
                    findings.append(f"{inst} conn {c}: the infrastructure origin {who} sent a frame")
                if cls == "no-cookie exception":
                    exception_frames[c].append(rec.get("msg") if "msg" in rec else {"raw": rec.get("raw")})
                msg = rec.get("msg")
                if not isinstance(msg, dict):
                    findings.append(f"{label}: a frame that is no JSON object: {str(rec.get('raw'))[:120]!r}")
                    continue
                cmd = msg.get("cmd")
                if not isinstance(cmd, str):
                    findings.append(f"{label}: a frame without a string cmd: {str(msg)[:120]}")
                    continue
                cmds[cmd] += 1
                if cls == "test":
                    per_attempt[key][_variant(cmd, msg)] += 1
                    if cmd == "hello":
                        hello.add(key)
                if cmd not in shapes:
                    findings.append(f"{label}: {cmd} is no command the UI declares (WsCommand / worker frames)")
                    continue
                extra = sorted(set(msg) - shapes[cmd] - TRANSPORT)
                if extra:
                    findings.append(f"{label}: {cmd} carries undeclared fields {extra}")
                problems_ = judge_reader(cmd, msg, rules) if cmd in rules else judge_payload(cmd, msg, var_sets)
                if cmd == "mdi" and isinstance(msg.get("text"), str) and PROBE_MDI.search(msg["text"]):
                    problems_.append("a probe routine through MDI (VM349-01: probe_run is the probe's job)")
                if not problems_:
                    continue
                a = attempts.get(key, {}) if cls == "test" else {}
                hit = next((i for i, x in enumerate(refusals)
                            if x["file"] == a.get("file") and x["title"] == a.get("title") and x["cmd"] == cmd
                            and _subset(x["payload"], msg) and all(x["refusal"] in p for p in problems_)), None)
                if hit is not None:
                    used[hit] = True
                    expected.append({"where": where(key), "cmd": cmd, "refusal": refusals[hit]["refusal"]})
                else:
                    findings += [f"{label}: {cmd} {p}" for p in problems_]
        findings += [f"{inst} conn {c}: {n} frame(s) on a connection with no open line" for c, n in orphans.items()]
        # R373 VM-I18: the exception waives the origin, nothing else — one
        # connection in its attempt, exactly the frames the spec sends
        per_key = Counter(origin_of[c][1] for c in exception_frames)
        for c, fr in exception_frames.items():
            key = origin_of[c][1]
            no_cookie.append({"where": where(key), "instance": inst, "conn": c, "frames": fr})
            if fr != NO_COOKIE_FRAMES:
                findings.append(f"{where(key)}: the named connection without a cookie (conn {c}) sent "
                                f"{str(fr)[:160]} — exactly {NO_COOKIE_FRAMES} is named")
        findings += [f"{where(k)}: {n} connections without a cookie — the exception names one"
                     for k, n in per_key.items() if n > 1]
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

    def observed(key: tuple[str, int]) -> str:
        n = sum(per_attempt[key].values())
        page = "page loaded at its mock" if key in loaded else "no page loaded at a mock"
        return f"{page}, {n} frame(s)" if n else f"{page}, no frames"
    # FI265-02 5 + R373: EVERY attempt — its id, project, retry, mock, status,
    # what the logs show of it; per attempt its commands with their counts
    # (variants: the O-routine of an mdi, the section of a save — "cmd:variant")
    attempt_list = [{"name": where(k), "test": k[0], "project": a.get("project"), "retry": k[1],
                     "instance": a.get("instance"), "status": a.get("status"), "page": k in loaded,
                     "frames": sum(per_attempt[k].values()), "observed": observed(k)}
                    for k, a in sorted(attempts.items(), key=lambda kv: where(kv[0]))]
    return {
        "verdict": "FAIL" if findings else "PASS", "run": run, "logs": len(logs),
        "connections": dict(conns), "http": dict(http), "frames": sum(frames_by.values()),
        "frames_by_class": dict(sorted(frames_by.items())),
        "commands": dict(sorted(cmds.items())), "attempts": len(attempts),
        "per_attempt": {where(k): dict(sorted(c.items())) for k, c in sorted(per_attempt.items(), key=lambda kv: where(kv[0]))},
        "attempt_list": attempt_list, "no_cookie": no_cookie,
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
