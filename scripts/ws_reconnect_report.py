#!/usr/bin/env python3
"""How long did each browser tab take to (re)connect after a gateway start?

The acceptance measurement for the WS reconnect gate (2026-09-23): after a
suite / LinuxCNC restart the operator sees "Disconnected — reconnecting
automatically" until the tab's socket opens again. This report reads the
trace bus (gateway events + browser telemetry, which arrives batched once a
tab is connected) and prints, per launcher-started gateway and per page:

  open_s     seconds from the gateway's boot to the page's first ws.open
             (a page loaded later counts from its own load)
  attempts   WS attempts the page made while that gateway was up
  held_to    attempts that closed after >= 2.9 s without opening while the
             gateway was up — the browser held them (backoff / per-IP queue)
             and the client gave up; the defect the reconnect gate removes
             (after it, only the 10 s backstop can close a held attempt)
  probes     ws.probe phases the page reported (down / still_down / up)

A page is one document: its telemetry `page` id (older traces: its
navigation start, t_wall_ms - t_perf_ms).
Baseline before the gate — boots 09-19 21:59 and 09-23 19:46: the first Mac
Firefox tab connected 58 s / 41 s after the boot; pages loaded meanwhile read
"never" (reloaded while waiting) or 16.1 / 6.2 s, each with held_to 1–4.

Usage:
  python3 scripts/ws_reconnect_report.py                 # every boot in the trace
  python3 scripts/ws_reconnect_report.py --last 2
  python3 scripts/ws_reconnect_report.py --log-dir ~/lcnc-suite/runlogs
"""
from __future__ import annotations

import argparse
import datetime as _dt
import glob
import json
import os
import sys
from collections import defaultdict

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "lcnc-gateway"))


def _default_log_dir() -> str:
    try:
        import lcnc_paths
        return lcnc_paths.resolve()[0]
    except Exception:  # safe-silent: fall back to the resolver's documented default
        return os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "runlogs")


PAGE_GAP_MS = 100.0


def _origin(e: dict) -> float:
    return e["t_wall_ms"] - e["t_perf_ms"]


def _hms(ms: float) -> str:
    return _dt.datetime.fromtimestamp(ms / 1000).strftime("%m-%d %H:%M:%S")


def _ua(ua: str) -> str:
    browser = "Firefox" if "Firefox/" in ua else "Chrome" if "Chrome/" in ua else "Safari" if "Safari/" in ua else "?"
    host = "Mac" if "Macintosh" in ua else "Linux" if "Linux" in ua else "Win" if "Windows" in ua else "?"
    return f"{browser}/{host}"


def load(log_dir: str):
    files = sorted(glob.glob(os.path.join(log_dir, "trace.ndjson*")),
                   key=lambda p: -int(p.rsplit(".", 1)[1]) if p[-1].isdigit() else 0)
    boots: dict[int, float] = {}
    rows: list[dict] = []
    for fn in files:
        with open(fn, encoding="utf-8", errors="replace") as fh:
            for line in fh:
                if "boot.session_bind" not in line and "browser.ws." not in line \
                        and "browser.tab.beforeunload" not in line:
                    continue
                try:
                    e = json.loads(line)
                except ValueError:
                    continue
                if e.get("tag") == "boot.session_bind":
                    if e.get("mode") == "launcher":
                        boots[e["pid"]] = e["t_wall_ns"] / 1e6
                elif "t_wall_ms" in e and "t_perf_ms" in e:
                    rows.append(e)
    return boots, rows


def report(boots: dict[int, float], rows: list[dict], last: int | None) -> int:
    order = sorted(boots.items(), key=lambda kv: kv[1])
    if last:
        order = order[-last:]
    if not order:
        print("no launcher-started gateway in the trace")
        return 1
    # One page = one document. Telemetry carries its `page` id since
    # 2026-09-24; older events only have the navigation start
    # (t_wall_ms - t_perf_ms), which jitters ~1 ms within a page — cluster those
    # by gap. (Two machines' clocks can still put two tabs within the gap: the
    # reason the id exists.)
    origins = sorted({_origin(e) for e in rows if "page" not in e})
    cluster: dict[float, float] = {}
    for i, o in enumerate(origins):
        prev = origins[i - 1] if i else None
        cluster[o] = cluster[prev] if prev is not None and o - prev <= PAGE_GAP_MS else o

    def key(e: dict) -> str:
        return f"id:{e['page']}" if "page" in e else f"t:{cluster[_origin(e)]}"

    loaded_at: dict[str, float] = {}
    ua_of: dict[str, str] = {}
    for e in rows:
        k = key(e)
        loaded_at[k] = min(loaded_at.get(k, float("inf")), _origin(e))
        # A page's browser is known from its ws.client_env, which may have
        # reached an EARLIER gateway's trace window (the page outlived it).
        if e["tag"] == "browser.ws.client_env":
            ua_of[k] = _ua(e.get("ua", ""))
    held_total = 0
    for i, (pid, boot) in enumerate(order):
        end = order[i + 1][1] if i + 1 < len(order) else float("inf")
        pages: dict[str, list[dict]] = defaultdict(list)
        for e in rows:
            if e.get("pid") == pid:
                pages[key(e)].append(e)
        print(f"\ngateway pid {pid}  boot {_hms(boot)}")
        if not pages:
            print("  (no browser telemetry)")
            continue
        print(f"  {'page loaded':<15} {'browser':<13} {'open_s':>7} {'attempts':>8} {'held_to':>7}  probes")
        for k, evs in sorted(pages.items(), key=lambda kv: loaded_at[kv[0]]):
            evs.sort(key=lambda e: e["t_wall_ms"])
            ua = ua_of.get(k, "?")
            origin = loaded_at[k]
            since = max(boot, origin)
            up = [e for e in evs if boot <= e["t_wall_ms"] < end]
            opens = [e for e in up if e["tag"] == "browser.ws.open"]
            attempts = sum(1 for e in up if e["tag"] == "browser.ws.connect.attempt")
            held = sum(1 for e in up if e["tag"] == "browser.ws.close" and e.get("code") == 1006
                       and e.get("since_attempt_ms", 0) >= 2900)
            held_total += held
            probes = ",".join(e.get("phase", "?") for e in up if e["tag"] == "browser.ws.probe")
            open_s = f"{(opens[0]['t_wall_ms'] - since) / 1000:.1f}" if opens else "never"
            print(f"  {_hms(origin):<15} {ua:<13} {open_s:>7} {attempts:>8} {held:>7}  {probes or '-'}")
    print(f"\nheld attempts while a gateway was up: {held_total}")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--log-dir", default=_default_log_dir())
    ap.add_argument("--last", type=int, default=None, help="only the last N gateway boots")
    args = ap.parse_args()
    boots, rows = load(os.path.expanduser(args.log_dir))
    return report(boots, rows, args.last)


if __name__ == "__main__":
    sys.exit(main())
