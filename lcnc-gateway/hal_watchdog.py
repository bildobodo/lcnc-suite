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
    comp.ready()
except Exception as e:
    print(f"HAL component '{COMP_NAME}' failed: {e}", file=sys.stderr, flush=True)
    sys.exit(1)

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

try:
    while True:
        socks = [server]
        if client is not None:
            socks.append(client)

        readable, _, _ = select.select(socks, [], [], 1.0)

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
                except Exception:
                    # Socket error — force pins LOW for safety
                    comp["connected"] = False
                    comp["heartbeat"] = False
                    comp["tool-changed"] = False
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
