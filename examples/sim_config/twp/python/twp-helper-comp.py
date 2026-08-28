#!/usr/bin/env python3

import hal
import linuxcnc
import time  # LCNC-SUITE

h = hal.component("twp-helper-comp")

# this pin reflects the machine.analog pin used for the
# twp-status
h.newpin("twp-status", hal.HAL_FLOAT, hal.HAL_IN)
# these pins are created here from 'twp-status''
h.newpin("twp-is-redefined", hal.HAL_BIT, hal.HAL_OUT)
h.newpin("twp-is-defined", hal.HAL_BIT, hal.HAL_OUT)
h.newpin("twp-is-active", hal.HAL_BIT, hal.HAL_OUT)

# twp origin vector
h.newpin("twp-ox-in", hal.HAL_FLOAT, hal.HAL_IN)
h.newpin("twp-oy-in", hal.HAL_FLOAT, hal.HAL_IN)
h.newpin("twp-oz-in", hal.HAL_FLOAT, hal.HAL_IN)
h.newpin("twp-ox", hal.HAL_FLOAT, hal.HAL_OUT)
h.newpin("twp-oy", hal.HAL_FLOAT, hal.HAL_OUT)
h.newpin("twp-oz", hal.HAL_FLOAT, hal.HAL_OUT)
# twp x-orientation vector
h.newpin("twp-xx-in", hal.HAL_FLOAT, hal.HAL_IN)
h.newpin("twp-xy-in", hal.HAL_FLOAT, hal.HAL_IN)
h.newpin("twp-xz-in", hal.HAL_FLOAT, hal.HAL_IN)
h.newpin("twp-xx", hal.HAL_FLOAT, hal.HAL_OUT)
h.newpin("twp-xy", hal.HAL_FLOAT, hal.HAL_OUT)
h.newpin("twp-xz", hal.HAL_FLOAT, hal.HAL_OUT)
# twp z-orientation vector
h.newpin("twp-zx-in", hal.HAL_FLOAT, hal.HAL_IN)
h.newpin("twp-zy-in", hal.HAL_FLOAT, hal.HAL_IN)
h.newpin("twp-zz-in", hal.HAL_FLOAT, hal.HAL_IN)
h.newpin("twp-zx", hal.HAL_FLOAT, hal.HAL_OUT)
h.newpin("twp-zy", hal.HAL_FLOAT, hal.HAL_OUT)
h.newpin("twp-zz", hal.HAL_FLOAT, hal.HAL_OUT)
# twp origin vector in machine coordinate system
h.newpin("twp-ox-world-in", hal.HAL_FLOAT, hal.HAL_IN)
h.newpin("twp-oy-world-in", hal.HAL_FLOAT, hal.HAL_IN)
h.newpin("twp-oz-world-in", hal.HAL_FLOAT, hal.HAL_IN)
h.newpin("twp-ox-world", hal.HAL_FLOAT, hal.HAL_OUT)
h.newpin("twp-oy-world", hal.HAL_FLOAT, hal.HAL_OUT)
h.newpin("twp-oz-world", hal.HAL_FLOAT, hal.HAL_OUT)
# LCNC-SUITE: machine-frame A (degrees) that the current plane state assumes —
# written by the remap at definition and at each orient. The A rotary is a
# WORK-side table here, so a live A away from this value means the stored plane
# frame and the physical face no longer agree (surfaced as "stale" in the UI).
h.newpin("twp-pose-a-in", hal.HAL_FLOAT, hal.HAL_IN)
h.newpin("twp-pose-a", hal.HAL_FLOAT, hal.HAL_OUT)

# LCNC-SUITE: "no pose" sentinel — the pin always exists once we are loaded, so
# absence has to be expressed in the VALUE, not by a missing pin. Set before
# ready() so a fresh boot reads "none" rather than a plausible 0.0.
_POSE_NONE = -1e9
h['twp-pose-a'] = _POSE_NONE
h['twp-pose-a-in'] = _POSE_NONE

h.ready()

# create a connection to the status channel
s = linuxcnc.stat()

# LCNC-SUITE: upstream's loop is a bare `while 1:` with no sleep — a pure
# busy-spin that pins a core at 100% AND polls the NML status channel as fast
# as the CPU allows. Measured here: 13m29s of CPU in 13m33s of wall time, a
# quarter of this 4-core box gone permanently. That is not survivable next to
# a 500 ms heartbeat watchdog.
#
# BUT the rate cannot simply be dropped: `twp-is-defined` / `twp-is-active`
# are NOT display state — remap.py reads them as CONTROL-FLOW GUARDS
# (g68.2 aborts if TWP is already defined; G53.x aborts "No TWP defined" if
# it is not). Upstream's spin republished them within microseconds, so the
# remap could treat them as synchronous with the analog-out that drives
# them. A coarse period turns `g69 / g68.2 / g53.3` — which the interpreter
# executes far faster than one iteration — into a race the program loses
# roughly half the time, aborting mid-run and leaving the machine in limbo.
#
# So: republish the guard pins at ~1 kHz (still ~1/1000th of a busy-spin,
# and sleep() yields the core), and rate-limit only the part that actually
# cost the CPU — the NML status poll, which feeds display values alone.
_PERIOD_S = 0.001       # LCNC-SUITE: guard-pin latency, must beat the interpreter
_STAT_PERIOD_S = 0.05   # LCNC-SUITE: NML poll — display values only, 20 Hz is plenty
_next_stat = 0.0        # LCNC-SUITE
_g5x_offset = None      # LCNC-SUITE: last polled value, reused between polls

_last_status = None     # LCNC-SUITE: republish the guards only on a real change

try:
    while 1:
        # publish twp-status
        # LCNC-SUITE: edge-triggered — in steady state this whole block is one
        # pin read and a compare, which is what makes the 1 kHz rate affordable.
        _status = h['twp-status']
        if _status != _last_status:
            _last_status = _status
            if _status == 1:
                h['twp-is-defined'] = 1
                h['twp-is-active']  = 0
            elif _status == 2:
                h['twp-is-defined'] = 1
                h['twp-is-active']  = 1
            else:
                h['twp-is-defined'] = 0
                h['twp-is-active']  = 0

        # LCNC-SUITE: everything below is display state for the vismach window
        # — no remap reads it — so it runs at _STAT_PERIOD_S, not every pass.
        _now = time.monotonic()
        if _g5x_offset is not None and _now < _next_stat:
            time.sleep(_PERIOD_S)
            continue

        # passthrough the twp arguments
        h['twp-ox'] = h['twp-ox-in']
        h['twp-oy'] = h['twp-oy-in']
        h['twp-oz'] = h['twp-oz-in']
        h['twp-xx'] = h['twp-xx-in']
        h['twp-xy'] = h['twp-xy-in']
        h['twp-xz'] = h['twp-xz-in']
        h['twp-zx'] = h['twp-zx-in']
        h['twp-zy'] = h['twp-zy-in']
        h['twp-zz'] = h['twp-zz-in']
        h['twp-pose-a'] = h['twp-pose-a-in']  # LCNC-SUITE: display only

        _next_stat = _now + _STAT_PERIOD_S  # LCNC-SUITE

        # we only want to expose offsets when twp is not defined
        if not h['twp-is-defined']:
            s.poll() # get current values
            _g5x_offset = s.g5x_offset
            h['twp-ox-world']  = _g5x_offset[0]
            h['twp-oy-world']  = _g5x_offset[1]
            h['twp-oz-world']  = _g5x_offset[2]
        else : # use the values from the remap
            _g5x_offset = _g5x_offset or (0.0, 0.0, 0.0)  # LCNC-SUITE: throttle primed
            h['twp-ox-world'] = h['twp-ox-world-in']
            h['twp-oy-world'] = h['twp-oy-world-in']
            h['twp-oz-world'] = h['twp-oz-world-in']

        time.sleep(_PERIOD_S)  # LCNC-SUITE

except KeyboardInterrupt:
    raise SystemExit
