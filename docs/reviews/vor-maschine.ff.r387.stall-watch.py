#!/usr/bin/env python3
"""THROWAWAY stall watcher (R387 investigation, outside every tree).

Polls the Firefox runs' event logs under the given roots; a test attempt
with a test-start and no test-end after AGE seconds gets one record: every
Firefox process and thread (state, wchan, CPU ticks) twice, 1.5 s apart,
plus memory, pressure and load. One record per attempt. Ends when the unit
named by --until is no longer active (checked every poll).

    stall-watch.py --out DIR --until UNIT ROOT...
"""
import argparse, glob, json, os, re, subprocess, time

AGE = 20.0


def rd(p):
    try:
        with open(p) as f:
            return f.read()
    except OSError:
        return ""


def snapshot():
    procs = []
    for pid in (d for d in os.listdir("/proc") if d.isdigit()):
        comm = rd(f"/proc/{pid}/comm").strip()
        cmd = rd(f"/proc/{pid}/cmdline").replace("\0", " ")
        if not re.search(r"firefox|Web Co|Isolated|Socket Pr|RDD|Utility|GPU Pro|Privileged|WebExt|forkserver", comm + " " + cmd, re.I):
            continue
        if re.search(r"node|playwright|bash|python", comm):
            continue
        st = rd(f"/proc/{pid}/stat"); f = st[st.rfind(")") + 2:].split()
        threads = []
        try:
            tids = os.listdir(f"/proc/{pid}/task")
        except OSError:
            tids = []
        for tid in tids:
            ts = rd(f"/proc/{pid}/task/{tid}/stat"); g = ts[ts.rfind(")") + 2:].split()
            if len(g) < 13:
                continue
            threads.append({"tid": tid, "comm": rd(f"/proc/{pid}/task/{tid}/comm").strip(), "state": g[0],
                            "wchan": rd(f"/proc/{pid}/task/{tid}/wchan").strip(), "cpu": int(g[11]) + int(g[12])})
        if len(f) < 13:
            continue
        procs.append({"pid": pid, "ppid": f[1], "comm": comm, "state": f[0], "cmd": cmd[:300],
                      "cpu": int(f[11]) + int(f[12]), "threads": threads})
    mem = {l.split(":")[0]: l.split(":")[1].strip() for l in rd("/proc/meminfo").splitlines()
           if l.split(":")[0] in ("MemAvailable", "SwapFree", "SwapTotal", "Shmem")}
    return {"t": time.time(), "mem": mem, "load": rd("/proc/loadavg").strip(),
            "psi": {k: rd(f"/proc/pressure/{k}") for k in ("cpu", "memory", "io")}, "procs": procs}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--until", required=True)
    ap.add_argument("roots", nargs="+")
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    done = set()
    offsets = {}
    open_ = {}
    log = open(os.path.join(a.out, "watch.log"), "a")
    log.write(f"start {time.strftime('%FT%T')} roots {a.roots}\n"); log.flush()
    while True:
        files = set()
        for r in a.roots:
            files |= set(glob.glob(os.path.join(os.path.expanduser(r), "**", "*events*.jsonl"), recursive=True))
        for fn in files:
            try:
                with open(fn) as f:
                    f.seek(offsets.get(fn, 0))
                    for line in f:
                        if not line.endswith("\n"):
                            break
                        offsets[fn] = offsets.get(fn, 0) + len(line.encode())
                        try:
                            e = json.loads(line)
                        except ValueError:
                            continue
                        key = (fn, e.get("run"), e.get("testId"), e.get("retry"))
                        if e.get("event") == "test-start":
                            open_[key] = (e.get("t", 0) / 1000.0, e.get("title"), e.get("workerIndex"), e.get("instance"))
                        elif e.get("event") == "test-end":
                            open_.pop(key, None)
            except OSError:
                pass
        now = time.time()
        for key, (t0, title, w, inst) in list(open_.items()):
            if now - t0 > AGE and key not in done:
                done.add(key)
                s1 = snapshot(); time.sleep(1.5); s2 = snapshot()
                rec = {"file": key[0], "run": key[1], "testId": key[2], "retry": key[3], "title": title,
                       "worker": w, "instance": inst, "age": round(now - t0, 1), "s1": s1, "s2": s2}
                with open(os.path.join(a.out, "records.jsonl"), "a") as f:
                    f.write(json.dumps(rec) + "\n")
                log.write(f"{time.strftime('%FT%T')} record: {title} (worker {w}, {round(now - t0)} s)\n"); log.flush()
        if subprocess.run(["systemctl", "--user", "is-active", "-q", a.until]).returncode != 0:
            log.write(f"end {time.strftime('%FT%T')}: {a.until} not active\n"); log.flush()
            return
        time.sleep(2)


if __name__ == "__main__":
    main()
