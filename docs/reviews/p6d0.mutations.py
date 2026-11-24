"""P6-d0 red proofs (request R464, agreed by Codex R464): each mutation breaks ONE rule; its
named guard must fail AT that rule. Run from the tree's root; every file is restored
byte-identical. A vitest guard runs the unit file after `vue-tsc -b` proves the mutated
tree still builds; a pytest guard runs the gateway test; a browser guard (pw) rebuilds the
page with the mutation and runs its spec - under the heavy lock (the page is rebuilt from
the restored tree afterwards).

  python3 scripts/test_support/heavy_lock.py --who p6d0 -- python3 -I docs/reviews/p6d0.mutations.py [name ...]
"""
import json
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
WEB = "lcnc-webui/"
S = WEB + "src/"
GW = "lcnc-gateway/"
SPEC = "e2e/collisions.viewer.spec.ts"
UT_BASIS = "src/viewer/checkBasis.test.ts"
UT_WORDS = "src/viewer/scrubBarWords.test.ts"
PY_DISPATCH = "test_command_dispatch.py"


def pw(grep, at):
    """A browser guard: the page rebuilt with the mutation, the spec's test run."""
    return ("pw", [SPEC, grep, at])


def vt(file, name, at=None):
    """A unit guard: the file's test of that name (vitest -t)."""
    return ("vitest", [file, name, at or name])


def py(test, at=None):
    """A gateway guard: the test of that name (pytest -k)."""
    return ("pytest", [PY_DISPATCH, test, at or test])


RUNNING = "a running idle check when a run from line begins"
CLEAR = "a finished idle Clear does not carry into a run from line"
MARKS = "a run from line keeps the program"
ENTRY_TAIL = ("  _colDropEntry();\n  cancelCollisionCheck();\n  collisionResult.value = null;\n  collisionTrack.value = null;\n"
              "  collisionPrevious.value = null;\n  _colPendingTrack = null;\n")
MUTS = {
    # ---- the admission: only a PROVEN start from line 0 (checkBasis.admitRunCheck)
    "admission_without_the_start_line": (S + "viewer/checkBasis.ts", [(
        '  if (r.startLine == null) return { ok: false, why: "start line not proven" };\n'
        '  if (r.startLine !== 0) return { ok: false, why: `a run from line ${r.startLine} is not checked` };\n', "")],
        [vt(UT_BASIS, "only a run proven to start at line 0")]),
    # ---- the reader: a missing line is unknown, never 0
    "a_missing_line_read_as_0": (S + "runBasis.ts", [(
        "startLine: lineNo(r.start_line)", "startLine: lineNo(r.start_line ?? 0)")],
        [vt(UT_BASIS, "the start line: a finite, non-negative integer")]),
    # ---- G7: a step in the paused run from line N keeps N
    "a_paused_step_names_0": (GW + "gateway.py", [(
        '    if safe_get("interp_state", None) != linuxcnc.INTERP_IDLE:\n        return None\n    # The start\'s joints',
        '    if safe_get("interp_state", None) != linuxcnc.INTERP_IDLE:\n'
        '        if _run_basis is not None:\n            _run_basis["start_line"] = start_line\n'
        '        return None\n    # The start\'s joints')],
        [py("test_a_step_in_a_paused_run_from_line_keeps_its_line")]),
    # ---- the run's entry lets every owner of the earlier check go
    # (a) the finished / parked idle result is kept behind the words
    "the_idle_result_survives_the_entry": (S + "ThreeViewer.vue", [(
        ENTRY_TAIL, ENTRY_TAIL.replace("  collisionResult.value = null;\n  collisionTrack.value = null;\n", ""))],
        [pw(CLEAR, "the run's entry: no check job, no result")]),
    # (b) the entry does nothing at all: the defect at 6c78780c behind the display gate
    "the_entry_lets_nothing_go": (S + "ThreeViewer.vue", [(
        "watch(_runNotCheckedKey, (k, old) => { if (k && k !== old) _colEnterNotChecked(k); });\n",
        "watch(_runNotCheckedKey, (k, old) => { if (k && k !== old && !k) _colEnterNotChecked(k); });\n")],
        [pw(CLEAR, "the run's entry: no check job, no result")]),
    # (c) the running job keeps its id (no cancel): its late replies land
    "a_late_reply_lands_the_job_kept": (S + "ThreeViewer.vue", [(
        ENTRY_TAIL, ENTRY_TAIL.replace("  cancelCollisionCheck();\n",
                                       "  collisionBusy.value = false;\n  collisionResumable.value = false;\n"
                                       "  collisionStopped.value = null;\n  collisionPartial.value = null;\n"))],
        [pw(RUNNING, "no check job, no result")]),
    # (d) a superseded request's result is taken
    "a_late_reply_lands_superseded": (S + "ThreeViewer.vue", [(
        "      if (m.id !== _colReqId) return;  // superseded\n",
        "      if (m.id !== _colReqId && !m.result) return;  // superseded\n")],
        [pw(RUNNING, "a late reply: no check job, no result")]),
    # ---- the bar's override: no result branch speaks for the run (after Codex R464's
    # "overrides the old result branches"; the owner cleanup masks it in the browser)
    "the_bar_speaks_for_the_run": (S + "ScrubBar.vue", [(
        "  if (props.collisionRunNotChecked) return null;\n  const r = shownResult.value;\n", "  const r = shownResult.value;\n")],
        [vt(UT_WORDS, "a run the check does not cover overrides every result branch")]),
    # ---- what the operator SEES names it: words in the slot, nothing moves; without a track too
    "the_slot_shows_no_words": (S + "ScrubBar.vue", [(
        '<span class="notCheckedWords">not checked</span>', "")],
        [pw("desktop: the bar's slot", "the bar's words, no coverage figure")]),
    "the_words_move_the_bar": (S + "ScrubBar.vue", [(
        "width: min-content; white-space: normal; line-height: 1.1;", "line-height: 1.1;")],
        [pw("desktop: the bar's slot", "its box as in a run from 0")]),
    "without_a_track_nothing_is_named": (S + "SimPanel.vue", [(
        '      <div v-if="simView.notChecked" class="emptyState"><span class="text-warn">{{ notCheckedCard }}</span></div>\n', "")],
        [pw("a run from line without a preview", "without a preview: the Sim tab")]),
    # ---- the lock-out is the COLLISION check's only: the program's marks stay
    # (a) every timeline mark goes with the check
    "the_marks_go_with_the_check": (S + "ScrubBar.vue", [(
        "  if (max <= 0) return out;\n  const pctOfCum",
        "  if (max <= 0 || props.collisionRunNotChecked) return out;\n  const pctOfCum")],
        [pw(MARKS, "the limit marks")]),
    # (b) the limit and tool-change rows go with the check
    "the_rows_go_with_the_check": (S + "ScrubBar.vue", [(
        "(() => ({ clash: clashIndex.value, limit: violationTargets.value, tool: toolTargets.value }));",
        "(() => ({ clash: clashIndex.value, limit: props.collisionRunNotChecked ? [] : violationTargets.value,"
        " tool: props.collisionRunNotChecked ? [] : toolTargets.value }));")],
        [pw(MARKS, "the limit and tool-change rows stay")]),
}


def failures(text):
    lines = text.splitlines()
    return [" | ".join(x.strip() for x in lines[i:i + 3] if x.strip())[:300]
            for i, ln in enumerate(lines) if "AssertionError" in ln or "FAIL" in ln or "Error:" in ln]


def run_guard(kind, args):
    if kind == "vitest":
        t = subprocess.run(["npx", "vue-tsc", "-b"], cwd=ROOT / "lcnc-webui", capture_output=True, text=True, timeout=900)
        if t.returncode != 0:
            return False, "BUILD RED: " + t.stdout + t.stderr, args[2]
        r = subprocess.run(["npx", "vitest", "run", args[0], "-t", args[1]], cwd=ROOT / "lcnc-webui",
                           capture_output=True, text=True, timeout=900)
        return r.returncode != 0, r.stdout + r.stderr, args[2]
    if kind == "pytest":
        r = subprocess.run([str(ROOT / "lcnc-gateway/.venv/bin/python3"), "-m", "pytest", "-q", args[0], "-k", args[1]],
                           cwd=ROOT / "lcnc-gateway", capture_output=True, text=True, timeout=900)
        return r.returncode != 0, r.stdout + r.stderr, args[2]
    if kind == "pw":
        b = subprocess.run(["npm", "run", "build"], cwd=ROOT / "lcnc-webui", capture_output=True, text=True, timeout=900)
        if b.returncode != 0:
            return False, "BUILD RED: " + b.stdout + b.stderr, args[2]
        # never under a timeout: a killed runner orphans its web server (4173)
        r = subprocess.run(["npx", "playwright", "test", args[0], "-g", args[1], "--workers=1", "--reporter=list"],
                           cwd=ROOT / "lcnc-webui", capture_output=True, text=True)
        return r.returncode != 0, r.stdout + r.stderr, args[2]
    raise SystemExit(f"unknown guard kind {kind}")


FLAG = pathlib.Path.home() / "claude-work/live-tier/codex-review.flag"


def main(names):
    out = {}
    todo = names or list(MUTS)
    for k, name in enumerate(todo):
        if FLAG.exists():
            # a Codex review is under way: no heavy series beside it - stop, name what is left
            print(json.dumps({"stopped": "codex review flag", "left": todo[k:]}), flush=True)
            return 7
        path, reps, guards = MUTS[name]
        f = ROOT / path
        orig = f.read_bytes()
        text = orig.decode()
        try:
            for old, new in reps:
                if text.count(old) != 1:
                    raise SystemExit(f"{name}: anchor not unique in {path}: {old[:70]!r}")
                text = text.replace(old, new)
            f.write_text(text)
            results = [run_guard(k, a) for k, a in guards]
        finally:
            f.write_bytes(orig)
            if any(k == "pw" for k, _a in guards):
                # the page back to the tree's own build
                subprocess.run(["npm", "run", "build"], cwd=ROOT / "lcnc-webui", capture_output=True, timeout=900, check=True)
        red = all(r for r, _o, _a in results)
        at_rule = red and all(at in o for _r, o, at in results)
        out[name] = {"red": red, "at_rule": at_rule}
        print(json.dumps({"mutation": name, "red": red, "at_rule": at_rule,
                          "failures": [failures(o)[:3] for _r, o, _a in results]}), flush=True)
    print(json.dumps({"total": len(out), "red": sum(v["red"] for v in out.values()),
                      "red_at_rule": sum(v["at_rule"] for v in out.values())}))
    return 0 if all(v["at_rule"] for v in out.values()) else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
