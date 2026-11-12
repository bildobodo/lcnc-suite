# The type check's boundary (package 2, plan vor-maschine R352/R353)

What `scripts/run_pyright.py` checks (`pyrightconfig.json`, pyright pinned in
`lcnc-webui/package.json`), and what it does not.

## Checked

- **The gateway's product modules** (`lcnc-gateway/*.py`), mode `standard` —
  **except `gateway.py` during 2a** (named, temporary: it enters with 2b, the
  connection `Link` that replaces the optional `STAT`/`CMD` globals).
- **`subroutines/surfacemap/compensation.py`** (the HAL helper the suite runs).
- **The interface and its two conformance checks**: `lcnc-gateway/lcnc_iface.py`
  (Protocols), `typings/conformance/check_stub.py` (the stub of the real
  binding against them), `check_fake.py` (the tests' fake against them),
  and the fake itself (`fake_linuxcnc.py`).

## Not checked — named

- **Tests** (`lcnc-gateway/test_*.py`, `conftest.py`) and the test helpers
  that live beside the product modules: `writer_fixture.py`,
  `suite_py_bind_probe.py`, `native_start_probe.py`, `native_pinned_probe.py`
  (run by tests, in their own processes). They keep their run-time checks.
- **`scripts/`** and **`examples/`** (the TWP remap is an upstream fork) —
  their own run checks; ruff covers them.

## The native and indirect imports of the checked modules

| Import | Where | Status |
|---|---|---|
| `linuxcnc` | gateway modules, compensation | **stub** `typings/linuxcnc.pyi` (shapes from the 2.9.4 binding's source; held against `lcnc_iface`) |
| `hal` | `hal_reader.py`, `hal_watchdog.py`, `compensation.py` | **stub** `typings/hal.pyi` (`halmodule.cc`, `hal.h`) |
| `interpreter` | `gcode_canon.py:53` | **stub** `typings/interpreter.pyi` — the embedded module exists only inside a parse; one named suppression (`reportMissingModuleSource`) at its import |
| `gcode` | `gcode_parse_worker.py:66` | **stub** `typings/gcode.pyi` (`gcodemodule.cc`: formats, the 2-tuple return, METH_VARARGS) |
| `rs274.interpret` | `gcode_canon.py:14` | **stub** `typings/rs274/interpret.pyi` — generated from the installed 2.9.4 source by `pyright --createstub`, typed from it |

The CI job installs no LinuxCNC. Every native or LinuxCNC-Python import of the
checked modules therefore has a stub here, and CI and the VM check against the
SAME stubs (stubs take precedence over the installed packages on the VM).

## Status fields: guaranteed and optional

`lcnc_iface.STAT_FIELDS` are the guaranteed fields (the stub declares them,
`lcnc_iface_check.py` finds each on the installed binding).
`OPTIONAL_STAT_FIELDS` are read with a fallback and not required of every
binding: `spindle_override` (2.9.4 has only the spindle row's `override`).
`test_lcnc_iface.py` holds every literal status read of the product code to
one of the two — the class of `spindle_override_enabled`, a name 2.9.4 never
had, read with the default True (fixed in 2a).

## The native name check

`lcnc_iface_check.py`: names and constant values only, against the installed
binding (import and class inspection — no channel, no poll). Mandatory on the
VM (`test_lcnc_iface.py`) and in the install probe (row `install-binding`);
skipped by name only where a job declares `LCNC_NO_BINDING=1` (the CI
backend job, which has no LinuxCNC).
