# P6-a parse time: the believed start's per-callback cost

Codex R459: "Die Backend-Gesamtdauern verschiedener Zweige sind keine Messung
des zusätzlichen Callback-Aufwands." P6-a puts a `try` / `if self.seq == 0` /
`finally: self._start_proof = None` around every motion handler of the canon
(straight_traverse, straight_feed = straight_probe, rigid_tap, arc_feed — the
arc's callback also calls `_ensure_reads()` and `_phase()` once more). This
measures what that costs on a big program, through the worker alone.

## Route

- **Trees:** `git archive` of `4eda3892` (base) and `fd720676` (P6-a) —
  `lcnc-gateway`, `subroutines`, `examples` — under
  `~/claude-work/p6a/parse-time/{base,head}`. `diff -rq`: they differ in
  `lcnc-gateway/gcode_canon.py`, `native_start_probe.py` and
  `test_start_dep_worker.py`; only the canon is on the parse's path.
- **Harness:** [p6a.parse-time.py](p6a.parse-time.py), ONE file for both trees
  (the base's probe lacks the setup the program needs): native_start_probe.py's
  route — the real `gcode_parse_worker.parse(ctx)` on LinuxCNC's native
  offline interpreter, synthetic STAT, a temporary INI / var file / tool table,
  a private tool data mmap under a private HOME — with the machine day's
  machine (its limits, the M600 remap, the bundled toolsetter routine, G54
  238.525 / 379.696 / −96.75). Each run is a fresh process; the clock
  (`perf_counter`, `process_time`) brackets `worker.parse(ctx)` alone.
- **Program:** `~/linuxcnc/nc_files/heavy_test_findings.ngc`, **689 082
  lines**, sha256 `d84c8a54…e630`: a Fusion 360 CAM program (parallel
  finishing, a tapered mill, `T13 M600` at its head) twice over, with one
  deliberate rapid past the X limit. No big CAM program is in the tree; this
  one is on the VM and already named in earlier review records. It parses to
  689 201 feed moves, 8 rapids and 138 arcs — about **689 300 motion
  callbacks**. Every run: no parse error, the same move counts, and the same
  payload digest without the start fields in both trees (`same_work: true`) —
  the two trees did the same work; only `start_believed` differs (base
  −238.525 / −379.696 / 96.75, P6-a 0 / 0 / 0: the F9 fix).
- **Conditions:** the VM (aarch64, 6 vCPUs, Python 3.13.5), the LAN sim
  running (3-axis profile), under the heavy lock (taken 11:14:39, released 11:15:56, 24 Nov 2026
  — no other heavy job in between). One warm-up per tree, discarded; then
  base, P6-a alternating, 3 runs each.

```
python3 scripts/test_support/heavy_lock.py --who p6a-follow -- \
  env -u PYTHONPATH lcnc-gateway/.venv/bin/python -I docs/reviews/p6a.parse-time.py \
  series ~/claude-work/p6a/parse-time/base ~/claude-work/p6a/parse-time/head \
  ~/linuxcnc/nc_files/heavy_test_findings.ngc <out.json> 3
```

Raw record: [p6a.parse-time.json](p6a.parse-time.json).

## The six numbers

| run | base 4eda3892 (s) | P6-a fd720676 (s) |
|---|---|---|
| 1 | 9.541 | 9.506 |
| 2 | 9.492 | 9.583 |
| 3 | 9.615 | 9.596 |
| **median** | **9.541** | **9.583** |
| spread (max − min) | 0.123 | 0.090 |

Wall time; the CPU time (`process_time`) is the same to the millisecond
(medians 9.540 / 9.582 s — the parse is one busy thread). Warm-ups: 9.600 /
9.572 s.

**Difference of the medians: +0.042 s = +0.44 %.**

## Model of the added statements

[p6a.parse-time.py](p6a.parse-time.py) `pattern` times the handler's shape
before and after P6-a around the same trivial body, past the first point
(2 000 000 calls, best of 7, twice each, same interpreter, under the heavy
lock): **55.1 → 78.1 ns per call, +23.0 ns**
([p6a.parse-time.pattern.json](p6a.parse-time.pattern.json)). For about
689 300 callbacks that is ≈ **0.016 s ≈ 0.17 %** of the 9.54 s parse.

## Verdict

The added per-callback work is **below what this measurement resolves**: the
medians differ by +0.042 s (+0.44 %), less than either tree's run-to-run
spread (0.12 s and 0.09 s), and the runs overlap (P6-a's fastest, 9.506 s, is
below the base's median). The difference is bounded by the spread: at most
≈ 0.12 s, i.e. ≈ 1.3 % or ≈ 180 ns per callback. The model puts it at
≈ 23 ns per callback, ≈ 0.17 % — consistent with that bound. On this program
P6-a adds no parse time worth a lever.

Scope: a program of straight moves. Its 138 arcs leave the arc callback's
extra `_ensure_reads()` / `_phase()` (once per arc, not per segment; once
the program has begun each is an attribute test and a return) unmeasured
here; an arc's own work — its segments, each recorded — is many times that.
