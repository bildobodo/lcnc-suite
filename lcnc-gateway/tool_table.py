#!/usr/bin/env python3
"""Pure LinuxCNC tool.tbl + tool_library.json helpers (gateway modularization,
issue #33).

No ``linuxcnc`` or gateway-global coupling — these operate purely on file paths
and plain data — so they're unit-testable on a plain developer machine and the
gateway's tool-persistence logic lives in one place. Extracted verbatim from
gateway.py; behavior unchanged. The current-tool-table path (which reads STAT)
and the NML reload stay in gateway.py — only the format/merge logic moves here.
"""

import re

from gateway_util import atomic_write_bytes

#: every field a LinuxCNC tool line may carry, in its own order (the offsets
#: X–W, the diameter, the lathe's front/back angle and orientation) — read and
#: written back whole: the writer used to drop X/Y and the parser never read
#: the rest, so rewriting the table for one tool zeroed the others (Codex R321)
_TOOL_FIELDS = ("X", "Y", "Z", "A", "B", "C", "U", "V", "W", "D", "I", "J", "Q")
#: the integer fields (LinuxCNC reads them with %d); the rest are reals (%lf)
_TOOL_INT_FIELDS = ("T", "P", "Q")
_INT_RE = re.compile(r"[+-]?\d+\Z")
_REAL_RE = re.compile(r"[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?\Z")


class ToolTableUnreadable(ValueError):
    """A tool line this reader does not understand. A rewrite of the table
    would drop it, so every read-modify-write refuses instead (Codex R323
    FI-I50)."""


def parse_tool_line(data: str) -> dict:
    """The fields of one tool line's data part (its comment cut off), as
    LinuxCNC 2.9.4 reads them (tooldata_read_entry, libtooldata.so.0,
    disassembled 2026-11-06): fields separated by spaces, in ANY order, the
    letter case-insensitive, T/P/Q integers, the rest reals. LinuxCNC skips a
    whole line with a field it does not know; this reader is stricter and
    raises on anything it does not read exactly — a field that is not one
    letter and one number (a tab inside, a unit, junk after the number), an
    unknown or repeated letter, a line without T or P."""
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
            fields[letter] = int(value)
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


def parse_tool_table(path: str, strict: bool = False) -> list:
    """Parse a LinuxCNC tool.tbl file → list of dicts (T, P, X, Y, Z, D always
    — 0 when absent — and every other field the line carries, plus `remark`).

    A blank line and a comment line (`;` or `#` first) are no tool. A line
    `parse_tool_line` does not read is skipped — LinuxCNC skips it too — or,
    with `strict`, raises ToolTableUnreadable naming it: every path that
    reads the table to write it back reads strictly, so a line it would drop
    stops the write."""
    tools = []
    with open(path, "r") as f:
        for n, raw in enumerate(f, 1):
            line = raw.strip()
            if not line or line.startswith(";") or line.startswith("#"):
                continue
            data, _, remark = line.partition(";")
            try:
                fields = parse_tool_line(data.strip())
            except ToolTableUnreadable as e:
                if strict:
                    raise ToolTableUnreadable(f"Tool table line {n} not understood ({e}): {line}") from None
                continue
            tool = {"T": fields.pop("T"), "P": fields.pop("P"),
                    "X": fields.pop("X", 0.0), "Y": fields.pop("Y", 0.0),
                    "Z": fields.pop("Z", 0.0), "D": fields.pop("D", 0.0)}
            tool.update(fields)
            tool["remark"] = remark.strip()
            tools.append(tool)
    return tools


def _num(v: float, fixed: str) -> str:
    """The value as `fixed` formats it when that is exactly the value, else in
    full (a rewrite never rounds a value no one sent)."""
    v = float(v)
    text = format(v, fixed)
    return text if float(text) == v else format(v, "+")


def write_tool_table(path: str, tools: list):
    """Write tools to a LinuxCNC tool.tbl file atomically."""
    lines = [";Tool  Pocket Z Offset     Diameter     Remark\n"]
    for t in sorted(tools, key=lambda x: x["T"]):
        tn = t["T"]
        pn = t.get("P", tn)
        remark = t.get("remark", "")
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
        if remark:
            line += f"   ; {remark}"
        lines.append(line + "\n")
    atomic_write_bytes(path, "".join(lines).encode("utf-8"))


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
