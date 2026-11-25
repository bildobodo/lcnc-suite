"""scripts/review_handshake.py — the Claude/Codex review handshake.

A stub `codex` records the bell; the state dir is a tmp dir. Run:
  python3 -m pytest scripts/test_review_handshake.py
"""
import json
import os
import subprocess
import sys
import threading
import time
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parent / "review_handshake.py"
REVIEW_FILE = "docs/reviews/ui-design-welle.implementation-review.md"


@pytest.fixture
def env(tmp_path):
    bell_log = tmp_path / "bell.jsonl"
    stub = tmp_path / "codex"
    stub.write_text(
        "#!/usr/bin/env python3\n"
        "import json, os, sys\n"
        "if os.environ.get('STUB_FAIL'):\n"
        "    print('Error: thread/queue/add failed', file=sys.stderr); sys.exit(1)\n"
        f"open({str(bell_log)!r}, 'a').write(json.dumps(sys.argv[1:]) + '\\n')\n")
    stub.chmod(0o755)
    e = dict(os.environ, REVIEW_HANDSHAKE_DIR=str(tmp_path / "state"), CODEX_BIN=str(stub))
    e.pop("STUB_FAIL", None)
    return e, bell_log


def run(env, *args, check=True):
    out = subprocess.run([sys.executable, str(SCRIPT), *args], env=env,
                         capture_output=True, text=True, timeout=30)
    if check:
        assert out.returncode == 0, out.stderr
    return out


def configure(e):
    run(e, "config", "--codex-thread", "thread-1")


def test_request_logs_and_rings_the_configured_thread(env):
    e, bell = env
    configure(e)
    # --base HEAD: the CI checks out one commit, HEAD~1 is not there
    req = json.loads(run(e, "request", "--scope", "D3-D6", "--review-file", REVIEW_FILE,
                         "--base", "HEAD", "--note", "fixes for UI-DI05").stdout)
    assert req["id"] == "R1" and req["type"] == "request" and req["base"] and req["head"]
    args = json.loads(bell.read_text().splitlines()[0])
    assert args[:3] == ["queue", "--thread", "thread-1"]
    msg = args[args.index("--message") + 1]
    # The bell names the round, the range, the file and the exact reply command.
    assert "[Review-Handshake R1]" in msg and REVIEW_FILE in msg and "fixes for UI-DI05" in msg
    assert "scripts/review_handshake.py done R1 --verdict" in msg
    # the receipt comes first, before the request's content
    assert msg.index("scripts/review_handshake.py received R1") < msg.index("Umfang:")


def test_ids_count_up_and_done_closes_exactly_its_request(env):
    e, _ = env
    configure(e)
    run(e, "request", "--test")
    run(e, "request", "--test")
    done = json.loads(run(e, "done", "R2", "--verdict", "ok").stdout)
    assert done == {**done, "type": "done", "request": "R2", "verdict": "ok", "by": "codex"}
    status = run(e, "status").stdout
    assert "R1" in status and "OPEN" in status.split("R1", 1)[1].splitlines()[0]
    assert "done ok" in status.split("R2", 1)[1].splitlines()[0]


def test_done_refuses_an_unknown_or_answered_request(env):
    e, _ = env
    configure(e)
    run(e, "request", "--test")
    assert run(e, "done", "R9", "--verdict", "ok", check=False).returncode == 1
    run(e, "done", "R1", "--verdict", "ok")
    again = run(e, "done", "R1", "--verdict", "findings", check=False)
    assert again.returncode == 1 and "already answered" in again.stderr


def test_a_failed_bell_is_logged_and_refused_loudly(env):
    e, _ = env
    configure(e)
    out = run(dict(e, STUB_FAIL="1"), "request", "--test", check=False)
    assert out.returncode == 1 and "bell failed" in out.stderr and "Tell Codex by hand" in out.stderr
    assert "(bell failed)" in run(e, "status").stdout


def test_request_without_thread_or_review_file_is_refused(env):
    e, _ = env
    assert run(e, "request", "--test", check=False).returncode == 1  # no thread configured
    configure(e)
    assert run(e, "request", "--scope", "x", check=False).returncode == 2  # no --review-file
    missing = run(e, "request", "--scope", "x", "--review-file", "docs/nope.md", check=False)
    assert missing.returncode == 1


def test_wait_returns_when_codex_answers_and_times_out_otherwise(env):
    e, _ = env
    configure(e)
    run(e, "request", "--test")
    assert run(e, "wait", "--timeout", "0.1", check=False).returncode == 2

    def answer():
        time.sleep(1.0)
        run(e, "done", "R1", "--verdict", "agreement", "--note", "no findings")

    t = threading.Thread(target=answer)
    t.start()
    got = json.loads(run(e, "wait", "--request", "R1", "--timeout", "20").stdout)
    t.join()
    assert got["verdict"] == "agreement" and got["note"] == "no findings"


# ---- the receipt -----------------------------------------------------------

sys.path.insert(0, str(SCRIPT.parent))
import review_handshake as rh  # noqa: E402


def ev(kind, rid, at, **kw):
    at = f"2026-11-25T{at}:00+01:00"
    return {"type": kind, "at": at, **({"id": rid} if kind == "request" else {"request": rid}), **kw}


def t_of(at):
    return rh.datetime.fromisoformat(f"2026-11-25T{at}:00+01:00").timestamp()


def test_only_the_oldest_open_request_owes_its_receipt():
    events = [ev("request", "R1", "01:00"), ev("request", "R2", "02:00"), ev("request", "R3", "03:00")]
    assert [rh.owes_receipt(events, r) for r in ("R1", "R2", "R3")] == [t_of("01:00"), None, None]
    # at work on R1: nothing is owed, however long it takes
    events.append(ev("received", "R1", "04:00"))
    assert [rh.owes_receipt(events, r) for r in ("R1", "R2", "R3")] == [None, None, None]
    # R1 answered: R2's clock starts there, not at its own hours-old bell
    events.append(ev("done", "R1", "05:00", verdict="agreement"))
    assert [rh.owes_receipt(events, r) for r in ("R1", "R2", "R3")] == [None, t_of("05:00"), None]
    # an answer without a receipt (an older bell's text) owes none either
    events.append(ev("done", "R2", "06:00", verdict="findings"))
    assert [rh.owes_receipt(events, r) for r in ("R2", "R3")] == [None, t_of("06:00")]


def test_a_request_after_a_long_quiet_time_gets_its_full_time():
    events = [ev("request", "R1", "01:00"), ev("done", "R1", "01:10", verdict="ok"), ev("request", "R2", "09:00")]
    assert rh.owes_receipt(events, "R2") == t_of("09:00")


def test_received_is_logged_once_and_refuses_an_unknown_or_answered_request(env):
    e, _ = env
    configure(e)
    run(e, "request", "--test")
    got = json.loads(run(e, "received", "R1").stdout)
    assert got["type"] == "received" and got["request"] == "R1" and got["by"] == "codex"
    again = run(e, "received", "R1", check=False)
    assert again.returncode == 1 and "already received" in again.stderr
    assert run(e, "received", "R9", check=False).returncode == 1
    run(e, "done", "R1", "--verdict", "ok")
    late = run(e, "received", "R1", check=False)
    assert late.returncode == 1 and "already done" in late.stderr


def test_wait_ends_when_the_receipt_stays_out_and_not_once_it_came(env):
    e, _ = env
    configure(e)
    run(e, "request", "--test")
    out = run(e, "wait", "--request", "R1", "--timeout", "20", "--receipt-timeout", "0.5", check=False)
    assert out.returncode == 3 and "R1 NOT RECEIVED" in out.stderr
    # 0 turns it off: the plain timeout
    assert run(e, "wait", "--request", "R1", "--timeout", "1", "--receipt-timeout", "0", check=False).returncode == 2
    assert "NOT RECEIVED" in run(e, "status").stdout
    run(e, "received", "R1")
    assert run(e, "wait", "--request", "R1", "--timeout", "3", "--receipt-timeout", "0.5", check=False).returncode == 2
    line = run(e, "status").stdout.split("R1", 1)[1].splitlines()[0]
    assert "received 20" in line and "NOT RECEIVED" not in line


def test_a_request_behind_an_older_one_waits_without_owing(env):
    e, _ = env
    configure(e)
    run(e, "request", "--test")
    run(e, "request", "--test")
    out = run(e, "wait", "--request", "R2", "--timeout", "2", "--receipt-timeout", "0.5", check=False)
    assert out.returncode == 2
    assert "behind an older request" in run(e, "status").stdout.split("R2", 1)[1].splitlines()[0]
