"""The bundled tool_touch_off.ngc runs in the preview too (M600 in the
preview, Codex R102–R104). Its task path must stay what it was: compared
here with the routine before the preview branch
(scripts/test_fixtures/tool_touch_off.before_preview.ngc) as a CONTROL
STRUCTURE — a tree of o-word blocks (sub, if/elseif/else, do/while,
return, call) and statements — after both are specialised for
`#<_task> = 1`. A block guarded by `[#<_task> EQ 1]` is unwrapped, one
guarded by `[#<_task> EQ 0]` (or its else) dropped; every other condition
stays as written. Comments are no statements (the preview markers are
comments).

The preview path (`#<_task> = 0`) must reach none of what a preview cannot
reproduce: no probe (G38), no M00/M01, no M50, no log file.
"""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
NEW = ROOT / "subroutines" / "tool_length_probe" / "tool_touch_off.ngc"
OLD = ROOT / "scripts" / "test_fixtures" / "tool_touch_off.before_preview.ngc"

_OWORD = re.compile(r"^O(<[^>]*>|\d+)(SUB|ENDSUB|IF|ELSEIF|ELSE|ENDIF|DO|WHILE|ENDWHILE|"
                    r"REPEAT|ENDREPEAT|RETURN|CALL|BREAK|CONTINUE)(.*)$")


def _lines(text):
    """Each non-empty block, normalised: the `;` comment out, whitespace
    out, upper case (parenthesised comments stay for the caller)."""
    for raw in text.splitlines():
        line = re.sub(r"\s+", "", raw.split(";", 1)[0]).upper()
        if line and line != "%":
            yield line


def _tree(text, comments=False):
    """[node]: ("stmt", text) | ("if", label, [(cond|None, [node])]) |
    ("do", label, [node], cond) | ("while", label, cond, [node]) |
    ("sub", label, [node]) | ("oword", label, kw, rest). Parenthesised
    comments are no statements unless `comments`."""
    lines = list(_lines(text))
    pos = 0

    def block(end_kws):
        nonlocal pos
        out = []
        while pos < len(lines):
            line = lines[pos]
            m = _OWORD.match(line)
            if m and m.group(2) in end_kws:
                return out, m
            pos += 1
            if not m:
                stmt = line if comments else re.sub(r"\([^)]*\)", "", line)
                if stmt:
                    out.append(("stmt", stmt))
                continue
            label, kw, rest = m.group(1), m.group(2), m.group(3)
            if kw == "IF":
                branches = []
                cond = rest
                while True:
                    body, end = block(("ELSEIF", "ELSE", "ENDIF"))
                    assert end is not None and end.group(1) == label, (label, end)
                    branches.append((cond, body))
                    pos += 1
                    if end.group(2) == "ENDIF":
                        break
                    cond = end.group(3) if end.group(2) == "ELSEIF" else None
                out.append(("if", label, branches))
            elif kw == "DO":
                body, end = block(("WHILE",))
                assert end is not None and end.group(1) == label
                pos += 1
                out.append(("do", label, body, end.group(3)))
            elif kw == "WHILE":
                body, end = block(("ENDWHILE",))
                assert end is not None and end.group(1) == label
                pos += 1
                out.append(("while", label, rest, body))
            elif kw == "SUB":
                body, end = block(("ENDSUB",))
                assert end is not None and end.group(1) == label
                pos += 1
                out.append(("sub", label, body))
            else:
                out.append(("oword", label, kw, rest))
        return out, None

    tree, end = block(())
    assert end is None and pos == len(lines)
    return tree


_TASK_EQ = re.compile(r"^\[#<_TASK>EQ([01])\]$")
_AND_TASK1 = re.compile(r"^\[(.*)AND#<_TASK>EQ1\]$")


def _truth(cond, task):
    """True / False where the condition is decided by #<_task> alone, else None."""
    m = _TASK_EQ.match(cond)
    if m:
        return int(m.group(1)) == task
    if task == 0 and _AND_TASK1.match(cond):
        return False
    return None


def _specialise(nodes, task):
    out = []
    for n in nodes:
        if n[0] == "if":
            kept = []
            for cond, body in n[2]:
                t = True if cond is None else _truth(cond, task)
                if t is False:
                    continue
                kept.append((None if t else cond, _specialise(body, task)))
                if t:
                    break
            if len(kept) == 1 and kept[0][0] is None:
                out.extend(kept[0][1])          # decided (or only an else left): the branch alone
            elif kept:
                out.append(("if", n[1], kept))
        elif n[0] == "do":
            out.append(("do", n[1], _specialise(n[2], task), n[3]))
        elif n[0] == "while":
            out.append(("while", n[1], n[2], _specialise(n[3], task)))
        elif n[0] == "sub":
            out.append(("sub", n[1], _specialise(n[2], task)))
        else:
            out.append(n)
    return out


def _flat(nodes):
    for n in nodes:
        if n[0] == "stmt":
            yield n[1]
        elif n[0] == "if":
            for _, body in n[2]:
                yield from _flat(body)
        elif n[0] in ("do", "sub"):
            yield from _flat(n[2])
        elif n[0] == "while":
            yield from _flat(n[3])
        else:
            yield f"O{n[1]}{n[2]}{n[3]}"


def test_task_path_is_the_routine_before_the_preview_branch():
    old = _specialise(_tree(OLD.read_text(encoding="utf-8")), 1)
    new = _specialise(_tree(NEW.read_text(encoding="utf-8")), 1)
    assert new == old


def test_the_preview_path_reaches_no_probe_no_pause_no_m50_no_log():
    preview = list(_flat(_specialise(_tree(NEW.read_text(encoding="utf-8")), 0)))
    assert not [s for s in preview if re.search(r"G38", s)]
    assert not [s for s in preview if re.search(r"M0*[01](?!\d)|M50", s)]
    with_comments = list(_flat(_specialise(_tree(NEW.read_text(encoding="utf-8"), comments=True), 0)))
    assert not [s for s in with_comments if "(LOGOPEN" in s]
    # ... while the task path opens it as before
    task = list(_flat(_specialise(_tree(NEW.read_text(encoding="utf-8"), comments=True), 1)))
    assert [s for s in task if "(LOGOPEN" in s]


def test_the_preview_path_moves_to_the_trip_and_marks_what_it_cannot_predict():
    preview = list(_flat(_specialise(_tree(NEW.read_text(encoding="utf-8")), 0)))
    assert "G1F#<FAST_PROBE_FR>Z-[#<PROBE_START_POS_Z>-#<PREVIEW_TRIP_Z>]" in preview
    assert "G1F#<SLOW_PROBE_FR>Z-[#<RETRACT_DISTANCE>]" in preview
    assert preview.count("#5070=1") == 2


def test_the_comparison_sees_a_changed_task_path():
    """The comparison itself: a guard on the task side turned into a preview
    guard, and one statement dropped from the task path, are both found."""
    new_text = NEW.read_text(encoding="utf-8")
    old = _specialise(_tree(OLD.read_text(encoding="utf-8")), 1)
    swapped = new_text.replace("o<501> if [#<_task> EQ 1]", "o<501> if [#<_task> EQ 0]", 1)
    assert swapped != new_text
    assert _specialise(_tree(swapped), 1) != old
    dropped = new_text.replace("  G38.3 Z-[#<z_max_travel>]    (fast tool probe)\n", "", 1)
    assert dropped != new_text
    assert _specialise(_tree(dropped), 1) != old


_AXIS_XY = re.compile(r"(?<![A-Z])[XY](?=[-+\[#0-9.])")


def _motion_words(stmt):
    """The statement without its parameter names (#<...>) — what is left
    names the words it carries."""
    return re.sub(r"#<[^>]*>", "#", stmt)


def test_only_z_moves_inside_the_braking_range():
    """The braking range (docs/reviews/parity-ef.plan.md F2) is a hull on the
    probe axis at a fixed X/Y: from the trip point to the band's end the
    routine moves only Z — in the preview path between its markers, and in
    the task path from the fast probe to the drive-free G53 Z0."""
    preview = list(_flat(_specialise(_tree(NEW.read_text(encoding="utf-8"), comments=True), 0)))
    starts = [i for i, s in enumerate(preview) if "(WEBUI_PROBE_BAND)" in s]
    ends = [i for i, s in enumerate(preview) if "(WEBUI_PROBE_BAND_END)" in s]
    assert len(starts) == 1 and len(ends) == 1 and starts[0] < ends[0]
    inside = [s for s in preview[starts[0] + 1:ends[0]] if _AXIS_XY.search(_motion_words(s))]
    assert inside == [], inside
    # the first move after the range rises to machine Z0 (the top): every pose
    # on it is one a machine that stopped lower passes too — the sweep takes
    # the poses past the range's end vertex as real (Codex R126 VP-I74)
    motion = re.compile(r"^(G53)?G[0-3](?![0-9.])|^G38")
    after = [s for s in preview[ends[0] + 1:] if motion.search(s)]
    assert re.sub(r"\([^)]*\)", "", after[0]) == "G53G1F#<TRAVERSE_FR>Z0", after[:2]
    task = list(_flat(_specialise(_tree(NEW.read_text(encoding="utf-8")), 1)))
    a = next(i for i, s in enumerate(task) if s.startswith("G38.3"))
    b = max(i for i, s in enumerate(task) if s == "G53G1F#<TRAVERSE_FR>Z0")
    assert a < b
    moved = [s for s in task[a:b] if _AXIS_XY.search(_motion_words(s))]
    assert moved == [], moved


def test_the_probes_follow_a_collinear_move_or_a_reversal():
    """The braking model's half acceleration holds with no kink reduction
    (tp.c tpSetupTangent): the fast probe follows the straight G53 Z move to
    its start, the slow one the retract up — a reversal, an exact stop."""
    task = list(_flat(_specialise(_tree(NEW.read_text(encoding="utf-8")), 1)))
    motion = re.compile(r"^(G53)?G[0-3](?![0-9.])|^G38|^G1F")
    fast = next(i for i, s in enumerate(task) if s.startswith("G38.3"))
    before = [s for s in task[:fast] if motion.search(s)]
    assert before[-1] == "G53G1F#<TRAVERSE_FR>Z#<PROBE_START_POS_Z>", before[-1]
    slow = next(i for i, s in enumerate(task) if s.startswith("G38.2"))
    between = [s for s in task[fast + 1:slow] if motion.search(s)]
    assert between == ["G1F#<TRAVERSE_FR>Z[#<RETRACT_DISTANCE>]"], between


def test_the_preview_brakes_past_the_trip_point_and_climbs_back():
    preview = list(_flat(_specialise(_tree(NEW.read_text(encoding="utf-8")), 0)))
    assert preview.count("G1Z-[#<PV_H_FAST>]") == 1 and preview.count("G1Z[#<PV_H_FAST>]") == 1
    assert preview.count("G1Z-[#<PV_H_SLOW>]") == 1 and preview.count("G1Z[#<PV_H_SLOW>]") == 1
    # the probe results are set at P, before the brake leg
    i = preview.index("G1Z-[#<PV_H_FAST>]")
    assert "#5070=1" in preview[i - 3:i]
