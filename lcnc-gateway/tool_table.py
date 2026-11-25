#!/usr/bin/env python3
"""Pure LinuxCNC tool.tbl + tool_library.json helpers (gateway modularization,
issue #33).

No ``linuxcnc`` or gateway-global coupling — these operate purely on file paths
and plain data — so they're unit-testable on a plain developer machine and the
gateway's tool-persistence logic lives in one place. Extracted verbatim from
gateway.py; behavior unchanged. The current-tool-table path (which reads STAT)
and the NML reload stay in gateway.py — only the format/merge logic moves here.
"""

import math
import re

from typing import Dict, Iterator, Optional, Tuple

from command_policy import TOOL_EDIT_FIELDS
from gateway_util import atomic_write_bytes

#: every field a LinuxCNC tool line may carry, in its own order (the offsets
#: X–W, the diameter, the lathe's front/back angle and orientation) — read and
#: written back whole: the writer used to drop X/Y and the parser never read
#: the rest, so rewriting the table for one tool zeroed the others (Codex R321)
_TOOL_FIELDS = ("X", "Y", "Z", "A", "B", "C", "U", "V", "W", "D", "I", "J", "Q")
#: the integer fields (LinuxCNC reads them with %d); the rest are reals (%lf)
_TOOL_INT_FIELDS = ("T", "P", "Q")
#: a whole number — also in the decimal form of a whole value (`+3.000000`:
#: this branch's own writer wrote Q so before it wrote `Q3`, Codex R324 FI-I54)
_INT_RE = re.compile(r"[+-]?\d+(?:\.0*)?\Z")
_REAL_RE = re.compile(r"[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?\Z")


class ToolTableUnreadable(ValueError):
    """A tool line this reader does not understand. A rewrite of the table
    would drop it, so every read-modify-write refuses instead (Codex R323
    FI-I50)."""


def parse_tool_line(data: str) -> dict:
    """The fields of one tool line's data part (its comment cut off), as
    LinuxCNC 2.9.4 reads them (tooldata_read_entry, libtooldata.so.0,
    disassembled 2026-11-06; v2.9.4 tooldata_common.cc): fields separated by
    spaces, in ANY order, the letter case-insensitive, T/P/Q integers (%d),
    the rest reals (%lf). LinuxCNC skips a whole line with a letter it does
    not know, and it reads a field's leading number and drops the rest
    (`Z1mm` is 1, `Q3.5` is 3). This reader takes only what it reads WHOLE:
    an integer field as a whole number, also written as a whole decimal
    (`Q+3.000000` is 3); anything else — a field that is not one letter and
    one number (a tab inside, a unit, junk after the number, a fraction in
    an integer field), an unknown or repeated letter, a line without T or P —
    raises, also where LinuxCNC would read a cut value."""
    fields: dict = {}
    for token in data.split(" "):
        if not token:
            continue
        letter, value = token[0].upper(), token[1:]
        if letter not in _TOOL_INT_FIELDS and letter not in _TOOL_FIELDS:
            raise ToolTableUnreadable(f"unknown field {token!r}")
        if letter in fields:
            raise ToolTableUnreadable(f"{letter} twice")
        if letter in _TOOL_INT_FIELDS:
            if not _INT_RE.match(value):
                raise ToolTableUnreadable(f"{token!r} is not {letter} and a whole number")
            fields[letter] = int(value.split(".")[0])
        else:
            if not _REAL_RE.match(value):
                raise ToolTableUnreadable(f"{token!r} is not {letter} and a number")
            fields[letter] = float(value)
    if "T" not in fields or "P" not in fields:
        raise ToolTableUnreadable("no T" if "T" not in fields else "no P")
    return fields


# Sidecar metadata fields kept in tool_library.json (beyond tool.tbl's T/P/Z/D).
_TOOL_META_FIELDS = (
    "is_example",
    "type", "description", "flutes", "oal", "flute_length", "shoulder_length",
    "shoulder_diameter", "corner_radius", "body_length", "shaft_diameter",
    "maximum_cutting_diameter", "upper_radius", "chamfer_width", "chamfer_angle",
    "lower_radius", "profile_radius", "axial_distance",
    "taper_angle", "point_angle", "tip_diameter", "material", "holder", "holder_segments",
    "assembly_gauge_length", "holder_gauge_length", "profile", "shaft_segments", "fusion_type",
    "tapered_type", "thread_pitch", "thread_pitch_min", "thread_pitch_max",
    "number_of_teeth", "thread_profile_angle", "thread_tip_type",
    "thread_tip_width", "thread_tip_radius",
    "tip_offset", "tip_length", "fusion_guid",
    "source_format", "source_id", "source_metadata", "source_z_min",
    "native_profile", "native_mesh", "geometry_note", "geometry_tolerance",
)


def tool_visual_metadata(meta: dict) -> dict:
    """Geometry sent to the viewer; measured offsets remain in status/tool.tbl."""
    return {k: meta[k] for k in (
        "type", "fusion_type", "oal", "flute_length", "shoulder_length",
        "shoulder_diameter", "body_length", "shaft_diameter", "shaft_segments",
        "taper_angle", "point_angle", "tip_diameter", "corner_radius",
        "maximum_cutting_diameter", "upper_radius", "chamfer_width", "chamfer_angle",
        "lower_radius", "profile_radius", "axial_distance",
        "holder_segments", "profile", "stl_file",
        "tapered_type", "thread_pitch", "thread_pitch_min", "thread_pitch_max",
        "number_of_teeth", "thread_profile_angle", "thread_tip_type",
        "thread_tip_width", "thread_tip_radius",
        "tip_offset", "tip_length", "source_format", "source_z_min",
        "native_profile", "native_mesh", "geometry_note", "geometry_tolerance",
    ) if k in meta}


def unread_line_tool(data: str) -> Optional[int]:
    """The tool number an UNREAD line names (P6 "tool files read", Codex
    R461): set only when the line's data part has exactly ONE token `T`
    and a whole number — else None, and such a line is never attached to a
    tool (a cut `T1` + `3 P13` must not become T1)."""
    found = [tok[1:] for tok in data.split(" ") if tok[:1] in ("T", "t") and _INT_RE.match(tok[1:])]
    return int(found[0].split(".")[0]) if len(found) == 1 else None


def parse_tool_table_bytes(data: bytes, strict: bool = False, unread: Optional[list] = None) -> list:
    """Parse a LinuxCNC tool.tbl's BYTES → list of dicts (T, P, X, Y, Z, D
    always — 0 when absent — and every other field the line carries, plus
    `remark`). THE parser: the file read (parse_tool_table) and rule R's read
    of one byte snapshot (tool_proof) take the same lines (P6 "tool files
    read").

    Lines end at `\\n`, `\\r\\n` or `\\r` (as a text-mode read took them);
    each line is UTF-8. A blank line and a comment line (`;` or `#` first)
    are no tool. A line `parse_tool_line` does not read whole — or that is
    not UTF-8 — is left out (LinuxCNC skips it only when it carries an
    unknown letter and may read it otherwise: a cut value), listed in
    `unread` as {line, T} (T: unread_line_tool), or, with `strict`, raises
    ToolTableUnreadable naming it: every path that reads the table to write
    it back reads strictly, so a line it would drop stops the write."""
    tools = []
    for n, raw_b in enumerate(data.replace(b"\r\n", b"\n").replace(b"\r", b"\n").split(b"\n"), 1):
        try:
            raw = raw_b.decode("utf-8")
            why = None
        except UnicodeDecodeError:
            raw = raw_b.decode("utf-8", errors="replace")
            why = "not UTF-8"
        line = raw.strip()
        if not line or line.startswith(";") or line.startswith("#"):
            continue
        part, _, remark = line.partition(";")
        try:
            if why is not None:
                raise ToolTableUnreadable(why)
            fields = parse_tool_line(part.strip())
        except ToolTableUnreadable as e:
            if strict:
                raise ToolTableUnreadable(f"Tool table line {n} not understood ({e}): {line}") from None
            if unread is not None:
                unread.append({"line": n, "T": unread_line_tool(part.strip())})
            continue
        tool = {"T": fields.pop("T"), "P": fields.pop("P"),
                "X": fields.pop("X", 0.0), "Y": fields.pop("Y", 0.0),
                "Z": fields.pop("Z", 0.0), "D": fields.pop("D", 0.0)}
        tool.update(fields)
        tool["remark"] = remark.strip()
        tools.append(tool)
    return tools


def parse_tool_table(path: str, strict: bool = False) -> list:
    """Parse a LinuxCNC tool.tbl file (parse_tool_table_bytes of its bytes)."""
    with open(path, "rb") as f:
        return parse_tool_table_bytes(f.read(), strict)


def _num(v: float, fixed: str) -> str:
    """The value as `fixed` formats it when that is exactly the value, else in
    full (a rewrite never rounds a value no one sent)."""
    v = float(v)
    text = format(v, fixed)
    return text if float(text) == v else format(v, "+")


class ToolTableUnwritable(ValueError):
    """A tool row whose line LinuxCNC would read as something else (its words
    name the tool, the cause and the way out). Nothing is shortened for it
    and nothing is written."""


def _tool_line(t: dict) -> bytes:
    """One tool's line as it stands in the file — ONE line for LinuxCNC's
    reader, whose integers LinuxCNC's hold — or ToolTableUnwritable (tool
    guard, Codex R476 answer 6 / MT476-03)."""
    tn = t["T"]
    pn = t.get("P", tn)
    remark = t.get("remark", "")
    if not _C_INT_MIN <= tn <= _C_INT_MAX:
        name = f"T{tn}" if len(str(tn)) <= 12 else "A tool number"
        raise ToolTableUnwritable(f"{name} is past LinuxCNC's integers — renumber it")
    for k, v in (("P", pn), ("Q", t.get("Q", 0))):
        if not _C_INT_MIN <= int(v) <= _C_INT_MAX:
            raise ToolTableUnwritable(f"T{tn}: {k} is past LinuxCNC's integers — correct it")
    for k in _TOOL_FIELDS:
        if k != "Q" and not math.isfinite(float(t.get(k, 0.0))):
            raise ToolTableUnwritable(f"T{tn}: {k} is not a finite number — correct it")
    if any(c in remark for c in "\n\r\0"):
        raise ToolTableUnwritable(f"T{tn}: line break or NUL in its description — remove it")
    line = f"T{tn:<5d} P{pn:<5d}"
    for k in _TOOL_FIELDS:
        if k == "Z":
            line += f" Z{_num(t.get('Z', 0.0), '+013.6f')}"
        elif k == "D":
            line += f"  D{_num(t.get('D', 0.0), '+012.6f')}"
        elif k == "Q":
            if k in t:
                line += f" Q{int(t[k])}"                 # an integer, as LinuxCNC reads it (%d)
        elif k in t and (k not in ("X", "Y") or t[k]):
            line += f" {k}{_num(t[k], '+.6f')}"      # X/Y written when not 0; the others as the line had them
    numbers = len(line) + 1
    if remark:
        line += f"   ; {remark}"
    try:
        data = (line + "\n").encode("utf-8")
    except UnicodeEncodeError:
        raise ToolTableUnwritable(f"T{tn}: description is not valid text — retype it") from None
    if len(data) > LINE_BYTES_MAX:
        raise ToolTableUnwritable(f"T{tn}: line too long for LinuxCNC — " + (
            "shorten its description" if numbers <= LINE_BYTES_MAX else "check its numbers"))
    return data


#: the writer's own comment line (the reader skips it)
_TABLE_HEAD = b";Tool  Pocket Z Offset     Diameter     Remark\n"


def tool_table_bytes(tools: list) -> bytes:
    """The whole file `tools` make, sorted by tool number — what a write is
    admitted on before it replaces anything — or ToolTableUnwritable."""
    return _TABLE_HEAD + b"".join(_tool_line(t) for t in sorted(tools, key=lambda x: x["T"]))


def write_tool_table(path: str, tools: list) -> bytes:
    """Write tools to a LinuxCNC tool.tbl file atomically; the bytes written
    (what LinuxCNC is then asked to load — the post-write wait proves them
    against its table, P6 "tool files read"). A row LinuxCNC would read as
    something else writes nothing (ToolTableUnwritable)."""
    data = tool_table_bytes(tools)
    atomic_write_bytes(path, data)
    return data


# ---- what LinuxCNC's own reader makes of a file's lines --------------------
# v2.9.4 tooldata_common.cc tooldata_load / tooldata_read_entry, nonrandom
# changer; pinned by the compiled upstream reader's output (test_tool_guard,
# docs/reviews/tg.golden.py). The parser above reads lines; LinuxCNC reads
# 255-byte pieces, splits them at spaces only and gives every `P` word it
# reads the next table index — also in a line it then skips: "#T3 P3 …" is no
# tool and takes one, ";T3 P3 …" takes none.

#: fgets(line, CANON_TOOL_ENTRY_LEN = 256): at most this many bytes of a line,
#: its line end included; what stands behind is a line of its own
LINE_BYTES_MAX = 255
#: CANON_POCKETS_MAX: the home entries are 1 … 1000
_INDEX_END = 1001
_C_INT_MIN, _C_INT_MAX = -2 ** 31, 2 ** 31 - 1
#: sscanf's %d / %lf on a token's rest: the leading number, whatever follows
_C_INT_RE = re.compile(rb"[ \t\n\v\f\r]*([+-]?[0-9]+)")
_C_REAL_RE = re.compile(rb"[ \t\n\v\f\r]*[+-]?(?:[0-9]+\.?[0-9]*|\.[0-9]+)")
#: number forms %lf also takes (hexadecimal, inf, nan) — not mirrored
_C_REAL_OTHER_RE = re.compile(rb"[ \t\n\v\f\r]*[+-]?(?:0[xX]|[iI][nN]|[nN][aA])")


def _c_int(text: bytes) -> Optional[int]:
    """sscanf(text, "%d"): strtol's saturated long, cut to an int."""
    m = _C_INT_RE.match(text)
    if m is None:
        return None
    v = max(-2 ** 63, min(2 ** 63 - 1, int(m.group(1))))
    return (v + 2 ** 31) % 2 ** 32 - 2 ** 31


def _fgets_lines(data: bytes) -> Iterator[Tuple[int, bytes]]:
    """(line number, the piece fgets reads) — a long line is several."""
    at, n = 0, 1
    while at < len(data):
        nl = data.find(b"\n", at, at + LINE_BYTES_MAX)
        end = nl + 1 if nl >= 0 else min(at + LINE_BYTES_MAX, len(data))
        yield n, data[at:end]
        n += nl >= 0
        at = end


def home_tools(data: bytes) -> Dict[int, Tuple[int, int]]:
    """{table index: (T, P)} of the home entries LinuxCNC holds after it
    loaded a file of these bytes (a nonrandom changer, no tool database). A
    line this does not mirror (a NUL byte; a number in a form the suite never
    writes) raises ToolTableUnreadable naming it: unknown, never guessed."""
    out: Dict[int, Tuple[int, int]] = {}
    free = 1
    for n, piece in _fgets_lines(data):
        if free == _INDEX_END:
            break                                   # every index is taken: no later line holds one
        if b"\0" in piece:
            raise ToolTableUnreadable(f"Line {n} not readable — fix it in an editor")
        if piece.startswith(b";"):
            continue
        part = piece.lstrip(b";").split(b";", 1)[0]
        if len(part) <= 1:
            continue
        tool, index, pocket, valid = -1, 0, 0, True
        for token in part.split(b" "):
            if not token:
                continue
            letter, rest = token[:1].upper(), token[1:]
            if letter in (b"T", b"P", b"Q"):
                v = _c_int(rest)
                if v is None:
                    valid = False
                elif letter == b"T":
                    tool = v
                elif letter == b"P":
                    pocket = v
                    if free < _INDEX_END:
                        index, free = free, free + 1
                    else:                           # "Out-of-range nonrandom_idx"
                        valid = False
            elif letter in b"DXYZABCUVWIJ":
                if _C_REAL_OTHER_RE.match(rest):
                    raise ToolTableUnreadable(f"Line {n} not readable — fix it in an editor")
                if _C_REAL_RE.match(rest) is None:
                    valid = False
            elif not token.startswith(b"\n"):
                valid = False
        if valid and index > 0 and tool != -1:      # (index 0 is the spindle's; T-1 is LinuxCNC's "no tool")
            out[index] = (tool, pocket)
    return out


def _merge_tool_data(tbl_tools: list, library: dict) -> list:
    """Merge tool.tbl entries with metadata from tool_library.json."""
    merged = []
    for t in tbl_tools:
        key = str(t["T"])
        meta = library.get(key, {})
        entry = {
            "T": t["T"],
            "P": t["P"],
            "Z": t["Z"],
            "D": t["D"],
            "remark": t.get("remark", ""),
        }
        for field in _TOOL_META_FIELDS:
            if field == "description":
                entry[field] = meta.get("description", t.get("remark", ""))
            elif field == "type":
                entry[field] = meta.get("type", "")
            else:
                entry[field] = meta.get(field)
        merged.append(entry)
    return merged


def tool_row_conflict(expected: dict, identity: dict, rows: list, library: dict, tool: int) -> Optional[list]:
    """What differs between the row state a tool edit was opened on
    (`expected`, command_policy.ToolRowExpect — already shape-checked) and
    the table read NOW: None = the same; else the names — "table" (another
    table or LinuxCNC instance), "tool" (another number than the edit
    addresses), "gone" (the row is no longer there), or each field of
    TOOL_EDIT_FIELDS whose value changed (P4-2, Codex MT433-01). Pure."""
    if expected.get("table") != identity:
        return ["table"]
    if expected.get("tool") != tool:
        return ["tool"]
    row = next((r for r in _merge_tool_data(rows, library) if r["T"] == tool), None)
    if row is None:
        return ["gone"]
    fields = expected.get("fields") or {}
    changed = [f for f in TOOL_EDIT_FIELDS if row.get(f) != fields.get(f)]
    return changed or None
