"""Pure Fusion metadata refresh planning; never writes a LinuxCNC tool table."""
import hashlib
import json
import math
from collections import Counter

from tool_table import _TOOL_META_FIELDS


def metadata_refresh_revision(source: bytes, table: list, library: dict,
                              ini_key: str, machine_unit: str) -> str:
    """Bind a reviewed plan to its file, machine configuration and current data."""
    state = [hashlib.sha256(source).hexdigest(), table, library, ini_key, machine_unit]
    encoded = json.dumps(state, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()
    return hashlib.sha256(encoded).hexdigest()


def plan_metadata_refresh(parsed: list, duplicates: list, table: list, library: dict) -> dict:
    """Update only unambiguous existing T numbers with unchanged table diameters.

    GUIDs protect already-linked tools from a reused number. Legacy entries have
    no GUID, so the preview exposes both descriptions for an explicit number-based
    match. A different compensated diameter or local STL requires a separate edit.
    Missing imported fields clear stale Fusion metadata; unrelated local keys and
    tools are retained. Inputs are never mutated.
    """
    if not isinstance(library, dict) or any(not isinstance(v, dict) for v in library.values()):
        raise ValueError("Invalid tool metadata; refusing to refresh")
    counts = Counter(t["T"] for t in table)
    source_counts = Counter(t["T"] for t in parsed + duplicates)
    existing = {t["T"]: t for t in table}
    result = dict(library)
    rows = []
    updated = []
    for tool in parsed:
        number = tool["T"]
        current = existing.get(number)
        old = library.get(str(number), {})
        reason = None
        if source_counts[number] != 1:
            reason = "Duplicate number in Fusion library"
        elif current is None:
            reason = "Tool number is not in the current table"
        elif counts[number] != 1:
            reason = "Duplicate number in current table"
        elif old.get("fusion_guid") and old["fusion_guid"] != tool.get("fusion_guid"):
            reason = "Fusion tool identity differs"
        elif old.get("stl_file"):
            reason = "Tool uses a local STL model"
        elif not math.isclose(current["D"], tool["D"], rel_tol=0, abs_tol=0.00000051):
            # tool.tbl writes six decimals in machine units. Only that rounding
            # is accepted; refresh never changes diameter compensation implicitly.
            reason = "Diameter differs from current table"
        rows.append({"T": number, "type": tool.get("type", ""), "description": tool.get("description", ""),
                     "current_description": old.get("description") or (current or {}).get("remark", ""),
                     "D": tool["D"], "current_diameter": (current or {}).get("D"),
                     "Z": (current or {}).get("Z"), "reason": reason,
                     "match": "guid" if old.get("fusion_guid") else "number"})
        if reason is not None:
            continue
        meta = dict(old)
        for field in (*_TOOL_META_FIELDS, "presets"):
            if tool.get(field) is None:
                meta.pop(field, None)
            else:
                meta[field] = tool[field]
        result[str(number)] = meta
        updated.append(number)
    return {"library": result, "rows": rows, "updated": updated,
            "skipped": [r["T"] for r in rows if r["reason"] is not None]}
