"""P6-e red proofs (plan maschinentag.r461 Rule E, Codex R461 MT461-01/-02 and its tolerance
decision): each mutation breaks ONE rule; its named guard must fail AT that rule. Run from
the tree's root; every file is restored byte-identical. A vitest guard runs the unit file
after `vue-tsc -b` proves the mutated tree still builds; a browser guard (pw) rebuilds the
page with the mutation and runs its spec - under the heavy lock (the page is rebuilt from
the restored tree afterwards).

  python3 scripts/test_support/heavy_lock.py --who p6e -- python3 -I docs/reviews/p6e.mutations.py [name ...]
"""
import json
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
WEB = "lcnc-webui/"
S = WEB + "src/"
HDR = S + "viewer/programToolHeader.ts"
CTX = S + "viewer/checkContext.ts"
SPEC = "e2e/program-header.viewer.spec.ts"
UT_HDR = "src/viewer/programToolHeader.test.ts"
UT_CTX = "src/viewer/checkContext.test.ts"


def pw(grep, at):
    """A browser guard: the page rebuilt with the mutation, the spec's test run."""
    return ("pw", [SPEC, grep, at])


def vt(file, name, at=None):
    """A unit guard: the file's named test (its name is where it fails)."""
    return ("vitest", [file, name, at or name])


MUTS = {
    # ---- MT461-01: the text bound to the shown check's publication
    # (1) the proven text's arrival is not watched: a header only from a text
    # already on the page when the context is taken
    "text_arrival_ignored": (S + "ThreeViewer.vue", [(
        "watch([collisionContext, colShown, gcodeShownText], () => {",
        "watch([collisionContext], () => {")],
        [pw("text delivered after the check ended", "the late text's header joins the card")]),
    # (2) V+1's text enriches V's card: a text binds to any context of its program
    "next_version_enriches_v": (CTX, [(
        "    else if (tk === k) next.set(k, scan(text!.text));",
        "    else if (tk != null && k.startsWith(text!.programId + \"\\u0000\")) next.set(k, scan(text!.text));")],
        [vt(UT_CTX, "text never enriches V's card — not by its program"),
         pw("V → V\\+1", "V's card: no header from V+1")]),
    # ---- MT461-02: the unit only from a literal unconditional G20/G21 in plain code
    # (3) the unit from any G20/G21 occurrence: control flow read as plain words
    # (R463: the O-word's refusal is now the allow-list's; the mutation reads an
    # O-word line as plain code, as before)
    "unit_from_any_occurrence": (HDR, [(
        "    const letter = m[1]!;\n",
        "    const letter = m[1]!;\n    if (letter === \"O\") return { kind: \"plain\", units: [], motion: false };\n")],
        [vt(UT_HDR, "a sub DEFINITION's G20 is no unit"),
         pw("an unproven unit", "the header named, not compared")]),
    # (3b) code the grammar cannot read is skipped instead of refused: the G20
    # inside a parameter name `#<g20>` is taken as a G-word
    "unreadable_code_skipped": (HDR, [(
        "    if (!m || m.index !== at) return { kind: \"unproven\" };\n",
        "    if (!m || m.index !== at) { WORD.lastIndex = at + 1; continue; }\n")],
        [vt(UT_HDR, "a G-word inside a parameter name is no G-word")]),
    # (4) a block-delete line's G20 counts
    "block_delete_runs": (HDR, [(
        "  if (del) return { kind: \"unproven\" };\n", "")],
        [vt(UT_HDR, "block delete")]),
    # (5) the scan runs past the first motion (a later G20 joins the unit)
    "scan_past_first_motion": (HDR, [(
        "      if (r.motion) { ended = true; break; }\n", "      if (r.motion) ended = true;\n")],
        [vt(UT_HDR, "ends with the first motion's line")]),
    # ---- Codex R463 MT-I34: only an allow-list of words passes
    # (R1) every M-word passes again (the first build)
    "m_words_passed": (HDR, [(
        "      if (!Number.isInteger(v) || !NEUTRAL_M.has(v)) return { kind: \"unproven\" };\n",
        "      if (!Number.isInteger(v) || (!NEUTRAL_M.has(v) && v < 0)) return { kind: \"unproven\" };\n")],
        [vt(UT_HDR, "R463 case A"), pw("R463 case A", "a call or a modal restore: the units not proven")]),
    # (R2) M98 on the list
    "m98_passed": (HDR, [(
        "const NEUTRAL_M = new Set([3, 4, 5, 7, 8, 9]);",
        "const NEUTRAL_M = new Set([3, 4, 5, 7, 8, 9, 98]);")],
        [vt(UT_HDR, "R463 case B"), pw("R463 case B", "a call or a modal restore: the units not proven")]),
    # (R3) T, S and F (remappable) taken as arguments
    "remappable_letters_passed": (HDR, [(
        "const ARG_LETTERS = new Set([\"N\", \"P\",",
        "const ARG_LETTERS = new Set([\"T\", \"S\", \"F\", \"N\", \"P\",")],
        [vt(UT_HDR, "the allow-list")]),
    # (R4) any G-code passes (an unallocated one may be a remap)
    "unknown_g_passed": (HDR, [(
        "      if (!MOTION_G.has(g) && !NEUTRAL_G.has(g)) return { kind: \"unproven\" };\n",
        "      if (!MOTION_G.has(g) && !NEUTRAL_G.has(g) && g < 0) return { kind: \"unproven\" };\n")],
        [vt(UT_HDR, "the allow-list")]),
    # ---- Codex R466 (MT-I34 rest): LinuxCNC executes Python comments
    # (P1) the Python form ignored
    "py_form_ignored": (HDR, [(
        "  if (cut == null || cut.exec) return { kind: \"unproven\" };\n",
        "  if (cut == null) return { kind: \"unproven\" };\n")],
        [vt(UT_HDR, "R466 executable comment — semicolon Python"), pw("R466", "an executable comment: the units not proven")]),
    # (P2) only lower case detected
    "py_only_lower_case": (HDR, [(
        "const EXEC_COMMENT = /^\\s*(?:py,|pyrun,|pyreload)/i;",
        "const EXEC_COMMENT = /^\\s*(?:py,|pyrun,|pyreload)/;")],
        [vt(UT_HDR, "R466 executable comment — Python case and leading spaces")]),
    # (P3) only the parenthesis form detected
    "py_only_paren_form": (HDR, [(
        "    if (ch === \";\") { if (EXEC_COMMENT.test(s.slice(i + 1))) exec = true; break; }\n",
        "    if (ch === \";\") break;\n")],
        [vt(UT_HDR, "R466 executable comment — semicolon Python"), pw("R466", "an executable comment: the units not proven")]),
    # (P4) the first motion's line not checked
    "py_first_motion_line_unchecked": (HDR, [
        ("  if (cut == null || cut.exec) return { kind: \"unproven\" };\n",
         "  if (cut == null) return { kind: \"unproven\" };\n"),
        ("  if (!c) return { kind: \"plain\", units: [], motion: false };\n",
         "  if (!c) return cut.exec ? { kind: \"unproven\" } : { kind: \"plain\", units: [], motion: false };\n"),
        ("  return { kind: \"plain\", units, motion };\n",
         "  return cut.exec && !motion ? { kind: \"unproven\" } : { kind: \"plain\", units, motion };\n")],
        [vt(UT_HDR, "the first motion line's executable comment counts too")]),
    # ---- the tolerance: 0.001 mm physical, converted (Codex R461 decided)
    # (6) the comparison's tolerance not converted for inch
    "tolerance_not_converted_for_inch": (HDR, [(
        "  const tol = mu === \"in\" ? HEADER_D_TOLERANCE_MM / MM_PER_IN : HEADER_D_TOLERANCE_MM;\n",
        "  const tol = mu === \"in\" ? HEADER_D_TOLERANCE_MM : HEADER_D_TOLERANCE_MM;\n")],
        [vt(UT_HDR, "inch header on an inch machine"), vt(UT_HDR, "mm header on an inch machine")]),
    # (7) the duplicates' spread not converted for an inch header
    "spread_not_converted_for_inch": (HDR, [(
        "  if (toMm(hi.value - lo.value, u) > HEADER_D_TOLERANCE_MM)",
        "  if (hi.value - lo.value > HEADER_D_TOLERANCE_MM && toMm(0, u) === 0)")],
        [vt(UT_HDR, "duplicates by the spread of ALL values")]),
    # ---- duplicates by the spread of ALL values
    # (8) a chain of pairwise near values merges (the order decides)
    "duplicates_spread_ignored": (HDR, [(
        "  if (toMm(hi.value - lo.value, u) > HEADER_D_TOLERANCE_MM)",
        "  if (mine.some((e, i) => i > 0 && toMm(Math.abs(e.value - mine[i - 1]!.value), u) > HEADER_D_TOLERANCE_MM))")],
        [vt(UT_HDR, "duplicates by the spread of ALL values")]),
    # ---- the card
    # (9) the comparison switched off
    "comparison_off": (CTX, [(
        "    const note = headerNote(compareHeaderD(o.header, t.num, t.diam, ctx.unit), ctx.unit);",
        "    const note = headerNote(compareHeaderD(null, t.num, t.diam, ctx.unit), ctx.unit);")],
        [pw("desktop: a header diameter that differs", "the tool's row names the header's diameter")]),
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
    if kind == "pw":
        b = subprocess.run(["npm", "run", "build"], cwd=ROOT / "lcnc-webui", capture_output=True, text=True, timeout=900)
        if b.returncode != 0:
            return False, "BUILD RED: " + b.stdout + b.stderr, args[2]
        # never under a timeout: a killed runner orphans its web server (4173)
        r = subprocess.run(["npx", "playwright", "test", args[0], "-g", args[1], "--workers=1", "--reporter=list"],
                           cwd=ROOT / "lcnc-webui", capture_output=True, text=True)
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
        built = not any(o.startswith("BUILD RED") for _r, o, _a in results)
        at_rule = red and built and all(at in o for _r, o, at in results)
        out[name] = {"red": red, "at_rule": at_rule}
        print(json.dumps({"mutation": name, "red": red, "build_green": built, "at_rule": at_rule,
                          "failures": [failures(o)[:3] for _r, o, _a in results]}), flush=True)
    print(json.dumps({"total": len(out), "red": sum(v["red"] for v in out.values()),
                      "red_at_rule": sum(v["at_rule"] for v in out.values())}))
    return 0 if all(v["at_rule"] for v in out.values()) else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
