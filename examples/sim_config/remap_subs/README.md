# Switchkins toggle remaps (M428 / M429 / M430)

Adapted from LinuxCNC 2.9.4's
`sample-configs/sim/axis/vismach/5axis/table-rotary-tilting/remap_subs`
(GPL v2+). Referenced by `lcnc_suite_sim_5axis_tcp.ini`.

| Code | Effect (`motion.switchkins-type` via `motion.analog-out-02`) |
|------|--------------------------------------------------------------|
| M429 | 0 — identity (joints follow axis words) |
| M428 | 1 — TCP (`xyzac-trt-kins` world kinematics) |
| M430 | 2 — userk (tool-length-along-tool in the stock template) |

Deltas vs the upstream sample, documented in each file's header:

- **`motion.analog-out-02`** instead of `-03` (`core_sim_5.hal` loads
  motmod with `num_aio=3`: `-00` is the coolant sim, `-02` is free).
- **Nested o-if guards** instead of `AND`-ed conditions — RS274 `AND`
  does **not** short-circuit, so `[#<_task> EQ 1] AND [#<_hal[...]>]`
  still evaluates the HAL variable during preview parsing and errors out.
- **`(WEBUI_KINSTYPE=n)` marker comments** — each remap emits one at the
  exact point it switches the kins. This is the contract the lcnc-suite
  offline stack (preview, simulation scrub, collision sweep, joint-side
  soft limits) uses to know which program segments run under which
  kinematics: comments are the only execution-ordered channel the
  preview interpreter receives (remapped M-codes never show up in the
  active-code lists, and M68 is swallowed by the preview canon). If you
  write your own switchkins M-codes, emit the same full-line comment
  where you set the pin; programs that switch without markers degrade
  honestly to "untracked" (programmed-coordinate posing + a browser
  console warning).

INI prerequisites (all present in the TCP sim INI; the remaps
self-diagnose the first two with a `(debug, …)` message + STOP):

- `[RS274NGC] HAL_PIN_VARS = 1` — the remaps read
  `#<_hal[motion.switchkins-type]>` to verify the switch took.
- `[HAL] HALCMD = net :kinstype-select motion.analog-out-02 => motion.switchkins-type`
- `[RS274NGC] SUBROUTINE_PATH` includes this directory, plus the three
  `REMAP=M42x modalgroup=10 ngc=42xremap` lines.
