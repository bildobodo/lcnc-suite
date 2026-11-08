"""The switchable suite functions (settings split package 3, plan R335–R337).

A machine section `features`: six switches, each ON unless the server holds
it OFF (an install without the section works as before). "Off" is the
suite's OPERATING function (operator OP2): its controls leave the UI and its
recognisable jobs and routes are refused here — free MDI, programs and the
remaps stay general NC paths, never searched for M600 or an O-call.

The parameter writes name their PURPOSE (R336, SS334-01 rest A): each
purpose has its own variable set and its own switch, so a shared transport
never ties one function to another (the toolsetter's values went through
the probe's `set_probe_vars`). A set outside its purpose — mixed, or one
number too many — is refused WHOLE before the first write. Pure: no
gateway state, no linuxcnc.
"""
from typing import Dict, Iterable, Optional

FEATURES = ("probing", "toolsetter", "surfaceMap", "camera", "macros", "gamepad")

LABELS = {
    "probing": "Probing",
    "toolsetter": "Toolsetter",
    "surfaceMap": "Surface map",
    "camera": "Camera",
    "macros": "Macros",
    "gamepad": "Gamepad",
}


def _span(lo: int, hi: int) -> frozenset:
    return frozenset(range(lo, hi + 1))


#: Each purpose's variables (CLAUDE.md "Toolsetter Var-File Mapping", the
#: probe panel's #3014–#3036, surface_scan.ngc's inputs) and its switch.
PURPOSE_VARS = {
    "probe": _span(3014, 3036),
    "surface": _span(3050, 3059) | {3014, 3021},
    "toolsetter": _span(3004, 3013) | _span(3100, 3115),
}
PURPOSE_FEATURE = {"probe": "probing", "surface": "surfaceMap", "toolsetter": "toolsetter"}

#: The recognisable jobs and their switch — the gateway's ONE table of what a
#: switch refuses over WS (the inventory guard reads it). `set_params` is
#: switched by its purpose, `set_compensation` only when it switches ON.
COMMAND_FEATURES = {
    "probe_run": "probing",
    "surface_scan_run": "surfaceMap",
    "set_compensation_method": "surfaceMap",
    "tool_measure": "toolsetter",
    "tool_unload_measure": "toolsetter",
    "run_macro": "macros",
}
#: The commands a switch refuses by their payload — the dispatch's own rule
#: (gateway `_command_feature_refusal`), named for the inventory.
VARIANT_COMMANDS = {
    "set_params": "the switch of its purpose (PURPOSE_FEATURE)",
    "set_compensation": "surfaceMap when it switches ON — OFF is always admitted",
    "auto_run": "toolsetter with run from line's pre-measurement (pre_tool)",
}
#: The HTTP routes a switch refuses (macro writes; the camera's two).
ROUTE_FEATURES = {
    "PUT /macro": "macros",
    "POST /macro-upload": "macros",
    "DELETE /macro": "macros",
    "GET /camera/stream": "camera",
    "GET /camera/status": "camera",
}

#: Where a command came from, when it says so: the gamepad's commands carry
#: `via: "gamepad"` (R336 named the key `source`; `auto_run.source` is the
#: program text's fingerprint, so the marker took its own key).
VIA_VALUES = frozenset({"gamepad"})
VIA_FEATURE = {"gamepad": "gamepad"}
#: Every command the gamepad sends (useGamepad.ts) — each carries `via`;
#: the stops among them pass with the gamepad off (the gateway's
#: _WS_STOP_CMDS).
GAMEPAD_COMMANDS = frozenset({
    "jog_cont", "jog_incr", "jog_stop", "jog_stop_multi",
    "cycle_start", "cycle_resume", "cycle_pause", "abort", "estop",
    "spindle_stop", "flood_on", "flood_off", "mist_on", "mist_off", "home_all",
})

#: The probe routines that read none of the panel's values — a probe_run of
#: one carries an EMPTY set (Codex R343 SS-I08: Reset Calibration only zeroes
#: #3032); every other routine needs its values.
PARAMLESS_PROBE_ROUTINES = frozenset({"probe_cal_reset"})

M600_MODE = "m600"


def features_of(section) -> Dict[str, bool]:
    """The switches as they act: the server's section, each switch ON where
    the section does not hold it (no section = every function on)."""
    out = {f: True for f in FEATURES}
    if isinstance(section, dict):
        for f in FEATURES:
            if isinstance(section.get(f), bool):
                out[f] = section[f]
    return out


def validate_features(data) -> None:
    """A `features` save: exactly the six switches, each a boolean. Raises
    ValueError — a partial or unknown key is an older or other page."""
    if not isinstance(data, dict):
        raise ValueError("Features: not a mapping — reload the page")
    unknown = sorted(set(data) - set(FEATURES))
    if unknown:
        raise ValueError(f"Features: unknown switch {unknown[0]} — reload the page")
    missing = [f for f in FEATURES if f not in data]
    if missing:
        raise ValueError(f"Features: {missing[0]} missing — reload the page")
    for f in FEATURES:
        if not isinstance(data[f], bool):
            raise ValueError(f"Features: {f} must be on or off")


def off_reason(feature: str) -> str:
    label = LABELS[feature]
    return f"{label} {'are' if label.endswith('s') else 'is'} off — Settings › Features"


def purpose_refusal(purpose, keys: Iterable) -> Optional[str]:
    """None when every key belongs to `purpose`, else why the whole set is
    refused (before anything is written)."""
    allowed = PURPOSE_VARS.get(purpose) if isinstance(purpose, str) else None
    if allowed is None:
        return "Parameters without a known purpose — reload the page"
    for k in keys:
        try:
            n = int(k)
        except (TypeError, ValueError):
            return f"#{k} is not a parameter number"
        if n not in allowed:
            return f"#{n} is not a {purpose} parameter — nothing written"
    return None


def conflict(machine: Optional[dict], features: Optional[dict], saved: str) -> Optional[str]:
    """The ONE cross-section rule (SS334-02): the toolsetter OFF while the
    tool change measures with M600 is no state the suite stores — whichever
    section the save changes, its reason names what to do first."""
    on = features_of(features)
    mode = (machine or {}).get("toolChangeMode") if isinstance(machine, dict) else None
    if on["toolsetter"] or mode != M600_MODE:
        return None
    if saved == "features":
        return "Tool change uses M600 — choose another tool change mode first"
    return "Toolsetter is off — turn it on first (Settings › Features)"
