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


def restore(host, pre: dict) -> dict:
    """Start what was recorded (what is not running yet), then prove it."""
    reasons: list[str] = []
    isolation: list[str] | None = None   # None: proven by the restore that started the units
    since = time.time()
    if any(not host.is_active(n) for n in pre["units"]):
        # the isolation claim (its own verdict — the LAN comes back either
        # way): the operator's files as the stop left them, compared BEFORE
        # the LAN instance runs again (it writes its own state)
        hashes = host.file_hashes()
        isolation = [f"{k} changed" for k in pre.get("hashes", {}) if hashes.get(k) != pre["hashes"][k]]
        if "hashes" not in pre:
            isolation.append("no hashes recorded after the stop (stop_lan)")
    for name, spec in pre["units"].items():
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
        if not instance:
            reasons.append("no LinuxCNC instance found")
        if host.gateway_ini() != pre["ini"]:
            reasons.append(f"the gateway runs {host.gateway_ini()}, recorded {pre['ini']}")
        if host.tree_head() != pre["head"]:
            reasons.append(f"the LAN tree's HEAD is {host.tree_head()}, recorded {pre['head']}")
        if "bg-keepalive" in pre["units"] and not host.keepalive_connected_since(since):
            reasons.append("no keepalive connected to the returned LAN instance")
    if reasons:
        return {"outcome": "not_returned", "reasons": reasons, "instance": instance, "isolation": isolation}
    trip = host.lan_trip()
    if trip:
        return {"outcome": "lan_started_trip_unacked", "trip": trip, "instance": instance, "isolation": isolation}
    return {"outcome": "complete", "instance": instance, "isolation": isolation}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--from", dest="pre", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    a = ap.parse_args()
    from system_host import SystemHost   # noqa: E402 — the real host, beside this file
    pre = json.loads(a.pre.read_text())
    out = restore(SystemHost(pre), pre)
    a.out.write_text(json.dumps(out, indent=2) + "\n")
    print(f"restore: {out['outcome']}")
    return 0 if out["outcome"] == "complete" else 1


if __name__ == "__main__":
    raise SystemExit(main())
