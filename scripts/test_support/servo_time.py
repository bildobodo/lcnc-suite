"""Time from the servo stream (native stage step 3, plan Codex R313–R316).

A sample number is no time (servo.py); the stream's own time is the motion
controller's period: `motion.servo.last-period` lp_k = C_k − C_(k−1), where
C_k is `rtapi_get_clocks()` at the start of emcmotController in invocation k
(LinuxCNC 2.9.4 control.c), cut to u32. The sampler, the servo thread's last
function, takes S_k later in the same invocation: C_k ≤ S_k ≤ C_(k+1).

- The clock is proven only on the checked backend: /usr/bin/rtapi_app of
  linuxcnc-uspace 1:2.9.4-2+deb13u1 (sha256 below), where rtapi_get_clocks is
  rtapi_get_time = clock_gettime(CLOCK_MONOTONIC) in ns — the clock of the
  run's own receipt and mark times (time.monotonic_ns). Another binary:
  unproven, every time row incomplete (R315, R316).
- No u32 wrap in samples 2 … b: the start mark is set at t0 and every sample
  carrying it is captured after, so C_1 ≥ t0 and C_b ≤ S_b ≤ recv_b; the rest
  recv_b − t0 − Σ_{m=2}^{b} lp_m is 0 ≤ rest < 2³² — a wrap would add 2³².
- Edge gap (edges at i and j, each between S_(i−1) and S_i): upper
  C_(j+1) − C_(i−1) = Σ_{m=i}^{j+1} lp, lower max(0, Σ_{m=i+2}^{j−1} lp).
- Duration of samples a … b at least C_b − C_(a+1) = Σ_{m=a+2}^{b} lp.
- Verdict: evidence invalid → incomplete; upper ≤ limit PASS; lower > limit
  FAIL; else incomplete. Integer ns throughout."""
from __future__ import annotations

import hashlib
import subprocess

from test_support.servo import LAST_PERIOD

WRAP_NS = 1 << 32
RTAPI_APP = "/usr/bin/rtapi_app"
RTAPI_SHA256 = "1a4bb954a645cc86a4109b363f6c2ce8ad21dbf40d82a7a3fcbe081d070ce6af"
PACKAGE, PACKAGE_VERSION = "linuxcnc-uspace", "1:2.9.4-2+deb13u1"
HB_LIMIT_NS = 250_000_000          # half the 0.5 s oneshot budget (R283)


def clock_contract(sha256, version) -> dict:
    """lp is ns of CLOCK_MONOTONIC only on the binary checked in R315."""
    ok = sha256 == RTAPI_SHA256 and version == PACKAGE_VERSION
    return {"ok": ok, "sha256": sha256, "version": version,
            "why": None if ok else "the servo clock's unit not proven on this backend "
                                   f"(rtapi_app {str(sha256)[:12]}…, {PACKAGE} {version})"}


def read_clock_contract(path: str = RTAPI_APP, run=subprocess.run) -> dict:
    """The installed binary's hash and the package version, judged."""
    try:
        with open(path, "rb") as f:
            sha = hashlib.sha256(f.read()).hexdigest()
    except OSError as e:
        sha = f"unreadable: {e.__class__.__name__}"
    r = run(["dpkg-query", "-W", "-f=${Version}", PACKAGE], capture_output=True, text=True)
    return clock_contract(sha, r.stdout.strip() if r.returncode == 0 else None)


def _lp(samples, m):
    v = samples[m][2][LAST_PERIOD] if len(samples[m][2]) > LAST_PERIOD else None
    return v if isinstance(v, int) and not isinstance(v, bool) and v >= 0 else None


def proven(samples, recv_ns: dict, t0_ns, clock) -> dict:
    """The index range lo … hi whose periods are proven unwrapped (lo = 2:
    C_1 ≥ t0 anchors the sum). `samples` are ONE contiguous span from the
    first sample with the start mark (the section's integrity says so).
    `clock`: the contract READ in the run (read_clock_contract) — without
    it, or not ok, no period is a time (R317 FI-I45)."""
    if not (isinstance(clock, dict) and clock.get("ok")):
        return {"ok": False, "why": (clock or {}).get("why") or "the servo clock's contract not read in the run"}
    if not isinstance(t0_ns, int) or len(samples) < 3:
        return {"ok": False, "why": "no start time or too few samples for a time proof"}
    b = len(samples) - 1
    recv_b = recv_ns.get(samples[b][1])
    lps = [_lp(samples, m) for m in range(2, b + 1)]
    if not isinstance(recv_b, int) or any(v is None for v in lps):
        return {"ok": False, "why": "a receipt time or a controller period not read"}
    rest = recv_b - t0_ns - sum(lps)
    if not 0 <= rest < WRAP_NS:
        return {"ok": False, "rest_ns": rest, "why": "a wrap of last-period not excluded" if rest >= 0 else
                "a contradictory time evidence (negative rest)"}
    return {"ok": True, "lo": 2, "hi": b, "rest_ns": rest}


def _sum(samples, a, b):
    return sum(_lp(samples, m) for m in range(a, b + 1)) if b >= a else 0


def gap_bounds(samples, rng: dict, i: int, j: int):
    """(upper, lower) ns for edges at samples i < j — None when a period it
    needs lies outside the proven range."""
    if not rng.get("ok") or i < rng["lo"] or j + 1 > rng["hi"]:
        return None
    return _sum(samples, i, j + 1), max(0, _sum(samples, i + 2, j - 1))


def duration_lower(samples, rng: dict, a: int, b: int):
    """The least time samples a … b span — None outside the proven range."""
    if not rng.get("ok") or b > rng["hi"] or a + 2 < rng["lo"]:
        return None
    return _sum(samples, a + 2, b)


def judge(bounds, limit_ns: int = HB_LIMIT_NS) -> str:
    if bounds is None:
        return "incomplete"
    upper, lower = bounds
    if upper <= limit_ns:
        return "PASS"
    if lower > limit_ns:
        return "FAIL"
    return "incomplete"


def edges(samples, ch: int) -> list:
    """The indices whose value of channel `ch` differs from the sample before."""
    return [i for i in range(1, len(samples)) if samples[i][2][ch] != samples[i - 1][2][ch]]
