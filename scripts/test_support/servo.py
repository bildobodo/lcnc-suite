"""The native stage's servo measurement (plan Codex R299–R301, step 2c).

A `sampler` loaded at run time into the TEST instance (never the LAN's; the
copy stays byte-identical, every halcmd change is in the report) records,
each servo period, the three joints' pos-fb and vel-cmd, motion.program-line,
motion.in-position and a marker signal the run sets. `halsampler -t`, line
buffered, carries the samples out; a reader thread stamps each line with
its RECEIPT time on the run's monotonic clock — a sample received before a
reply was captured before it; a later receipt proves nothing, and a sample
number is no time (late servo invocations leave no gap — R300).

The run OWNS the sampler (R301): every measurement halcmd passes ONE gate,
which refuses any change while a section is open — only the mark and
reading commands pass. A change by a foreign process is not detected: a
named limit. Each attempt is one SECTION between its own start and end
marks: the start mark is awaited before the trigger, the end mark is set
after the case's completion and its post window and read until RECEIVED;
anything the section's integrity does not show is a problem — incomplete,
never PASS."""
from __future__ import annotations

import math
import re
import subprocess
import threading
import time

CHANNELS = ("joint.0.pos-fb", "joint.1.pos-fb", "joint.2.pos-fb",
            "joint.0.vel-cmd", "joint.1.vel-cmd", "joint.2.vel-cmd",
            "motion.program-line", "motion.in-position")
CFG = "ffffffsbs"                 # the channels above, then the mark
MARK_SIGNAL = "natv-mark"
MARK_INDEX = len(CHANNELS)
DEPTH = 65536
READ_ONLY = ("getp", "gets", "show")


class GateRefused(RuntimeError):
    """A change to the measurement's HAL while a section is open."""


def _halcmd(argv):
    r = subprocess.run(argv, capture_output=True, text=True, timeout=10)
    if r.returncode:
        raise RuntimeError(f"{' '.join(argv)}: {(r.stderr or r.stdout).strip()}")
    return r.stdout


class HalGate:
    """The ONE door for the measurement's halcmd calls (R301)."""

    def __init__(self, run=None):
        self.run = run or _halcmd
        self.open_section = None
        self.log: list = []

    def __call__(self, *args):
        verb = args[0]
        if self.open_section is not None and not (
                verb in READ_ONLY or (verb == "sets" and len(args) > 1 and args[1] == MARK_SIGNAL)):
            raise GateRefused(f"halcmd {' '.join(map(str, args))} refused: section {self.open_section} is open")
        self.log.append([str(a) for a in args])
        return self.run(["halcmd", *map(str, args)])


def signal_of(show_pin: str, pin: str):
    """The signal a pin is on, from `halcmd show pin` — None when it is on none."""
    for line in show_pin.splitlines():
        parts = line.split()
        if pin in parts:
            i = parts.index(pin)
            if len(parts) > i + 2 and parts[i + 1] in ("==>", "<==", "<=>"):
                return parts[i + 2]
            return None
    raise RuntimeError(f"{pin} not shown by halcmd")


def thread_of(show_thread: str) -> dict:
    """The servo thread's EFFECTIVE period and its functions in order, from `halcmd show thread`."""
    period, functions, inside = None, [], False
    for line in show_thread.splitlines():
        if "servo-thread" in line:
            period, inside = int(line.split()[0]), True
            continue
        m = re.match(r"^\s+\d+\s+(\S+)\s*$", line)
        if inside and m:
            functions.append(m.group(1))
        elif inside and line.strip():
            inside = False
    if period is None:
        raise RuntimeError("servo-thread not shown by halcmd")
    return {"period_ns": period, "functions": functions}


def _value(token: str, kind: str):
    if kind == "f":
        return float(token)
    if token in ("TRUE", "FALSE"):
        return int(token == "TRUE")
    return int(token)


def parse_line(line: str):
    """One `halsampler -t` line → (sample number, values in CFG order) — None
    for anything else (an `overrun` notice, a short or malformed line)."""
    parts = line.split()
    if len(parts) != 1 + len(CFG):
        return None
    try:
        return int(parts[0]), tuple(_value(t, k) for t, k in zip(parts[1:], CFG))
    except ValueError:
        return None


def setup(gate: HalGate) -> dict:
    """Load and wire the sampler into the running test instance; the report
    of what changed and the thread as read back afterwards."""
    gate("loadrt", "sampler", f"depth={DEPTH}", f"cfg={CFG}")
    wiring = []
    for i, pin in enumerate(CHANNELS):
        sig = signal_of(gate("show", "pin", pin), pin)
        if sig:
            gate("linksp", sig, f"sampler.0.pin.{i}")
        else:
            sig = f"natv-ch{i}"
            gate("net", sig, pin, f"sampler.0.pin.{i}")
        wiring.append({"pin": pin, "signal": sig, "channel": i})
    gate("newsig", MARK_SIGNAL, "s32")
    gate("linksp", MARK_SIGNAL, f"sampler.0.pin.{MARK_INDEX}")
    gate("addf", "sampler.0", "servo-thread")
    # the wiring READ BACK from the sampler's own pins (R302 FI-I34)
    for w in wiring:
        pin = f"sampler.0.pin.{w['channel']}"
        w["read_back"] = signal_of(gate("show", "pin", pin), pin)
        if w["read_back"] != w["signal"]:
            raise RuntimeError(f"{pin} reads back on {w['read_back']}, wired to {w['signal']}")
    mark_pin = f"sampler.0.pin.{MARK_INDEX}"
    mark_read_back = signal_of(gate("show", "pin", mark_pin), mark_pin)
    if mark_read_back != MARK_SIGNAL:
        raise RuntimeError(f"{mark_pin} reads back on {mark_read_back}, not {MARK_SIGNAL}")
    thread = thread_of(gate("show", "thread", "servo-thread"))
    if not thread["functions"] or thread["functions"][-1] != "sampler.0":
        raise RuntimeError(f"sampler.0 is not the servo thread's last function: {thread['functions']}")
    return {"changes": [list(c) for c in gate.log], "wiring": wiring, "mark_read_back": mark_read_back,
            "thread": thread}


class Reader:
    """`stdbuf -oL halsampler -c 0 -t` read by a thread: (receipt time, n, values) per sample."""

    def __init__(self, popen=subprocess.Popen, clock=time.monotonic):
        self.popen, self.clock = popen, clock
        self.samples: list = []
        self.overrun = False
        self.malformed = 0
        self.alive = False
        self.proc = None

    def start(self):
        self.proc = self.popen(["stdbuf", "-oL", "halsampler", "-c", "0", "-t"], stdout=subprocess.PIPE,
                               stderr=subprocess.STDOUT, text=True, bufsize=1)
        self.alive = True
        threading.Thread(target=self._read, daemon=True).start()

    def _read(self):
        try:
            for line in self.proc.stdout:
                t = self.clock()
                if "overrun" in line.lower():
                    self.overrun = True
                    continue
                parsed = parse_line(line)
                if parsed is None:
                    self.malformed += 1
                    continue
                self.samples.append((t, parsed[0], parsed[1]))
        finally:
            self.alive = False

    def wait_for_mark(self, mark: int, deadline_s: float, since: int = 0):
        """The index of the first sample with `mark` RECEIVED, from `since`; None at the deadline."""
        end = time.monotonic() + deadline_s
        i = since
        while True:
            while i < len(self.samples):
                if self.samples[i][2][MARK_INDEX] == mark:
                    return i
                i += 1
            if time.monotonic() > end or not self.alive:
                return None
            time.sleep(0.005)

    def stop(self):
        if self.proc and self.proc.poll() is None:
            self.proc.terminate()
            try:
                self.proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.proc.kill()


def section(stream, start_mark: int, end_mark: int, integrity: dict) -> dict:
    """The samples of ONE attempt — between the first sample with its start
    mark and the first with its end mark, its own mark only — and every flaw
    its integrity shows (R300/R301): no end mark received, a number gap, a
    non-finite value, enable not TRUE at either end, the overrun counter
    changed, the FIFO at its depth, the reader's overrun notice, an
    effective period other than the INI's."""
    problems = []
    si = next((i for i, s in enumerate(stream) if s[2][MARK_INDEX] == start_mark), None)
    if si is None:
        return {"samples": [], "problems": ["start mark not received"], "first_n": None, "end_n": None,
                "integrity": integrity}
    ei = next((i for i in range(si + 1, len(stream)) if stream[i][2][MARK_INDEX] == end_mark), None)
    span = stream[si:] if ei is None else stream[si:ei + 1]
    if ei is None:
        problems.append("end mark not received — the section's end unread")
    inner = span if ei is None else span[:-1]
    body = [s for s in inner if s[2][MARK_INDEX] == start_mark]
    foreign = [s for s in inner if s[2][MARK_INDEX] != start_mark]
    if foreign:
        # another mark BETWEEN the marks breaks the coverage (R302 FI-I33);
        # one before the start is another attempt's and never reaches here
        problems.append(f"a foreign mark inside the section ({foreign[0][2][MARK_INDEX]} at sample {foreign[0][1]})")
    gaps = [(a[1], b[1]) for a, b in zip(span, span[1:]) if b[1] != a[1] + 1]
    if gaps:
        problems.append(f"a number gap ({gaps[0][0]} → {gaps[0][1]})")
    if any(not math.isfinite(v) for _, _, vals in body for v, k in zip(vals, CFG) if k == "f"):
        problems.append("a non-finite channel value")
    if not (integrity.get("enable_start") is True and integrity.get("enable_end") is True):
        problems.append("sampler enable not TRUE at both ends")
    if integrity.get("overruns_end") != integrity.get("overruns_start"):
        problems.append("the overrun counter rose")
    if integrity.get("depth_end") is None or integrity["depth_end"] >= integrity.get("depth", DEPTH):
        problems.append("the FIFO at its depth")
    if integrity.get("reader_overrun"):
        problems.append("the reader reported an overrun")
    if integrity.get("reader_alive") is False:
        problems.append("the reader ended")
    ts, te = integrity.get("thread_start"), integrity.get("thread_end")
    if ts is not None or te is not None:
        if ts != te:
            problems.append("the servo thread's functions changed during the section")
        elif not ts or ts[-1] != "sampler.0":
            problems.append("sampler.0 is not the servo thread's last function")
    if integrity.get("period_ns") != integrity.get("ini_period_ns"):
        problems.append(f"the effective period {integrity.get('period_ns')} ns differs from the INI's "
                        f"{integrity.get('ini_period_ns')}")
    return {"samples": body, "problems": problems, "first_n": body[0][1] if body else None,
            "end_n": stream[ei][1] if ei is not None else None, "integrity": integrity}


class Measurement:
    """The attempts of one run: begin awaits the start mark, end sets the end
    mark, reads until it is received and judges the section."""

    def __init__(self, gate: HalGate, reader: Reader, ini_period_ns: int, period_ns: int,
                 mark_wait_s: float = 5.0):
        self.gate, self.reader = gate, reader
        self.ini_period_ns, self.period_ns = ini_period_ns, period_ns
        self.mark_wait_s = mark_wait_s
        self.k = 0

    def _getp(self, pin):
        return self.gate("getp", pin).strip()

    def begin(self) -> dict:
        self.k += 1
        start, end = 2 * self.k + 1, 2 * self.k + 2
        attempt = {"k": self.k, "start": start, "end": end, "since": len(self.reader.samples),
                   "log_from": len(self.gate.log),
                   "enable_start": self._getp("sampler.0.enable") == "TRUE",
                   "overruns_start": int(self._getp("sampler.0.overruns")),
                   "thread_start": thread_of(self.gate("show", "thread", "servo-thread"))["functions"]}
        self.gate("sets", MARK_SIGNAL, start)
        if self.reader.wait_for_mark(start, self.mark_wait_s, attempt["since"]) is None:
            raise RuntimeError(f"servo: the start mark {start} was not received — the measurement is broken")
        self.gate.open_section = self.k
        return attempt

    def end(self, attempt: dict) -> dict:
        """The end mark, read until received, the integrity read at this end;
        the section closes in the gate on EVERY path (R302 FI-I31) — a
        failing read raises after it."""
        try:
            self.gate("sets", MARK_SIGNAL, attempt["end"])
            self.reader.wait_for_mark(attempt["end"], self.mark_wait_s, attempt["since"])
            integrity = {"enable_start": attempt["enable_start"],
                         "enable_end": self._getp("sampler.0.enable") == "TRUE",
                         "overruns_start": attempt["overruns_start"],
                         "overruns_end": int(self._getp("sampler.0.overruns")),
                         "depth_end": int(self._getp("sampler.0.curr-depth")), "depth": DEPTH,
                         "period_ns": self.period_ns, "ini_period_ns": self.ini_period_ns,
                         "thread_start": attempt["thread_start"],
                         "thread_end": thread_of(self.gate("show", "thread", "servo-thread"))["functions"],
                         "reader_overrun": self.reader.overrun, "reader_alive": self.reader.alive}
        finally:
            self.gate.open_section = None
        sec = section(self.reader.samples[attempt["since"]:], attempt["start"], attempt["end"], integrity)
        sec.update(attempt=attempt["k"], start_mark=attempt["start"], end_mark=attempt["end"],
                   hal=[list(c) for c in self.gate.log[attempt["log_from"]:]])
        return sec
