"""F5 measurement series (docs/reviews/parity-ef.plan.md F5): the sim's real
probe overshoot against the preview's modeled hull h_model. On the running,
shipped XYZAC simulator only (validate_sim_target, before anything is sent).

    f5_probe.py <ini> <report.txt> [--cases quick|all]

Per case an MDI o-call of a scratch sub in PROGRAM_PREFIX that moves like
tool_touch_off.ngc: G53 G1 Z down to the start (collinear), G91 G38.3 at the
case's feed, in G64 or G61. Measured: P_rep = STAT.probed_position Z (the
feedback position at the trip, machine frame), Q = the Z where the machine
stands after the move, P_geo = plate Z + the spindle tool's table length.
The tool goes in with M61 (no change dialog) and comes out again; the sim is
torn down at the end with the client still connected (no heartbeat gap).
"""
import asyncio, json, os, signal, subprocess, sys, time
import linuxcnc

SCRIPTS = "/home/cnc/lcnc-suite/scripts"
sys.path.insert(0, SCRIPTS)
import toolsetter_readback_check as rb   # Gateway, until, validate_sim_target, launcher_pids, ini_value

S = linuxcnc.stat()
TOOL = 7
# (feed mm/min, start above P_geo, path mode, stop before the probe)
CASES_QUICK = [(2000, 10, 64, 0)]
CASES_ALL = ([(f, 10, m, 0) for m in (64, 61) for f in (200, 500, 1000, 2000, 3000)]
             + [(200, 3, 64, 0), (2000, 1, 64, 1), (3000, 1, 64, 1), (3000, 0.3, 64, 1)])


def check_copy(copy_ini, installed_ini):
    """A measurement copy: the installed INI (itself the shipped sim, checked
    by validate_sim_target) with only [AXIS_Z] MAX_ACCELERATION /
    OFFSET_AV_RATIO changed, in this scratchpad. Raises otherwise."""
    if not os.path.realpath(copy_ini).startswith(os.path.dirname(os.path.dirname(os.path.realpath(__file__)))):
        raise ValueError("a copy lives in the scratchpad")
    a = open(installed_ini).read().splitlines()
    b = open(copy_ini).read().splitlines()
    sec_a, sec_b, da, db = "", "", [], []
    for ln in a:
        if ln.strip().startswith("["): sec_a = ln.strip()
        da.append((sec_a, ln.strip()))
    for ln in b:
        if ln.strip().startswith("["): sec_b = ln.strip()
        db.append((sec_b, ln.strip()))
    extra = [x for x in db if x not in da] + [x for x in da if x not in db]
    bad = [x for x in extra if not (x[0] == "[AXIS_Z]" and x[1].split("=")[0].strip() in ("MAX_ACCELERATION", "OFFSET_AV_RATIO"))]
    if bad:
        raise ValueError(f"the copy differs beyond the Z acceleration and reserve: {bad[:3]}")
SUB = """o<f5case> sub
(#1 feed, #2 start Z machine, #3 travel, #4 path mode 61 or 64)
G90
G53 G0 Z0
G53 G0 X#5 Y#6
o10 if [#4 EQ 61]
  G61
o10 else
  G64
o10 endif
G53 G1 F3000 Z#2
o20 if [#7 EQ 1]
  G4 P0.2
o20 endif
G91
G38.3 Z-[#3] F#1
G90
G64
o<f5case> endsub
M2
"""


def poll():
    S.poll()
    return S


def halp(name):
    r = subprocess.run(["halcmd", "getp", name], capture_output=True, text=True)
    return float(r.stdout.strip())


def ini_f(ini, sec, key, default=None):
    v = rb.ini_value(ini, sec, key)
    return float(v) if v not in (None, "") else default


async def wait_still(timeout=60):
    t0 = time.monotonic()
    while time.monotonic() - t0 < timeout:
        s = poll()
        if s.interp_state == linuxcnc.INTERP_IDLE and s.inpos and abs(s.current_vel) < 1e-6:
            return True
        await asyncio.sleep(0.05)
    return False


def h_model(ini, feed):
    rho = ini_f(ini, "AXIS_Z", "OFFSET_AV_RATIO", 0.0)
    vmax = (1 - rho) * ini_f(ini, "AXIS_Z", "MAX_VELOCITY")
    tv = ini_f(ini, "TRAJ", "MAX_LINEAR_VELOCITY")
    if tv is not None:
        vmax = min(vmax, tv)
    a = (1 - rho) * ini_f(ini, "AXIS_Z", "MAX_ACCELERATION")
    ta = ini_f(ini, "TRAJ", "MAX_LINEAR_ACCELERATION")
    if ta is not None:
        a = min(a, ta)
    t = 4 * ini_f(ini, "EMCMOT", "SERVO_PERIOD") / 1e9
    v = min(feed / 60.0, vmax)
    return v * t + v * v / a


async def main(ini, report, cases):
    rows = []
    import f5_seq as sq     # the same measurement-basis log as the routine-sequence run
    cfg = os.path.dirname(os.path.abspath(ini))
    var = os.path.join(cfg, rb.ini_value(ini, "RS274NGC", "PARAMETER_FILE"))
    iv = {k: sq.ini_f(ini, *k.split(".")) for k in ("AXIS_Z.MAX_VELOCITY", "AXIS_Z.MAX_ACCELERATION", "AXIS_Z.OFFSET_AV_RATIO",
                                                   "AXIS_Z.MIN_LIMIT", "TRAJ.MAX_LINEAR_VELOCITY", "TRAJ.MAX_LINEAR_ACCELERATION",
                                                   "EMCMOT.SERVO_PERIOD")}
    rows.append(f"INI {json.dumps(iv)}")
    vv = sq.var_values(var, set(range(3100, 3103)))
    rows.append("plate " + " ".join(f"{a}={sq.hal(['getp', f'sim-toolsetter.0.plate-{a}'])}" for a in "xyz")
                + f" vs #3100–#3102 {vv.get(3100)}, {vv.get(3101)}, {vv.get(3102)}")
    rows.append("probe chain: " + " | ".join(l.strip() for l in sq.hal(["show", "sig", "probe-input"]).splitlines()[1:] if l.strip()))
    hs = sq.HalSampler()
    prefix = os.path.expanduser(rb.ini_value(ini, "DISPLAY", "PROGRAM_PREFIX"))
    sub = os.path.join(prefix, "f5case.ngc")
    token = rb.ini_value(ini, "DISPLAY", "WEBUI_TOKEN") or ""
    port = int(rb.ini_value(ini, "DISPLAY", "WEBUI_PORT") or 8000)
    url = f"ws://127.0.0.1:{port}/ws" + (f"?token={token}" if token else "")
    px, py, pz = halp("sim-toolsetter.0.plate-x"), halp("sim-toolsetter.0.plate-y"), halp("sim-toolsetter.0.plate-z")
    with open(sub, "w") as f:
        f.write(SUB)
    tool0 = poll().tool_in_spindle
    try:
        async with rb.Gateway(url, token, port) as gw:
            ok = (await rb.until(gw, {"cmd": "estop_reset"}, lambda: poll().task_state != linuxcnc.STATE_ESTOP)
                  and await rb.until(gw, {"cmd": "machine_on"}, lambda: poll().task_state == linuxcnc.STATE_ON))
            await asyncio.sleep(1.5)
            ok = ok and await rb.until(gw, {"cmd": "home_all"}, lambda: all(poll().homed[:S.joints]) and S.inpos, timeout=120)
            rows.append(f"setup: on and homed: {ok}")
            if not ok:
                return
            # the gateway's own status lags LinuxCNC's homing by a cycle or two:
            # retry until the tool is really in the spindle, else measure nothing
            r = {}
            for _ in range(20):
                r = await rb.send(gw, {"cmd": "mdi", "text": f"M61 Q{TOOL}"})
                await wait_still()
                if r.get("ok") and poll().tool_in_spindle == TOOL:
                    break
                await asyncio.sleep(1.0)
            if poll().tool_in_spindle != TOOL:
                rows.append(f"T{TOOL} not in the spindle (M61: {r.get('error')}) — nothing measured")
                cases = []
            L = next(t.zoffset for t in poll().tool_table if t.id == TOOL)
            p_geo = pz + L
            rows.append(f"tool T{TOOL} in the spindle (M61): ok={r.get('ok')} table length {L:.4f}; plate X{px} Y{py} Z{pz}; P_geo {p_geo:.4f}")
            hs.start()
            rows.append("feed  start  mode       P_rep      Q          P_geo-P_rep  overshoot(P_geo-Q)  h_model   margin(h_model-overshoot)")
            for feed, approach, mode, dwell in cases:
                start = p_geo + approach
                r = await rb.send(gw, {"cmd": "mdi", "text": f"o<f5case> call [{feed}] [{start:.4f}] [{approach + 10:.4f}] [{mode}] [{px}] [{py}] [{dwell}]"}, timeout=120)
                still = await wait_still()
                s = poll()
                prep = s.probed_position[2]
                q = s.actual_position[2]
                over = p_geo - q
                h = h_model(ini, feed)
                flag = "" if (r.get("ok") and still and s.probe_tripped) else                     f"  (mdi ok={r.get('ok')} still={still} tripped={s.probe_tripped} {r.get('error') or ''})"
                rows.append(f"F{feed:<5} +{approach:<5} G{mode}{' stop' if dwell else '     '}  {prep:9.4f}  {q:9.4f}  "
                            f"{p_geo - prep:10.4f}   {over:10.4f}          {h:8.4f}  {h - over:8.4f}{flag}")
                await rb.send(gw, {"cmd": "mdi", "text": "G90 G53 G0 Z0"})
                await wait_still()
            hs.stop = True
            hs.join()
            rows.append(f"during the cases (halcmd, {len(hs.rows)} samples): "
                        + ", ".join(f"{p.split('.')[-1]} {sorted({h[1][p] for h in hs.rows})}" for p in sq.HalSampler.PINS))
            await rb.send(gw, {"cmd": "mdi", "text": f"M61 Q{tool0}"})
            await wait_still()
            rows.append(f"tool back to T{tool0} (M61): spindle {poll().tool_in_spindle}")
            await gw.cmd({"cmd": "arm", "armed": False})
            # torn down with this client still connected (no heartbeat gap)
            lines = subprocess.run(["pgrep", "-a", "-f", "/lcnc-suite -ini "], capture_output=True, text=True).stdout.splitlines()
            for pid in rb.launcher_pids(ini, lines):
                os.kill(pid, signal.SIGTERM)
            t0 = time.monotonic()
            while time.monotonic() - t0 < 30 and subprocess.run(["pgrep", "-x", "linuxcncsvr"], capture_output=True).returncode == 0:
                await asyncio.sleep(0.5)
            rows.append(f"teardown: the sim stopped with the client connected: "
                        f"{subprocess.run(['pgrep', '-x', 'linuxcncsvr'], capture_output=True).returncode != 0}")
    finally:
        try:
            os.remove(sub)
        except OSError:
            pass
        with open(report, "w") as f:
            f.write(f"# F5 probe overshoot {time.strftime('%Y-%m-%d %H:%M:%S')} on {os.path.basename(ini)}\n")
            f.write("\n".join(rows) + "\n")
        print("\n".join(rows))


if __name__ == "__main__":
    ini, report = sys.argv[1], sys.argv[2]
    cases = CASES_ALL if "--cases" in sys.argv and sys.argv[sys.argv.index("--cases") + 1] == "all" else CASES_QUICK
    S.poll()
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    if "--copy-of" in sys.argv:
        installed = sys.argv[sys.argv.index("--copy-of") + 1]
        rb.validate_sim_target(installed, installed)   # the installed config is the shipped sim
        check_copy(ini, installed)
        if os.path.realpath(S.ini_filename) != os.path.realpath(ini):
            raise SystemExit(f"running {S.ini_filename}, not the copy")
    else:
        rb.validate_sim_target(ini, S.ini_filename)     # raises before anything is sent
    asyncio.run(main(ini, report, cases))
