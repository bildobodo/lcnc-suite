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
import socket
import select
import hal

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

try:
    while True:
        socks = [server]
        if client is not None:
            socks.append(client)

        # 100ms select timeout → edge polling at ~10Hz. oneshot width is 500ms,
        # so a trip window is always ≥500ms wide; 100ms resolution never misses.
        readable, _, _ = select.select(socks, [], [], 0.1)

        # Falling-edge detection on hb-ok-in. Increment trip-count so the
        # gateway can read it via webui-monitor and register a new trip.
        # Also drop trip-latch FALSE to keep the safety chain broken after
        # oneshot auto-heals — operator must send trip_reset to re-arm.
        hb_ok = bool(comp["hb-ok-in"])
        if _last_hb_ok is True and not hb_ok:
            _trip_count += 1
            comp["trip-count"] = _trip_count
            comp["trip-latch"] = False
            print(f"[SAFETY] oneshot.0.out FALSE edge, trip-count={_trip_count}", flush=True)
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
                        pass
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
                            comp["heartbeat"] = bool(msg["heartbeat"])
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
                except Exception:
                    # Socket error — force pins LOW for safety
                    comp["connected"] = False
                    comp["heartbeat"] = False
                    comp["tool-changed"] = False
                    comp["compensation-enable"] = False
                    try:
                        client.close()
                    except Exception:
                        pass
                    client = None
                    buf = ""
except KeyboardInterrupt:
    pass
finally:
    if client:
        try:
            client.close()
        except Exception:
            pass
    server.close()
    if os.path.exists(SOCK_PATH):
        os.unlink(SOCK_PATH)
