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
    """The run's OWN test instance and tree (state.json, R286/R287 FI-I19),
    ended before the LAN instance returns — from `finally` and from
    ExecStopPost alike. Ownership is proven, not intended: only a unit the
    run STARTED (`test_unit` with the InvocationID it got, written after a
    successful start) and only while that incarnation runs is stopped; the
    wait is for the recorded test instance (pid and start) alone — never
    "no LinuxCNC at all", which the returned LAN instance never satisfies;
    the tree goes only once that instance has ended. An intent whose
    ownership was never written is resolved against the unit itself. Every
    failure is named."""
    if state.get("test_ended"):
        return []
    reasons = []
    unit = state.get("test_unit")
    owned = bool(unit) and host.invocation(unit) == state.get("test_unit_invocation")
    if not unit and state.get("test_unit_intent"):
        # killed after the start, before its ownership was written (R288
        # FI-I19 B): resolve the intent against the unit itself — this run's
        # folder and INI make it the run's; anything else stays unresolved
        unit = state["test_unit_intent"]
        spec = host.unit_if_exists(unit)
        if spec is None:
            unit = None                 # never started: nothing to end
        elif spec.get("WorkingDirectory") == state.get("test_unit_wd") and \
                (spec.get("ExecStart") or [None])[-1] == state.get("test_ini"):
            owned = True
        else:
            return [f"a unit {unit} runs that this run intended but cannot prove its own — unresolved"]
    if unit and owned:
        if not state.get("test_instance"):
            inst = host.unit_instance(unit)     # its LinuxCNC, read before the stop ends its cgroup
            if inst:
                state["test_instance"] = [inst[1], inst[2]]
        try:
            host.stop(unit)
        except Exception as e:  # noqa: BLE001
            reasons.append(f"the test unit {unit} did not stop: {e}")
    inst = state.get("test_instance")
    if inst:
        end = time.monotonic() + TEST_END_S
        while host.process_alive(*inst) and time.monotonic() < end:
            time.sleep(0.2)
        if host.process_alive(*inst):
            reasons.append(f"the test instance {inst} still runs")
    if not reasons:
        tree = state.get("tree")
        if tree and state.get("tree_of"):
            try:
                host.remove_tree(tree, state["tree_of"])
            except Exception as e:  # noqa: BLE001
                reasons.append(f"the run tree {tree} was not removed: {e}")
    if not reasons:
        state["test_ended"] = True
    return reasons


def restore(host, pre: dict, state: dict | None = None, first: Path | None = None, save=None) -> dict:
    """End the run's own test resources, start what was recorded and is not
    running, prove it. Phases bind in `state` (the run's state.json): the
    isolation is compared ONCE, before the LAN instance runs again, and kept;
    a partial return (the LAN up, the keepalive not) resumes. `first` (the
    run's restore.json) is written by the restore that returned the LAN; a
    later one proves the CURRENT state again — the same instance, every
    other proof — and keeps the first's isolation verdict. An isolation never
    proven stays None (unknown)."""
    state = {} if state is None else state
    cleanup = end_test_resources(host, state)
    earlier = json.loads(first.read_text()) if first and first.is_file() else None
    since = time.time()
    reasons = list(cleanup)
    if not reasons and "isolation" not in state and all(not host.is_active(n) for n in pre["units"]):
        # the isolation claim (its own verdict — the LAN comes back either
        # way): the operator's files as the stop left them, compared BEFORE
        # the LAN instance runs again (it writes its own state)
        hashes = host.file_hashes()
        state["isolation"] = [f"{k} changed" for k in pre.get("hashes", {}) if hashes.get(k) != pre["hashes"][k]]
        if "hashes" not in pre:
            state["isolation"].append("no hashes recorded after the stop (stop_lan)")
    isolation = earlier.get("isolation") if earlier else state.get("isolation")
    if save:
        # the phases reached and the isolation proof on DISK before the LAN
        # runs again (R288 FI-I19 A): a later hash would read its own writes
        save(state)
    for name, spec in pre["units"].items():
        if reasons:
            break                       # the test instance still holds the VM's LinuxCNC
        if host.is_active(name):
            continue
        try:
            host.start(name, spec)
        except Exception as e:  # noqa: BLE001 — a unit that did not start is a named reason
            reasons.append(f"{name} did not start: {e}")
    if not reasons and not host.wait_ready(READY_S):
        reasons.append(f"the LAN gateway's /ready did not answer within {READY_S} s")
    instance = list(host.lan_instance() or ())
    if not reasons:
        reasons += _proofs(host, pre, instance, since, earlier)
    out = _outcome(host, reasons, instance, isolation, cleanup)
    if earlier:
        out["repeat_of"] = earlier.get("outcome")
    elif first and out["outcome"] != "not_returned":
        _write(first, out)
    return out


def _proofs(host, pre, instance, since, earlier=None) -> list[str]:
    """Every current proof of the return. The first return needs a NEW
    instance of the restored unit; a later one THAT instance, still running."""
    reasons = []
    gateway_unit = next(iter(pre["units"]))
    if not instance:
        reasons.append("no LinuxCNC instance found")
    elif earlier is not None and instance != earlier.get("instance"):
        reasons.append(f"the instance {instance} is not the one the restore returned ({earlier.get('instance')})")
    elif earlier is None and instance[1:] == list(pre["instance"])[1:]:
        reasons.append("the instance is the one recorded before the stop — not a new one")
    elif not host.unit_owns(gateway_unit, instance[1]):
        reasons.append(f"the instance {instance} does not belong to {gateway_unit}")
    for name, spec in pre["units"].items():
        if host.unit(name)["ExecStart"] != spec["ExecStart"]:
            reasons.append(f"{name} runs another command than recorded")
    if host.gateway_ini() != pre["ini"]:
        reasons.append(f"the gateway runs {host.gateway_ini()}, recorded {pre['ini']}")
    if host.tree_head() != pre["head"]:
        reasons.append(f"the LAN tree's HEAD is {host.tree_head()}, recorded {pre['head']}")
    if "bg-keepalive" in pre["units"] and not host.keepalive_heartbeat_since(since):
        reasons.append("no fresh heartbeat of the recorded keepalive reached the returned gateway")
    return reasons


def _outcome(host, reasons, instance, isolation, cleanup) -> dict:
    base = {"instance": instance, "isolation": isolation, "cleanup": cleanup}
    if reasons:
        return {"outcome": "not_returned", "reasons": reasons, **base}
    trip = host.lan_trip()
    if trip:
        return {"outcome": "lan_started_trip_unacked", "trip": trip, **base}
    return {"outcome": "complete", **base}


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
        out = restore(host_factory(pre), pre, state, first=run / "restore.json", save=lambda st: _write(state_path, st))
    if state_path.is_file() or state:
        _write(state_path, state)
    a.out.write_text(json.dumps(out, indent=2) + "\n")
    print(f"restore: {out['outcome']}")
    return 0 if out["outcome"] == "complete" else 1


if __name__ == "__main__":
    raise SystemExit(main())
