"""Gateway-side mutants for the latch-sticky contract: each applied alone in
~/lcnc-suite-latch, test_trip_basis.py run, the tree restored."""
import subprocess, sys, xml.etree.ElementTree as ET
from pathlib import Path
T = Path.home() / "lcnc-suite-latch"
G = T / "lcnc-gateway"
PY = str(G / ".venv/bin/python3")
MUTANTS = {
 "M1 stale input dropped": ("lcnc-gateway/gateway_util.py",
   'latched = snap.get("trip_latched") if isinstance(snap, dict) else None',
   'latched = (snap.get("trip_latched") if isinstance(snap, dict) else None) if (now - arrival) <= stale_sec else None'),
 "M2 poller reads the latch again": ("lcnc-gateway/gateway.py",
   "                _latch_in, _last_fault_latched, _trip_baseline_seen",
   '                _reader_get("trip_latched"), _last_fault_latched, _trip_baseline_seen'),
 "M3 await before the publication": ("lcnc-gateway/gateway.py",
   "            _gen = _status_gen + 1\n",
   "            await asyncio.sleep(0)\n            _gen = _status_gen + 1\n"),
 "M4 trip_basis from the global": ("lcnc-gateway/gateway.py",
   "                        trip_basis=pub.trip_basis,",
   "                        trip_basis=_published.trip_basis,"),
 "M5 data from the global": ("lcnc-gateway/gateway.py",
   "status_data = pub.status_dict.copy() if pub.status_dict else st.__dict__.copy()",
   "status_data = _published.status_dict.copy() if _published.status_dict else st.__dict__.copy()"),
 "M6 delta frames drop trip_basis": ("lcnc-gateway/gateway.py",
   '                            status_msg["type"] = "status_delta"\n',
   '                            status_msg["type"] = "status_delta"\n                            status_msg.pop("trip_basis", None)\n'),
 "M7 the stamp after the read": ("lcnc-gateway/hal_reader.py",
   "                r0 = time.monotonic()\n                raw = hal.get_value(source)\n",
   "                raw = hal.get_value(source)\n                r0 = time.monotonic()\n"),
 "M8 t_pub not right before the rebind": ("lcnc-gateway/gateway.py",
   "            _gen = _status_gen + 1\n            _t_pub = time.monotonic()\n",
   "            _t_pub = time.monotonic()\n            _gen = _status_gen + 1\n"),
 "M9 the reader never numbers": ("lcnc-gateway/hal_reader.py",
   "    _snap_seq += 1\n", "    _snap_seq = 1\n"),
 "M10 the delta from the global after the await": ("lcnc-gateway/gateway.py",
   'status_msg["data"] = _diff_status_data(_last_status_data, status_msg["data"])',
   'status_msg["data"] = _diff_status_data(_last_status_data, dict(_published.status_dict or {}))'),
 "M11 a second latch read for the trip decision": ("lcnc-gateway/gateway.py",
   "            if _tl[\"faulted_on_connect\"]:",
   "            _second = _hal_bridge.reader_get(\"trip_latched\")\n            if _tl[\"faulted_on_connect\"]:"),
}
out = []
for name, (rel, old, new) in MUTANTS.items():
    p = T / rel
    src = p.read_text()
    assert src.count(old) == 1, (name, src.count(old))
    p.write_text(src.replace(old, new))
    try:
        xml = Path("/tmp/claude-1000/-home-cnc-lcnc-suite/43040f88-3607-41a3-a5fe-dc80019b2257/scratchpad/mut.xml")
        subprocess.run([PY, "-m", "pytest", "-p", "no:cacheprovider", f"--junitxml={xml}", "test_trip_basis.py"],
                       cwd=G, capture_output=True, timeout=600)
        red = []
        for c in ET.parse(xml).getroot().iter("testcase"):
            f = c.find("failure") if c.find("failure") is not None else c.find("error")
            if f is not None:
                red.append(f"{c.get('name')}: {(f.get('message') or '').splitlines()[0][:150] if f.get('message') else ''}")
        out.append(f"{name}: {len(red)} red" + "".join(f"\n    {r}" for r in red))
    finally:
        p.write_text(src)
print("\n".join(out))
