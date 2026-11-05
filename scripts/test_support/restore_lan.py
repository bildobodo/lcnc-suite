"""The native stage gives the VM's one LinuxCNC back (plan Codex R268/R269
"Rückgabe", R283/R284): what the LAN instance was is RECORDED before the
take-over — its units (name, ExecStart, WorkingDirectory), the INI its
gateway runs, the code tree's HEAD, the keepalive, the hashes of the
operator's files — and the restore PROVES each point afterwards. "Unit
started" or `/ready` alone is no proof.

The isolation claim is its own verdict (`isolation`: the operator's files
that changed, [] = none, None = proven by the restore that started the
units) — the LAN comes back either way. Three outcomes of the return, apart:
  complete                  — every point proven
  lan_started_trip_unacked  — returned, but the LAN instance reports a trip;
                              it stays unacknowledged (the restore never
                              acknowledges one)
  not_returned              — a point not proven, with the reasons

It runs twice — the orchestrator's `finally` and the unit's ExecStopPost
(when the orchestrator itself died) — so it is idempotent: units already
running are proven, not started again. It lives in the persistent worktree,
never in the run folder it outlives, and reads the recorded state from JSON:

  python3 -I scripts/test_support/restore_lan.py --from <pre.json> --out <outcome.json>
"""
from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

UNITS = ("lcnc-sim-gates", "bg-keepalive")   # the gateway instance first, then its keepalive
READY_S = 120


class TakeOverRefused(RuntimeError):
    """The LAN instance must not be taken over (a trip nobody acknowledged)."""


def record(host, units=UNITS) -> dict:
    """The LAN instance before the take-over. A trip waiting for its
    acknowledgement refuses the take-over: it is the operator's."""
    trip = host.lan_trip()
    if trip:
        raise TakeOverRefused(f"the LAN instance has an unacknowledged trip ({trip}) — the operator's to acknowledge")
    return {"units": {u: host.unit(u) for u in units if host.is_active(u)},
            "ini": host.gateway_ini(), "head": host.tree_head(), "tree": host.tree_dir(),
            "instance": list(host.lan_instance()), "at": time.time()}


def stop_lan(host, pre: dict) -> None:
    """Stop the recorded units, keepalive first, then hash the operator's
    files: the LAN instance writes its own state (the var file) as it shuts
    down — hashed before the stop, that write would read as a run's."""
    for name in reversed(list(pre["units"])):
        host.stop(name)
    pre["hashes"] = host.file_hashes()


TEST_END_S = 60


def end_test_resources(host, state: dict) -> list[str]:
    """The run's OWN test instance and tree (state.json, R286 FI-I19), ended
    before the LAN instance comes back — from `finally` and from ExecStopPost
    alike. The VM runs one LinuxCNC: while the test instance lives, the LAN
    cannot return. Every failure is named, none ignored."""
    reasons = []
    unit = state.get("test_unit")
    if unit and host.is_active(unit):
        try:
            host.stop(unit)
        except Exception as e:  # noqa: BLE001
            reasons.append(f"the test unit {unit} did not stop: {e}")
    if unit:
        end = time.monotonic() + TEST_END_S
        while host.lan_instance() and time.monotonic() < end:
            time.sleep(0.2)
        if host.lan_instance():
            reasons.append(f"a LinuxCNC instance {list(host.lan_instance())} still runs after the test unit stopped")
    tree = state.get("tree")
    if tree and state.get("tree_of") and not state.get("tree_removed"):
        try:
            host.remove_tree(tree, state["tree_of"])
            state["tree_removed"] = True
        except Exception as e:  # noqa: BLE001
            reasons.append(f"the run tree {tree} was not removed: {e}")
    return reasons


def restore(host, pre: dict, state: dict | None = None, first: Path | None = None) -> dict:
    """End the run's own test resources, start what was recorded, prove it.
    `first` (the run's restore.json) binds the outcome: the restore that
    returned the LAN writes it, a later one (ExecStopPost after `finally`)
    recognises THAT return — the same instance, still running — and keeps
    its isolation verdict; without one, an isolation it cannot prove stays
    unknown (None), never "proven"."""
    state = state or {}
    cleanup = end_test_resources(host, state)
    earlier = json.loads(first.read_text()) if first and first.is_file() else None
    reasons: list[str] = []
    since = time.time()
    lan_down = any(not host.is_active(n) for n in pre["units"])
    if earlier and not lan_down:
        return _reproven(host, pre, earlier, cleanup)
    isolation: list[str] | None = None
    if lan_down and not cleanup:
        # the isolation claim (its own verdict — the LAN comes back either
        # way): the operator's files as the stop left them, compared BEFORE
        # the LAN instance runs again (it writes its own state)
        hashes = host.file_hashes()
        isolation = [f"{k} changed" for k in pre.get("hashes", {}) if hashes.get(k) != pre["hashes"][k]]
        if "hashes" not in pre:
            isolation.append("no hashes recorded after the stop (stop_lan)")
    if cleanup:
        reasons += cleanup
    for name, spec in pre["units"].items():
        if reasons:
            break                       # the test instance still holds the VM's LinuxCNC
        if host.is_active(name):
            if host.unit(name)["ExecStart"] != spec["ExecStart"]:
                reasons.append(f"{name} runs another command than recorded")
            continue
        try:
            host.start(name, spec)
        except Exception as e:  # noqa: BLE001 — a unit that did not start is a named reason
            reasons.append(f"{name} did not start: {e}")
    if not reasons and not host.wait_ready(READY_S):
        reasons.append(f"the LAN gateway's /ready did not answer within {READY_S} s")
    instance = list(host.lan_instance() or ())
    if not reasons:
        reasons += _proofs(host, pre, instance, since)
    out = _outcome(host, reasons, instance, isolation, cleanup)
    if first and out["outcome"] != "not_returned":
        _write(first, out)
    return out


def _proofs(host, pre, instance, since) -> list[str]:
    reasons = []
    if not instance:
        reasons.append("no LinuxCNC instance found")
    elif instance[1:] == list(pre["instance"])[1:]:
        reasons.append("the instance is the one recorded before the stop — not a new one")
    elif not host.unit_owns(next(iter(pre["units"])), instance[1]):
        reasons.append(f"the instance {instance} does not belong to {next(iter(pre['units']))}")
    if host.gateway_ini() != pre["ini"]:
        reasons.append(f"the gateway runs {host.gateway_ini()}, recorded {pre['ini']}")
    if host.tree_head() != pre["head"]:
        reasons.append(f"the LAN tree's HEAD is {host.tree_head()}, recorded {pre['head']}")
    if "bg-keepalive" in pre["units"] and not host.keepalive_connected_since(since):
        reasons.append("the recorded keepalive is not connected to the returned LAN instance")
    return reasons


def _outcome(host, reasons, instance, isolation, cleanup) -> dict:
    base = {"instance": instance, "isolation": isolation, "cleanup": cleanup}
    if reasons:
        return {"outcome": "not_returned", "reasons": reasons, **base}
    trip = host.lan_trip()
    if trip:
        return {"outcome": "lan_started_trip_unacked", "trip": trip, **base}
    return {"outcome": "complete", **base}


def _reproven(host, pre, earlier, cleanup) -> dict:
    """A later restore of the same run: the earlier return still stands —
    the SAME instance runs, the keepalive is there; its isolation verdict
    stays what it was."""
    instance = list(host.lan_instance() or ())
    reasons = list(cleanup)
    if instance != earlier.get("instance"):
        reasons.append(f"the instance {instance} is not the one the restore returned ({earlier.get('instance')})")
    if "bg-keepalive" in pre["units"] and not host.keepalive_connected_since(0):
        reasons.append("the recorded keepalive is not connected")
    out = _outcome(host, reasons, instance, earlier.get("isolation"), cleanup)
    return {**out, "repeat_of": earlier.get("outcome")}


def _write(path: Path, obj) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(obj, indent=2) + "\n")
    tmp.replace(path)


def main(argv=None, host_factory=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--from", dest="pre", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    a = ap.parse_args(argv)
    import sys
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))   # scripts/
    if host_factory is None:
        from test_support.system_host import SystemHost
        host_factory = SystemHost
    pre = json.loads(a.pre.read_text())
    run = a.pre.parent
    state_path = run / "state.json"
    state = json.loads(state_path.read_text()) if state_path.is_file() else {}
    # under the ONE heavy lock: the killed run's lock is gone already (R286 FI-I19)
    from test_support.heavy_lock import heavy_lock
    with heavy_lock("restore_lan", wait=600):
        out = restore(host_factory(pre), pre, state, first=run / "restore.json")
    if state_path.is_file() or state:
        _write(state_path, state)
    a.out.write_text(json.dumps(out, indent=2) + "\n")
    print(f"restore: {out['outcome']}")
    return 0 if out["outcome"] == "complete" else 1


if __name__ == "__main__":
    raise SystemExit(main())
