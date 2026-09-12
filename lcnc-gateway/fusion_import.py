#!/usr/bin/env python3
"""Fusion 360 tool-library import — pure decode + transform (+ subprocess worker).

Extracted from gateway.py after the perf-matrix harness PROVED the in-thread
path trips the HAL watchdog at the size cap: decode+transform of a near-16 MB
library measured 243 ms of GIL-held CPU (plus the GC pressure of ~60k fresh
dicts) — a thread cannot isolate that from the event loop (offload principle #3:
confirmed GIL-bound CPU goes to a SUBPROCESS, the gcode-worker pattern).

Dual-use file:
- imported by gateway.py for small blobs (<= ~1 MiB, ~15 ms — thread is fine)
- executed as a subprocess worker for large blobs:
    stdin : msgpack {"raw": bytes, "unit": "mm"|"in"}
    stdout: msgpack {"parsed": [...], "skipped": [...]}
    rc 4  : invalid library (message on stderr -> HTTP 400)
    rc !=0: internal failure (stderr tail -> HTTP 500)

Pure: imports NOTHING machine-coupled, so it runs under pytest and as a bare
venv subprocess.
"""
import json
import sys
from typing import Optional

FUSION_TYPE_MAP = {
    "flat end mill": "endmill",
    "ball end mill": "ball",
    "bull nose end mill": "bullnose",
    "chamfer mill": "chamfer",
    "corner chamfer end mill": "cornerchamfer",
    "circle segment barrel": "circlebarrel",
    "circle segment lens": "circlelens",
    "circle segment oval": "circleoval",
    "circle segment taper": "circletaper",
    "drill": "drill",
    "block drill": "blockdrill",
    "spot drill": "drill",
    "counter bore": "endmill",
    "reamer": "endmill",
    "boring bar": "endmill",
    "center drill": "centerdrill",
    "counter sink": "countersink",
    "dovetail mill": "dovetail",
    "face mill": "facemill",
    "lollipop mill": "lollipop",
    "slot mill": "slotmill",
    "thread mill": "threadmill",
    "form mill": "formmill",
    "radius mill": "radiusmill",
    "tapered mill": "tapered",
    "probe": "probe",
    "tap right hand": "tap",
    "tap left hand": "tap",
    "engraving cutter": "engraver",
}


def _fusion_unit_scale(src: Optional[str], machine_unit: str) -> float:
    """Multiplier to convert a Fusion `unit` field value to machine native units.
    Fusion writes "millimeters" or "inches"; default to mm if missing/unknown.
    """
    src_mm = not (src or "millimeters").lower().startswith("in")
    machine_mm = machine_unit == "mm"
    if src_mm == machine_mm:
        return 1.0
    return 25.4 if (not src_mm and machine_mm) else (1.0 / 25.4)


def _opt_scale(v, scale: float):
    return None if v is None else v * scale


def parse_fusion_library(data: dict, machine_unit: str) -> tuple[list, list]:
    """Parse a Fusion 360 Library.json → (tools, skipped_duplicates).

    Tools with duplicate numbers are excluded from the main list and returned
    separately so the caller can warn about them.  The *first* occurrence of
    each number is kept; later duplicates are skipped.

    Linear dimensions are converted from each entry's `unit` (and each
    holder's `unit`) into the machine's native linear unit. ``machine_unit`` is
    passed in (resolved on the event loop, since get_ini_config() may STAT.poll)
    so this stays NML-free and safe to run in an executor thread (B2).
    """
    tools: list[dict] = []
    skipped: list[dict] = []
    seen_nums: dict[int, int] = {}          # tool_num → index in tools[]
    for entry in data.get("data", []):
        pp = entry.get("post-process", {})
        geom = entry.get("geometry", {})
        presets = entry.get("start-values", {}).get("presets", [])
        holder = entry.get("holder", {})

        tool_num = pp.get("number")
        if tool_num is None:
            continue

        fusion_type = entry.get("type", "")
        our_type = FUSION_TYPE_MAP.get(fusion_type, "other")

        tool_scale = _fusion_unit_scale(entry.get("unit"), machine_unit)

        tool = {
            "T": int(tool_num),
            "D": float(geom.get("DC", 0)) * tool_scale,
            "description": entry.get("description", "").strip(),
            "type": our_type,
            "flutes": geom.get("NOF"),
            "oal": _opt_scale(geom.get("OAL"), tool_scale),
            "flute_length": _opt_scale(geom.get("LCF"), tool_scale),
            "corner_radius": _opt_scale(geom.get("RE"), tool_scale),
            "maximum_cutting_diameter": _opt_scale(geom.get("DCX"), tool_scale),
            "upper_radius": _opt_scale(geom.get("upper-radius"), tool_scale),
            "body_length": _opt_scale(geom.get("LB"), tool_scale),
            "shaft_diameter": _opt_scale(geom.get("SFDM"), tool_scale),
            "taper_angle": geom.get("TA"),
            "point_angle": geom.get("SIG"),
            "tip_diameter": _opt_scale(geom.get("tip-diameter"), tool_scale),
            "tip_length": _opt_scale(geom.get("tip-length"), tool_scale),
            "shoulder_length": _opt_scale(geom.get("shoulder-length"), tool_scale),
            "shoulder_diameter": _opt_scale(geom.get("shoulder-diameter"), tool_scale),
            "assembly_gauge_length": _opt_scale(geom.get("assemblyGaugeLength"), tool_scale),
            "material": entry.get("BMC"),
            "holder": holder.get("description") if holder else None,
            "fusion_type": fusion_type,
            "fusion_guid": entry.get("guid"),
        }
        if our_type == "tapered":
            tool["tapered_type"] = entry.get("tapered-type")
        if our_type == "cornerchamfer":
            tool["chamfer_width"] = _opt_scale(geom.get("chamfer-width"), tool_scale)
            tool["chamfer_angle"] = geom.get("chamfer-angle")
        if fusion_type.startswith("circle segment "):
            # Preserve these for later native validation; the UI explicitly
            # identifies the current generic rendering as an approximation.
            for field in ("lower-radius", "profile-radius", "axial-distance"):
                tool[field.replace("-", "_")] = _opt_scale(geom.get(field), tool_scale)
        if our_type == "threadmill":
            tool.update({
                "thread_pitch": _opt_scale(geom.get("TP"), tool_scale),
                "thread_pitch_min": _opt_scale(geom.get("TPN"), tool_scale),
                "thread_pitch_max": _opt_scale(geom.get("TPX"), tool_scale),
                "number_of_teeth": geom.get("NT"),
                "thread_profile_angle": geom.get("thread-profile-angle"),
                "thread_tip_type": geom.get("thread-tip-type"),
                "thread_tip_width": _opt_scale(geom.get("thread-tip-width"), tool_scale),
                "thread_tip_radius": _opt_scale(geom.get("thread-tip-radius"), tool_scale),
            })
        # ---- Per-type angle normalization (Fusion stores half-angles for some types) ----
        # Verified against native Fusion CAM contours, independently by type.
        if our_type in ("chamfer", "countersink"):
            # Fusion TA is half-angle for chamfer/countersink — double to get included angle
            if tool.get("taper_angle"):
                tool["taper_angle"] *= 2
        # SIG is the full included point angle for drills, countersinks and
        # center drills. Center-drill TA is also a full included body angle.

        # A custom shaft belongs to the tool and shares its unit. Segment
        # heights stack from shoulder-length, independently of LB/installation.
        shaft_segs = (entry.get("shaft") or {}).get("segments", [])
        if shaft_segs:
            tool["shaft_segments"] = [
                {"height": s["height"] * tool_scale,
                 "lower_diameter": s["lower-diameter"] * tool_scale,
                 "upper_diameter": s["upper-diameter"] * tool_scale}
                for s in shaft_segs
            ]

        # Holders carry their own `unit` independent of the tool body.
        if holder:
            tool["holder_gauge_length"] = _opt_scale(
                holder.get("gaugeLength"), _fusion_unit_scale(holder.get("unit"), machine_unit))
        holder_segs = holder.get("segments", []) if holder else []
        if holder_segs:
            holder_scale = _fusion_unit_scale(holder.get("unit"), machine_unit)
            tool["holder_segments"] = [
                {"height": s["height"] * holder_scale,
                 "lower_diameter": s["lower-diameter"] * holder_scale,
                 "upper_diameter": s["upper-diameter"] * holder_scale}
                for s in holder_segs if "height" in s
            ]
        # Form-mill profile coords share the tool's unit; arcs add a `center` pair.
        if our_type == "formmill":
            # CAM compensation-point metadata, not the measured installed length.
            tool["tip_offset"] = _opt_scale(geom.get("tip-offset"), tool_scale)
            raw_profile = geom.get("profile")
            if raw_profile and isinstance(raw_profile, list):
                scaled_profile = []
                for seg in raw_profile:
                    new_seg = dict(seg)
                    if "end" in seg:
                        new_seg["end"] = [seg["end"][0] * tool_scale,
                                          seg["end"][1] * tool_scale]
                    if "center" in seg:
                        new_seg["center"] = [seg["center"][0] * tool_scale,
                                             seg["center"][1] * tool_scale]
                    scaled_profile.append(new_seg)
                tool["profile"] = scaled_profile
        # Preserve raw presets (speeds/feeds per material) for sidecar
        if presets:
            tool["presets"] = presets

        t_int = int(tool_num)
        if t_int in seen_nums:
            skipped.append(tool)
        else:
            seen_nums[t_int] = len(tools)
            tools.append(tool)
    return tools, skipped


def decode_fusion_blob(raw: bytes, machine_unit: str) -> tuple[list, list]:
    """Decode + parse a Fusion library blob → (parsed, skipped). CPU/GIL-bound,
    so callers run it via an executor (B2): json.loads is one C call that holds
    the GIL for its duration (fine for realistic KB–MB libraries — the 50 MB cap
    is only a DoS bound), while the per-tool transform is a Python loop that
    releases the GIL every few ms so the heartbeat keeps running. Raises
    ValueError on malformed input (the caller maps it to HTTP 400)."""
    try:
        data = json.loads(raw)
    except (json.JSONDecodeError, UnicodeDecodeError) as e:
        raise ValueError(f"Invalid JSON: {e}")
    if not isinstance(data, dict) or "data" not in data or not isinstance(data["data"], list):
        raise ValueError("Not a Fusion 360 tool library (missing 'data' array)")
    return parse_fusion_library(data, machine_unit)


def main() -> None:
    import msgspec
    try:
        ctx = msgspec.msgpack.decode(sys.stdin.buffer.read())
        raw = ctx["raw"]
        unit = ctx["unit"]
    except Exception as e:
        print(f"bad context: {type(e).__name__}: {e}", file=sys.stderr, flush=True)
        sys.exit(2)
    try:
        parsed, skipped = decode_fusion_blob(raw, unit)
    except ValueError as e:
        print(str(e), file=sys.stderr, flush=True)
        sys.exit(4)
    except Exception as e:
        print(f"parse failed: {type(e).__name__}: {e}", file=sys.stderr, flush=True)
        sys.exit(3)
    sys.stdout.buffer.write(msgspec.msgpack.encode({"parsed": parsed, "skipped": skipped}))
    sys.stdout.buffer.flush()


if __name__ == "__main__":
    main()
