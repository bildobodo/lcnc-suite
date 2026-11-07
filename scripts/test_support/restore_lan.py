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


def _unit_view(host, unit):
    """systemd's view of the unit, or the reason it was not read — an
    unread unit is unresolved, never "not running" (R289 FI-I19 B)."""
    try:
        return host.unit_status(unit), None
    except Exception as e:  # noqa: BLE001
        return None, f"the test unit {unit} was not read ({e}) — unresolved"


def _unit_ended(st) -> bool:
    """The unit's confirmed end: gone, or inactive / failed with an EMPTY
    cgroup. Not active is not ended: activating, deactivating, reloading
    still hold their processes (`is-active` says no to all three — measured)."""
    return st["load"] == "not-found" or (st["active"] in ("inactive", "failed") and not st["pids"])


def continue_stopped(host, state: dict, save=None, kill=None) -> list[dict]:
    """SIGCONT every process the run recorded as stopped (state `stopped`,
    step 3: the gateway in the latch case, a helper client) — only when the
    recorded identity (pid, start ticks) is still the process; else no
    signal, named. Before the test instance ends: a stopped gateway must not
    keep the instance's heartbeat down while it is torn down, and a stopped
    helper outlives nothing unseen (plan Codex R283, R313)."""
    import os
    import signal
    kill = kill or os.kill
    out = []
    for rec in list(state.get("stopped", [])):
        same = host.process_alive(rec["pid"], rec["start"])
        if same:
            try:
                kill(rec["pid"], signal.SIGCONT)
            except ProcessLookupError:
                same = False
        out.append({**rec, "outcome": "continued" if same else "gone or another process — no signal"})
    if out:
        state["stopped"] = []
        state.setdefault("continued", []).extend(out)
        if save:
            save(state)
    return out


def end_test_resources(host, state: dict, save=None) -> list[str]:
    """The run's OWN test instance and tree (state.json, R286–R289 FI-I19),
    ended before the LAN instance returns — from `finally` and from
    ExecStopPost alike. Existence, the running incarnation, a transition and
    a failed query are told apart: an unread unit releases nothing; a unit
    that still runs is stopped only when it is the run's (`test_unit` with
    the InvocationID its start gave, or — killed before that was written —
    an intent whose unit runs this run's folder and INI), else unresolved.
    The test instance found here is written (`save`) BEFORE the stop, so a
    new restore after an abort during the stop waits for exactly it. Only the
    CONFIRMED end — the unit ended (`_unit_ended`) and the recorded instance
    (pid and start) gone — releases the tree and, by the empty reasons, the
    LAN start. Every failure is named."""
    continue_stopped(host, state, save)
    if state.get("test_ended"):
        return []
    unit = state.get("test_unit") or state.get("test_unit_intent")
    stop_error = None
    if unit:
        st, err = _unit_view(host, unit)
        if err:
            return [err]
        if not _unit_ended(st):
            if state.get("test_unit"):
                own = st["invocation"] == state.get("test_unit_invocation")
            else:
                own = st.get("wd") == state.get("test_unit_wd") and \
                    (st.get("exec") or [None])[-1] == state.get("test_ini")
            if not own:
                return [f"a unit {unit} runs ({st['active']}) that this run cannot prove its own — unresolved"]
            if not state.get("test_instance"):
                inst = host.unit_instance(unit)     # its LinuxCNC, read before the stop ends its cgroup
                if inst:
                    state["test_instance"] = [inst[1], inst[2]]
            if save:
                save(state)                         # on disk before the stop (R289)
            try:
                host.stop(unit)
            except Exception as e:  # noqa: BLE001 — judged by the confirmed end below
                stop_error = str(e)
    reasons = []
    end = time.monotonic() + TEST_END_S
    while True:
        st, err = _unit_view(host, unit) if unit else ({"load": "not-found"}, None)
        inst = state.get("test_instance")
        alive = bool(inst) and host.process_alive(*inst)
        if not err and _unit_ended(st) and not alive:
            break
        if time.monotonic() >= end:
            if err:
                reasons.append(err)
            elif not _unit_ended(st):
                reasons.append(f"the test unit {unit} has not ended ({st['active']}, {len(st['pids'])} processes)")
            else:
                reasons.append(f"the test instance {inst} still runs")
            if stop_error:
                reasons.append(f"the test unit {unit} did not stop: {stop_error}")
            return reasons
        time.sleep(0.2)
    if stop_error:
        state["test_stop_error"] = stop_error       # the end is confirmed; the error stays on record
    tree = state.get("tree")
    if tree and state.get("tree_of"):
        try:
            host.remove_tree(tree, state["tree_of"])
        except Exception as e:  # noqa: BLE001
            return [f"the run tree {tree} was not removed: {e}"]
    state["test_ended"] = True
    return []


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
    cleanup = end_test_resources(host, state, save)
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
    # the gateway unit first; a later one (the keepalive) only once the
    # gateway answers: the keepalive connects ONCE and ends on a refused
    # connection (live run 2026-11-05: started beside the gateway it was gone
    # before /ready, the first return lacked its heartbeat)
    gateway_unit, ready = next(iter(pre["units"])), None
    for name, spec in pre["units"].items():
        if reasons:
            break                       # the test instance still holds the VM's LinuxCNC
        if name != gateway_unit:
            ready = host.wait_ready(READY_S) if ready is None else ready
            if not ready:
                break
        if host.is_active(name):
            continue
        try:
            host.start(name, spec)
        except Exception as e:  # noqa: BLE001 — a unit that did not start is a named reason
            reasons.append(f"{name} did not start: {e}")
    if not reasons and not (host.wait_ready(READY_S) if ready is None else ready):
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
    from test_support import heavy_lock as heavy
    # this restore IS the run's owed return: the lock is its own while the
    # run's marker stands (Codex R331 FI-I60 A) — no gate waiting meanwhile takes it
    owner = str(run.resolve())
    with heavy.heavy_lock("restore_lan", wait=600, owed_by=owner):
        out = restore(host_factory(pre), pre, state, first=run / "restore.json", save=lambda st: _write(state_path, st))
        # the run's final return settles what the run owed; a marker this
        # restore cannot read as its own stays (R332 A3) — named in the record
        out["owed"] = heavy.settle(owner) if out["outcome"] != "not_returned" else "kept: not returned"
    if state_path.is_file() or state:
        _write(state_path, state)
    a.out.write_text(json.dumps(out, indent=2) + "\n")
    print(f"restore: {out['outcome']}")
    return 0 if out["outcome"] == "complete" else 1


if __name__ == "__main__":
    raise SystemExit(main())
