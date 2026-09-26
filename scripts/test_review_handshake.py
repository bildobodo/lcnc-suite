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
    req = json.loads(run(e, "request", "--scope", "D3-D6", "--review-file", REVIEW_FILE,
                         "--base", "HEAD~1", "--note", "fixes for UI-DI05").stdout)
    assert req["id"] == "R1" and req["type"] == "request" and req["base"] and req["head"]
    args = json.loads(bell.read_text().splitlines()[0])
    assert args[:3] == ["queue", "--thread", "thread-1"]
    msg = args[args.index("--message") + 1]
    # The bell names the round, the range, the file and the exact reply command.
    assert "[Review-Handshake R1]" in msg and REVIEW_FILE in msg and "fixes for UI-DI05" in msg
    assert "scripts/review_handshake.py done R1 --verdict" in msg


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
