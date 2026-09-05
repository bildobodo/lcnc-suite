#!/usr/bin/env python3
"""Live acceptance for o<twp_capture> — one-button plane capture (2026-08-31).

What it proves, on the TWP sim (homed, machine on):

  B. Capture at A=0: with the head tilted (B20 C-15) and the tip at a known
     point, the gateway's `twp_capture` command (fired over the WS as an
     ARMED client — the REAL button path, policy included) defines the
     plane FROM the live rotaries
     with origin AT the tip, and the G53.1 P0 orient is a NO-MOVE (joints
     unchanged < 1e-4): TWP active, TOOL kins, tool normal to the plane,
     DRO ~0 on X/Y/Z, G59..G59.3 rewritten with A0 B0 C0 R0, and the G54
     row + its provenance stamp UNTOUCHED (capture writes no datum).
     Optionally (gateway venv reachable): the GATEWAY's broadcast work_pos
     also reads ~0 — the kins-2 DRO honesty fix (a joint-frame formula
     posed as plane coords before it).
  C. Capture at a live table angle (A=35): same properties — g683 stores
     the captured frame in the TABLE frame at the live A; a re-orient
     recomputes the same G59 rows.
  D. Round trip with the Plane touch-off: after a capture,
     `o<twp_touchoff> call [4] [0] [0] [v]` makes the DRO read v.
  E. Refusals, state-intact (all policy-side, surfaced as {ok:false}):
     plane already defined; from G55 (G69 would silently force G54);
     a G92 X offset; a G54 rotary offset.
  F. Clear path: G69 → undefined, G54, identity kins.

Pattern: twp_touchoff_plane_check.py (mdi/snap/read_params/teardown).
Refuses to report on a machine that cannot execute.
"""
import atexit
import math
import os
import subprocess
import sys
import time

import linuxcnc

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                "..", "lcnc-gateway"))
from gateway_util import parse_kins_config, wcs_prov_params  # noqa: E402

c = linuxcnc.command()
s = linuxcnc.stat()
err = linuxcnc.error_channel()
FAILS = []


def check(name, ok, detail=""):
    print(f"  {'PASS' if ok else 'FAIL'}  {name}{'  — ' + detail if detail else ''}")
    if not ok:
        FAILS.append(name)


def require_ready():
    s.poll()
    problems = []
    if s.task_state != linuxcnc.STATE_ON:
        problems.append(f"task_state={s.task_state} (need STATE_ON)")
    if not all(s.homed[:6]):
        problems.append(f"homed={list(s.homed[:6])}")
    if problems:
        raise SystemExit("PRECONDITIONS NOT MET — refusing to report: " + "; ".join(problems))


def kins_from_running_config():
    s.poll()
    ini = linuxcnc.ini(s.ini_filename)
    k = parse_kins_config(ini.find("KINS", "KINEMATICS"),
                          ini.findall("HAL", "HALCMD") or [])
    return float(k["params"]["nut_angle"])


PINS = ["twp-helper-comp.twp-is-defined", "twp-helper-comp.twp-is-active",
        "twp-helper-comp.twp-ox", "twp-helper-comp.twp-oy", "twp-helper-comp.twp-oz",
        "twp-helper-comp.twp-ox-world", "twp-helper-comp.twp-oy-world",
        "twp-helper-comp.twp-oz-world",
        "twp-helper-comp.twp-zx", "twp-helper-comp.twp-zy", "twp-helper-comp.twp-zz",
        "motion.switchkins-type",
        "xyzacb_trsrn_kins.pre-rot", "xyzacb_trsrn_kins.primary-angle",
        "xyzacb_trsrn_kins.secondary-angle"]


def halget(pin):
    out = subprocess.run(["halcmd", "getp", pin], capture_output=True, text=True)
    if out.returncode != 0:
        raise SystemExit(f"halcmd getp {pin}: {out.stderr.strip()}")
    return float(out.stdout.strip().replace("TRUE", "1").replace("FALSE", "0"))


def snap():
    return {p: halget(p) for p in PINS}


def poll():
    s.poll()


def wait_idle(timeout=180.0):
    t0 = time.time()
    while time.time() - t0 < timeout:
        poll()
        if s.interp_state == linuxcnc.INTERP_IDLE and not s.current_vel:
            return True
        time.sleep(0.05)
    return False


def _drain_errors():
    msgs = []
    while True:
        e = err.poll()
        if not e:
            return msgs
        kind, text = e
        if kind in (linuxcnc.NML_ERROR, linuxcnc.OPERATOR_ERROR):
            msgs.append(str(text))


def mdi(line, timeout=180.0, expect_error=False):
    _drain_errors()
    c.mode(linuxcnc.MODE_MDI)
    c.wait_complete()
    c.mdi(line)
    rc = c.wait_complete(timeout)
    idle = wait_idle(timeout)
    poll()
    errors = _drain_errors()
    if expect_error:
        return errors + (["<RCS_ERROR>"] if rc == linuxcnc.RCS_ERROR else [])
    if rc == linuxcnc.RCS_ERROR or rc == -1 or not idle or errors:
        raise SystemExit(f"MDI {line!r} did not complete cleanly: rc={rc} "
                         f"idle={idle} errors={errors}")
    return errors


def read_params(nums, timeout=5.0):
    import tempfile
    path = os.path.join(tempfile.gettempdir(), f"twp_capture_params_{os.getpid()}.txt")
    try:
        os.remove(path)
    except OSError:
        pass
    mdi(f"(LOGOPEN,{path})")
    mdi("(LOG,PARAMS " + " ".join(f"#{n}" for n in nums) + ")")
    mdi("(LOGCLOSE)")
    t0 = time.time()
    while time.time() - t0 < timeout:
        try:
            with open(path) as f:
                for ln in f:
                    if "PARAMS" in ln:
                        vals = ln.split("PARAMS", 1)[1].split()
                        if len(vals) == len(nums):
                            os.remove(path)
                            return [float(v) for v in vals]
        except OSError:
            pass
        time.sleep(0.05)
    raise SystemExit(f"could not read interpreter parameters ({path})")


def angle_between(a, b):
    cx = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
    return math.degrees(math.atan2(math.sqrt(sum(v * v for v in cx)), sum(x * y for x, y in zip(a, b))))


def plane_normal_machine(snapshot, a_deg):
    n = [snapshot["twp-helper-comp.twp-zx"], snapshot["twp-helper-comp.twp-zy"],
         snapshot["twp-helper-comp.twp-zz"]]
    th = -math.radians(a_deg)
    cth, sn = math.cos(th), math.sin(th)
    return [n[0], n[1] * cth - n[2] * sn, n[1] * sn + n[2] * cth]


def tool_axis_from_head(snapshot):
    b = math.radians(snapshot["xyzacb_trsrn_kins.secondary-angle"])
    cc = math.radians(snapshot["xyzacb_trsrn_kins.primary-angle"])
    nut = math.radians(NUT_ANGLE)
    ax = [0.0, math.sin(nut), math.cos(nut)]
    v = [0.0, 0.0, 1.0]
    k, ct, st = ax, math.cos(b), math.sin(b)
    kv = k[0] * v[0] + k[1] * v[1] + k[2] * v[2]
    kx = [k[1] * v[2] - k[2] * v[1], k[2] * v[0] - k[0] * v[2], k[0] * v[1] - k[1] * v[0]]
    r = [v[i] * ct + kx[i] * st + k[i] * kv * (1 - ct) for i in range(3)]
    cz, sz = math.cos(cc), math.sin(cc)
    return [r[0] * cz - r[1] * sz, r[0] * sz + r[1] * cz, r[2]]


def dro():
    """What the DRO shows: world − g5x − g92 − tool offset, XYZ."""
    poll()
    return [s.actual_position[i] - s.g5x_offset[i] - s.g92_offset[i] - s.tool_offset[i]
            for i in range(3)]


def joints():
    poll()
    return list(s.joint_actual_position[:6])


_WS_HELPER_SRC = r"""
import asyncio, json, sys
import msgspec.msgpack
import websockets

async def main():
    url = sys.argv[1]
    async with websockets.connect(url, max_size=None) as ws:
        async def send(o):
            await ws.send(json.dumps(o))
        await send({"cmd": "hello"})
        await send({"cmd": "arm", "armed": True})
        async def beat():
            while True:
                await send({"cmd": "heartbeat"})
                await asyncio.sleep(0.8)
        asyncio.get_event_loop().create_task(beat())
        loop = asyncio.get_event_loop()
        while True:
            line = await loop.run_in_executor(None, sys.stdin.readline)
            if not line:
                return
            req = json.loads(line)
            await send(req)
            while True:
                raw = await asyncio.wait_for(ws.recv(), 90)
                try:
                    d = msgspec.msgpack.decode(raw) if isinstance(raw, (bytes, bytearray)) else json.loads(raw)
                except Exception:
                    continue
                # Match the reply to THIS command: hello/arm/heartbeat acks
                # also carry "ok", and reading the first ok-bearing frame
                # shifted every reply by two in the first live run.
                if isinstance(d, dict) and "ok" in d and d.get("cmd") == req.get("cmd"):
                    print(json.dumps(d), flush=True)
                    break

asyncio.run(main())
"""

_ws_procs = {}


def _ws_client(client=0):
    """One persistent ARMED WS client per index (the real button path —
    policy, armed-gate and all); index 1 stands in for a second operator tab."""
    p = _ws_procs.get(client)
    if p is None or p.poll() is not None:
        venv = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                            "..", "lcnc-gateway", ".venv", "bin", "python3")
        tok = os.environ.get("LCNC_WS_TOKEN", "")
        url = "ws://127.0.0.1:8000/ws" + (f"?token={tok}" if tok else "")
        p = subprocess.Popen([venv, "-c", _WS_HELPER_SRC, url],
                             stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                             text=True, bufsize=1)
        _ws_procs[client] = p
        time.sleep(2.0)  # hello + arm settle
    return p


def ws_send(obj, client=0):
    """Send without waiting for the reply (ws_read collects it)."""
    import json as _json
    p = _ws_client(client)
    p.stdin.write(_json.dumps(obj) + "\n")
    p.stdin.flush()


def ws_read(client=0, timeout=90.0):
    import json as _json
    import select
    p = _ws_client(client)
    r, _, _ = select.select([p.stdout], [], [], timeout)
    if not r:
        raise SystemExit(f"WS reply (client {client}) timed out")
    return _json.loads(p.stdout.readline())


def ws_cmd(obj, timeout=90.0, client=0):
    """Send one typed command through a persistent ARMED WS client and
    return the reply dict."""
    ws_send(obj, client)
    return ws_read(client, timeout)


_PREVIEW_FETCH_SRC = r'''
import json, sys, time, urllib.request, msgspec
expect, keys, timeout = sys.argv[1], json.loads(sys.argv[2]), float(sys.argv[3])
t0 = time.time()
while time.time() - t0 < timeout:
    try:
        with urllib.request.urlopen("http://127.0.0.1:8000/preview", timeout=5) as r:
            d = msgspec.msgpack.decode(r.read())
    except Exception:
        time.sleep(0.5)
        continue
    if str(d.get("file") or "").endswith(expect):
        out = {}
        for k in keys:
            v = d.get(k)
            out[k] = len(v) if isinstance(v, (bytes, bytearray)) else v
        print(json.dumps(out))
        sys.exit(0)
    time.sleep(0.5)
print("null")
'''


def gateway_preview_keys(expect_file, keys, timeout=30.0):
    """Selected keys of the RUNNING gateway's cached preview payload once it
    names `expect_file` (venv python: it has msgspec; this process has
    linuxcnc). Binary streams report their byte length. None = never
    published within the timeout (said)."""
    import json as _json
    venv = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                        "..", "lcnc-gateway", ".venv", "bin", "python3")
    out = subprocess.run([venv, "-c", _PREVIEW_FETCH_SRC, os.path.basename(expect_file),
                          _json.dumps(keys), str(timeout)], capture_output=True, text=True)
    if out.returncode != 0:
        print(f"  (preview fetch failed: {out.stderr.strip()[:200]})")
        return None
    d = _json.loads(out.stdout.strip() or "null")
    if d is None:
        print(f"  (gateway never published a preview for {os.path.basename(expect_file)})")
    return d


def trace_tags_since(t0_ns, tags):
    """Events carrying one of `tags` written to the suite's trace file since
    t0 (wall ns) — the resolved log dir (env > INI > <install-dir>/runlogs),
    the same resolution the gateway uses. None when unreadable (said)."""
    import json as _json
    import lcnc_paths
    path = os.path.join(lcnc_paths.resolve()[0], "trace.ndjson")
    out = []
    try:
        with open(path, "rb") as f:
            f.seek(0, 2)
            f.seek(max(0, f.tell() - 4_000_000))
            for ln in f.read().decode(errors="replace").splitlines():
                if not ln.startswith("{"):
                    continue
                try:
                    d = _json.loads(ln)
                except ValueError:
                    continue
                if d.get("tag") in tags and int(d.get("t_wall_ns", 0)) >= t0_ns:
                    out.append(d)
    except OSError as e:
        print(f"  (trace file {path} unreadable: {e} — trace rows not judged)")
        return None
    return out


def gateway_status_fields(keys):
    """One FULL status snapshot from the RUNNING gateway over WS (venv python —
    it has websockets+msgspec; this process has linuxcnc). A fresh client's
    first status frame is full; the payload rides INSIDE the envelope's
    nested `data` (ws_fanout.build_status_envelope) — the same fact the
    corpus confirmer needed. Returns {key: value} or None with a loud SKIP."""
    venv = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                        "..", "lcnc-gateway", ".venv", "bin", "python3")
    tok = os.environ.get("LCNC_WS_TOKEN", "")
    url = "ws://127.0.0.1:8000/ws" + (f"?token={tok}" if tok else "")
    prog = (
        "import asyncio,json,sys,websockets\n"
        "import msgspec.msgpack as mp\n"
        "KEYS=json.loads(sys.argv[2])\n"
        "async def m():\n"
        "    async with websockets.connect(sys.argv[1], max_size=None) as w:\n"
        "        await w.send(json.dumps({'cmd':'hello'}))\n"
        "        for _ in range(80):\n"
        "            raw = await asyncio.wait_for(w.recv(), 5)\n"
        "            try: d = mp.decode(raw)\n"
        "            except Exception: continue\n"
        "            data = d.get('data') if isinstance(d, dict) and isinstance(d.get('data'), dict) else None\n"
        "            if data and all(k in data for k in KEYS):\n"
        "                print(json.dumps({k: data[k] for k in KEYS})); return\n"
        "        raise SystemExit('no full status frame with ' + str(KEYS))\n"
        "asyncio.run(m())\n")
    import json
    out = subprocess.run([venv, "-c", prog, url, json.dumps(list(keys))],
                         capture_output=True, text=True, timeout=30)
    if out.returncode != 0:
        print(f"  SKIP  gateway status probe unavailable — {out.stderr.strip()[-200:]}")
        return None
    return json.loads(out.stdout.strip())


def gateway_work_pos():
    d = gateway_status_fields(["work_pos"])
    return None if d is None else d["work_pos"]


def gateway_datum_row_check(label, g54_after):
    """The gateway's broadcast G54 row must follow the datum M535 wrote
    (seeded from the helper pins — STAT only carries the ACTIVE fixture and
    the var file is written at shutdown): the false "datum moved" class."""
    d = gateway_status_fields(["wcs_table", "twp_datum", "wcs_prov_a"])
    if d is None:
        return
    row = d["wcs_table"][0]
    rxyz = [float(row[k]) for k in ("x", "y", "z")]
    check(f"{label}: GATEWAY wcs_table[0] follows the datum (M535 seed)",
          all(abs(rxyz[i] - g54_after[i]) < 1e-4 for i in range(3)),
          f"row={[round(v, 4) for v in rxyz]} g54={[round(v, 4) for v in g54_after]}")
    dat = d["twp_datum"]
    check(f"{label}: twp_datum == wcs_table[0]",
          dat is not None and all(abs(float(dat[i]) - rxyz[i]) < 5e-3 for i in range(3)),
          f"datum={dat}")
    pa = (d.get("wcs_prov_a") or [None])[0]
    check(f"{label}: G54 stamp A published as 0 (table frame)",
          pa is not None and abs(float(pa)) < 1e-9, f"wcs_prov_a[0]={pa}")


G54_ROW = list(range(5221, 5231))
G59_ROW = list(range(5321, 5331))
_PROV = wcs_prov_params(1)
_PROV_ROWS = [_PROV[k] for k in ("stamped", "kins", "a", "x", "y", "z")]

print("=== 0. preconditions ===")
require_ready()
NUT_ANGLE = kins_from_running_config()
_saved_g54 = read_params(G54_ROW)
_saved_g59 = read_params(G59_ROW)
_saved_prov = read_params(_PROV_ROWS)
print(f"  nut={NUT_ANGLE} G54={[round(v, 3) for v in _saved_g54[:6]]} "
      f"G54 prov stamped={_saved_prov[0]:.0f}")
# Absent G54 provenance start (a stale posed stamp makes g683's
# to_storage_frame refuse by design); teardown restores the original.
mdi(f"#{_PROV['stamped']}=0")


def _teardown():
    global _ws_proc
    if _ws_proc is not None and _ws_proc.poll() is None:
        _ws_proc.stdin.close()
        try:
            _ws_proc.wait(timeout=3)
        except subprocess.TimeoutExpired:
            _ws_proc.kill()  # helper may sit in ws.recv — the socket drop is the point
        time.sleep(1.0)  # the armed-disconnect abort lands before our MDIs
    try:
        mdi("g69")
        mdi("G0 A0")
        poll()
        words = lambda g: " ".join(f"{L}{g[i]:.6f}" for i, L in enumerate("XYZABCUVW")
                                   if s.axis_mask & (1 << i))
        mdi("G92.1")
        mdi(f"G10 L2 P1 {words(_saved_g54)} R{_saved_g54[9]:.6f}")
        g = list(_saved_g59)
        g[3] = g[4] = g[5] = g[9] = 0.0
        mdi(f"G10 L2 P6 {words(g)} R0")
        mdi(" ".join(f"#{_PROV[k]}={v:.6f}" for k, v in
                     zip(("kins", "a", "x", "y", "z", "stamped"),
                         (_saved_prov[1], _saved_prov[2], _saved_prov[3],
                          _saved_prov[4], _saved_prov[5], _saved_prov[0]))))
        print("  (teardown: g69, A0, G92.1, G54 + G59 + provenance restored)")
    except SystemExit as e:
        print(f"  (teardown incomplete: {e})")


atexit.register(_teardown)


def capture_case(label, a_deg, x, y, z):
    """Tilt the head, park the tip, capture, assert the whole contract."""
    mdi("g69")
    mdi(f"G0 A{a_deg} B20 C-15")
    mdi("G10 L2 P1 X0 Y0 Z0 A0 B0 C0 R0")
    mdi(f"G0 X{x} Y{y} Z{z}")
    j_before = joints()
    read_params([5221, 5222, 5223])  # settle the param channel before capture
    time.sleep(0.6)  # let the broadcast poll see the settled state (the gate reads it)
    r = ws_cmd({"cmd": "twp_capture"})
    check(f"{label}: gateway capture ok", r.get("ok") is True, str(r))
    wait_idle()
    st = snap()
    check(f"{label}: TWP active + TOOL kins",
          st["twp-helper-comp.twp-is-active"] == 1
          and st["motion.switchkins-type"] == 2)
    j_after = joints()
    dj = max(abs(a - b) for a, b in zip(j_before, j_after))
    check(f"{label}: no-move orient (joints unchanged)", dj < 1e-4, f"max dJ={dj:.6f}")
    errN = angle_between(plane_normal_machine(st, a_deg), tool_axis_from_head(st))
    check(f"{label}: plane normal == tool axis", errN < 0.01, f"{errN:.7f} deg")
    d = dro()
    check(f"{label}: DRO ~0 at the tip", all(abs(v) < 1e-3 for v in d),
          f"{[round(v, 4) for v in d]}")
    rows = read_params([5324, 5325, 5326, 5330])
    check(f"{label}: G59 A/B/C/R zero", all(abs(v) < 1e-6 for v in rows), f"{rows}")
    g54_after = read_params([5221, 5222, 5223])
    prov_after = read_params(_PROV_ROWS)
    # Capture ends with the plane touch-off (M535, all-XYZ zero): the ONE
    # datum (G54) lands at the tip THROUGH the plane, provenance stamped
    # table-frame by the remap.
    check(f"{label}: datum provenance stamped table-frame (kins 0, A 0, xyz)",
          abs(prov_after[0] - 1.0) < 1e-9 and abs(prov_after[1]) < 1e-9
          and abs(prov_after[2]) < 1e-9
          and all(abs(prov_after[3 + i] - g54_after[i]) < 1e-4 for i in range(3)),
          f"{[round(v, 4) for v in prov_after]}")
    # Bounded settle: the world pins ride gui_update_twp -> helper republish
    # (a manual probe 1.5 s later showed exact agreement; the immediate read
    # raced the republish once at A=35).
    _pins_ok = False
    for _ in range(30):
        # 5e-3: halcmd getp prints ~7 significant digits, so at datum
        # magnitudes ~1000 its print resolution is 1e-3 — a 1e-4 tolerance
        # failed on formatting, not on disagreement.
        _pins_ok = all(abs(halget(f"twp-helper-comp.twp-o{ax}-world") - g54_after[i]) < 5e-3
                       for i, ax in enumerate("xyz"))
        if _pins_ok:
            break
        time.sleep(0.1)
    check(f"{label}: helper world pins follow the new datum", _pins_ok,
          f"pins={[halget(f'twp-helper-comp.twp-o{ax}-world') for ax in 'xyz']} "
          f"g54={[round(v, 4) for v in g54_after]}")
    return st


print("\n=== B. capture at A=0 ===")
stB = capture_case("A=0", 0.0, 50.0, 40.0, -30.0)
gateway_datum_row_check("A=0", read_params([5221, 5222, 5223]))
wp = gateway_work_pos()
if wp is not None:
    check("A=0: GATEWAY work_pos ~0 (kins-2 DRO honesty)",
          all(abs(v) < 1e-2 for v in wp[:3]), f"{[round(v, 4) for v in wp[:3]]}")

print("\n=== C. capture at a live table angle (A=35) ===")
capture_case("A=35", 35.0, 30.0, -20.0, -40.0)
g59_c = read_params([5321, 5322, 5323])
mdi("o<twp_reorient> call")
g59_rt = read_params([5321, 5322, 5323])
check("A=35: re-orient recomputes the SAME G59 rows",
      all(abs(a - b) < 1e-3 for a, b in zip(g59_c, g59_rt)),
      f"{[round(v, 4) for v in g59_rt]} vs {[round(v, 4) for v in g59_c]}")

print("\n=== C2. a refused program previews LOUDLY (plane active, G59 seeded) ===")
# The preview interpreter starts in the machine's LIVE active fixture (G59
# while a plane is active), so a program that opens with G68.2 is refused
# by the remap's "Must be in G54" guard — as a run would be. Before
# 2026-09-05 that previewed as an EMPTY success with no reason anywhere
# (CANON_ERROR is a stub in the preview module; the refusal yields
# INTERP_EXIT). Now the payload carries parse_refused and the trace the twin.
poll()
_prev_file = s.file
_probe = os.path.expanduser("~/linuxcnc/nc_files/webui_refusal_probe.ngc")
with open(_probe, "w") as _f:
    _f.write("g68.2 x50 y50 z-50 q121 i30 j15\ng53.3 x0y0z100\ng0 x10\ng69\nm2\n")
time.sleep(0.6)
tC2_ns = time.time_ns()
rL = ws_cmd({"cmd": "load_file", "path": _probe})
check("C2: load_file ok", rL.get("ok") is True, str(rL))
pv = gateway_preview_keys(_probe, ["parse_refused", "parse_error", "feed", "rapid"])
if pv is not None:
    pr = pv.get("parse_refused") or {}
    check("C2: payload carries parse_refused naming G54 at line 1",
          "G54" in str(pr.get("message", "")) and pr.get("line") == 1, str(pv))
    check("C2: the refused payload is EMPTY and not a parse_error",
          pv.get("feed") == 0 and pv.get("rapid") == 0 and pv.get("parse_error") is None, str(pv))
    _ev = trace_tags_since(tC2_ns, {"gcode.parse_refused"})
    if _ev is not None:
        check("C2: trace — gcode.parse_refused", any("G54" in str(e.get("message")) for e in _ev),
              str([(e.get("line"), e.get("message")) for e in _ev]))
else:
    check("C2: gateway published the probe's preview", False, "no payload")

print("\n=== D. round trip with the Plane touch-off (M535) ===")
before = dro()
mdi("o<twp_touchoff> call [4] [0] [0] [5.0]")
after = dro()
check("D: DRO Z reads the entered value", abs(after[2] - 5.0) < 1e-3,
      f"{after[2]:.4f} (was {before[2]:.4f})")
gateway_datum_row_check("D (after plane touch-off)", read_params([5221, 5222, 5223]))

print("\n=== D2. datum-write epoch: the settle keys on M535's write, not on the value ===")
# Same datum again (DRO Z already reads 5.0): before 2026-09-05 the gateway's
# settle waited for the VALUE to change and burned its whole 3 s timeout on
# exactly this case (3089 / 3082 ms replies, twp.datum_settle_timeout).
seq_d = halget("twp-helper-comp.twp-datum-seq")
mdi("o<twp_touchoff> call [4] [0] [0] [5.0]")
seq_e = halget("twp-helper-comp.twp-datum-seq")
check("D2: twp-datum-seq +1 per M535 (direct MDI)", abs(seq_e - seq_d - 1) < 1e-9,
      f"{seq_d:.0f} → {seq_e:.0f}")
time.sleep(0.6)  # broadcast settle (the touchoff gate reads the shared payload)
t0_ns = time.time_ns()
t0 = time.monotonic()
rT = ws_cmd({"cmd": "touchoff", "axes": {"Z": 5.0}})
dtT = time.monotonic() - t0
check("D2: gateway Plane touch-off on the SAME datum ok",
      rT.get("ok") is True and rT.get("route") == "plane", str(rT))
check("D2: same-datum touch-off replies in < 1 s", dtT < 1.0, f"{dtT * 1000:.0f} ms")
check("D2: twp-datum-seq +1 through the gateway path",
      abs(halget("twp-helper-comp.twp-datum-seq") - seq_e - 1) < 1e-9)
_ev = trace_tags_since(t0_ns, {"twp.datum_settled", "twp.datum_settle_timeout",
                              "twp.datum_seq_unavailable"})
if _ev is not None:
    _settled = [e for e in _ev if e["tag"] == "twp.datum_settled"]
    check("D2: trace — one twp.datum_settled (changed=false), no timeout, no seq-unavailable",
          len(_settled) == 1 and _settled[0].get("changed") is False and len(_ev) == 1,
          str([(e["tag"], e.get("changed"), e.get("ms")) for e in _ev]))
gateway_datum_row_check("D2 (same datum)", read_params([5221, 5222, 5223]))

print("\n=== E. refusals, state intact (policy-side, {ok:false}) ===")
def refuse(label, fragment):
    time.sleep(0.6)  # let the broadcast poll see the planted state
    r = ws_cmd({"cmd": "twp_capture"})
    check(f"{label}: refused", r.get("ok") is False, str(r))
    check(f"{label}: reason names it", fragment.lower() in str(r.get("error", "")).lower(),
          str(r.get("error")))

refuse("E1 plane already defined", "Clear plane")
st = snap()
check("E1: plane still active (state intact)",
      st["twp-helper-comp.twp-is-active"] == 1)
mdi("g69")
mdi("G0 A0")
mdi("G55")
refuse("E2 from G55", "G54")
poll()
check("E2: G55 still active (no silent G54 switch)", s.g5x_index == 2)
mdi("G54")
mdi("G92 X1")
refuse("E3 G92 X offset", "G92")
mdi("G92.1")
mdi("G10 L2 P1 A5")
refuse("E4 G54 rotary offset", "rotary")
check("E4: TWP stays undefined",
      halget("twp-helper-comp.twp-is-defined") == 0)
mdi("G10 L2 P1 A0")

print("\n=== F. clear path ===")
# Start from a known G54 at machine zero: the sections above leave G54 where
# the plane touch-off (D) wrote it, and with the Z window narrowed to the top
# of travel (2026-09-05) a G54-relative Z-10 from there can sit ABOVE machine
# zero — "would exceed Z's positive limit" — which was fine only on ±5000.
mdi("G10 L2 P1 X0 Y0 Z0 A0 B0 C0 R0")
mdi("G0 B10 C10")
# Z-60, not Z-10: the joint-side limit check adds the tool length back
# (tip at -10 with a 22 mm tool puts the JOINT above the 0.01 ceiling).
mdi("G0 X10 Y10 Z-60")
time.sleep(0.6)  # broadcast settle (gate reads the shared payload)
rF = ws_cmd({"cmd": "twp_capture"})
check("F: gateway capture ok", rF.get("ok") is True, str(rF))
wait_idle()
check("F: capture defines + activates",
      halget("twp-helper-comp.twp-is-active") == 1)
mdi("g69")
poll()
check("F: G69 → undefined, G54, identity kins",
      halget("twp-helper-comp.twp-is-defined") == 0 and s.g5x_index == 1
      and halget("motion.switchkins-type") == 0)

print("\n=== F2. the same program parses once the machine is back in G54 ===")
time.sleep(0.6)
rL2 = ws_cmd({"cmd": "load_file", "path": _probe})
check("F2: load_file ok", rL2.get("ok") is True, str(rL2))
# The cached payload still names the probe: wait for a NEW publish (the
# refused one had zero bytes of motion, this one must have some).
pv2 = None
for _ in range(30):
    pv2 = gateway_preview_keys(_probe, ["parse_refused", "parse_error", "feed", "rapid"], timeout=5)
    if pv2 and (pv2.get("rapid") or pv2.get("feed")):
        break
    time.sleep(0.5)
check("F2: parses with motion and no parse_refused",
      pv2 is not None and (pv2.get("rapid") or pv2.get("feed")) and not pv2.get("parse_refused")
      and pv2.get("parse_error") is None, str(pv2))
if _prev_file and os.path.isfile(_prev_file) and _prev_file != _probe:
    ws_cmd({"cmd": "load_file", "path": _prev_file})
    print(f"  (restored the loaded program: {os.path.basename(_prev_file)})")
else:
    ws_cmd({"cmd": "unload_file"})

print("\n=== G. abort mid-capture: a stop never waits behind a handler (2026-09-05) ===")
# Capture chains four MDI waits inside _cmd_lock; before stop-class preemption
# an abort from any client waited behind all of them. Now the abort cancels the
# in-flight handler (the victim replies "Preempted by abort") and runs after
# the current 50 ms wait slice.
mdi("G10 L2 P1 X0 Y0 Z0 A0 B0 C0 R0")
mdi("G0 A0 B10 C10")
mdi("G0 X10 Y10 Z-60")
time.sleep(0.6)
_ws_client(1)  # the second operator tab, armed
tG_ns = time.time_ns()
ws_send({"cmd": "twp_capture"}, client=0)
time.sleep(0.08)  # the capture is inside its first MDI wait
t0 = time.monotonic()
rA = ws_cmd({"cmd": "abort"}, client=1)
dtA = time.monotonic() - t0
check("G: abort from a second client replies ok in < 1 s while the capture is in flight",
      rA.get("ok") is True and dtA < 1.0, f"{rA} {dtA * 1000:.0f} ms")
rC = ws_read(client=0, timeout=30)
_preempted = rC.get("ok") is False and "Preempted by abort" in str(rC.get("error", ""))
check("G: the capture reply says it was preempted (or it completed before the abort landed)",
      _preempted or rC.get("ok") is True, str(rC))
print(f"  capture reply: {rC}" + ("" if _preempted else "  (completed first — preemption not exercised this run)"))
if _preempted:
    _ev = trace_tags_since(tG_ns, {"ws.command_preempt", "ws.command_preempted"})
    if _ev is not None:
        check("G: trace — ws.command_preempt names the capture, ws.command_preempted by=abort",
              any(e["tag"] == "ws.command_preempt" and e.get("by") == "abort"
                  and any(v.get("cmd") == "twp_capture" for v in e.get("victims", [])) for e in _ev)
              and any(e["tag"] == "ws.command_preempted" and e.get("cmd") == "twp_capture" for e in _ev),
              str([(e["tag"], e.get("by"), e.get("cmd"), e.get("victims")) for e in _ev]))
wait_idle()
mdi("g69")
mdi("G0 A0")
poll()
check("G: G69 recovers — undefined, G54, identity kins, machine ON",
      halget("twp-helper-comp.twp-is-defined") == 0 and s.g5x_index == 1
      and halget("motion.switchkins-type") == 0 and s.task_state == linuxcnc.STATE_ON)

print(f"\n=== {'ALL PASS' if not FAILS else str(len(FAILS)) + ' FAIL: ' + ', '.join(FAILS)} ===")
sys.exit(1 if FAILS else 0)
