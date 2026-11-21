"""Jog leases: a continuous jog lives only while its page renews it (P1b,
machine day 2026-11-21; plan agreed with Codex R423–R426).

A continuous jog used to end only by its `jog_stop`. The release that sends
it (a finger, a key, a stick back at rest) is handled by the page's MAIN
thread; a page that hangs for 0.5–1.6 s (measured on the operator's panel)
left the axis moving for as long as it hung. The connection's heartbeat comes
from a worker and keeps beating through such a hang — it proves the
connection, never the operator's input path (Codex R399).

So a continuous jog from the WebUI carries a LEASE: an id the page chose for
the input gesture (a pointer on a jog button, a held key, a stick or a D-pad
from leaving rest to returning), renewed by `jog_renew` frames that only the
page's main thread sends (every 100 ms). The gateway:

- anchors the deadline at RECEIPT — the reader that reads the frame — to
  `t_receipt + TTL`; queue and lock time never extend it;
- renews in the reader (no handler, no queue, no lock), and only a lease that
  is still alive: a lease past its deadline is dead and stays dead;
- checks the deadline at EVERY write the lease admits (the switch to MANUAL,
  each jog), in the write's own thread;
- books every written axis with its owner (`(conn_key, id)`) and a write
  generation; the expiry stops only the axes still booked under the lease.

This module holds the decisions, pure and on `time.monotonic()` values the
caller passes in; the gateway owns the timers, the writes and the replies.
The lease ids of one connection only grow: an id at or below the highest one
begun on the connection that is not alive is DEAD, so an ended lease that was
already forgotten is never revived by a late frame.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

#: the lease's validity (operator decision Q423-1, 2026-11-21): at 3000 mm/min
#: 500 ms are 25 mm of travel; the real overrun after a page stops renewing is
#: larger by the transport, the stop's processing and the deceleration (it is
#: measured in the sim probe, never promised here)
JOG_LEASE_TTL_S = 0.5
#: the page renews every 100 ms (jogLease.ts RENEW_MS — a test holds them
#: together): four renewals may be lost before a healthy page's lease ends
JOG_RENEW_EXPECTED_S = 0.1
#: one renew frame names at most this many leases (a page has a few gestures)
RENEW_IDS_MAX = 16

#: the replies a dead lease's commands get
JOG_LEASE_DEAD = "Jog expired — release and press again"
JOG_LEASE_FOREIGN_LINK = "Connection to LinuxCNC changed — release and press again"

LeaseKey = Tuple[str, int]


@dataclass
class Lease:
    """One gesture's lease. `state`: live → ended (its source said so, or a
    stop of this client ended it) or expired (no renewal by the deadline)."""
    conn_key: str
    lease_id: int
    link: Any                 # the controller Link it began on (identity compared)
    deadline: float           # monotonic
    began: float
    state: str = "live"
    renewals: int = 0
    timer: Any = None         # the gateway's TimerHandle (owned there)
    stop_scheduled: bool = False
    extra: Dict[str, Any] = field(default_factory=lambda: dict[str, Any]())

    @property
    def key(self) -> LeaseKey:
        return (self.conn_key, self.lease_id)


class LeaseTable:
    """Every lease of every connection. Not thread-safe by locking: the event
    loop thread mutates it; a write thread only READS one lease's `state` and
    `deadline` (is_live) — single attribute reads under the GIL."""

    def __init__(self, ttl: float = JOG_LEASE_TTL_S) -> None:
        self.ttl = ttl
        self._leases: Dict[LeaseKey, Lease] = {}
        self._max_id: Dict[str, int] = {}

    # --- receipt -----------------------------------------------------------
    def receive_start(self, conn_key: str, lease_id: int, link: Any,
                      now: float) -> Tuple[Optional[Lease], Optional[str]]:
        """A frame that starts or changes a jog under `lease_id` was READ now.

        A new id (above every id this connection began) begins a lease whose
        deadline is now + TTL. A live lease's frame is a renewal: it, too,
        came from the page's main thread. A known lease past its deadline,
        an ended one, or a forgotten id (at or below the highest begun) is
        dead: (None, the reason) — nothing may start under it."""
        key = (conn_key, lease_id)
        lease = self._leases.get(key)
        if lease is not None:
            if self._alive(lease, now):
                lease.deadline = now + self.ttl
                lease.renewals += 1
                return lease, None
            self._mark_dead(lease, now)
            return None, JOG_LEASE_DEAD
        if lease_id <= self._max_id.get(conn_key, 0):
            return None, JOG_LEASE_DEAD
        self._max_id[conn_key] = lease_id
        lease = Lease(conn_key=conn_key, lease_id=lease_id, link=link,
                      deadline=now + self.ttl, began=now)
        self._leases[key] = lease
        return lease, None

    def renew(self, conn_key: str, ids: List[int], now: float) -> List[int]:
        """A `jog_renew` frame READ now. Each live lease named gets the
        deadline now + TTL; the ids that are dead (past the deadline, ended,
        forgotten or never begun) are returned — nothing revives them."""
        dead: List[int] = []
        for lease_id in ids:
            lease = self._leases.get((conn_key, lease_id))
            if lease is not None and self._alive(lease, now):
                lease.deadline = now + self.ttl
                lease.renewals += 1
                continue
            if lease is not None:
                self._mark_dead(lease, now)
            dead.append(lease_id)
        return dead

    # --- queries -----------------------------------------------------------
    def get(self, key: LeaseKey) -> Optional[Lease]:
        return self._leases.get(key)

    def is_live(self, key: LeaseKey, now: float) -> bool:
        """The write's check (any thread): the lease exists, nothing ended it
        and its deadline is ahead. Decided by the deadline — never by whether
        the expiry timer has run yet."""
        lease = self._leases.get(key)
        return lease is not None and lease.state == "live" and now < lease.deadline

    def leases_of(self, conn_key: str) -> List[Lease]:
        return [lz for lz in self._leases.values() if lz.conn_key == conn_key]

    def __len__(self) -> int:
        return len(self._leases)

    # --- endings -----------------------------------------------------------
    def end(self, key: LeaseKey) -> Optional[Lease]:
        """The source ended the gesture (or a stop of its client ended every
        gesture): no more starts under it. Returns the lease (still listed —
        the caller stops its axes, then forgets it), or None when unknown."""
        lease = self._leases.get(key)
        if lease is not None and lease.state == "live":
            lease.state = "ended"
        return lease

    def due(self, key: LeaseKey, now: float) -> Optional[float]:
        """The expiry timer fired: the seconds left when the lease is still
        alive (a renewal moved the deadline — re-arm for that), else None:
        the lease is now dead (marked expired unless something ended it
        first) and the caller handles its stop."""
        lease = self._leases.get(key)
        if lease is None:
            return None
        if self._alive(lease, now):
            return lease.deadline - now
        self._mark_dead(lease, now)
        return None

    def forget(self, key: LeaseKey) -> None:
        """Drop a dead lease once its stop was handled. Its id stays dead:
        the connection's highest id is kept."""
        lease = self._leases.get(key)
        if lease is not None and lease.state != "live":
            del self._leases[key]

    def drop_connection(self, conn_key: str) -> List[Lease]:
        """The connection ended: every lease of it ends with it (returned so
        the caller cancels their timers). The connection's id floor goes too
        — a new connection has a new key."""
        gone = self.leases_of(conn_key)
        for lease in gone:
            if lease.state == "live":
                lease.state = "ended"
            del self._leases[lease.key]
        self._max_id.pop(conn_key, None)
        return gone

    # --- internals ---------------------------------------------------------
    @staticmethod
    def _alive(lease: Lease, now: float) -> bool:
        return lease.state == "live" and now < lease.deadline

    @staticmethod
    def _mark_dead(lease: Lease, now: float) -> None:
        if lease.state == "live":
            lease.state = "expired"
            lease.extra.setdefault("dead_at", now)


def parse_renew_ids(raw: Any) -> Optional[List[int]]:
    """`jog_renew`'s `ids`: a list of 1..RENEW_IDS_MAX positive JSON integers
    (no booleans), else None (the frame renews nothing — a malformed renewal
    lets the lease run out, the safe direction)."""
    if not isinstance(raw, list):
        return None
    items: List[Any] = list(raw)  # pyright: ignore[reportUnknownArgumentType]
    if not 1 <= len(items) <= RENEW_IDS_MAX:
        return None
    out: List[int] = []
    for v in items:
        if isinstance(v, bool) or not isinstance(v, int) or not 1 <= v < 2**53:
            return None
        out.append(v)
    return out


def lease_id_of(raw: Any) -> Optional[int]:
    """A command's `lease`: a positive JSON integer, else None."""
    if isinstance(raw, bool) or not isinstance(raw, int) or not 1 <= raw < 2**53:
        return None
    return raw
