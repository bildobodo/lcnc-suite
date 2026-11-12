# The type check's boundary (package 2, plan vor-maschine R352/R353)

What `scripts/run_pyright.py` checks (`pyrightconfig.json`, pyright pinned in
`lcnc-webui/package.json`), and what it does not.

## Checked

- **The gateway's product modules** (`lcnc-gateway/*.py`), mode `standard` —
  **except `gateway.py` during 2a** (named, temporary: it enters with 2b, the
  connection `Link` that replaces the optional `STAT`/`CMD` globals).
- **`strict` for the pure modules** (`pyrightconfig.json` `strict`, R354
  VM-I03): `command_policy`, `settings_store`, `session_bind`, `lcnc_paths`,
  `lcnc_trace` — no unknown type anywhere in them. What arrives as JSON (a
  command payload, a settings document, a helper's hello) is `JsonValue`
  (`lcnc-gateway/json_types.py`, what `json.loads` makes — no `Any`), narrowed
  where it is used; `to_float` / `to_int` are float() / int() with the
  builtins' outcome for every value, typed. `Any` remains in ONE strict
  module, `lcnc_trace`, five times, each named: the trace bus's field
  contract `**fields: Any` on `emit`, `emit_exc`, `emit_exc_tb` (any value —
  JSON, a repr for the rest; the two forwarders pass `**fields` on into
  emit's named parameters, which `object` would not admit), the Aggregator's
  fields that go to it, and asyncio's exception-handler context (typeshed's
  own type). The other four strict modules have none.
  `hal_bridge` stays `standard` (socket and thread state, R353).
- **`writer_fixture.py`** — the protected-write writer of the tests, with a
  real starlette `WebSocket` that fails as a dropped connection does (never
  `None` where `ClientState` holds a WebSocket).
- **`subroutines/surfacemap/compensation.py`** (the HAL helper the suite runs).
- **The interface and its two conformance checks**: `lcnc-gateway/lcnc_iface.py`
  (Protocols), `typings/conformance/check_stub.py` (the stub of the real
  binding against them), `check_fake.py` (the tests' fake against them),
  `check_forms.py` (the call forms, below) and the fake itself
  (`fake_linuxcnc.py`).

## Call forms (R354 VM-I01)

The binding checks a command's FORM before it sends (emcmodule.cc v2.9.4):
`auto(AUTO_RUN, line)` is the only two-argument auto, the other sub-operations
take none; `jog` takes 3 / 4 / 5 arguments for JOG_STOP / CONTINUOUS /
INCREMENT; spindle direction, mode, state, mist and flood are enumerated
(else ValueError). The stub and `lcnc_iface` carry the constants with their
values (`Final = n`) and bind each form to its sub-operation with `Literal`
overloads; a selector known only at run time narrows to its set before the
call — never a general `int`. `typings/conformance/check_forms.py` holds the
refused forms against the stub, the interface and the fake: each carries an
ignore naming its rule, and the file reports an unnecessary ignore as an
error — a form the gate accepted again turns it red. The fake refuses the
same forms at run time with the binding's exception, before the send is
counted (`test_lcnc_iface.py` FakeForms).

**Boundary in 2a:** every `auto` / `jog` call of the product code is in
`gateway.py`, through `_cmd_blocking(CMD.jog, …)`; 2a proves the forms on the
conformance file only. They reach those call sites when 2b types
`_cmd_blocking` (the `Link`).

## Not checked — named

- **Tests** (`lcnc-gateway/test_*.py`, `conftest.py`) and the test helpers
  that live beside the product modules and run in their own processes:
  `suite_py_bind_probe.py`, `native_start_probe.py`, `native_pinned_probe.py`.
  They keep their run-time checks.
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
binding — present or absent, both are fine, and the stub never claims them:
`spindle_override` (2.9.4 has only the spindle row's `override`).
`test_lcnc_iface.py` holds every literal status read of the product code to
one of the two — the class of `spindle_override_enabled`, a name 2.9.4 never
had, read with the default True (fixed in 2a).

## The native name check

`lcnc_iface_check.py` reads what each stub CLAIMS from the stub itself (AST):
every public module name, every public member of a public class, every
constant value — for `linuxcnc`, `hal`, `gcode` and `rs274.interpret` (R354
VM-I02). Each claim must hold on the installed module; the module may have
more (the binding's other commands), a stub may not claim more than the
module has. Imported helper types and private `_` names are the stub's own
helpers, never claims (the HAL info-row TypedDicts). The tool-table row type
is the binding's export `linuxcnc.tool` (named tool_result), so its fields
are checked like any class. A pure-Python class's member may also be an
instance attribute its own source assigns (`rs274.interpret`).

Names and constant values only — shapes and types are the stubs', from the
binding's source. Import and class inspection: no channel, no poll. The
embedded `interpreter` exists only inside a parse and is NOT checkable here
(its stub lists only the members `gcode_canon` reads).

The check runs against surrogate modules in every job (`test_lcnc_iface.py`
StubClaims: an extra stub member, a missing module name, a changed constant
are found; an extra real member and an optional field present or absent are
not) and against the installed modules on the VM (`test_lcnc_iface.py`) and
in the install probe (row `install-binding`); skipped by name only where a
job declares `LCNC_NO_BINDING=1` (the CI backend job, which has no
LinuxCNC).
