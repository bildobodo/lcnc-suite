#!/usr/bin/env python3
"""Preview-payload golden gate (W2 P8.2).

Parses a corpus of programs through the REAL parse worker (same spawn as
the gateway) and reduces each payload to a structural SUMMARY — the facts
the wave-2 defects would have flipped:

  preview_schema        the wire-format stamp (P1)
  points                feed/rapid counts
  ships_abc             the abc pose channel is present (P3 — the flat-TWP
                        class was this bit silently false)
  swept_axes            which of A/B/C actually vary in the shipped abc
  kinstype_present      switchkins mode arrays on the wire
  kins_frames           TWP frame marker count
  wcs_epochs            epoch rows + how many are program-rewritten
  brk_count             flip-relabel vertices (phantom-jump handling)
  lines_untrusted       the per-point-trust kill switch (P6: no point trusts)
  trusted_points        how many shipped points trust their line
  sub_names             marked subroutine spans seen
  violations_total      per-line soft-limit flags (env-sensitive: depends on
                        the parse-time tool table / WCS — see below)

`generate` writes goldens to scripts/preview_goldens/<config>/<program>.json;
`check` re-parses and diffs against them, printing exact field-level drift.
A field regressing (abc disappearing, epochs collapsing, schema moving
without a golden refresh) is a red check — the class of silent preview
regressions wave 2 was built to end.

REQUIRES a running LinuxCNC instance of the MATCHING config (the worker
reads live stat for the tool table, like the gateway does) — same
requirement as twp_parity; a headless `DISPLAY = dummy` boot suffices.
Env-sensitive fields (violations_total, trusted rates on programs with
tool changes) belong to the config+var-file state goldens were generated
under; regenerate deliberately, never to silence a diff you don't
understand.
"""
import argparse
import json
import os
import sys

import numpy as np

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _HERE)
sys.path.insert(0, os.path.join(_HERE, "..", "lcnc-gateway"))

from twp_parity import run_preview, _arr  # noqa: E402

GOLDEN_DIR = os.path.join(_HERE, "preview_goldens")


def summarize(payload):
    """Reduce a preview payload to its structural golden summary. Pure."""
    out = {"preview_schema": payload.get("preview_schema")}
    n_feed = len(_arr(payload, "feed")) // 3
    n_rapid = len(_arr(payload, "rapid")) // 3
    out["points"] = {"feed": int(n_feed), "rapid": int(n_rapid)}
    abc = []
    for stream in ("feed", "rapid"):
        raw = payload.get(stream + "_abc")
        if raw:
            abc.append(_arr(payload, stream + "_abc").reshape(-1, 3))
    out["ships_abc"] = bool(abc)
    swept = set()
    if abc:
        allabc = np.vstack(abc)
        ptp = allabc.max(axis=0) - allabc.min(axis=0)
        swept = {"ABC"[i] for i in range(3) if ptp[i] > 1e-6}
    out["swept_axes"] = sorted(swept)
    out["kinstype_present"] = payload.get("feed_kinstype") is not None \
        or payload.get("rapid_kinstype") is not None
    out["kins_frames"] = len(payload.get("kins_frames") or [])
    rows = payload.get("wcs_frames") or []
    out["wcs_epochs"] = {"count": len(rows),
                         "rewritten": sum(1 for r in rows if int(r[3]))}
    brk = payload.get("rapid_brk")
    out["brk_count"] = int(np.frombuffer(brk, np.uint8).sum()) if brk else 0
    out["lines_untrusted"] = bool(payload.get("lines_untrusted"))
    trusted = 0
    total = 0
    for stream in ("feed", "rapid"):
        ok = payload.get(stream + "_lineok")
        if ok:
            arr = np.frombuffer(ok, np.uint8)
            trusted += int(arr.sum())
            total += len(arr)
    out["trusted_points"] = {"trusted": trusted, "total": total}
    out["sub_names"] = list(payload.get("sub_names") or [])
    out["violations_total"] = int(payload.get("violations_total") or 0)
    out["violations_world_unchecked"] = int(
        payload.get("violations_world_unchecked") or 0)
    return out


def diff_summaries(golden, current, prefix=""):
    """Field-level differences golden → current, as printable strings."""
    out = []
    keys = sorted(set(golden) | set(current))
    for k in keys:
        g, c = golden.get(k), current.get(k)
        if isinstance(g, dict) and isinstance(c, dict):
            out.extend(diff_summaries(g, c, prefix=f"{prefix}{k}."))
        elif g != c:
            out.append(f"{prefix}{k}: golden={g!r} current={c!r}")
    return out


def _golden_path(config_name, ngc):
    base = os.path.splitext(os.path.basename(ngc))[0]
    return os.path.join(GOLDEN_DIR, config_name, base + ".json")


def run(mode, ini, files, config_name):
    fails = 0
    for ngc in files:
        payload = run_preview(ini, ngc)
        cur = summarize(payload)
        path = _golden_path(config_name, ngc)
        if mode == "generate":
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, "w") as f:
                json.dump(cur, f, indent=2, sort_keys=True)
                f.write("\n")
            print(f"golden written: {os.path.relpath(path, _HERE)}")
            continue
        if not os.path.isfile(path):
            fails += 1
            print(f"[NO GOLDEN] {os.path.basename(ngc)} — run generate first")
            continue
        with open(path) as f:
            golden = json.load(f)
        diffs = diff_summaries(golden, cur)
        if diffs:
            fails += 1
            print(f"[DRIFT] {os.path.basename(ngc)}")
            for d in diffs:
                print(f"  {d}")
        else:
            print(f"[OK] {os.path.basename(ngc)}")
    return fails


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("mode", choices=["generate", "check"])
    ap.add_argument("--ini", required=True)
    ap.add_argument("--config-name", required=True,
                    help="golden subdir name (e.g. twp, 3axis)")
    ap.add_argument("files", nargs="+", help="programs to parse")
    a = ap.parse_args()
    fails = run(a.mode, a.ini, a.files, a.config_name)
    if a.mode == "check":
        print(f"\npreview gate: {'CLEAN' if fails == 0 else f'{fails} FAILURE(S)'}")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
