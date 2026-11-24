"""P6-b red proofs (plan maschinentag.r456.p6-plan-v2 F11/F10, agreed by Codex R456): each
mutation breaks ONE rule; its named guard must fail AT that rule. Run from the tree's root;
every file is restored byte-identical. Every guard is a browser guard (pw): the page is
rebuilt with the mutation and its spec run - under the heavy lock (the page is rebuilt
from the restored tree afterwards). Each mutation keeps the build green (an unused
function fails vue-tsc and the old page would be tested).

  python3 scripts/test_support/heavy_lock.py --who p6b -- python3 -I docs/reviews/p6b.mutations.py [name ...]
"""
import json
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
WEB = "lcnc-webui/"
S = WEB + "src/"
SPEC = "e2e/scrub-start.viewer.spec.ts"


def pw(grep, at, spec=SPEC):
    """A browser guard: the page rebuilt with the mutation, its spec run."""
    return ("pw", [spec, grep, at])


START = "desktop: the start"
# Back to start's and Play's buttons as the template writes them (the
# position mutation swaps the two)
BACK_BTN = ("      <MachineBtn type=\"scrub\" class=\"iconBtn\" :disabled=\"!simulationOn || (!simMode && !machineOff)\"\n"
            "                  :reason=\"!simulationOn ? DEVICE_SIM_OFF : undefined\"\n"
            "                  aria-label=\"Back to start\" title=\"Back to start\"\n"
            "                  @click=\"backToStart\">\n"
            "        <SkipBack :size=\"14\" />\n"
            "      </MachineBtn>\n")
PLAY_BTN = ("      <MachineBtn type=\"scrub\" class=\"iconBtn\" :disabled=\"!simulationOn || (!simMode && !machineOff)\"\n"
            "                  :reason=\"!simulationOn ? DEVICE_SIM_OFF : undefined\"\n"
            "                  :title=\"playing ? 'Pause playback' : 'Play the program through the machine model'\"\n"
            "                  @click=\"togglePlay\">\n"
            "        <Pause v-if=\"playing\" :size=\"14\" />\n"
            "        <Play v-else :size=\"14\" />\n"
            "      </MachineBtn>\n")
MUTS = {
    # ---- F11: the start state, explicit, ScrubBar -> ThreeViewer -> App -> GcodePanel
    "the_panel_ignores_the_start": (S + "GcodePanel.vue", [(
        "watch(() => props.scrubStart, (start) => {\n  if (start != null && !editing.value) showProgramStart();\n});\n", "")],
        [pw(START, "middle → 0 (timeline): the program's top")]),
    "the_start_for_every_null": (S + "ScrubBar.vue", [(
        "  const atStart = !curAtEnd.value && t === entryTrack.value && _sample.index === 0;",
        "  const atStart = (curAtEnd.value ? (endLine.value ?? null) : disp.line) == null;")],
        [pw("counter-controls: a null line", "the view stays at the middle")]),
    # (first run: GREEN with the first move on line 2 — the top shows it anyway,
    # visibly equivalent; the guard's program now has its first move on line 302)
    "the_start_on_every_track": (S + "ScrubBar.vue", [(
        "  const atStart = !curAtEnd.value && t === entryTrack.value && _sample.index === 0;",
        "  const atStart = !curAtEnd.value && _sample.index === 0;")],
        [pw("a track without an entry move", "position 0: the first point's line marked and in view")]),
    # (first run, `scrollToRow(0)` in the start's watcher: GREEN — equivalent:
    # the watcher of "no line followed", created before it, clears the followed
    # row first, so a step to the top has no highlight to start from and snaps.
    # The glide that can happen: a scroll the browser animates.)
    "the_start_glides": (S + "GcodePanel.vue", [(
        "  _followedRows = null;\n  setScroll(0);\n}\n",
        "  _followedRows = null;\n  codeViewerRef.value?.scrollTo({ top: 0, behavior: \"smooth\" });\n}\n")],
        [pw(START, "a snap — every frame at the top")]),
    "the_hidden_pane_not_reapplied": (S + "GcodePanel.vue", [(
        "  else if (!(was > 0) && props.scrubStart != null && !editing.value) showProgramStart();\n",
        "  else if (!(was > 0) && props.scrubStart != null && !editing.value && false) showProgramStart();\n")],
        [pw("Sim tab open", "the Program tab at the top")]),
    "the_height_change_pulls_back": (S + "GcodePanel.vue", [(
        "  else if (!(was > 0) && props.scrubStart != null && !editing.value) showProgramStart();\n",
        "  else if (was === was && props.scrubStart != null && !editing.value) showProgramStart();\n")],
        [pw("Sim tab open", "a height change keeps the scroll by hand")]),
    # ---- F10: Back to start
    "back_without_the_position": (S + "ScrubBar.vue", [(
        "  _startAsked = true;\n  sPos.value = 0;\n  applyPos();\n", "  _startAsked = true;\n  applyPos();\n")],
        [pw(START, "middle → Back to start: the program's top")]),
    "back_swallowed_at_zero": (S + "ScrubBar.vue", [(
        "  _startAsked = true;\n  sPos.value = 0;\n  applyPos();\n", "  sPos.value = 0;\n  applyPos();\n")],
        [pw(START, "Back to start again at 0: the program's top")]),
    "back_relies_on_the_watcher": (S + "ScrubBar.vue", [(
        "  _startAsked = true;\n  sPos.value = 0;\n  applyPos();\n", "  _startAsked = true;\n  sPos.value = 0;\n")],
        [pw(START, "Back to start again at 0: the program's top")]),
    "back_open_in_a_run": (S + "ScrubBar.vue", [(
        '      <MachineBtn type="scrub" class="iconBtn" :disabled="!simulationOn || (!simMode && !machineOff)"\n'
        '                  :reason="!simulationOn ? DEVICE_SIM_OFF : undefined"\n'
        '                  aria-label="Back to start"',
        '      <MachineBtn type="scrub" class="iconBtn" :disabled="!simulationOn"\n'
        '                  :reason="!simulationOn ? DEVICE_SIM_OFF : undefined"\n'
        '                  aria-label="Back to start"')],
        [pw("never begins a simulation in a run", "in a run Back to start is dimmed like Play")]),
    "back_bypasses_the_entry": (S + "ScrubBar.vue", [(
        "function backToStart() {\n  if (!enterSim()) return;\n",
        "function backToStart() {\n  if (!enterSim()) simMode.value = true;\n")],
        [pw("never begins a simulation in a run", "an entry refused: no simulation")]),
    # (P6-b round 2, the coordinator 2026-11-24: Back to start LEFT of Play,
    # the speed directly beside Play) - the order as first built
    "back_right_of_play": (S + "ScrubBar.vue", [(
        BACK_BTN + PLAY_BTN, PLAY_BTN + BACK_BTN)],
        [pw("every bar form", "Back to start directly left of Play")]),
    "the_link_beside_back": (S + "ScrubBar.vue", [(
        "  .simTabLink { display: none; }\n", "  .simTabLink { order: 1; margin-left: auto; }\n")],
        [pw("every bar form", "the link only in one row")]),
}


def failures(text):
    lines = text.splitlines()
    return [" | ".join(x.strip() for x in lines[i:i + 3] if x.strip())[:300]
            for i, ln in enumerate(lines) if "AssertionError" in ln or "FAIL" in ln or "Error:" in ln]


def run_guard(kind, args):
    if kind == "pw":
        b = subprocess.run(["npm", "run", "build"], cwd=ROOT / "lcnc-webui", capture_output=True, text=True, timeout=900)
        if b.returncode != 0:
            return False, b.stdout + b.stderr, args[2]
        r = subprocess.run(["npx", "playwright", "test", args[0], "-g", args[1], "--workers=1", "--reporter=list"],
                           cwd=ROOT / "lcnc-webui", capture_output=True, text=True, timeout=1800)
        return r.returncode != 0, r.stdout + r.stderr, args[2]
    raise SystemExit(f"unknown guard kind {kind}")


def main(names):
    out = {}
    for name in names or list(MUTS):
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
