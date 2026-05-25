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
import hal

import lcnc_trace as _trace
_trace.init("hal_watchdog")
_trace.install_crash_hooks("hal_watchdog")

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
SOCK_PATH = "/tmp/webui-safety.sock"

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
    # trip-latch gates the safety chain independently of the oneshot. Drops
    # FALSE on every falling edge of hb-ok-in and stays FALSE until the
    # operator's E-Stop Reset reaches us as {"trip_reset": true} on the IPC
    # socket. Starts TRUE so the chain isn't blocked before the first trip.
    comp.newpin("trip-latch", hal.HAL_BIT, hal.HAL_OUT)
    comp.ready()
except Exception as e:
    print(f"HAL component '{COMP_NAME}' failed: {e}", file=sys.stderr, flush=True)
    sys.exit(1)

comp["compensation-method"] = 2  # default: cubic
comp["trip-latch"] = True
print("OK", flush=True)  # signal to loadusr -W

# ---- Unix socket server ----
if os.path.exists(SOCK_PATH):
    os.unlink(SOCK_PATH)

server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
server.bind(SOCK_PATH)
server.listen(1)
server.setblocking(False)

client = None
buf = ""
# Edge-detect state for oneshot.0.out (HAL heartbeat watchdog).
# Start None so the first read syncs without registering a phantom
# falling edge (oneshot.0.out is FALSE before the first heartbeat).
_last_hb_ok = None
_trip_count = 0

# === TEMP HB-RECV PROBE === track time of last received heartbeat
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
_HB_RECV_LOG_PATH = os.path.join(_trace.log_dir() or "/tmp", "hal_watchdog.log")
try:
    _hb_recv_log = open(_HB_RECV_LOG_PATH, "w", buffering=1)  # line-buffered
except OSError as _e:
    _hb_recv_log = None
    print(f"[HB-RECV] failed to open {_HB_RECV_LOG_PATH}: {_e}", flush=True)


def _hb_recv_print(line: str) -> None:
    if _hb_recv_log is not None:
        try:
            _hb_recv_log.write(line + "\n")
        except OSError:
            pass  # safe-silent: instrumentation log; failure must not destabilize the watchdog


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
# cadence) by the shared Aggregator. `msgs`/`client_inq`/`trip_latch`/
# `hb_ok` are point-in-time at emit (extras callback resets msgs).
_wd_msgs_processed = 0


def _wd_extras() -> dict:
    global _wd_msgs_processed
    out = {
        "msgs": _wd_msgs_processed,
        "client_inq": _client_inq(client),
        "trip_latch": bool(comp["trip-latch"]),
        "hb_ok": bool(comp["hb-ok-in"]),
    }
    _wd_msgs_processed = 0
    return out


_wd_tick_agg = _trace.Aggregator(
    "wd.tick_summary", every=10, count_field="ticks", extra_fields=_wd_extras
)

try:
    while _running:
        socks = [server]
        if client is not None:
            socks.append(client)

        # 100ms select timeout → edge polling at ~10Hz. oneshot width is 500ms,
        # so a trip window is always ≥500ms wide; 100ms resolution never misses.
        _select_t0 = time.monotonic()
        readable, _, _ = select.select(socks, [], [], 0.1)
        _select_dt = (time.monotonic() - _select_t0) * 1000
        _wd_tick_agg.record(select_ms=_select_dt)

        # Falling-edge detection on hb-ok-in. Increment trip-count so the
        # gateway can read it via webui-monitor and register a new trip.
        # Also drop trip-latch FALSE to keep the safety chain broken after
        # oneshot auto-heals — operator must send trip_reset to re-arm.
        hb_ok = bool(comp["hb-ok-in"])
        if _last_hb_ok is True and not hb_ok:
            _trip_count += 1
            comp["trip-count"] = _trip_count
            comp["trip-latch"] = False
            _trace.emit(
                "wd.hb_edge", level="warn",
                edge="falling", trip_count=_trip_count,
            )
        elif _last_hb_ok is False and hb_ok:
            _trace.emit(
                "wd.hb_edge", edge="rising", trip_count=_trip_count,
            )
        _last_hb_ok = hb_ok

        for sock in readable:
            if sock is server:
                # New gateway connection — replace any existing
                new_client, _ = server.accept()
                new_client.setblocking(False)
                if client is not None:
                    try:
                        client.close()
                    except Exception:
                        pass  # safe-silent: socket close in error/cleanup path
                # Reset pins until new gateway proves itself
                comp["connected"] = False
                comp["heartbeat"] = False
                comp["tool-changed"] = False
                comp["compensation-enable"] = False
                client = new_client
                buf = ""
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
                    while "\n" in buf:
                        line, buf = buf.split("\n", 1)
                        line = line.strip()
                        if not line:
                            continue
                        msg = json.loads(line)
                        if "heartbeat" in msg:
                            # === TEMP HB-RECV PROBE === log inter-arrival gap
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
                            # === TEMP HB-RECV PROBE === log EVERY heartbeat.
                            # The HAL `oneshot` likely retriggers on rising
                            # edge only — what matters is the time between
                            # consecutive TRUE values, not raw inter-arrival.
                            # Log every message (compact format) plus a
                            # dedicated `[HB-RISING]` line for True-to-True
                            # gaps over 200 ms so trip-relevant gaps are
                            # easy to spot.
                            ts_ms = int((_now - _T0) * 1000)
                            _hb_recv_print(
                                f"[HB-RECV] +{ts_ms}ms hb={'T' if _new_val else 'F'}"
                            )
                            if _new_val:
                                if _last_hb_recv_true is not None:
                                    rising_gap_ms = int((_now - _last_hb_recv_true) * 1000)
                                    if rising_gap_ms > 200:
                                        _hb_recv_print(
                                            f"[HB-RISING] +{ts_ms}ms "
                                            f"True-to-True gap {rising_gap_ms}ms"
                                        )
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
                            comp["trip-latch"] = True
                            print("[SAFETY] trip-latch released by operator reset", flush=True)
                            _trace.emit("wd.trip_reset")
                        _wd_msgs_processed += 1
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

        # The Aggregator above flushes wd.tick_summary every 10
        # recordings; nothing to do here. msgs counter is consumed
        # by `_wd_extras` at flush time.
except KeyboardInterrupt:
    pass  # safe-silent: Ctrl-C → graceful shutdown via finally
finally:
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
