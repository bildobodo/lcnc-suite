"""F5, the routine's own sequence (Codex R127 VP-I77): T7 M600 on the running,
shipped XYZAC sim — tool_touch_off.ngc's fast G38.3, its retract, its slow
G38.2, as the routine runs them. Sampled: the machine Z, STAT.probed_position Z,
probe_tripped / probe_val (a fast stat poll), and the probe chain's runtime
state (halcmd, every 100 ms: the setter's enable, manual input, tool length,
the external Z offset). Logged before: the INI values, the servo period, the
toolsetter parameters from the var file, the plate against #3100–#3102, the
driver of motion.probe-input. The target is checked ONCE, before connecting.
Restores T7's table length and an empty spindle; tears the sim down with the
client still connected.
    f5_seq.py <ini> <report.txt>"""
import asyncio, json, os, signal, subprocess, sys, threading, time
import linuxcnc
sys.path.insert(0, "/home/cnc/lcnc-suite/scripts")
import toolsetter_readback_check as rb

TOOL = 7
rows = []


def say(m):
    rows.append(m)
    print(m, flush=True)


def hal(cmd):
    return subprocess.run(["halcmd"] + cmd, capture_output=True, text=True).stdout.strip()


def ini_f(ini, sec, key):
    v = rb.ini_value(ini, sec, key)
    return float(v) if v not in (None, "") else None


def var_values(path, keys):
    out = {}
    with open(path) as f:
        for ln in f:
            p = ln.split()
            if len(p) >= 2 and p[0].isdigit() and int(p[0]) in keys:
                out[int(p[0])] = float(p[1])
    return out


class Sampler(threading.Thread):
    """machine Z, probed Z, tripped, probe value — as fast as stat polls."""
    def __init__(self):
        super().__init__(daemon=True)
        self.s = linuxcnc.stat()
        self.rows, self.stop = [], False

    def run(self):
        while not self.stop:
            self.s.poll()
            self.rows.append((time.monotonic(), self.s.actual_position[0], self.s.actual_position[1],
                              self.s.actual_position[2], self.s.probed_position[2], self.s.probe_tripped,
                              self.s.probe_val, self.s.tool_in_spindle))
            time.sleep(0.0003)


class HalSampler(threading.Thread):
    PINS = ["sim-toolsetter.0.enable", "sim-toolsetter.0.manual", "sim-toolsetter.0.tool-length",
            "axis.z.eoffset", "axis.z.eoffset-enable"]

    def __init__(self):
        super().__init__(daemon=True)
        self.rows, self.stop = [], False

    def run(self):
        while not self.stop:
            self.rows.append((time.monotonic(), {p: hal(["getp", p]) for p in self.PINS}))
            time.sleep(0.1)


async def wait_still(s, timeout=300):
    t0 = time.monotonic()
    await asyncio.sleep(0.3)
    while time.monotonic() - t0 < timeout:
        s.poll()
        if s.interp_state == linuxcnc.INTERP_IDLE and s.inpos and abs(s.current_vel) < 1e-6 and not hal(["getp", "iocontrol.0.tool-change"]) == "TRUE":
            return True
        await asyncio.sleep(0.1)
    return False


async def confirmer(gw, stop):
    while not stop.is_set():
        if hal(["getp", "iocontrol.0.tool-change"]) == "TRUE":
            await asyncio.sleep(0.3)
            r = await gw.cmd({"cmd": "confirm_tool_change"})
            say(f"tool change confirmed ok={r.get('ok')} {r.get('error') or ''}")
            t0 = time.monotonic()
            while hal(["getp", "iocontrol.0.tool-change"]) == "TRUE" and time.monotonic() - t0 < 30:
                await asyncio.sleep(0.1)
        await asyncio.sleep(0.2)


async def main(ini, report):
    cfg = os.path.dirname(os.path.abspath(ini))
    var = os.path.join(cfg, rb.ini_value(ini, "RS274NGC", "PARAMETER_FILE"))
    token = rb.ini_value(ini, "DISPLAY", "WEBUI_TOKEN") or ""
    port = int(rb.ini_value(ini, "DISPLAY", "WEBUI_PORT") or 8000)
    url = f"ws://127.0.0.1:{port}/ws" + (f"?token={token}" if token else "")
    # the measurement basis, before anything is sent
    iv = {k: ini_f(ini, *k.split(".")) for k in ("AXIS_Z.MAX_VELOCITY", "AXIS_Z.MAX_ACCELERATION", "AXIS_Z.OFFSET_AV_RATIO",
                                                "AXIS_Z.MIN_LIMIT", "TRAJ.MAX_LINEAR_VELOCITY", "TRAJ.MAX_LINEAR_ACCELERATION",
                                                "EMCMOT.SERVO_PERIOD")}
    say(f"INI {json.dumps(iv)}")
    vv = var_values(var, set(range(3004, 3011)) | set(range(3100, 3117)) | {3014, 5181, 5182, 5183})
    say(f"var file (as of the last synch) {json.dumps({str(k): v for k, v in sorted(vv.items())})}")
    plate = {a: float(hal(["getp", f"sim-toolsetter.0.plate-{a}"])) for a in "xyz"}
    say(f"plate {plate} vs #3100–#3102 {vv.get(3100)}, {vv.get(3101)}, {vv.get(3102)}: "
        f"{'equal' if (plate['x'], plate['y'], plate['z']) == (vv.get(3100), vv.get(3101), vv.get(3102)) else 'DIFFERENT'}")
    say("probe chain: " + " | ".join(l.strip() for l in hal(["show", "sig", "probe-input"]).splitlines()[1:] if l.strip()))
    say("setter pins before: " + " ".join(f"{p.split('.')[-1]}={hal(['getp', p])}" for p in
                                          ("sim-toolsetter.0.enable", "sim-toolsetter.0.manual", "sim-toolsetter.0.radius",
                                           "sim-toolsetter.0.tool-length", "axis.z.eoffset", "axis.z.eoffset-enable")))
    s = linuxcnc.stat()
    s.poll()
    L0 = next(t.zoffset for t in s.tool_table if t.id == TOOL)
    tool0 = s.tool_in_spindle
    say(f"T{TOOL} table length {L0:.4f}; spindle T{tool0}")
    smp, hsmp = Sampler(), HalSampler()
    stop = asyncio.Event()
    async with rb.Gateway(url, token, port) as gw, rb.Gateway(url, token, port) as conf:
        ok = (await rb.until(gw, {"cmd": "estop_reset"}, lambda: (s.poll(), s.task_state != linuxcnc.STATE_ESTOP)[1])
              and await rb.until(gw, {"cmd": "machine_on"}, lambda: (s.poll(), s.task_state == linuxcnc.STATE_ON)[1]))
        await asyncio.sleep(1.5)
        ok = ok and await rb.until(gw, {"cmd": "home_all"}, lambda: (s.poll(), all(s.homed[:s.joints]) and s.inpos)[1], timeout=120)
        for _ in range(20):          # the gateway's own status catches up with the homing
            r = await rb.send(gw, {"cmd": "mdi", "text": "G90"})
            if r.get("ok"):
                break
            await asyncio.sleep(1.0)
        say(f"setup: on, homed, the gateway agrees: {ok and bool(r.get('ok'))}")
        if not (ok and r.get("ok")):
            return
        ct = asyncio.ensure_future(confirmer(conf, stop))
        smp.start(); hsmp.start()
        t_start = time.monotonic()
        r = await rb.send(gw, {"cmd": "mdi", "text": f"T{TOOL} M600"}, timeout=300)
        still = await wait_still(s)
        smp.stop = hsmp.stop = True
        smp.join(); hsmp.join()
        say(f"T{TOOL} M600: mdi ok={r.get('ok')} {r.get('error') or ''} still={still} "
            f"{len(smp.rows)} stat samples in {smp.rows[-1][0] - smp.rows[0][0]:.1f} s")
        s.poll()
        L1 = next(t.zoffset for t in s.tool_table if t.id == TOOL)
        say(f"T{TOOL} table length after the routine {L1:.4f} (written by G10 L1)")
        # restore: the table length, no offset, an empty spindle, Z up
        for cmd in ("G49", f"G10 L1 P{TOOL} Z{L0}", f"M61 Q{tool0}", "G90 G53 G0 Z0"):
            rr = await rb.send(gw, {"cmd": "mdi", "text": cmd})
            await wait_still(s, 60)
            say(f"restore {cmd}: ok={rr.get('ok')}")
        s.poll()
        say(f"restored: T{TOOL} {next(t.zoffset for t in s.tool_table if t.id == TOOL):.4f}, spindle T{s.tool_in_spindle}")
        stop.set()
        await ct
        await gw.cmd({"cmd": "arm", "armed": False})
        await conf.cmd({"cmd": "arm", "armed": False})
        analyse(smp.rows, hsmp.rows, plate, L0, iv, vv)
        # torn down with both clients still connected (no heartbeat gap)
        lines = subprocess.run(["pgrep", "-a", "-f", "/lcnc-suite -ini "], capture_output=True, text=True).stdout.splitlines()
        for pid in rb.launcher_pids(ini, lines):
            os.kill(pid, signal.SIGTERM)
        t0 = time.monotonic()
        while time.monotonic() - t0 < 30 and subprocess.run(["pgrep", "-x", "linuxcncsvr"], capture_output=True).returncode == 0:
            await asyncio.sleep(0.5)
        say(f"teardown: the sim stopped with the clients connected: "
            f"{subprocess.run(['pgrep', '-x', 'linuxcncsvr'], capture_output=True).returncode != 0}")
    with open(report + ".samples.json", "w") as f:
        json.dump({"stat": smp.rows, "hal": hsmp.rows}, f)


def h_model(iv, feed):
    rho = iv["AXIS_Z.OFFSET_AV_RATIO"] or 0.0
    vmax = (1 - rho) * iv["AXIS_Z.MAX_VELOCITY"]
    if iv["TRAJ.MAX_LINEAR_VELOCITY"] is not None:
        vmax = min(vmax, iv["TRAJ.MAX_LINEAR_VELOCITY"])
    a = (1 - rho) * iv["AXIS_Z.MAX_ACCELERATION"]
    if iv["TRAJ.MAX_LINEAR_ACCELERATION"] is not None:
        a = min(a, iv["TRAJ.MAX_LINEAR_ACCELERATION"])
    t = 4 * iv["EMCMOT.SERVO_PERIOD"] / 1e9
    v = min(feed / 60.0, vmax)
    return v * t + v * v / a


def analyse(st, hs, plate, L, iv, vv):
    p_geo = plate["z"] + L
    # at the setter: X/Y within the plate's window
    at = [r for r in st if abs(r[1] - plate["x"]) < 1e-3 and abs(r[2] - plate["y"]) < 1e-3]
    # trip events: probe_tripped rising, or the probed Z changing while tripped
    ev = []
    for a, b in zip(at, at[1:]):
        if (b[5] and not a[5]) or (b[5] and abs(b[4] - a[4]) > 1e-9):
            ev.append(b)
    say(f"P_geo {p_geo:.4f} (plate Z {plate['z']} + table length {L:.4f}); {len(ev)} trip events at the setter")
    names = ["fast G38.3", "slow G38.2"]
    feeds = [vv.get(3004), vv.get(3005)]
    r = vv.get(3009)
    for k, e in enumerate(ev[:2]):
        t0 = e[0]
        nxt = ev[k + 1][0] if k + 1 < len(ev) else float("inf")
        win = [x for x in at if t0 <= x[0] < nxt]
        q = min(x[3] for x in win)
        tq = next(x[0] for x in win if x[3] == q)
        prep = e[4]
        h = h_model(iv, feeds[k])
        over = p_geo - q
        say(f"{names[k]} F{feeds[k]:g}: P_rep {prep:.4f} (P_geo − P_rep {p_geo - prep:.4f}), Q {q:.4f}, overshoot {over:.4f}, "
            f"h_model {h:.4f}, margin {h - over:.4f}")
        if k == 0:
            # the retract from Q: its top before the slow probe starts down
            after = [x for x in win if x[0] > tq]
            top = max(x[3] for x in after) if after else None
            started = next((x for x in after if top is not None and x[3] == top), None)
            say(f"  retract: from Q {q:.4f} up to {top:.4f} ({top - q:.4f}, #3009 = {r:g}); "
                f"the tool's tip there {top - L:.4f} vs the plate {plate['z']}: "
                f"{'clear' if top - L > plate['z'] else 'NOT clear'}; probe value at the slow start: "
                f"{'tripped' if started and started[6] else 'released'}")
    en = sorted({h[1]["sim-toolsetter.0.enable"] for h in hs})
    man = sorted({h[1]["sim-toolsetter.0.manual"] for h in hs})
    tl = sorted({h[1]["sim-toolsetter.0.tool-length"] for h in hs})
    eo = sorted({(h[1]["axis.z.eoffset"], h[1]["axis.z.eoffset-enable"]) for h in hs})
    say(f"during the run (halcmd, {len(hs)} samples): enable {en}, manual {man}, tool-length {tl}, eoffset/enable {eo}")


if __name__ == "__main__":
    ini, report = sys.argv[1], sys.argv[2]
    s0 = linuxcnc.stat(); s0.poll()
    rb.validate_sim_target(ini, s0.ini_filename)        # once, before connecting
    try:
        asyncio.run(main(ini, report))
    finally:
        with open(report, "w") as f:
            f.write(f"# F5 routine sequence {time.strftime('%Y-%m-%d %H:%M:%S')} on {os.path.basename(ini)}\n" + "\n".join(rows) + "\n")
