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


class Refused(RuntimeError):
    """The gateway ANSWERED ok: false — a known refusal."""


class NoReply(RuntimeError):
    """No reply within the time — nothing is known of the command's fate."""


class TransportLost(RuntimeError):
    """The connection failed or closed while sending or waiting (R296 FI-I31:
    the library's ConnectionClosed is no RuntimeError — typed here, at the
    boundary; a programming error is none of these and stays itself)."""


class SimulatorClient:
    def __init__(self, token, session="test-suite-live-twp", auto_confirm=True, on_status=None, keep=None):
        self.token = token
        # live-twp confirms every simulated M6 itself; the native stage never
        # does (plan Codex R282–R284): its cases confirm the one request they
        # expect, by its sequence and tool
        self.auto_confirm = auto_confirm
        # each status frame, as it arrives: on_status(monotonic seconds, merged status)
        self.on_status = on_status
        # hello's session id keys the gateway's armed-resume hold: a second
        # client must never share the main one's
        self.session = session
        self.ws = None
        self.stop = threading.Event()
        self.replies = queue.Queue()
        self.status = {}
        self.error = None
        self.threads = []
        # the envelope beside `data` (native stage step 2): the error channel
        # rides ONE status tick and is gone after it, so every frame's errors
        # are kept with their receipt time; the run-from-line progress, the
        # published program's origin and the probe widgets' values as last sent
        self.errors: list = []            # (monotonic s, kind, text)
        self.rfl_status = None
        self.rfl_history: list = []       # (monotonic s, rfl_status) on each change
        self.preview_origin = None
        self.probe_results: dict = {}
        # every status frame RECEIVED, in receipt order: (monotonic s, the
        # `keep` fields of the merged status) — a case reads frames, never
        # re-reads of `status` (R292 FI-I24: a cache read is no observation)
        self.keep = tuple(keep) if keep else None
        self.frames: list = []

    def send(self, command):
        from websockets.exceptions import ConnectionClosed
        try:
            self.ws.send(json.dumps(command))
        except (ConnectionClosed, OSError) as e:
            raise TransportLost(f"the connection closed while sending: {e!r}") from e

    def start(self):
        from websockets.sync.client import connect
        self.ws = connect("ws://127.0.0.1:8000/ws?" + urlencode({"token": self.token}),
                          max_size=None, close_timeout=2)
        self.threads = [threading.Thread(target=self.receive, daemon=True),
                        threading.Thread(target=self.heartbeat, daemon=True)]
        for thread in self.threads:
            thread.start()
        self.request("hello", session=self.session)
        self.request("arm", armed=True)

    def receive(self):
        import msgspec
        confirmed = None
        try:
            for raw in self.ws:
                msg = msgspec.msgpack.decode(raw) if isinstance(raw, bytes) else json.loads(raw)
                confirmed = self.take(msg, confirmed)
            if not self.stop.is_set():
                self.error = "Simulator WebSocket closed during the gate"
        except Exception as exc:
            if not self.stop.is_set():
                self.error = str(exc)

    def take(self, msg, confirmed=None):
        """One message: a STATUS frame (full or delta — never a reply that
        carries data, R286 FI-I23) updates the status and is reported with
        its arrival time; a reply goes to the queue. Returns the request seq
        last confirmed."""
        if msg.get("type") in ("status", "status_delta") and isinstance(msg.get("data"), dict):
            now = time.monotonic()
            self.status.update(msg["data"])
            for kind, text in msg.get("errors") or []:
                self.errors.append((now, kind, text))
            if "rfl_status" in msg and msg["rfl_status"] != self.rfl_status:
                self.rfl_status = msg["rfl_status"]
                self.rfl_history.append((now, msg["rfl_status"]))
            if "preview_origin" in msg:
                self.preview_origin = msg["preview_origin"]
            if isinstance(msg.get("probe_results"), dict):
                self.probe_results.update(msg["probe_results"])
            if self.keep is not None:
                self.frames.append((now, {k: self.status.get(k) for k in self.keep}))
            if self.on_status:
                self.on_status(now, dict(self.status))
            requested = self.status.get("tool_change_requested", False)
            seq = self.status.get("tool_change_seq")
            if self.auto_confirm and requested and seq != confirmed:
                # once per request, naming the request it answers
                # (button gates BG-17)
                self.send({"cmd": "confirm_tool_change", "request": seq})
                confirmed = seq
        if "ok" in msg:
            self.replies.put(msg)
        return confirmed

    def heartbeat(self):
        try:
            while not self.stop.wait(0.5):
                self.send({"cmd": "heartbeat"})
        except Exception as exc:
            if not self.stop.is_set():
                self.error = str(exc)

    def request(self, cmd, **kwargs):
        if self.error:
            raise TransportLost(self.error)
        self.send({"cmd": cmd, **kwargs})
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            if self.error:
                raise TransportLost(self.error)
            try:
                reply = self.replies.get(timeout=0.5)
            except queue.Empty:
                continue
            # hello and arm are legacy handshakes without a cmd field.
            # Await hello before sending arm so their replies cannot shift.
            if reply.get("cmd") == cmd or (cmd in ("hello", "arm") and "cmd" not in reply):
                if not reply["ok"]:
                    raise Refused(f"{cmd} refused: {reply.get('error')}")
                return reply
        raise NoReply(f"No gateway reply to {cmd}")

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

    def close(self, strict=False):
        """Abort and disarm, then close. `strict` (the native stage) raises a
        failed abort / disarm — its own ending must not be silent (R287)."""
        failure = None
        if self.ws:
            try:
                self.request("abort")
                self.request("arm", armed=False)
            except Exception as e:
                failure = e  # socket loss itself triggers the gateway's stop path
            self.stop.set()
            self.ws.close()
        for thread in self.threads:
            thread.join(timeout=3)
        if strict and failure is not None:
            raise RuntimeError(f"the client's ending failed: {failure}")


def gateway_load(path, token):
    """Load `path` the way the operator does: the gateway's own load_file —
    the only load it takes as the LOADED program (review R15 B2: a bare
    program_open is a STAT.file flip it ignores, and the preview never
    follows it). load_file needs an armed client: a short one of its own,
    which disarms before it closes — an armed client's disconnect would
    abort the machine. Returns the reply; raises on a refusal."""
    client = SimulatorClient(token, session="test-suite-live-load")
    client.start()
    try:
        return client.request("load_file", path=str(path))
    finally:
        try:
            client.request("arm", armed=False)
        finally:
            client.stop.set()
            client.ws.close()
            for thread in client.threads:
                thread.join(timeout=3)
