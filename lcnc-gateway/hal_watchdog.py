#!/usr/bin/env python3
"""HAL watchdog for webui-safety.

Loaded by LinuxCNC HAL config:  loadusr -W hal_watchdog.py
Listens for gateway heartbeat updates on a Unix socket.
When gateway disconnects, heartbeat stops toggling → downstream watchdog trips.
Pins survive gateway restart because this component is owned by LinuxCNC.
"""
import os
import sys
import json
import signal
import socket
import select
import time
import collections
import hal

import lcnc_trace as _trace
_trace.init("hal_watchdog")
_trace.install_crash_hooks("hal_watchdog")

import session_bind as _sb

try:
    import fcntl as _fcntl
    import struct as _struct
    _SIOCINQ = 0x541B
except Exception:
    _fcntl = None
    _struct = None
    _SIOCINQ = 0


def _client_inq(sock) -> int:
    """Bytes pending in the kernel recv buffer for the client socket.
    Linux only. Returns -1 if unavailable. Cheap (one ioctl)."""
    if sock is None or _fcntl is None or _struct is None:
        return -1
    try:
        buf = bytearray(4)
        _fcntl.ioctl(sock.fileno(), _SIOCINQ, buf)
        return _struct.unpack("I", bytes(buf))[0]
    except Exception:
        return -1

COMP_NAME = "webui-safety"
# Test override only (the stub-hal admission test runs a private socket);
# production always uses the default path the gateway dials.
SOCK_PATH = os.environ.get("WEBUI_SAFETY_SOCK", "/tmp/webui-safety.sock")

# ---- Create HAL component ----
try:
    comp = hal.component(COMP_NAME)
    comp.newpin("heartbeat", hal.HAL_BIT, hal.HAL_OUT)
    comp.newpin("connected", hal.HAL_BIT, hal.HAL_OUT)
    comp.newpin("tool-changed", hal.HAL_BIT, hal.HAL_OUT)
    comp.newpin("compensation-enable", hal.HAL_BIT, hal.HAL_OUT)
    comp.newpin("compensation-method", hal.HAL_U32, hal.HAL_OUT)
    # Safety-trip detection: watches oneshot.0.out (HAL heartbeat watchdog).
    # Runs in this independent userspace process so edges are captured even
    # if the gateway itself is frozen during the FALSE window.
    comp.newpin("hb-ok-in", hal.HAL_BIT, hal.HAL_IN)
    comp.newpin("trip-count", hal.HAL_U32, hal.HAL_OUT)
    # The sticky trip latch now lives in HAL (webui-hb-latch / estop_latch in the
    # servo thread) so it catches the oneshot falling edge in-cycle instead of
    # this 100 ms poll, which lost the race against a ~1 ms re-arm (issue #34).
    # We no longer own the latch; we only pulse its reset on operator E-Stop
    # Reset. trip-reset-out is held TRUE for one IPC-loop slice then dropped so
    # the next reset produces a fresh rising edge for estop_latch.reset.
    comp.newpin("trip-reset-out", hal.HAL_BIT, hal.HAL_OUT)
    comp.ready()
except Exception as e:
    print(f"HAL component '{COMP_NAME}' failed: {e}", file=sys.stderr, flush=True)
    sys.exit(1)

comp["compensation-method"] = 2  # default: cubic
comp["trip-reset-out"] = False
print("OK", flush=True)  # signal to loadusr -W

# ---- Unix socket server ----
if os.path.exists(SOCK_PATH):
    os.unlink(SOCK_PATH)

server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
server.bind(SOCK_PATH)
# Owner-only perms: this socket releases the safety trip-latch (trip_reset).
# Without this, any local user/process could connect and clear a latched trip.
os.chmod(SOCK_PATH, 0o600)
server.listen(_sb.MAX_PENDING + 1)
server.setblocking(False)

client = None
buf = ""

# ---- Session binding (2026-09-13): admit only a gateway bound to THIS session ----
# Identity = (linuxcncsvr pid, start ticks), discovered lazily and cached
# once — this helper never adopts a later LinuxCNC session. A connecting
# gateway must open with a hello naming that instance and its own pid
# (checked against SO_PEERCRED); anything else is answered `rejected` and
# closed WITHOUT touching the admitted client's pins. A connected gateway is
# never replaced while its socket is open (kernel EOF is the liveness
# signal) — see session_bind.py.
_instance = _sb.InstanceResolver("wd", emit=_trace.emit,
                                 comm=os.environ.get("WEBUI_INSTANCE_COMM", "linuxcncsvr"))


def _existing_healthy() -> bool:
    return client is not None


_gate = _sb.AdmissionGate("wd", _instance.current, _existing_healthy,
                          expected_ended=_instance.ended, emit=_trace.emit)
# Edge-detect state for oneshot.0.out (HAL heartbeat watchdog).
# Start None so the first read syncs without registering a phantom
# falling edge (oneshot.0.out is FALSE before the first heartbeat).
_last_hb_ok = None
_trip_count = 0
# Operator-reset pulse: trip-reset-out is driven TRUE on a trip_reset IPC msg and
# dropped after one slice so estop_latch.reset sees a clean rising edge each time.
_RESET_PULSE_S = 0.05
_reset_pulse_off_at = None

# === HB-RECV DIAGNOSTICS (permanent — quiet by design) === track last received heartbeat
# message from the gateway. The gateway sends heartbeats at ~30 Hz
# (every ~33 ms). If the kernel socket buffer or hal_watchdog's read
# loop introduces delivery latency that the gateway itself can't see,
# this catches it: a gap >100 ms between received messages means the
# gateway-to-watchdog pipe is the bottleneck, not the gateway's heart-
# beat loop. Output goes to its own file so we don't depend on halrun's
# stdout routing (which gets eaten by LinuxCNC's startup).
_T0 = time.monotonic()
_last_hb_recv = None  # monotonic time of last heartbeat msg received
_last_hb_recv_true = None  # monotonic time of last heartbeat msg with value=True
_RECV_GAP_THRESHOLD_S = 0.10
# _trace.init() ran at import top (line ~19), so log_dir() is resolved here.
# No silent /tmp fallback: if there's no log dir, disable the probe rather
# than scatter the file into cwd.
_HB_RECV_LOG_DIR = _trace.log_dir()
_HB_RECV_LOG_PATH = (
    os.path.join(_HB_RECV_LOG_DIR, "hal_watchdog.log") if _HB_RECV_LOG_DIR else None
)
_hb_recv_log = None
if _HB_RECV_LOG_PATH:
    try:
        _hb_recv_log = open(_HB_RECV_LOG_PATH, "w", buffering=1)  # line-buffered
    except OSError as _e:
        print(f"[HB-RECV] failed to open {_HB_RECV_LOG_PATH}: {_e}", flush=True)
else:
    print("[HB-RECV] no log dir resolved; instrumentation disabled", flush=True)


def _hb_recv_print(line: str) -> None:
    if _hb_recv_log is not None:
        try:
            _hb_recv_log.write(line + "\n")
        except OSError:
            pass  # safe-silent: instrumentation log; failure must not destabilize the watchdog


# P0.2: keep heartbeat arrivals in a bounded in-memory ring rather than writing
# every ~33 ms arrival to disk. Healthy operation does zero per-heartbeat disk
# I/O; the ring is dumped only on a trip-relevant event (a near-trip True-to-True
# gap, an operator trip-reset, or shutdown), so a trip bundle still carries the
# preceding heartbeat timeline. The lightweight [HB-RISING] one-liner still marks
# the smaller 200 ms jitter threshold (edge-triggered, rare).
_HB_RING_SIZE = 256        # ~8.5 s of arrivals at 30 Hz — ample pre-event context
_HB_DUMP_GAP_MS = 400      # dump the ring only on near-trip gaps (budget is 500 ms)
_hb_recv_ring = collections.deque(maxlen=_HB_RING_SIZE)


def _hb_recv_flush(reason: str) -> None:
    """Dump the heartbeat-arrival ring to the log — forensic, event-driven."""
    if _hb_recv_log is None or not _hb_recv_ring:
        return
    ts_now = int((time.monotonic() - _T0) * 1000)
    try:
        _hb_recv_log.write(f"[HB-DUMP] +{ts_now}ms reason={reason} n={len(_hb_recv_ring)}\n")
        for ts_ms, val in _hb_recv_ring:
            _hb_recv_log.write(f"  +{ts_ms}ms hb={'T' if val else 'F'}\n")
    except OSError:
        pass  # safe-silent: instrumentation log


_hb_recv_print(f"[HB-RECV] +{(time.monotonic() - _T0) * 1000:.0f}ms watchdog ready, instrumentation active")

# Cooperative shutdown: halrun sends SIGTERM on unload. select.select() is
# interrupted by the signal in the main thread, so the loop exits within
# one tick (~100 ms) instead of waiting for halrun's SIGKILL escalation.
_running = True
def _stop(*_):
    global _running
    _running = False
signal.signal(signal.SIGTERM, _stop)
signal.signal(signal.SIGINT, _stop)

# wd.tick_summary is emitted once per N ticks (~1 s at 10 Hz select
# cadence) by the shared Aggregator. `msgs`/`client_inq`/`reset_out`/
# `hb_ok` are point-in-time at emit (extras callback resets msgs).
_wd_msgs_processed = 0


def _wd_extras() -> dict:
    global _wd_msgs_processed
    out = {
        "msgs": _wd_msgs_processed,
        "client_inq": _client_inq(client),
        "pending": len(_gate),
        "reset_out": bool(comp["trip-reset-out"]),
        "hb_ok": bool(comp["hb-ok-in"]),
    }
    _wd_msgs_processed = 0
    return out


_wd_tick_agg = _trace.Aggregator(
    "wd.tick_summary", every=10, count_field="ticks", extra_fields=_wd_extras
)

def _consume_buf() -> None:
    """Parse every complete line in `buf` and drive the pins. Called for
    the admitted client on each recv AND right after admission (a gateway
    pipelines its first heartbeat behind the hello)."""
    global buf, _last_hb_recv, _last_hb_recv_true, _reset_pulse_off_at, _wd_msgs_processed
    while "\n" in buf:
        line, buf = buf.split("\n", 1)
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except Exception as _je:
            # A single malformed line must NOT fall into the
            # broad except below (which forces all pins LOW and
            # trips safety). Skip it like hal_reader does — a
            # bad byte is not a reason to ESTOP the machine.
            print(f"[WD] bad json from gateway: {_je}", flush=True)
            _trace.emit("wd.bad_msg", level="warn", err=str(_je))
            continue
        if "heartbeat" in msg:
            # === HB-RECV DIAGNOSTICS === log inter-arrival gap
            # for heartbeat messages. Gateway sends at ~33 ms
            # cadence; anything past 100 ms means delivery is
            # late from the watchdog's perspective regardless
            # of what the gateway thinks. Logged from the
            # process that actually drives the HAL pin, so a
            # gap >500 ms here would directly explain a
            # watchdog trip. Lower threshold (100 ms) catches
            # sub-trip jitter that compounds.
            _now = time.monotonic()
            _new_val = bool(msg["heartbeat"])
            # === HB-RECV DIAGNOSTICS === ring-buffer every heartbeat (P0.2: in-memory,
            # dumped only on trip-relevant events).
            # The HAL `oneshot` likely retriggers on rising
            # edge only — what matters is the time between
            # consecutive TRUE values, not raw inter-arrival.
            # Log every message (compact format) plus a
            # dedicated `[HB-RISING]` line for True-to-True
            # gaps over 200 ms so trip-relevant gaps are
            # easy to spot.
            ts_ms = int((_now - _T0) * 1000)
            _hb_recv_ring.append((ts_ms, _new_val))  # in-memory only (P0.2)
            if _new_val:
                if _last_hb_recv_true is not None:
                    rising_gap_ms = int((_now - _last_hb_recv_true) * 1000)
                    if rising_gap_ms > 200:
                        _hb_recv_print(
                            f"[HB-RISING] +{ts_ms}ms "
                            f"True-to-True gap {rising_gap_ms}ms"
                        )
                        if rising_gap_ms > _HB_DUMP_GAP_MS:
                            _hb_recv_flush(f"gap_{rising_gap_ms}ms")
                _last_hb_recv_true = _now
            _last_hb_recv = _now
            comp["heartbeat"] = _new_val
        if "connected" in msg:
            comp["connected"] = bool(msg["connected"])
        if "tool_changed" in msg:
            comp["tool-changed"] = bool(msg["tool_changed"])
        if "compensation_enable" in msg:
            comp["compensation-enable"] = bool(msg["compensation_enable"])
        if "compensation_method" in msg:
            comp["compensation-method"] = int(msg["compensation_method"])
        if msg.get("trip_reset"):
            # Pulse the HAL latch reset (rising edge). Held TRUE
            # until the pulse-off check above drops it next slice,
            # so the servo-thread estop_latch sees one clean edge.
            comp["trip-reset-out"] = True
            _reset_pulse_off_at = time.monotonic() + _RESET_PULSE_S
            print("[SAFETY] trip latch reset pulsed by operator", flush=True)
            _trace.emit("wd.trip_reset")
            _hb_recv_flush("trip_reset")  # capture pre-reset HB timeline
        _wd_msgs_processed += 1


try:
    while _running:
        socks = [server] + _gate.socks()
        if client is not None:
            socks.append(client)

        # 100ms select timeout → edge polling at ~10Hz. oneshot width is 500ms,
        # so a trip window is always ≥500ms wide; 100ms resolution never misses.
        _select_t0 = time.monotonic()
        readable, _, _ = select.select(socks, [], [], 0.1)
        _select_dt = (time.monotonic() - _select_t0) * 1000
        _wd_tick_agg.record(select_ms=_select_dt)

        # Best-effort FALSE-edge forensic on hb-ok-in. The SAFETY latch is now
        # the servo-thread estop_latch (webui-hb-latch); this 100 ms poll only
        # records trip-count + an hb-edge trace for diagnostics and may miss a
        # sub-100 ms blip — which the HAL latch still catches in-cycle (#34).
        hb_ok = bool(comp["hb-ok-in"])
        if _last_hb_ok is True and not hb_ok:
            _trip_count += 1
            comp["trip-count"] = _trip_count
            _trace.emit(
                "wd.hb_edge", level="warn",
                edge="falling", trip_count=_trip_count,
            )
        elif _last_hb_ok is False and hb_ok:
            _trace.emit(
                "wd.hb_edge", edge="rising", trip_count=_trip_count,
            )
        _last_hb_ok = hb_ok

        # Drop the reset pulse after one slice so the next operator reset
        # produces a fresh rising edge on webui-hb-latch.reset.
        if _reset_pulse_off_at is not None and time.monotonic() >= _reset_pulse_off_at:
            comp["trip-reset-out"] = False
            _reset_pulse_off_at = None

        for sock in readable:
            if sock is server:
                # New connection: pending until its hello passes admission.
                # No pin writes here — a rejected connect must not disturb
                # the admitted gateway's heartbeat.
                new_client, _ = server.accept()
                _gate.add(new_client)
            elif sock in _gate:
                admitted = _gate.handle_readable(sock)
                if admitted is not None:
                    # Admitted: it becomes THE gateway. Only an EOF'd (or
                    # absent) previous client can be replaced — the gate
                    # refuses duplicates while a client socket is open.
                    if client is not None:
                        try:
                            client.close()
                        except Exception:
                            pass  # safe-silent: socket close in error/cleanup path
                    # Reset pins until the new gateway proves itself
                    comp["connected"] = False
                    comp["heartbeat"] = False
                    comp["tool-changed"] = False
                    comp["compensation-enable"] = False
                    client = admitted.sock
                    buf = admitted.leftover
                    _last_hb_recv = None
                    _last_hb_recv_true = None
                    _consume_buf()
            elif sock is client:
                try:
                    data = client.recv(4096)
                    if not data:
                        # Gateway disconnected — force pins LOW for safety
                        comp["connected"] = False
                        comp["heartbeat"] = False
                        comp["tool-changed"] = False
                        comp["compensation-enable"] = False
                        client.close()
                        client = None
                        buf = ""
                        continue
                    buf += data.decode()
                    _consume_buf()
                except Exception:
                    # Socket error — force pins LOW for safety
                    comp["connected"] = False
                    comp["heartbeat"] = False
                    comp["tool-changed"] = False
                    comp["compensation-enable"] = False
                    try:
                        client.close()
                    except Exception:
                        pass  # safe-silent: socket close in error/cleanup path
                    client = None
                    buf = ""

        # Pending clients that never presented a hello are closed here
        # (after the readable pass, so a socket is handled at most once/tick).
        _gate.expire()

        # The Aggregator above flushes wd.tick_summary every 10
        # recordings; nothing to do here. msgs counter is consumed
        # by `_wd_extras` at flush time.
except KeyboardInterrupt:
    pass  # safe-silent: Ctrl-C → graceful shutdown via finally
finally:
    _hb_recv_flush("shutdown")  # final heartbeat timeline for post-mortem
    _gate.close_all()
    if client:
        try:
            client.close()
        except Exception:
            pass  # safe-silent: socket close in shutdown finally
    server.close()
    if os.path.exists(SOCK_PATH):
        os.unlink(SOCK_PATH)
    try:
        comp.exit()
    except Exception as e:
        print(f"[SAFETY] comp.exit failed: {e}", flush=True)
