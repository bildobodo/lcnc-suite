#!/usr/bin/env python3
"""Count the stall's signature in recorded Firefox runs (R387/R388 investigation).

A load = an HTTP GET / answered 200 under a test attempt's origin (run, test,
retry). A load has its hello when a connection OPENED under the same origin
after the load and before that origin's next load received a 'hello' frame.
A load without one is the stall's signature.

    stall-count.py DIR...   (each DIR is searched for *replay*/*.jsonl)
"""
import glob, json, os, sys


def origin_key(o):
    if not isinstance(o, dict) or "test" not in o:
        return None
    return (o.get("run"), o.get("test"), o.get("retry"))


def count_file(fn):
    loads, opens, hellos = {}, {}, set()
    with open(fn) as f:
        for line in f:
            try:
                e = json.loads(line)
            except ValueError:
                continue
            k = e.get("kind")
            if k == "http" and e.get("method") == "GET" and e.get("path") == "/" and e.get("status") == 200:
                key = origin_key(e.get("origin"))
                if key:
                    loads.setdefault(key, []).append(e["t"])
            elif k == "open":
                key = origin_key(e.get("origin"))
                if key:
                    opens[e["conn"]] = (key, e["t"])
            elif k == "frame" and isinstance(e.get("msg"), dict) and e["msg"].get("cmd") == "hello":
                hellos.add(e["conn"])
    n = missing = 0
    titles = []
    for key, ts in loads.items():
        ts.sort()
        for i, t in enumerate(ts):
            end = ts[i + 1] if i + 1 < len(ts) else float("inf")
            n += 1
            if not any(c in hellos and k2 == key and t <= t2 < end for c, (k2, t2) in opens.items()):
                missing += 1
                titles.append(key)
    return n, missing, titles


def main():
    total_n = total_m = 0
    for d in sys.argv[1:]:
        files = sorted(glob.glob(os.path.join(os.path.expanduser(d), "**", "*replay*", "*.jsonl"), recursive=True))
        n = m = 0
        found = []
        for fn in files:
            a, b, t = count_file(fn)
            n += a; m += b; found += t
        total_n += n; total_m += m
        print(f"{d:70s} files {len(files):3d} loads {n:5d} without hello {m}" + (f"  {found}" if found else ""))
    print(f"{'total':70s}           loads {total_n:5d} without hello {total_m}")


if __name__ == "__main__":
    main()
