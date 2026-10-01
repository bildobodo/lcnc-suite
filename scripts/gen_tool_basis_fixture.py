#!/usr/bin/env python3
"""Regenerate scripts/test_fixtures/tool_basis_pairs.json — REAL payloads of
the same program parsed at two start tool offsets (the real worker and
LinuxCNC's native offline interpreter via lcnc-gateway/native_start_probe.py,
one fresh process per parse), for the client's normalisation guard
(lcnc-webui/src/viewer/toolBasis.test.ts, VP-I20). Bytes as base64.

    python3 scripts/gen_tool_basis_fixture.py
"""
import base64
import json
import os
import subprocess
import sys
import tempfile

import msgspec

HERE = os.path.dirname(os.path.abspath(__file__))
GW = os.path.join(HERE, "..", "lcnc-gateway")
OUT = os.path.join(HERE, "test_fixtures", "tool_basis_pairs.json")
PAIRS = {"r55": ("10", "20"), "heavy_like": ("10", "10.005")}


def run(case, tmp):
    path = os.path.join(tmp, case.replace("@", "_") + ".mpk")
    env = dict(os.environ)
    env.pop("PYTHONPATH", None)
    subprocess.run([sys.executable, os.path.join(GW, "native_start_probe.py"), case, path],
                   check=True, capture_output=True, env=env, cwd=GW, timeout=120)
    with open(path, "rb") as f:
        p = msgspec.msgpack.decode(f.read())
    return {k: ({"bytes_b64": base64.b64encode(v).decode()} if isinstance(v, (bytes, bytearray)) else v)
            for k, v in p.items()}


def main():
    out = {"what": "native payloads of one program at two start tool offsets (VP-I20); "
                   "regenerate with scripts/gen_tool_basis_fixture.py", "pairs": {}}
    with tempfile.TemporaryDirectory() as tmp:
        for name, zs in PAIRS.items():
            out["pairs"][name] = {z: run(f"{name}@{z}", tmp) for z in zs}
    with open(OUT, "w") as f:
        json.dump(out, f, indent=1, sort_keys=True)
        f.write("\n")
    print("wrote", OUT)


if __name__ == "__main__":
    main()
