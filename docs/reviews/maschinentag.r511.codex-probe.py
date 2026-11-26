#!/usr/bin/env python3
"""R511 plan probes: pure arithmetic and state models, no product imports.

The scalar L20 equations mirror find_current_in_system + convert_setup
for a plain active Z target in mm. These are source-derived models, not
native runs. The routing models are literal consequences of the written
plan, not tests of an implementation.
"""
from dataclasses import asdict, dataclass
import json


@dataclass(frozen=True)
class ZState:
    origin: float
    g92: float
    tlo: float

    def work(self, machine):
        return machine - self.origin - self.g92 - self.tlo


def l20(interp, status, machine, *, stored_row=0.0, stored_g92=0.0, target=0.0):
    cz = interp.work(machine) + interp.g92 + interp.origin - stored_row - stored_g92
    new_row = cz + stored_row - target
    new_i = ZState(new_row, interp.g92, interp.tlo)
    new_s = ZState(new_row, status.g92, status.tlo)
    return {
        "new_row": new_row,
        "interpreter_work_after": new_i.work(machine),
        "status_work_after": new_s.work(machine),
    }


def touch_observations(interp, status, machine):
    return {
        "applied_index": 1, "stored_index": 1,
        "program_z": interp.work(machine),
        "abs_z": machine, "tlo_on": bool(interp.tlo),
        "stored_row_z": 0.0, "stored_g92_z": 0.0,
        "status": asdict(status), "machine_z": machine,
        "detector_agrees": interp.work(machine) == status.work(machine),
    }


def main():
    status = ZState(0, 0, 50)
    cases = {
        "healthy": ZState(0, 0, 50),
        "hidden_applied_g92": ZState(-7, 7, 50),
        "hidden_origin_tlo_split": ZState(10, 0, 40),
    }
    obs = [touch_observations(i, status, 50) for i in cases.values()]
    assert obs[0] == obs[1] == obs[2]
    touch = {
        name: {"interpreter": asdict(i), "observations": touch_observations(i, status, 50),
               "after_l20_z0": l20(i, status, 50)}
        for name, i in cases.items()
    }
    assert touch["healthy"]["after_l20_z0"]["status_work_after"] == 0
    assert touch["hidden_applied_g92"]["after_l20_z0"]["interpreter_work_after"] == -7
    assert touch["hidden_origin_tlo_split"]["after_l20_z0"]["status_work_after"] == -10

    nr19_state = ZState(0, 7, 0)
    nr19 = l20(nr19_state, nr19_state, 10)
    assert nr19["interpreter_work_after"] == nr19["status_work_after"] == -7

    # Literal §2.1 + §0 dispatch: until a full success, behaves as (b).
    # But (b)'s Start/Offsets Read executes only the point detector.
    configured_python = True
    full_read_succeeded = False
    bootstrap = []
    for attempt in range(3):
        branch = "a" if configured_python and full_read_succeeded else "b"
        read_kind = "full" if branch == "a" else "point"
        if read_kind == "full":
            full_read_succeeded = True
        bootstrap.append({"attempt": attempt + 1, "branch": branch, "read": read_kind,
                          "full_read_succeeded": full_read_succeeded})
    assert not full_read_succeeded

    # Merely asking on any positive result never consumes a specific finding.
    repeats = [{"attempt": n, "consent": "unchecked", "read": "INCONSISTENT:A", "record": "ask"}
               for n in range(1, 4)]
    def proposed_record(ack, finding):
        return "ask" if finding is not None and finding != ack else "go_unverified"
    bounded = [proposed_record(None, "A"), proposed_record("A", "A"), proposed_record("A", "B")]
    assert bounded == ["ask", "go_unverified", "ask"]

    numeric = []
    for machine, origin in [(1000.0, 999.9), (1e5, 1e5 - 0.1), (1e6, 1e6 - 0.1)]:
        a = machine - origin
        b = (machine / 25.4 - origin / 25.4) * 25.4
        e_result = 16 * 2**-52 * max(1, abs(a), abs(b))
        e_operands = 16 * 2**-52 * max(1, abs(machine), abs(origin))
        assert abs(a - b) > e_result and abs(a - b) < e_operands
        numeric.append({"machine_mm": machine, "origin_mm": origin,
                        "subtract_first_mm": a, "convert_first_then_subtract_mm": b,
                        "difference_mm": abs(a - b), "bound_using_result": e_result,
                        "scale_using_operands": e_operands,
                        "result_bound_covers": False})

    # v3 G16 still has an agreeing point; it is the bool that differs.
    first_tlo_i, first_tlo_s = ZState(50, 0, 50), ZState(100, 0, 0)
    assert first_tlo_i.work(100) == first_tlo_s.work(100) == 0
    assert bool(first_tlo_i.tlo) != bool(first_tlo_s.tlo)

    print(json.dumps({
        "kind": "plan countermodels and source-derived arithmetic",
        "native_run": False, "product_tests": False,
        "indistinguishable_observations_before_l20": touch,
        "nr19_source_prediction": nr19,
        "literal_bootstrap": bootstrap,
        "literal_reask_without_acknowledged_finding": repeats,
        "proposed_bounded_reask": bounded,
        "floating_point_cancellation": numeric,
        "g16": {"point_difference": 0, "tlo_flags_differ": True},
        "result": "all model assertions passed; no native reachability or implementation claims",
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
