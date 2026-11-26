"""Pure models for R506 decisions; NOT implementation tests.

No product imports, sockets, LinuxCNC, browser, or heavy test process.
The status example models the existing receipt/rAF split, not new code.
"""
import json
from dataclasses import dataclass, field


@dataclass
class Job:
    id: int
    kind: str
    state: str = "pending"
    origins: list = field(default_factory=list)


class Lane:
    def __init__(self):
        self.pending = []
        self.taken = None
        self.seq = 0
        self.receipts = []
        self.outcomes = []
        self.writes = []

    def arrive(self, kind, request):
        # The model concerns lane admission only. Drain/preempt/S1/leases
        # must run for EVERY arrival, including a join, in the implementation.
        job = next((j for j in self.pending if j.kind == kind), None)
        if job is None:
            self.seq += 1
            job = Job(self.seq, kind)
            self.pending.append(job)
        if len(job.origins) < 64:
            job.origins.append(request)
        else:
            self.receipts.append(dict(req_id=request, ok=False, joined=job.id,
                                      pending=True, final=False))
        assert len(self.pending) <= 2
        assert all(len(j.origins) <= 64 for j in self.pending)
        return job.id

    def take(self):
        assert self.taken is None
        self.taken = self.pending.pop(0)
        self.taken.state = "taken"
        return self.taken.id

    def finish(self, ok=True):
        j = self.taken
        assert j is not None
        j.state = "written" if ok else "write_failed"
        if ok:
            self.writes.append((j.id, j.kind))
        self.outcomes.extend(dict(req_id=r, ok=ok, job=j.id) for r in j.origins)
        self.taken = None


def lane_cases():
    out = {}
    lane = Lane()
    ids = [lane.arrive("abort", f"r{i}") for i in range(65)]
    assert len(set(ids)) == 1 and len(lane.receipts) == 1
    lane.take()
    lane.finish()
    assert len(lane.writes) == 1 and len(lane.outcomes) == 64
    out["65_origins"] = dict(writes=len(lane.writes), final_replies=len(lane.outcomes),
                              receipt_only=lane.receipts)

    lane = Lane()
    first = lane.arrive("abort", "first")
    lane.take()
    second = lane.arrive("abort", "after_take")
    assert first != second
    lane.finish()
    lane.take()
    lane.finish()
    out["arrival_after_take"] = dict(writes=lane.writes)

    for kinds in [("abort", "estop"), ("estop", "abort")]:
        lane = Lane()
        for i, kind in enumerate(kinds):
            lane.arrive(kind, f"r{i}")
        while lane.pending:
            lane.take()
            lane.finish()
        assert [k for _, k in lane.writes] == list(kinds)
        out["then_".join(kinds)] = dict(writes=lane.writes)

    lane = Lane()
    a1 = lane.arrive("abort", "a1")
    lane.arrive("estop", "e1")
    a2 = lane.arrive("abort", "a2")
    assert a1 == a2
    while lane.pending:
        lane.take()
        lane.finish()
    out["A_E_A_join"] = dict(writes=lane.writes, note="job order, NOT one write per arrival")

    lane = Lane()
    for i in range(65):
        lane.arrive("estop", f"r{i}")
    lane.take()
    lane.finish(ok=False)
    assert len(lane.writes) == 0 and len(lane.outcomes) == 64
    out["failure_after_receipt_only"] = dict(final_failures=len(lane.outcomes),
                                             no_final_reply=lane.receipts[0]["req_id"])
    return out


def status_cases():
    old = dict(epoch=1, machine="ON", permission=True)
    new = dict(epoch=2, machine="ESTOP", permission=False)
    # Existing statusStore holds status and a deferred _pendingStatus.
    applied = old
    pending = new
    fresh_on_receipt = True
    literal = dict(fresh=fresh_on_receipt, shown=applied["machine"],
                   permission=applied["permission"], pending=pending["machine"])
    assert literal["fresh"] and literal["shown"] == "ON"

    epoch = 2
    applied_epoch = 1
    valid = applied_epoch == epoch
    before_apply = dict(fresh=valid, shown=applied["machine"] if valid else "WAITING",
                        permission=applied["permission"] if valid else False)
    applied = pending
    applied_epoch = pending["epoch"]
    valid = applied_epoch == epoch
    after_apply = dict(fresh=valid, shown=applied["machine"] if valid else "WAITING",
                       permission=applied["permission"] if valid else False)
    assert not before_apply["fresh"] and after_apply == dict(fresh=True, shown="ESTOP", permission=False)

    # A late flush owned by epoch 1 cannot establish freshness in epoch 2.
    stale_pending = old
    stale_accepted = stale_pending["epoch"] == epoch
    assert not stale_accepted
    return dict(literal_receipt_flag=literal, clarified_before=before_apply,
                clarified_after=after_apply, late_old_flush_accepted=stale_accepted,
                note="Plan model. Freshness is a property of the applied status and its connection.")


print(json.dumps(dict(kind="plan models, no product implementation exercised",
                      lane=lane_cases(), status=status_cases()), indent=2))
