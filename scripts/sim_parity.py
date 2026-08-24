#!/usr/bin/env python3
"""Sim-vs-actual trajectory gate (W6).

The operator's acceptance standard: the trajectory the 3D SIM would pose
the machine along and the trajectory the REAL run produces must match,
over a corpus of test programs — "before that it's not proven correct."

Per run:
  1. load the program, wait for the RUNNING GATEWAY's cached payload to
     settle (idle drift edges included — their correctness is part of
     what's under test), and save those bytes: the payload the sim would
     actually play right before Cycle Start;
  2. capture the real run (twp_parity.sample_run — sim configs only,
     machine on + homed, refuses otherwise) with its W6 context header;
  3. replay the payload through the ACTUAL client code
     (lcnc-webui/scripts/simDump.ts via vite-node);
  4. compare joint-space PATHS bidirectionally (deg ≙ mm): truth samples
     against the sim polyline AND sim samples against the truth polyline
     — one direction alone misses an excursion the other path never
     makes (the arc-vs-plunge class). Wall-clock is never compared: the
     sim runs the estimate axis by design; corner rounding within the
     program's G64 blend budget is why tolerance is per-program.

  scripts/sim_parity.py gate --corpus scripts/parity_corpus/twp.json
  scripts/sim_parity.py compare --truth t.ndjson --sim s.jsonl --tol 0.5
  # offline payload source (bypasses the gateway cache — staleness NOT tested):
  scripts/sim_parity.py gate --corpus ... --fresh-parse
"""
import argparse
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _HERE)
sys.path.insert(0, os.path.join(_HERE, "..", "lcnc-gateway"))

import msgspec  # noqa: E402
import numpy as np  # noqa: E402

from twp_parity import run_preview, sample_run  # noqa: E402

_WEBUI = os.path.join(_HERE, "..", "lcnc-webui")


# ───────────────────────────── compare ─────────────────────────────

def load_truth_joints(path):
    """(N, J) joint rows from a sample_run capture (header skipped)."""
    rows = []
    for line in open(path):
        if not line.strip():
            continue
        r = json.loads(line)
        if r.get("header"):
            continue
        rows.append(r["joints"])
    return np.asarray(rows, dtype=float)


def load_sim_joints(path):
    """((N, J) rows, null_sample_count) from a simDump capture. Samples
    with any null joint are EXCLUDED from the arrays and counted — the
    caller must surface them (unchecked ≠ clean)."""
    rows = []
    nulls = 0
    for line in open(path):
        if not line.strip():
            continue
        r = json.loads(line)
        if r.get("meta"):
            continue
        j = r["joints"]
        if any(v is None for v in j):
            nulls += 1
            continue
        rows.append(j)
    return np.asarray(rows, dtype=float), nulls


def path_deviation(A, B):
    """Nearest-segment distance from each sample of A to polyline B, in
    6D joint space (degrees ≙ mm — the suite's convention). Returns
    (max, p99). Pure."""
    if len(A) == 0 or len(B) == 0:
        return float("inf"), float("inf")
    if len(B) == 1:
        d = np.sqrt(((A - B[0]) ** 2).sum(1))
        return float(d.max()), float(np.percentile(d, 99))
    P0, P1 = B[:-1], B[1:]
    D = P1 - P0
    L2 = (D * D).sum(1)
    L2[L2 == 0] = 1.0
    best = np.empty(len(A))
    for i, p in enumerate(A):
        t = np.clip(((p - P0) * D).sum(1) / L2, 0.0, 1.0)
        proj = P0 + t[:, None] * D
        best[i] = ((p - proj) ** 2).sum(1).min()
    best = np.sqrt(best)
    return float(best.max()), float(np.percentile(best, 99))


def compare_files(truth_path, sim_path, tol):
    """Bidirectional gate on one run. Returns (ok, report_str)."""
    T = load_truth_joints(truth_path)
    S, nulls = load_sim_joints(sim_path)
    if T.size == 0 or S.size == 0:
        return False, "empty trajectory (truth or sim) — nothing to certify"
    j = min(T.shape[1], S.shape[1])
    T, S = T[:, :j], S[:, :j]
    t2s_max, t2s_p99 = path_deviation(T, S)
    s2t_max, s2t_p99 = path_deviation(S, T)
    ok = t2s_max <= tol and s2t_max <= tol
    rep = (f"truth→sim max {t2s_max:.3f} p99 {t2s_p99:.3f} | "
           f"sim→truth max {s2t_max:.3f} p99 {s2t_p99:.3f} | tol {tol}")
    if nulls:
        frac = nulls / max(1, nulls + len(S))
        rep += f" | {nulls} sim samples with null joints (UNCHECKED)"
        if frac > 0.05:
            ok = False
            rep += " — over 5%, refusing to certify"
    return ok, rep


# ───────────────────────────── payload source ─────────────────────────────

def fetch_gateway_payload(port, expect_file, timeout=45.0, settle=4.0):
    """The RUNNING gateway's cached preview bytes — the payload the sim
    would actually play. Waits until the payload names `expect_file` and
    the bytes are STABLE for `settle` seconds (lets the idle drift edges
    fire and republish; their correctness is inside this gate's scope)."""
    url = f"http://127.0.0.1:{port}/preview"
    t0 = time.time()
    last = None
    stable_since = None
    while time.time() - t0 < timeout:
        try:
            with urllib.request.urlopen(url, timeout=5) as r:
                raw = r.read()
        except urllib.error.HTTPError:
            # 404 = nothing published YET (the poller parses moments after
            # program_open) — keep polling until the timeout.
            time.sleep(1.0)
            continue
        except Exception as e:
            raise SystemExit(
                f"gate needs the RUNNING gateway ({url}): {e} — start the "
                f"suite, or use --fresh-parse (staleness then NOT tested)")
        try:
            f = msgspec.msgpack.decode(raw).get("file")
        except Exception:
            f = None
        if f == expect_file:
            if raw == last:
                if stable_since and time.time() - stable_since >= settle:
                    return raw
            else:
                last = raw
                stable_since = time.time()
        time.sleep(1.0)
    raise SystemExit(f"gateway payload never settled on {expect_file} "
                     f"within {timeout}s")


# ───────────────────────────── gate ─────────────────────────────

def cmd_compare(a):
    ok, rep = compare_files(a.truth, a.sim, a.tol)
    print(("PASS  " if ok else "FAIL  ") + rep)
    return 0 if ok else 1


def cmd_gate(a):
    corpus = json.load(open(a.corpus))
    cdir = os.path.dirname(os.path.abspath(a.corpus))
    ini = os.path.expanduser(corpus["ini"])
    out_dir = a.out_dir or os.path.join(cdir, "runs")
    os.makedirs(out_dir, exist_ok=True)
    import linuxcnc  # noqa: F401  (sample_run needs it; fail early if absent)
    fails = 0
    for entry in corpus["programs"]:
        ngc = os.path.expanduser(entry["file"])
        if not os.path.isabs(ngc):
            ngc = os.path.normpath(os.path.join(cdir, ngc))
        runs = int(entry.get("runs", 1))
        tol = float(entry.get("tol", 0.5))
        base = os.path.splitext(os.path.basename(ngc))[0]
        for run_i in range(1, runs + 1):
            tag = f"{base}.run{run_i}"
            truth_path = os.path.join(out_dir, tag + ".truth.ndjson")
            sim_path = os.path.join(out_dir, tag + ".sim.jsonl")
            payload_path = os.path.join(out_dir, tag + ".payload.msgpack")
            # 1. the payload the sim would play RIGHT NOW (pre-run state).
            if a.fresh_parse:
                p = run_preview(ini, ngc)
                p.pop("_stderr", None)
                raw = msgspec.msgpack.encode(p)
            else:
                # Load first so the gateway parses this file, then let it
                # settle (drift edges included).
                import linuxcnc as _l
                c = _l.command()
                c.mode(_l.MODE_AUTO)
                c.wait_complete()
                c.program_open(ngc)
                raw = fetch_gateway_payload(a.port, ngc)
            with open(payload_path, "wb") as f:
                f.write(raw)
            # 2. the real run.
            sample_run(ini, ngc, truth_path)
            # 3. the sim replay of the SAME pre-run payload + start state.
            r = subprocess.run(
                ["npx", "vite-node", "scripts/simDump.ts", "--",
                 payload_path, truth_path, sim_path],
                cwd=_WEBUI, capture_output=True, text=True)
            if r.returncode != 0:
                fails += 1
                print(f"[FAIL] {tag}: simDump rc={r.returncode}\n{r.stderr[-800:]}")
                continue
            # 4. the gate.
            ok, rep = compare_files(truth_path, sim_path, tol)
            print(("[PASS] " if ok else "[FAIL] ") + f"{tag}: {rep}")
            fails += 0 if ok else 1
    print(f"\nsim parity gate: {'GREEN' if fails == 0 else f'{fails} FAILURE(S)'}")
    return 1 if fails else 0


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0],
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    g = sub.add_parser("gate", help="run the corpus gate")
    g.add_argument("--corpus", required=True)
    g.add_argument("--out-dir")
    g.add_argument("--port", type=int, default=8000)
    g.add_argument("--fresh-parse", action="store_true",
                   help="parse per run instead of using the gateway cache "
                        "(cache staleness then NOT tested)")
    g.set_defaults(fn=cmd_gate)
    c = sub.add_parser("compare", help="compare one truth/sim pair")
    c.add_argument("--truth", required=True)
    c.add_argument("--sim", required=True)
    c.add_argument("--tol", type=float, default=0.5)
    c.set_defaults(fn=cmd_compare)
    a = ap.parse_args()
    return a.fn(a)


if __name__ == "__main__":
    sys.exit(main())
