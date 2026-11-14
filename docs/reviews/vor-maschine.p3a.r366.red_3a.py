#!/usr/bin/env python3
"""Red before the fix (package 3a): the new guards against the base 45727d61.

A detached worktree at the base gets the head's new test files; the imports
of helpers that exist only on the head are made tolerant (a missing name is
None, a missing gateway attribute is created by the patch), so each test
fails on BEHAVIOUR where the base allows it, never on an ImportError alone.
Every test's outcome and first error line go to the report; the expected red
set is named below and checked: a guard expected red that passes at the base
proves nothing, and fails this script.

    python3 red_3a.py <head-tree> <out.txt>
"""
import json
import re
import shutil
import subprocess
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

BASE = "45727d61"
HEAD_TREE = Path(sys.argv[1])
OUT = Path(sys.argv[2])
WORK = Path.home() / "claude-work/p3/red-base"
FILES = ["test_payload_contract.py", "test_payload_scan.py", "test_home_axis.py"]

# the guards that MUST be red at the base (a substring of the test id)
EXPECT_RED = [
    "test_the_table_covers_the_schema", "test_every_gated_command_has_an_entry", "test_an_unknown_command_is_refused",
    "test_each_required_field_refuses_missing_null_and_its_wrong_forms", "test_native_integer_ranges",
    "test_an_integer_past_2_53", "test_present_optional_and_nested_values_are_judged",
    "test_touchoff_expect_null_is_the_one_null_admitted", "test_clear_wcs_takes_all_reserved",
    "test_the_gateway_stop_set_is_the_policy_set",
    "test_every_required_field_fault_writes_nothing_and_books_nothing", "test_the_old_defaults_act_no_more",
    "test_estop_and_abort_with_a_bad_via_still_stop", "test_a_malformed_jog_stop_stops_every_booked_jog",
    "test_each_malformed_frame_keeps_the_socket", "test_only_the_current_trip_id_acknowledges_it",
    "test_false_strings_and_numbers_disarm",
    "test_backing_off_a_soft_limit_takes_the_joint_span", "test_teleop_not_reached_writes_no_jog",
    "test_a_mode_change_after_the_match_is_caught_at_the_write",
    "test_an_unknown_travel_closes_the_step",
    "test_the_gateway_holds_the_contract", "test_in_teleop_the_axis_span_and_the_canonical_axis",
    "test_a_single_sequence_homes_the_axis_joint", "test_unhome_has_no_group_rule",
    "test_the_shipped_profiles_send_what_they_sent",

    "test_a_group_is_refused_before_anything_is_written", "test_the_retired_joint_field_is_refused",
    "test_a_group_appearing_during_the_wait_sends_no_home",
]


PRELUDE = """import importlib.util as _ilu
def _head_module(name, path):
    _s = _ilu.spec_from_file_location(name, path)
    _m = _ilu.module_from_spec(_s)
    _s.loader.exec_module(_m)
    return _m
_HEAD_GU = _head_module("head_gateway_util", "<HEAD>/gateway_util.py")
_HEAD_CP = _head_module("head_command_policy", "<HEAD>/command_policy.py")
import command_policy as _base_cp
for _n in dir(_HEAD_CP):
    if not _n.startswith("__") and not hasattr(_base_cp, _n):
        setattr(_base_cp, _n, getattr(_HEAD_CP, _n))
"""


def sh(*a, **k):
    return subprocess.run(a, check=True, capture_output=True, text=True, **k)


def main():
    if WORK.exists():
        sh("git", "-C", str(HEAD_TREE), "worktree", "remove", "--force", str(WORK))
    sh("git", "-C", str(HEAD_TREE), "worktree", "add", "--detach", str(WORK), BASE)
    gw = WORK / "lcnc-gateway"
    (gw / ".venv").symlink_to((HEAD_TREE / "lcnc-gateway/.venv").resolve())
    prelude = PRELUDE.replace("<HEAD>", str(HEAD_TREE / "lcnc-gateway"))
    for f in FILES:
        text = (HEAD_TREE / "lcnc-gateway" / f).read_text()
        # the head-only NAMES (spec classes, constants, pure helpers) borrowed
        # from the head modules — the behaviour under test stays the base's
        text = text.replace("import command_policy as cp  # noqa: E402",
                            "import command_policy as cp  # noqa: E402\n" + prelude, 1)
        if "import command_policy as cp" not in text:
            text = text.replace("import gateway  # noqa: E402", "import gateway  # noqa: E402\n" + prelude, 1)
        # tolerant imports: a helper the base lacks becomes None
        text = re.sub(r"^from gateway_util import \(([^)]*)\)", lambda m: _tolerant(m.group(1)), text, flags=re.M | re.S)
        text = re.sub(r"^from gateway_util import ([^\n(]+?)(\s+# noqa: E402)?$", lambda m: _tolerant(m.group(1)), text,
                      flags=re.M)
        text = text.replace("linuxcnc.TRAJ_MODE_FREE", "getattr(linuxcnc, 'TRAJ_MODE_FREE', 1)")
        text = text.replace("unittest.mock.patch.object(gateway, \"_axis_joint_map\",",
                            "unittest.mock.patch.object(gateway, \"_axis_joint_map\", create=True, new=")
        text = text.replace("unittest.mock.patch.object(gateway, \"_home_sequences\",",
                            "unittest.mock.patch.object(gateway, \"_home_sequences\", create=True, new=")
        text = text.replace("unittest.mock.patch.object(gateway, \"_jog_mode_flag\",",
                            "unittest.mock.patch.object(gateway, \"_jog_mode_flag\", create=True, new=")
        (gw / f).write_text(text)
    xml = WORK / "red.xml"
    subprocess.run([str(gw / ".venv/bin/python3"), "-m", "pytest", "-q", "-p", "no:cacheprovider", f"--junitxml={xml}",
                    *FILES], cwd=gw, capture_output=True, text=True, timeout=1500)
    results = {}
    for case in ET.parse(xml).getroot().iter("testcase"):
        tid = f"{case.get('classname')}::{case.get('name')}"
        bad = case.find("failure") if case.find("failure") is not None else case.find("error")
        results[tid] = ("RED", (bad.get("message") or "").strip().splitlines()[0][:200]) if bad is not None else ("green", "")
    lines = [f"== red check at {BASE}: the head's package 3a guards ({', '.join(FILES)})"]
    missing = []
    for want in EXPECT_RED:
        hits = {t: r for t, r in results.items() if want in t}
        if not hits:
            missing.append(f"{want}: no such test")
            continue
        for t, (state, why) in sorted(hits.items()):
            lines.append(f"{state:5} {t} — {why}")
            if state != "RED":
                missing.append(f"{t}: expected red, green at the base")
    others = sorted(t for t in results if not any(w in t for w in EXPECT_RED))
    lines.append(f"-- not in the expected-red set ({len(others)}): their state at the base")
    lines += [f"{results[t][0]:5} {t}" for t in others]
    lines.append(f"== {sum(1 for w in EXPECT_RED for t in results if w in t and results[t][0] == 'RED')} expected-red "
                 f"tests red; problems: {missing or 'none'}")
    OUT.write_text("\n".join(lines) + "\n")
    print(lines[-1])
    sh("git", "-C", str(HEAD_TREE), "worktree", "remove", "--force", str(WORK))
    return 1 if missing else 0


def _tolerant(names: str) -> str:
    out = []
    names = re.sub(r"#[^\n]*", "", names)          # a trailing noqa inside the parentheses
    for n in [x.strip() for x in names.replace("\n", " ").split(",") if x.strip()]:
        if n:
            out.append(f"try:\n    from gateway_util import {n}\nexcept ImportError:\n    {n} = getattr(_HEAD_GU, {n!r})")
    return "\n".join(out)


if __name__ == "__main__":
    sys.exit(main())
