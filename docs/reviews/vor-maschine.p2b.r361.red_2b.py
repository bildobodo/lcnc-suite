"""Package 2b: every new guard runs against the gateway.py BEFORE its fix
(the head's tests, the old product) and must fail there; the named controls
must pass. Each run lists its test ids — the verdict compares the outcome
per id and the script exits 1 on any difference (Fable's check of
7c16f5e9: labels that went stale and an exit code that was always 0).

usage: <venv python> red_2b.py <worktree> <out.txt>"""
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

WT, OUT = Path(sys.argv[1]), Path(sys.argv[2])
L = "test_link_ownership.py::"
RUNS = [
    ("699834be", "pin to no connection, heal and read-back on one Link (7fed7bef)",
     {L + "OneLinkPerCommand::test_a_command_that_began_without_a_connection_never_takes_a_later_one",
      L + "BackgroundSequencesKeepTheirLink::test_the_heal_refuses_its_g54_after_a_reconnect",
      L + "BackgroundSequencesKeepTheirLink::test_the_heal_waits_for_a_command_in_flight",
      L + "BackgroundSequencesKeepTheirLink::test_the_read_back_refuses_its_synch_after_a_reconnect"},
     {L + "OneLinkPerCommand::test_without_a_connection_throughout_it_is_not_connected",
      L + "BackgroundSequencesKeepTheirLink::test_the_heal_on_one_link_writes_both"}),
    ("7fed7bef", "an abort preempts the heal; the read-back names a refused Link (211ecc45)",
     {L + "AnAbortDuringTheHeal::test_the_abort_goes_out_within_a_slice",
      L + "TheReadBackOnAChangedLinkAtItsWrite::test_refused_and_traced"}, set()),
    ("211ecc45", "the heal re-checks under the lock; caches from a read status (3e3ec6ed)",
     {L + "BackgroundSequencesKeepTheirLink::test_a_fixture_selected_ahead_of_the_heal_supersedes_it",
      L + "BackgroundSequencesKeepTheirLink::test_a_plane_oriented_ahead_of_the_heal_supersedes_it",
      L + "BackgroundSequencesKeepTheirLink::test_a_machine_no_longer_ready_defers_it",
      L + "BackgroundSequencesKeepTheirLink::test_a_fixture_selected_at_the_write_is_refused_there",
      L + "CachesFilledOnTheirOwnLink::test_the_payload_bounds_are_not_cached_by_a_pinned_out_caller",
      L + "CachesFilledOnTheirOwnLink::test_the_joint_jog_facts_read_one_status"}, set()),
    ("3e3ec6ed", "reserved rows only on a TWP machine (3aae6337)",
     {L + "ReservedRowsOnlyOnATwpMachine::test_a_tcp_trunnions_g59_1_is_an_ordinary_fixture",
      L + "ReservedRowsOnlyOnATwpMachine::test_the_heal_on_a_machine_without_twp_writes_nothing"},
     {L + "ReservedRowsOnlyOnATwpMachine::test_an_unread_plane_state_on_a_twp_machine_defers"}),
    ("3aae6337", "Codex R360: completions, cache publication, the relinked window (7c16f5e9)",
     {L + "ClaimsOfAnEarlierLink::test_a_poll_begun_before_the_write_does_not_start_the_window",
      L + "ClaimsOfAnEarlierLink::test_a_mark_of_another_proof_does_not_shorten_the_window",
      L + "ClaimsOfAnEarlierLink::test_a_poll_of_a_replaced_link_proves_nothing",
      L + "CompletionsKeepTheirLink::test_a_link_replaced_in_the_synchs_wait_books_nothing",
      L + "CompletionsKeepTheirLink::test_a_link_replaced_at_the_last_file_read_books_nothing",
      L + "BackgroundSequencesKeepTheirLink::test_a_link_replaced_in_the_g54_wait_heals_nothing",
      L + "CachesFilledOnTheirOwnLink::test_an_old_poll_never_publishes_its_bounds_for_the_new_link",
      L + "CachesFilledOnTheirOwnLink::test_an_old_ini_read_never_publishes_its_joint_jog_facts_for_the_new_link"},
     {L + "CompletionsKeepTheirLink::test_unchanged_the_read_back_books_the_synched_values"}),
    ("7c16f5e9", "Fable's check of 7c16f5e9: the class (the head)",
     {L + "ClaimsOfAnEarlierLink::test_a_poll_that_read_no_link_proves_nothing",
      L + "CachesFilledOnTheirOwnLink::test_an_old_ini_read_never_publishes_its_kins_mode_commands_for_the_new_link",
      L + "TheSkipFlagClearOnAReplacedLink::test_cleared_on_a_replaced_link_the_flag_stays_unknown",
      L + "ReservedRowsOnlyOnATwpMachine::test_an_unread_declaration_does_not_spend_the_boot_check",
      "test_toolsetter_basis.py::TestBooking::test_values_done_on_a_replaced_link_are_unknown_not_applied"},
     {L + "TheSkipFlagClearOnAReplacedLink::test_cleared_on_its_own_link_the_flag_is_known",
      "test_toolsetter_basis.py::TestBooking::test_values_done_on_their_own_link_are_applied"}),
    ("f4ba0f31", "Fable's check of f4ba0f31: G30 confirmations, the viewer-init cache, the read-back's file refusal, the program open (the head)",
     {L + "TheG30ConfirmedReadKeepsItsLink::test_a_link_replaced_in_the_synchs_wait_confirms_nothing",
      L + "TheG30ConfirmedReadKeepsItsLink::test_a_link_replaced_at_the_last_file_read_confirms_nothing",
      L + "TheViewerInitCacheIsTheLinks::test_an_old_build_never_publishes_for_the_new_link",
      L + "TheViewerInitCacheIsTheLinks::test_a_link_change_clears_it_and_a_current_build_stores",
      L + "CompletionsKeepTheirLink::test_a_file_permission_error_is_the_files_and_keeps_the_latch",
      "test_command_dispatch.py::TestHandlerExecution::test_an_open_done_on_a_replaced_link_proves_nothing"},
     {L + "TheG30ConfirmedReadKeepsItsLink::test_unchanged_the_synched_values_are_confirmed",
      "test_command_dispatch.py::TestHandlerExecution::test_an_open_done_on_its_own_link_settles_the_reload"}),
]
head = subprocess.run(["git", "-C", str(WT), "rev-parse", "--short=8", "HEAD"], capture_output=True, text=True).stdout.strip()
lines, bad = [f"== red check at {head}"], 0
py = WT / "lcnc-gateway/.venv/bin/python"
with tempfile.TemporaryDirectory(dir="/tmp/claude-1000/-home-cnc-lcnc-suite/43040f88-3607-41a3-a5fe-dc80019b2257/scratchpad") as d:
    for rev, label, want_fail, want_pass in RUNS:
        t = Path(d) / "t"
        if t.exists():
            shutil.rmtree(t)
        shutil.copytree(WT / "lcnc-gateway", t / "lcnc-gateway", symlinks=True,
                        ignore=shutil.ignore_patterns("__pycache__", "runlogs"))
        for extra in ("typings", "pyrightconfig.json", "subroutines", "machine"):
            if (WT / extra).exists():
                (t / extra).symlink_to(WT / extra)
        old = subprocess.run(["git", "-C", str(WT), "show", f"{rev}:lcnc-gateway/gateway.py"],
                             capture_output=True, text=True, check=True).stdout
        (t / "lcnc-gateway/gateway.py").write_text(old)
        ids = sorted(want_fail | want_pass)
        junit = Path(d) / "junit.xml"
        subprocess.run([str(py), "-m", "pytest", "-p", "no:cacheprovider", "-o", "addopts=", "-q",
                        f"--junitxml={junit}", *ids],
                       cwd=t / "lcnc-gateway", capture_output=True, text=True, timeout=600,
                       env=dict(os.environ, LCNC_NO_BINDING="1"))
        import xml.etree.ElementTree as ET
        got, why = {}, {}
        for tc in ET.parse(junit).iter("testcase"):
            f = tc.get("file") or (tc.get("classname", "").split(".")[0] + ".py")
            cls = tc.get("classname", "").split(".")[-1]
            tid = f"{os.path.basename(f)}::{cls}::{tc.get('name')}"
            bad_el = tc.find("failure")
            if bad_el is None:
                bad_el = tc.find("error")
            got[tid] = "PASSED" if bad_el is None else ("FAILED" if bad_el.tag == "failure" else "ERROR")
            if bad_el is not None:
                why[tid] = (bad_el.get("message") or "").splitlines()[0][:110] if bad_el.get("message") else ""
        lines.append(f"-- {label}: gateway.py of {rev}, the head's tests")
        for i in ids:
            want = "FAILED" if i in want_fail else "PASSED"
            have = got.get(i, "MISSING")
            ok = have == want or (want == "FAILED" and have == "ERROR")
            bad += not ok
            lines.append(f"{'ok ' if ok else 'BAD'} {have:7} (want {want:6}) {i}")
            if have != "PASSED" and why.get(i):
                lines.append(f"      why: {why[i]}")
lines.append(f"{'ALL AS EXPECTED' if not bad else f'{bad} NOT AS EXPECTED'}")
OUT.write_text("\n".join(lines) + "\n")
print("\n".join(lines))
sys.exit(1 if bad else 0)
