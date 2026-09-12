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

_TOOL_TP_RE = re.compile(r"T(\d+)\s+P(\d+)")
_TOOL_FIELD_RE = re.compile(r"([XYZD])([+-]?[\d.]+)")

# Sidecar metadata fields kept in tool_library.json (beyond tool.tbl's T/P/Z/D).
_TOOL_META_FIELDS = (
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
        "tip_offset", "tip_length",
    ) if k in meta}


def parse_tool_table(path: str) -> list:
    """Parse a LinuxCNC tool.tbl file → list of dicts.

    Handles both column orders: Z before D and D before Z,
    since LinuxCNC may rewrite the file in either order.
    """
    tools = []
    with open(path, "r") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith(";") or line.startswith("#"):
                continue
            tp = _TOOL_TP_RE.match(line)
            if not tp:
                continue
            # Split off remark (everything after ';')
            remark = ""
            if ";" in line:
                data_part, remark = line.split(";", 1)
                remark = remark.strip()
            else:
                data_part = line
            # Extract X/Y/Z/D fields in any order
            fields = {m.group(1): float(m.group(2)) for m in _TOOL_FIELD_RE.finditer(data_part)}
            tools.append({
                "T": int(tp.group(1)),
                "P": int(tp.group(2)),
                "X": fields.get("X", 0.0),
                "Y": fields.get("Y", 0.0),
                "Z": fields.get("Z", 0.0),
                "D": fields.get("D", 0.0),
                "remark": remark,
            })
    return tools


def write_tool_table(path: str, tools: list):
    """Write tools to a LinuxCNC tool.tbl file atomically."""
    lines = [";Tool  Pocket Z Offset     Diameter     Remark\n"]
    for t in sorted(tools, key=lambda x: x["T"]):
        tn = t["T"]
        pn = t.get("P", tn)
        z = t.get("Z", 0.0)
        d = t.get("D", 0.0)
        remark = t.get("remark", "")
        line = f"T{tn:<5d} P{pn:<5d} Z{z:+013.6f}  D{d:+012.6f}"
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
