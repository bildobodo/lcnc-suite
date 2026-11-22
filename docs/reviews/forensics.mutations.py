"""P3 red proofs (machine day, forensics): each mutation breaks ONE rule of the
agreed plan (R425/R426 MT425-02..04); the named guards must turn red. Applies
to a tree, runs the guards, restores — every file byte-identical afterwards.

  python3 -I mut_p3.py <tree> [name …]
"""
import json, pathlib, subprocess, sys

TREE = pathlib.Path(sys.argv[1]).resolve()
ONLY = set(sys.argv[2:])
PY = str(TREE / "lcnc-gateway/.venv/bin/python3")
GW = ["lcnc-gateway/test_trace_rotation.py", "lcnc-gateway/test_trace_bundle.py"]
WEB = ["src/stallWindow.test.ts", "src/holdGesture.test.ts", "src/ws/telemetry.test.ts"]

MUTS = [
    ("cross_process_fragment_not_closed", "MT425-02 / R426: a fragment another writer left is not ended",
     "lcnc-gateway/lcnc_trace.py",
     'and os.pread(fd, 1, size - 1) != b"\\n":', 'and False:', "gw"),
    ("write_without_lock", "MT425-02: the section takes no lock",
     "lcnc-gateway/lcnc_trace.py",
     "fcntl.flock(self._lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)", "pass", "gw"),
    ("launcher_fragment_not_closed", "MT425-02 / R426: the launcher glues its line to a fragment",
     "lcnc-suite",
     'if [[ -s "$log" && -n "$(tail -c1 -- "$log")" ]]; then', "if false; then", "gw"),
    ("snapshot_reads_past_its_bound", "MT425-03: the reader reads past the captured size",
     "scripts/trace-bundle.py",
     "snap.files.append((entry, fd, st.st_dev, st.st_ino, st.st_size))",
     "snap.files.append((entry, fd, st.st_dev, st.st_ino, st.st_size + (1 << 20)))", "gw"),
    ("stall_at_150", "MT425-04: a 150 ms gap counts (the hold guard's limit is > 150)",
     "lcnc-webui/src/stallWindow.ts",
     "if (gap > HOLD_STALL_MS) {", "if (gap >= HOLD_STALL_MS) {", "web"),
    ("hold_refusal_without_its_gap", "MT425-04: a stalled hold's refusal does not carry its gap",
     "lcnc-webui/src/holdGesture.ts",
     'this.finish("stalled", gap);', 'this.finish("stalled");', "web"),
    ("transport_loss_not_counted", "MT425-04 F20: a lost batch is not counted",
     "lcnc-webui/src/ws/telemetry.ts",
     "_dropped.events += events;", "_dropped.events += 0;", "web"),
]


def run(kind):
    if kind == "gw":
        p = subprocess.run([PY, "-m", "pytest", "-q", "-p", "no:cacheprovider", *GW], cwd=TREE,
                           capture_output=True, text=True, timeout=900)
    else:
        p = subprocess.run(["npx", "vitest", "run", *WEB], cwd=TREE / "lcnc-webui",
                           capture_output=True, text=True, timeout=900)
    out = p.stdout + p.stderr
    failed = [l.strip() for l in out.splitlines()
              if l.startswith("FAILED ") or " FAIL " in l or l.strip().startswith("×")]
    tail = [l for l in out.splitlines() if " passed" in l or " failed" in l][-3:]
    return p.returncode, failed[:12], tail


results = []
for name, rule, rel, old, new, kind in MUTS:
    if ONLY and name not in ONLY:
        continue
    f = TREE / rel
    src = f.read_bytes()
    s = src.decode()
    assert s.count(old) == 1, f"{name}: anchor found {s.count(old)}x in {rel}"
    try:
        f.write_text(s.replace(old, new))
        rc, failed, tail = run(kind)
    finally:
        f.write_bytes(src)
    results.append({"mutation": name, "rule": rule, "file": rel, "red": rc != 0,
                    "failed": failed, "summary": tail})
    print(("RED  " if rc != 0 else "GREEN"), name, "|", " ".join(tail)[:160], flush=True)

dirty = subprocess.run(["git", "status", "--short", "--", *[m[2] for m in MUTS]], cwd=TREE,
                       capture_output=True, text=True).stdout.strip()
print("restored:", "yes" if not dirty else "NO: " + dirty)
print(json.dumps(results, indent=1))
