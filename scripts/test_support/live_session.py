"""Armed browser stand-in, used only after the live runner's simulator checks.

Keeps heartbeats flowing independently of blocking NML/gate subprocesses and
confirms simulated M6 requests. No reconnect, automatic trip acknowledgement,
or automatic re-arming: losing the session must fail the run.
"""
import json
import queue
import threading
import time
from urllib.parse import urlencode


class SimulatorClient:
    def __init__(self, token):
        self.token = token
        self.ws = None
        self.stop = threading.Event()
        self.replies = queue.Queue()
        self.status = {}
        self.error = None
        self.threads = []

    def send(self, command):
        self.ws.send(json.dumps(command))

    def start(self):
        from websockets.sync.client import connect
        self.ws = connect("ws://127.0.0.1:8000/ws?" + urlencode({"token": self.token}),
                          max_size=None, close_timeout=2)
        self.threads = [threading.Thread(target=self.receive, daemon=True),
                        threading.Thread(target=self.heartbeat, daemon=True)]
        for thread in self.threads:
            thread.start()
        self.request("hello", session="test-suite-live-twp")
        self.request("arm", armed=True)

    def receive(self):
        import msgspec
        confirming = False
        try:
            for raw in self.ws:
                msg = msgspec.msgpack.decode(raw) if isinstance(raw, bytes) else json.loads(raw)
                if isinstance(msg.get("data"), dict):
                    self.status.update(msg["data"])
                    requested = self.status.get("tool_change_requested", False)
                    if requested and not confirming:
                        self.send({"cmd": "confirm_tool_change"})
                    confirming = bool(requested)
                if "ok" in msg:
                    self.replies.put(msg)
            if not self.stop.is_set():
                self.error = "Simulator WebSocket closed during the gate"
        except Exception as exc:
            if not self.stop.is_set():
                self.error = str(exc)

    def heartbeat(self):
        try:
            while not self.stop.wait(0.5):
                self.send({"cmd": "heartbeat"})
        except Exception as exc:
            if not self.stop.is_set():
                self.error = str(exc)

    def request(self, cmd, **kwargs):
        self.send({"cmd": cmd, **kwargs})
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            if self.error:
                raise RuntimeError(self.error)
            try:
                reply = self.replies.get(timeout=0.5)
            except queue.Empty:
                continue
            # hello and arm are legacy handshakes without a cmd field.
            # Await hello before sending arm so their replies cannot shift.
            if reply.get("cmd") == cmd or (cmd in ("hello", "arm") and "cmd" not in reply):
                if not reply["ok"]:
                    raise RuntimeError(f"{cmd} refused: {reply.get('error')}")
                return reply
        raise RuntimeError(f"No gateway reply to {cmd}")

    def prepare(self, joint_count=6):
        import linuxcnc
        stat = linuxcnc.stat()

        def wait_state(state, label):
            deadline = time.monotonic() + 10
            while time.monotonic() < deadline:
                if self.error:
                    raise RuntimeError(self.error)
                stat.poll()
                # Commands acknowledge submission; both controller and
                # broadcast/policy snapshot must have observed the transition.
                ready = self.status.get("is_estop") is False
                if state == linuxcnc.STATE_ON:
                    ready = ready and self.status.get("is_enabled") is True
                if stat.task_state == state and ready:
                    return
                time.sleep(0.05)
            raise RuntimeError(f"Simulator did not reach {label}")

        # Give the connected/heartbeat HAL pins one update before power-on.
        time.sleep(1)
        stat.poll()
        if stat.task_state == linuxcnc.STATE_ESTOP:
            self.request("estop_reset")
            wait_state(linuxcnc.STATE_ESTOP_RESET, "E-stop reset")
        stat.poll()
        if stat.task_state != linuxcnc.STATE_ON:
            self.request("machine_on")
            wait_state(linuxcnc.STATE_ON, "machine ON")
        self.request("home_all")
        deadline = time.monotonic() + 60
        while time.monotonic() < deadline:
            stat.poll()
            if all(stat.homed[:joint_count]) and stat.inpos:
                return
            time.sleep(0.1)
        raise RuntimeError("Simulator homing did not complete")

    def close(self):
        if self.ws:
            try:
                self.request("abort")
                self.request("arm", armed=False)
            except Exception:
                pass  # socket loss itself triggers the gateway's stop path
            self.stop.set()
            self.ws.close()
        for thread in self.threads:
            thread.join(timeout=3)
