# Live checks before main — 2026-11-11

The live checks owed on my side before main (operator: "mache die checks die auf
deiner seite offen sind"), run on the VM's real LinuxCNC (sim). The product is
**development f54f3120** throughout; where a test DRIVER was wrong, the fixed
driver ran against the same gateway code.

## Verdicts

| Check | Product | Driver | Verdict | Evidence |
|---|---|---|---|---|
| Native stage, main variant | f54f3120 | f54f3120 | FAIL (driver) — stopped at `ts-sync`: the driver saved the toolsetter section without `base_rev`, the gateway refused it correctly | `native.20261111T182625` |
| Native stage, main variant | 407b758c (= f54f3120 + driver fix) | 407b758c | **PASS** — 58 PASS, 6 informational `incomplete` | `native.20261111T184906` |
| Native stage, latch-delayed | f54f3120 / 407b758c | same | **PASS** 3/3 at both | `native.…-latch-delayed` |
| toolsetter-readback (XYZAC) | f54f3120 | f54f3120 | **PASS** 10/10 | `pass1.toolsetter-readback.*` |
| live-twp `--prepare-sim` (TWP) | f54f3120 | f54f3120 | **PASS** 9/9 gates (preview goldens, live parity, twp_buttons_check, reorient, capture, touch-off, plane touch-off, G68.3, adverse), nothing omitted | `pass1.live-twp.*` |
| macro-live (XYZAC + macro folder) | f54f3120 | f54f3120 | FAIL (driver) — 4 rows: every macro write refused "Connection unknown" (no `X-Conn-Key`) | `pass1.macro-live.txt` |
| macro-live | f54f3120 gateway code | 10775728 | **PASS** — 17 PASS, 1 SKIP (above-z0: Z MAX 0, by design) | `pass2.macro-live.txt` |
| perf_matrix (3-axis) | f54f3120 | f54f3120 | FAIL (driver) — upload/save 403 (measured nothing), preview_publish DELIVERY FAIL | `pass1.perf*` |
| perf_matrix | f54f3120 gateway code | 10775728 | **PASS** — every scenario measured: upload/save 40 MB → 200, lag 0; preview_publish delivered (19.1 s); sigstop_trip latched and recovered; worst non-SIGSTOP lag 71.5 ms | `pass2.perf*` |
| probe-live | — | — | NOT RUNNABLE — no runner exists. Nearest evidence: the native stage's `probe-z`, its counter-check and `probe-z-miss`, all PASS. Nothing covers `probe_run`, the UI's probe path | — |
| firefox-core | — | — | NOT RUNNABLE — the infrastructure is not built (test strategy step 6) | — |

The six `incomplete` rows of the native main run are the jog rows measured from
the WebSocket reply: status frames carry no capture time, so the braking travel
has only an upper bound. The servo-timed rows for the same jogs PASS.

"f54f3120 gateway code" (pass 2): the run tree was `~/lcnc-suite-fs` at 10775728
(fix/native-settings-rev). `git diff --stat f54f3120 10775728` touches only
`scripts/` and `lcnc-gateway/test_suite_runner.py` (a test) — the gateway, the
HAL helpers, the subroutines and the example configs are f54f3120's. A second
scratch install from that tree was needed because `perf_matrix` reads the trace
of ITS checkout's `runlogs/`, which must be the running gateway's.

## Defects found — all in test drivers or the harness, none in the product

1. **native_run.py saved without `base_rev`** (a settings-split leftover; the
   offline fakes accepted every save). Fixed in 407b758c: `live_session` keeps
   the `settings_init` / `settings_changed` revisions, the save names its base,
   the offline fake uses the real `settings_store`.
2. **macro_live_check.py and perf_matrix.py predate BG-14**: their protected
   HTTP writes carried the token only and were refused. Two of
   macro_live_check's claim rows passed their "write during" half only because
   the writer refusal carries the kind `busy` too; perf_matrix answered 0 with
   two vacuous 403 scenarios (a scenario's own result never decided the run).
   Fixed in 10775728: the hello reply's `conn_key`, `X-Conn-Key`, an armed
   writer for perf_matrix's writes, `overwrite=1`, claim rows on the busy
   machine's reasons only, and `scenario_failure` (an exception, a status
   outside 2xx, an `*_ok` not True fails the run). New backend step
   `perf-matrix` (`scripts/test_perf_matrix.py`, 7 mutations red).
3. **Harness (not in the repo)**: the first attempt (19:22) failed in setup for
   every check — LinuxCNC ran under the installer's fake HOME, the check
   scripts under the real one. LinuxCNC keeps its tool mmap at
   `$HOME/.tool.mmap`, so `stat.poll()` under the other HOME raised SystemError
   (or segfaulted — `pass1.proof.txt` proves it both ways), and
   `compensation.py` resolved from the real `~/.local/bin` (links into the main
   repo). `env.sh` now gives LinuxCNC and every check ONE HOME and PATH and pins
   the heavy lock (`heavy_lock.py` resolves it under `Path.home()`). The
   harness is `harness.txt`.

## Files

- `pass1.*` — the full pass at f54f3120 (all.sh): toolsetter-readback,
  live-twp, macro-live (red), perf (red), and the proof of the HOME cause.
- `pass2.*` — macro-live and perf with the fixed drivers (all2.sh).
- `native.*` — the four native-stage run reports.
- No WEBUI token in any file (checked against every INI token on this VM).

The LAN sim was given back on f54f3120 after each pass (`lcnc-sim-gates`,
`bg-keepalive` active). Still owed before main: the hardware validation on the
machine PC, and the fix branch's round gate, Codex round and merge.
