"""A disarmed WebSocket client that only heartbeats (the HAL watchdog needs at
least one connected client), for a sim whose INI requires WEBUI_TOKEN: the
token is read from the INI given as argv[1] and never printed."""
import json, os, re, sys, threading, time
from pathlib import Path
from urllib.parse import urlencode
from websockets.sync.client import connect
import msgspec
m = re.search(r"^WEBUI_TOKEN\s*=\s*(\S+)", Path(sys.argv[1]).read_text(), re.M)
ws = connect("ws://127.0.0.1:8000/ws?" + urlencode({"token": m.group(1) if m else ""}), max_size=None, close_timeout=2)
ws.send(json.dumps({"cmd": "hello", "session": "button-gates-operator-test-keepalive"}))
BEAT = Path(__file__).with_suffix(".beat.json")
PORT = ws.socket.getsockname()[1]
def drain():
    # every pong — the gateway's answer to a heartbeat — leaves its trace for
    # the native stage's restore proof (Codex R287 FI-I21): pid, port, count
    pongs = 0
    for raw in ws:
        try:
            # the gateway's frames: MessagePack by default (ws_fanout), JSON text otherwise (R288)
            msg = msgspec.msgpack.decode(raw) if isinstance(raw, bytes) else json.loads(raw)
        except (ValueError, msgspec.DecodeError):
            continue
        if not isinstance(msg, dict):
            continue
        if msg.get("type") == "pong":
            pongs += 1
            tmp = BEAT.with_suffix(".tmp")
            tmp.write_text(json.dumps({"pid": os.getpid(), "local_port": PORT, "pongs": pongs, "t_wall": time.time()}))
            tmp.replace(BEAT)
threading.Thread(target=drain, daemon=True).start()
while True:
    ws.send(json.dumps({"cmd": "heartbeat"}))
    time.sleep(0.5)
