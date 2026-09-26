#!/usr/bin/env python3
"""Review handshake between Claude (implementation) and Codex (review).

The two agents share the review FILE (e.g. docs/reviews/<topic>.implementation-
review.md — findings, answers, agreement, as before) and this handshake: an
append-only event log both sides write through this script, so a review round
needs no operator relay.

  Claude:  request  "ready for review"  -> logged + a message queued into the
                                          operator's Codex thread (the bell)
  Codex:   done     "review written"    -> logged; Claude's `wait` returns
  Claude:  wait                          blocks until the answer is logged

The bell is `codex queue --thread <id>`: it posts into the EXISTING Codex
session (the one the operator uses in VS Code), which runs queued messages by
itself once the thread is idle. No second Codex is started. An idle agent
notices nothing on its own, so the log alone could not wake Codex; Claude's
side waits with `wait` in a background shell, whose exit wakes it.

State lives in .review-handshake/ at the repository root (gitignored; inside
the workspace, so Codex's workspace-write sandbox may append to it):
  events.jsonl   one JSON object per line: request / done / notify_failed
  config.json    {"codex_thread": "<session uuid or exact name>"}

Usage:
  review_handshake.py config --codex-thread <uuid>
  review_handshake.py request --scope "D3-D6" --review-file docs/reviews/x.md \
      [--base 5cc74a5] [--head HEAD] [--note "..."] [--test] [--no-notify]
  review_handshake.py done R3 --verdict agreement|findings|question|ok [--note "..."]
  review_handshake.py wait [--request R3] [--timeout 14400]
  review_handshake.py status

Exit codes: 0 ok, 1 refused (unknown/closed request, notify failed), 2 wait
timed out.
"""
from __future__ import annotations

import argparse
import fcntl
import glob
import json
import os
import shutil
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
VERDICTS = ("agreement", "findings", "question", "ok")
POLL_S = 2.0


def state_dir() -> Path:
    return Path(os.environ.get("REVIEW_HANDSHAKE_DIR", ROOT / ".review-handshake"))


def now() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def read_events() -> list[dict]:
    path = state_dir() / "events.jsonl"
    if not path.exists():
        return []
    with open(path, encoding="utf-8") as fh:
        return [json.loads(line) for line in fh if line.strip()]


def append_event(make) -> dict:
    """Append make(events) under an exclusive lock (ids stay unique when both
    agents write at once) and return it."""
    d = state_dir()
    d.mkdir(parents=True, exist_ok=True)
    with open(d / "events.lock", "w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        event = make(read_events())
        with open(d / "events.jsonl", "a", encoding="utf-8") as fh:
            fh.write(json.dumps(event, ensure_ascii=False) + "\n")
    return event


def read_config() -> dict:
    path = state_dir() / "config.json"
    return json.loads(path.read_text()) if path.exists() else {}


def requests_by_id(events: list[dict]) -> dict[str, dict]:
    return {e["id"]: e for e in events if e["type"] == "request"}


def answer_of(events: list[dict], rid: str) -> dict | None:
    return next((e for e in events if e["type"] == "done" and e["request"] == rid), None)


def git_rev(rev: str) -> str:
    out = subprocess.run(["git", "rev-parse", "--short", rev], cwd=ROOT,
                         capture_output=True, text=True)
    if out.returncode != 0:
        sys.exit(f"review_handshake: unknown revision {rev!r}: {out.stderr.strip()}")
    return out.stdout.strip()


def git_branch() -> str:
    out = subprocess.run(["git", "branch", "--show-current"], cwd=ROOT,
                         capture_output=True, text=True)
    return out.stdout.strip()


def codex_bin() -> str | None:
    """CODEX_BIN, else `codex` on PATH, else the newest VS Code extension's."""
    if os.environ.get("CODEX_BIN"):
        return os.environ["CODEX_BIN"]
    found = shutil.which("codex")
    if found:
        return found
    cands = glob.glob(os.path.expanduser(
        "~/.vscode/extensions/openai.chatgpt-*/bin/*/codex"))
    return max(cands, key=os.path.getmtime) if cands else None


def bell_text(req: dict) -> str:
    rid = req["id"]
    reply = f"python3 scripts/review_handshake.py done {rid} --verdict"
    if req.get("test"):
        return (f"[Review-Handshake {rid} · Test] Nur ein Verbindungstest, kein Review. "
                f"Bitte führe nur aus: {reply} ok --note \"Test angekommen\"")
    lines = [
        f"[Review-Handshake {rid}] Claude meldet: bereit für das Review.",
        f"Umfang: {req['scope']}",
        f"Commits: {req['base']}..{req['head']} (Branch {req['branch']})"
        if req.get("base") else f"Stand: {req['head']} (Branch {req['branch']})",
        f"Review-Datei: {req['review_file']}",
    ]
    if req.get("note"):
        lines.append(f"Hinweis: {req['note']}")
    lines += [
        "Wenn das Review in der Datei steht (Belege wie bisher in docs/reviews/), "
        "melde zurück — Claude wartet darauf und macht dann weiter:",
        f"  {reply} agreement|findings|question --note \"<ein Satz>\"",
    ]
    return "\n".join(lines)


def ring(req: dict, thread: str) -> None:
    """Queue the request into the operator's Codex thread; log and refuse loudly
    when that fails — a silent miss would leave both sides waiting."""
    binary = codex_bin()
    if binary is None:
        err = "no codex binary (set CODEX_BIN)"
    else:
        out = subprocess.run([binary, "queue", "--thread", thread, "--message", bell_text(req)],
                             capture_output=True, text=True, timeout=60)
        err = None if out.returncode == 0 else \
            (out.stderr.strip() or out.stdout.strip() or f"exit {out.returncode}")
    if err:
        append_event(lambda _: {"type": "notify_failed", "request": req["id"],
                                "at": now(), "error": err})
        sys.exit(f"review_handshake: {req['id']} logged, but the bell failed: {err}\n"
                 f"Tell Codex by hand: {bell_text(req).splitlines()[0]}")


def cmd_config(a) -> None:
    cfg = read_config()
    if a.codex_thread:
        cfg["codex_thread"] = a.codex_thread
    state_dir().mkdir(parents=True, exist_ok=True)
    (state_dir() / "config.json").write_text(json.dumps(cfg, indent=2) + "\n")
    print(json.dumps(cfg))


def cmd_request(a) -> None:
    thread = a.codex_thread or read_config().get("codex_thread")
    if not a.no_notify and not thread:
        sys.exit("review_handshake: no Codex thread configured (config --codex-thread <uuid>)")
    if not a.test and not (ROOT / a.review_file).exists():
        sys.exit(f"review_handshake: review file {a.review_file} does not exist")
    fields = {
        "type": "request", "by": "claude", "at": now(), "scope": a.scope,
        "review_file": a.review_file, "branch": git_branch(), "head": git_rev(a.head),
        "base": git_rev(a.base) if a.base else None, "note": a.note, "test": a.test,
    }

    def make(events):
        n = 1 + max((int(e["id"][1:]) for e in events if e["type"] == "request"), default=0)
        return {"id": f"R{n}", **fields}

    req = append_event(make)
    if not a.no_notify:
        ring(req, thread)
    print(json.dumps(req, ensure_ascii=False))


def cmd_done(a) -> None:
    rid = a.request

    def make(events):
        if rid not in requests_by_id(events):
            sys.exit(f"review_handshake: no request {rid}")
        prior = answer_of(events, rid)
        if prior:
            sys.exit(f"review_handshake: {rid} was already answered at {prior['at']}")
        return {"type": "done", "by": "codex", "request": rid, "at": now(),
                "verdict": a.verdict, "note": a.note}

    print(json.dumps(append_event(make), ensure_ascii=False))


def cmd_wait(a) -> None:
    rid = a.request
    if rid is None:
        events = read_events()
        open_ids = [r for r in requests_by_id(events) if not answer_of(events, r)]
        if not open_ids:
            sys.exit("review_handshake: no open request to wait for")
        rid = open_ids[-1]
    deadline = time.monotonic() + a.timeout
    while True:
        events = read_events()
        if rid not in requests_by_id(events):
            sys.exit(f"review_handshake: no request {rid}")
        ans = answer_of(events, rid)
        if ans:
            print(json.dumps(ans, ensure_ascii=False))
            return
        if time.monotonic() >= deadline:
            print(f"review_handshake: {rid} still open after {a.timeout:.0f} s", file=sys.stderr)
            sys.exit(2)
        time.sleep(POLL_S)


def cmd_status(_a) -> None:
    events = read_events()
    cfg = read_config()
    print(f"codex thread: {cfg.get('codex_thread', '(not configured)')}")
    for rid, req in requests_by_id(events).items():
        ans = answer_of(events, rid)
        fails = [e for e in events if e["type"] == "notify_failed" and e["request"] == rid]
        state = (f"done {ans['verdict']} at {ans['at']}" + (f" — {ans['note']}" if ans.get("note") else "")
                 if ans else "OPEN" + (" (bell failed)" if fails else ""))
        kind = "test" if req.get("test") else req["scope"]
        print(f"{rid}  {req['at']}  {kind}  -> {state}")


def main(argv=None) -> None:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = p.add_subparsers(dest="cmd", required=True)

    c = sub.add_parser("config", help="store the Codex thread the bell rings")
    c.add_argument("--codex-thread")
    c.set_defaults(fn=cmd_config)

    r = sub.add_parser("request", help="Claude: ready for review")
    r.add_argument("--scope", default="Handshake test")
    r.add_argument("--review-file", default="")
    r.add_argument("--base")
    r.add_argument("--head", default="HEAD")
    r.add_argument("--note")
    r.add_argument("--test", action="store_true", help="connection test, no review")
    r.add_argument("--no-notify", action="store_true", help="log only, ring no bell")
    r.add_argument("--codex-thread", help="override the configured thread")
    r.set_defaults(fn=cmd_request)

    d = sub.add_parser("done", help="Codex: review written")
    d.add_argument("request")
    d.add_argument("--verdict", required=True, choices=VERDICTS)
    d.add_argument("--note")
    d.set_defaults(fn=cmd_done)

    w = sub.add_parser("wait", help="block until a request is answered")
    w.add_argument("--request", help="default: the newest open request")
    w.add_argument("--timeout", type=float, default=4 * 3600)
    w.set_defaults(fn=cmd_wait)

    s = sub.add_parser("status", help="list requests and their answers")
    s.set_defaults(fn=cmd_status)

    a = p.parse_args(argv)
    if a.cmd == "request" and not a.test and not a.review_file:
        p.error("request needs --review-file (or --test)")
    a.fn(a)


if __name__ == "__main__":
    main()
