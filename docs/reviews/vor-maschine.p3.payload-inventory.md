# Payload inventory — SYS-CONN.S5 + issue #27 (starting table)

Source: commit `45727d61` (feat/link, now development). Read-only (grep/sed); no
test, build or import ran. Paths are relative to the worktree. `gw` = `lcnc-gateway/gateway.py`,
`cp` = `lcnc-gateway/command_policy.py`, `gu` = `lcnc-gateway/gateway_util.py`.

## 1. The path a WS frame takes, and where a refusal can land

| Step | Where | What it checks |
|---|---|---|
| Reader | gw:11612–11894 | `json.loads`, then answers these frame types ITSELF: `heartbeat` 11645, `hello` 11658, `safety_trip_ack` 11732, `get_settings` 11749, `save_settings` 11753, `device_rename/_reset/_delete` 11764, `client_diag` 11769, `timing_log` 11780, `halshow_live` 11802, `halshow_refresh` 11815, `tab_visibility` 11823. **Never reaches validate_payload or check_command.** Everything else goes to the client's queue (11883–11894). |
| Worker | gw:10785 `_execute_client_command` | **`arm` is answered here (10803–10847)** before handle_command — so `arm` never sees check_command or validate_payload. The `arm` branch in `_cmds_machine_state` (gw:5723) is unreachable over WS. Catches `(ValueError, TypeError, KeyError, PermissionError, OverflowError)` at 10859 → `{"ok": false, "error": "<Type>: <msg>"}`. |
| Dispatch | gw:7259 `_handle_command_impl` | read-only commands 7266–7309 → connection 7313 → **gate** `check_command` 7325 → **bounds** `validate_payload` 7348 → feature switches `_command_feature_refusal` 7358 → handler groups 7364 (`_COMMAND_GROUPS` gw:7255) → any exception from a handler body → `{"ok": false, "error": "<Type>: <msg>"}` at 7375. None of these steps writes to the controller. |
| Bounds | cp:1264 `validate_payload` | **cp:1280 `if field not in msg or msg[field] is None: continue`** — missing and null both skip. Commands without a COMMAND_SCHEMA entry pass through untouched (cp:1275–1277). Docstring cp:1271–1273 states the current policy ("a handler's own default applies"). |

### Conversion rules that decide every cell below

- `msg.get(k, d)`: `d` applies only when the key is **missing**; an explicit `null` returns `None` and the helper decides.
- `finite_float(x, default=0.0, lo, hi)` (gu:175): `None` → `default` (0.0, or the explicit second argument, e.g. `1.0` for `scale`). `float(x)`: a numeric string (`"1"`) and a bool (`true` → 1.0) pass; `"false"` → ValueError; a list/dict → TypeError.
- `finite_int(x, default=None, lo, hi)` (gu:196): `None` with no default → **ValueError "missing required integer value"** (so `null` is refused wherever it is called without a default). `float(x)` then `int()` — **truncates** (`2.9` → 2), bool → 0/1, `"3"` → 3.
- `validate_payload` `Num` (cp:1218 `_check_number`) uses `json_types.to_float` (json_types.py:23): **bools pass as 0/1**, numeric strings pass, `"false"` → `"<cmd>: <field> must be a number"`; `integer=True` refuses `1.5` ("must be a whole number"); `clamp=True` fields are clamped and traced `ws.payload_clamped`.
- `validate_payload` `Enum` uses `to_int` (json_types.py:30): `true` → 1, **`1.9` → 1 (truncated, accepted)**, `"2"` → 2, `"1.5"`/`"false"` → refused "must be an integer".
- `bool(x)`: `"false"`, `"0"`, `[0]` → True; `null`, `0`, `""`, `[]`, `{}` → False.
- Client side (JS): `JSON.stringify` drops a key whose value is `undefined` and serialises `NaN`/`Infinity` as **`null`**. So any number the page computes as NaN arrives as `null` — the reviewer's "null scale" is reachable from the shipped page, not only from a hand-made client.

### LinuxCNC constants used below
`MODE_MANUAL=1, MODE_AUTO=2, MODE_MDI=3` (mirrored in lcnc-webui/src/lcnc.ts:13–15). `home(-1)` / `unhome(-1)` = all joints (comments at gw:6478, 6484).

---

## 2. Field table — commands through handle_command

Column key: **sch** = COMMAND_SCHEMA spec (cp:1125–1207) or "—"; **0/false** = a valid zero/false value; **role**: T = target, A = amount, S = on/off switch, M = optional modifier, B = binding/admission.
"write before read?" is noted only where a controller write (mode switch, MDI, NML command, HAL send) can precede the read; otherwise every read below precedes the handler's first write.

### 2.1 Machine state, mode

| cmd | field | read (gw) | sch | missing → | null → | wrong type → | 0/false → | role |
|---|---|---|---|---|---|---|---|---|
| arm | armed | 10804 `bool(msg.get("armed", False))` — worker, not validate_payload | — | False → **disarm** (+ `_jog_stop_for_client` 10831 when it was armed) | False → disarm | **`"false"`/`"0"`/`[0]` → True → ARMS the client** (unless a trip is unacknowledged, 10808); `[]`/`{}` → disarm | false → disarm | S |
| set_mode | mode | 5788 `finite_int(msg.get("mode", 0))` | — | 0 → refused "Invalid mode: 0" (5790) | refused (ValueError, via 7375) | `"false"`/list → refused; **`true` → 1 = MANUAL**; `"3"` → MDI; **`2.9` → 2 = AUTO** | 0 = invalid → refused | T |
| estop, estop_reset, machine_on, machine_off, shutdown, abort | — | 5726–5826 | — | no payload fields | — | — | — | — |

### 2.2 Jogging and homing

| cmd | field | read (gw) | sch | missing → | null → | wrong type → | 0/false → | role |
|---|---|---|---|---|---|---|---|---|
| jog_cont | axis | 6398 `finite_int(msg.get("axis"), lo=0)` | Num(0..n_axes−1, int) | refused (ValueError) | refused | `"false"` refused (sch); **`true` → axis 1** | axis 0 = X | T |
| jog_cont | vel | 6398 `finite_float(msg.get("vel", 0.0))` | Num(±max_jog_vel, clamp) | **0.0 → set_mode(MANUAL) (4136) + JOG_CONTINUOUS at 0 (4144), booked in `_active_jogs`** | same as missing | `"false"` refused (sch); `true` → +1.0 | 0 → same as missing | A (+direction by sign) |
| jog_incr | axis | 6462 | Num(int) | refused | refused | `true` → 1 | 0 = X | T |
| jog_incr | vel | 6462 `abs(finite_float(msg.get("vel", 0.0)))` | Num(clamp) | 0.0 → MANUAL switch + JOG_INCREMENT at speed 0 (4146) | same | `true` → 1.0 | 0 | A |
| jog_incr | distance | 6463 `finite_float(msg.get("distance", 0.0))` | **— (not in schema; unbounded)** | 0.0 → MANUAL switch + increment of 0 | 0.0 (same) | `"false"` → ValueError, refused before `_start_jogs`; **`true` → +1.0 increment** | 0 | A + direction |
| jog_cont_multi | axes | 6429 `msg.get("axes", [])` | Seq(len ≤ n_axes) | **[] → `_start_jogs` gate check, set_mode(MANUAL) 4136, no jog, reply ok** | same | non-list refused (sch) | [] → same as missing | T |
| jog_cont_multi | axes[].axis / .vel | 6428 `finite_int(e["axis"])`, `finite_float(e["vel"])` | **none per entry** (commandShapes.test.ts:116–117 "per-entry bounds OPEN") | KeyError → refused | axis: refused; **vel: 0.0** | non-dict entry → TypeError refused; bools → 0/1; **an out-of-range axis is NOT refused before the write** — homed, it passes `_jog_axis_arg` to `CMD.jog` (docstring 4264: "CMD.jog rejects them itself") AFTER set_mode(MANUAL) 4136 (unhomed: refused "No axis N" 4125 before the switch) | — | T / A |
| jog_incr_multi | axes, axes[].axis/.vel/.distance | 6474, 6473–6474 | Seq only | [] → MANUAL switch, ok | entry vel/distance null → **0.0** | as above | — | T / A |
| jog_stop | axis | 6409 `finite_int(msg.get("axis"), lo=0)` | Num(int) | **refused → a running jog keeps running** (STOP!) | refused (same) | `true` → 1 | 0 = X | T |
| jog_stop_multi | axes | 6435 `[finite_int(a, lo=0) for a in msg.get("axes", [])]` | Seq | [] → no-op, ok (traced `jog.stop_without_jog` 6438) | same | a null or non-numeric entry → whole command refused, **no axis stopped** (`"0"` passes) | — | T |
| home | joint | 6488 `finite_int(msg.get("joint", -1))` → 6489 `_manual_command` → set_mode(MANUAL) 8477 → `home(joint)` | Num(−1..n_joints−1, int) | **−1 → MANUAL switch + HOME ALL joints** | refused (ValueError "missing required integer value"), before any write | `"false"` refused (sch); **`true` → joint 1, `false` → joint 0**; `1.5` refused | joint 0 = a real joint | T |
| unhome | joint | 6493 → 6494–6496 teleop_enable(0) + `unhome(joint)` | same | **−1 → MANUAL switch, teleop off, UNHOME ALL** | refused | as home | joint 0 | T |
| home_all, unhome_all | — | 6476, 6480 | — | no fields (`-1` is the command's own) | — | — | — | — |

### 2.3 Overrides, spindle, coolant, program switches

| cmd | field | read (gw) | sch | missing → | null → | wrong type → | 0/false → | role |
|---|---|---|---|---|---|---|---|---|
| set_feed_override | scale | 6536 `finite_float(msg.get("scale", 1.0), 1.0)` → 6537 `feedrate(scale)` | Num(0..MAX_FEED_OVERRIDE, clamp) | **1.0 → feed 100 %** | **1.0 → feed 100 %** | `"false"` refused (sch); `true` → 1.0; above max → clamped | 0 → 0 % (feed stops) | A |
| set_spindle_override | scale | 6543 | Num(MIN..MAX_SPINDLE_OVERRIDE, clamp) | **1.0 → 100 %** | **1.0** | as above; 0 → clamped up to the min | below min → min | A |
| set_rapid_override | scale | 6601 | Num(0..1.0, clamp) | **1.0 → rapids 100 %** | **1.0** | as above | 0 → 0 % | A |
| set_max_velocity | velocity | 6620 `finite_float(msg.get("velocity", 0.0))` | Num(0..MAX_LINEAR_VELOCITY, clamp) | **0.0 → `maxvel(0)`** (effect on motion not verified here) | 0.0 | `true` → 1.0 | 0 | A — the shipped page never sends it (commandShapes.test.ts:61–63) |
| set_optional_stop | value | 6607 `bool(msg.get("value", False))` → 6608 | — | **False → optional stop OFF (M1 no longer stops)** | False → OFF | **`"false"`/`"0"` → True → ON** | false → OFF | S |
| set_block_delete | value | 6613 `bool(...)` → 6614 | — | **False → block delete OFF ("/" lines run)** | False | **`"false"` → True → ON ("/" lines SKIPPED)** | false → OFF | S |
| spindle_forward / _reverse | speed | 6549 / 6554 `finite_float(msg.get("speed", 0))` → `_manual_command` (MANUAL switch 8477) → `spindle(dir, speed)` | Num(0..MAX_SPINDLE_SPEED, clamp) | **0 → MANUAL switch + spindle FWD/REV at 0 rpm** (what LinuxCNC/HAL does with a 0-rpm spindle-on is not verified here) | 0.0, same | `"false"` refused (sch); `true` → 1 rpm; negative → clamped to 0 | **0 is sent by the shipped page** (SpindleStrip.vue:64 `+value`, an empty field = 0) | A |
| spindle_stop, spindle_increase/_decrease, flood_on/_off, mist_on/_off | — | 6557–6595 | — | no fields | — | — | — | — |

### 2.4 Program run, MDI, macros, frames

| cmd | field | read (gw) | sch | missing → | null → | wrong type → | 0/false → | role |
|---|---|---|---|---|---|---|---|---|
| cycle_start, auto_step, cycle_pause, cycle_resume, go_to_zero, twp_capture, reparse_preview, unload_file | — | 6498, 6224, 6519, 6525, 6008, 7079, 6781, 6715 | — | no fields | — | — | — | — |
| auto_run | line | 6266 `finite_int(msg.get("line", 0), lo=0)` → 6380 / 5144 `AUTO_RUN start_line` | Num(≥0, int) | **0 → program runs from the top** | refused (ValueError) | `"false"` refused (sch); `true` → line 1 | 0 = from the top | T |
| auto_run | file / version / source | 6287–6289, checked 6292–6297 | version Num(int), source Text(64); file — | refused "Program changed — confirm Run from line again" | refused | version `"3"`/`true` coerced (6295 `finite_int(version)`), file/source must be str | — | B |
| auto_run | spindle_dir | 6264 `msg.get("spindle_dir")`, used 6372–6377 (RFL path 5121–5127) | — | no spindle start | same | **an unknown string (e.g. `"fwd"`) with speed > 0 → set_mode(MANUAL) 6373, NO spindle command, program then starts (6379–6380)** — silent; by 6372 `_start_guard` (6366, may write `#3116=0`) and `_toolsetter_sync` (6369, may write the toolsetter parameters) have already run | — | M (but it decides spindle ON) |
| auto_run | spindle_speed | 6265 `finite_int(msg.get("spindle_speed", 0), lo=0)` | Num(0..max, clamp; not int) | 0 → no spindle start | refused (ValueError) | float truncated (1500.7 → 1500); `true` → 1 | 0 → no spindle | A |
| auto_run | pre_tool | 6267 `finite_int(...)`; also raw truthiness 5693 for the toolsetter switch | Num(≥0, int) | 0 → no pre-measurement | refused | **`true` → T1 M600 pre-measure** (needs probe_vars equal to the server basis, 6316–6331); `"0"` → 0 here but truthy at 5693 (switch checked — stricter, harmless) | 0 → none | M (adds a measurement) |
| auto_run | probe_vars | 6315, values 6328 `canonical_param(finite_float(v))` | VarNumbers (keys only) | with pre_tool → refused (6319) | same | value null → 0.0 → compared to the basis → refused unless the basis value is 0; the WRITE always uses the server basis (6351–6353) | — | B |
| auto_run | safe_z | 6268 `bool(msg.get("safe_z", False))` | — | False | False | **`"false"` → True → RFL path with safe-Z retract** (never lowers Z) | false | M (adds motion) |
| auto_run | entry_x / entry_y | 6270–6274 `finite_float` if not None | — | no entry move | no entry move (treated absent) | `"false"` → ValueError, refused (before writes); `true` → 1.0 | 0 → move to 0 | T (forces safe_z, 6278) |
| auto_run | entry_wcs | 6275 `… if in _RFL_WCS_OK else None` | — | None → modal WCS | None | **invalid → silently None → the rapid (4978–4992, 5111) uses the modal WCS** | — | M (decides the rapid's target frame) |
| auto_run | entry_units | 6276 `… if in ("G20","G21") else None` | — | None → modal units | None | **invalid → silently None → the rapid uses the modal units** (an inch/mm mix-up moves 25.4× off; `_rfl_entry_reached` 4995 then fails AFTER the move) | — | M (decides the rapid's target) |
| mdi | text | 5842 `msg.get("text", "")` | Text(≤255) | refused "Missing text" (5845) | refused | non-str refused (sch) | — | T |
| mdi | vars | 5851 (dict check 5852–5853); values 5395 `finite_float(v)` | VarNumbers (**keys only**) | no parameter write | no parameter write | `{}`/non-dict refused; **a value null → `#n=0.000000` written to the interpreter and the var file, then the line runs**; a value `"abc"` → refused before writes (5395 precedes set_mode 5418); `true` → 1 | — | A (per value) |
| run_macro | name / revision | 5881 / 5883, strict 5884–5887 | Text | refused | refused | refused | — | T / B |
| run_macro | args | 5882 `msg.get("args") or []` → `build_call` 5920 (macro_files.py:321) | Seq(≤30) | [] → arity check refuses unless the macro takes 0 values | same | element bool / non-number / non-finite refused (macro_files.py:333); non-list refused (sch) | — | A — **write before read: `_start_guard` 5891 can switch to MDI and write `#3116=0` (4796–4797) BEFORE `build_call` validates args** |
| set_kins_mode | mode | 5964 `finite_int(msg.get("mode", -1))` | Enum{0,1,2} (to_int) | −1 → refused (5966) | refused (ValueError) | **`true` → 1 = TCP**, `false` → 0 = Machine, `"2"` → Plane (with plane_frame_check), **`1.9` → 1 = TCP**; `"false"` refused (sch) | 0 = Machine | T |

### 2.5 Tools, tool change, toolsetter, probing jobs

| cmd | field | read (gw) | sch | missing → | null → | wrong type → | 0/false → | role |
|---|---|---|---|---|---|---|---|---|
| tool_change | tool_number | 6202 `finite_int(msg["tool_number"], lo=0)` (before `_start_guard` 6203 / MDI 6206) | Num(0..99999, int) | refused (KeyError) | refused | **`true` → T1 M6; `false` → T0 M6 + G49**; `"5"` → T5 | **0 = unload (sent by the page, App.vue:1445)** | T |
| tool_measure | tool | 5587 `finite_int(msg.get("tool", 0), lo=0)` | Num(1..99999, int) | 0 → refused "No tool to measure" (5589) | refused | **`true` → T1 M600** | 0 → refused by sch (lo=1) | T |
| tool_unload_measure | — | 5587 (tool fixed 0) | — | no fields | — | — | — | — |
| save_tool | tool_number | 6052 `finite_int(msg["tool_number"], lo=0)` | Num(int) | refused (KeyError) | refused | `true` → T1 | T0 | T |
| save_tool | pocket | 6067 `if "pocket" in msg: finite_int(msg["pocket"])` | Num(int) | unchanged | refused (ValueError) | `true` → 1 | 0 | A |
| save_tool | z_offset | 6069 `if "z_offset" in msg: finite_float(msg["z_offset"])` | **—** | unchanged | **0.0 → tool length offset 0 written to tool.tbl and reloaded into LinuxCNC (`_persist_tool_edit` 4465, reload 4481)** | `"abc"` refused; `true` → 1.0 | 0 | A |
| save_tool | diameter | 6071 | Num(≥0) | unchanged | **0.0 written** | — | 0 | A |
| save_tool | remark | 6073 `str(msg["remark"])` | — | unchanged | **"None" (the string) written** | any value str()'d | — | M |
| save_tool / add_tool / renumber_tool | metadata (`_TOOL_META_FIELDS`, tool_table.py:71) | 6085 / 6115 / 6192 `msg[field]` verbatim | — | not written | null stored | any JSON stored | — | M (library only) |
| add_tool | tool_number | 6091 | Num(int) | refused | refused | — | T0 | T |
| add_tool | pocket | 6105 `finite_int(msg.get("pocket", tool_num))` | Num(int) | = tool number | refused | — | 0 | A |
| add_tool | z_offset / diameter | 6106 / 6107 `finite_float(msg.get(…, 0.0))` | — / Num(≥0) | 0.0 | **0.0** | `true` → 1.0 | 0 | A |
| add_tool | remark | 6108 `str(msg.get("remark", ""))` | — | "" | **"None"** | — | — | M |
| renumber_tool | old_tool_number / tool_number | 6154 / 6155 | Num(int) | refused (KeyError) | refused | — | — | T |
| renumber_tool | pocket | 6184 (only if in msg) | Num(int) | kept (Codex R321 FI321-02) | refused | — | — | A |
| renumber_tool | z_offset / diameter | 6185 / 6186 `finite_float(msg.get(k, src.get(K)))` | — / Num | kept | **0.0 → the measured length / diameter replaced by 0** | — | — | A |
| renumber_tool | remark | 6187 | — | kept | **"None"** | — | — | M |
| delete_tool | tool_number | 6121 | Num(int) | refused (KeyError) | refused | `true` → deletes T1 | T0 | T |
| confirm_tool_change | request | 6841 → `_tool_change_request_refusal` 4668 | — | refused "Tool change request changed — confirm again" | refused | bool and non-int refused (4668) | — | B (strict) |
| probe_run | routine | 5571, must be in `get_probe_macros()` (5572–5573) | Text(63) | refused | refused | refused | — | T |
| probe_run | vars | 5574; dict check 5592–5594; keys `purpose_refusal` 5595 (features.py:127, keys only); values 5395 | VarNumbers (keys only) | refused "Missing vars dict" (5594), except `probe_cal_reset` → {} (5579–5580) | same | **a value null → `#n=0` written, then `O<routine> CALL` runs**; `"abc"` → refused before writes | — | A |
| surface_scan_run | vars | 5582, same path | VarNumbers | refused "Missing vars dict" | same | **value null → 0 written, then `O<surface_scan> CALL`** | — | A |
| set_params | sets | 6764 → `sets_refusal` (features.py:143) | PurposeSets | refused "Missing parameter sets — reload the page" | same | value null/`"false"` → refused "#k is not a number" (features.py:162–164); `true` → 1.0, `"1"` → 1.0 accepted | — | A (strict for null) |
| set_compensation | enable | 6820 `isinstance(enable, bool)` | — | refused "Compensation not sent — on or off missing" | refused | refused | false → OFF | S (strict) |
| set_compensation_method | method | 6831 None check → 6833 `finite_int(msg["method"])` | Enum{0,1,2} | refused "Method not sent — none given" | refused | `true` → 1 (linear); `1.9` → 1; `"false"` refused (sch) | 0 = nearest | T |
| simulate_probe_trip, list_probe_macros, get_* | — | 6859, 6752, 7266–7309, 6874 | — | no fields | — | — | — | — |

### 2.6 Work offsets, G30, files

| cmd | field | read (gw) | sch | missing → | null → | wrong type → | 0/false → | role |
|---|---|---|---|---|---|---|---|---|
| clear_wcs | target | 6889 `msg.get("target", "active")` | **—** | **"active" → stat.g5x_index (6890–6893) → set_mode(MDI) 6909 → `G10 L2 P<active> X0 Y0 Z0 … R0` (6915): the ACTIVE work offset is zeroed** | refused "Invalid target: None" (6908) | list → TypeError (unhashable, `in _G5X_MAP`) → refused; number → refused | — | T |
| set_wcs | target | 7202 strict (`in _G5X_MAP`) | — | refused "Invalid WCS: None" (7204) | refused | list → TypeError refused | — | T |
| set_wcs | x y z a b c u v w r | 7209–7214 `if val is not None: finite_float(val)` | Num() each | not written | not written | `"false"` refused (sch); **`true` → writes 1.0** | 0 → writes 0 | A; all absent → refused "No axis values provided" (7216) |
| touchoff | axes | 6945, dict check 6946–6947, values 6948 | AxisMap (non-empty, letters, finite) | refused "No axis values provided" | same | value null → refused by sch ("axes.X must be a number"); **`true` → 1.0**; **write before refusal: U/V/W letters on the Plane route are refused at 7004 only AFTER set_mode(MDI) 6970** (`touchoff_route` cp:356 refuses A/B/C outside Machine but not U/V/W under Plane) | 0 → zero | A |
| touchoff | expect | 6957 → `touchoff_expect_check` (cp:1090: not a dict → no check) | ExpectMap | **no expectation check** (the controller re-check of the route from 6983 still runs) | same | non-dict refused (sch) | — | B (sent only when known, useTouchoffMath.ts:58) |
| set_g30 | values | 10639 `msg["values"].items()` | AxisMap | refused (KeyError) | refused (AttributeError) | entries checked by sch | — | A |
| set_g30 | based_on | 10640 `(msg.get("based_on") or {})` | AxisMap | {} → refused "G30 draft has no basis — reload" (10646) | same | — | — | B |
| read_g30, capture_g30 | — | 6742, 6745 | — | no fields | — | — | — | — |
| load_file | path | 6633 `msg.get("path", "")` | — | refused "Missing path" (6635) | refused | non-str refused | — | T |

### 2.7 `via` (every command in `features.GAMEPAD_COMMANDS`, features.py:80)

| field | read | sch | missing / null → | wrong type → | role |
|---|---|---|---|---|---|
| via | gw:5673 `_command_feature_refusal` | Choice{"gamepad"} (cp:1210–1211) | not a gamepad command → the gamepad switch is not applied | anything but `"gamepad"` refused | B — a marker; the strip and keyboard send the same commands without it |

## 3. Reader frames (never through validate_payload)

| frame | field | read (gw) | missing → | null → | wrong type → | effect |
|---|---|---|---|---|---|---|
| heartbeat | seq | 11651–11653 (int 0..2^53 else None) | None | None | None | liveness only |
| hello | session | 11669 (non-empty str) | no session | same | ignored | armed-resume key |
| hello | resume_armed | 11674 `bool(msg.get("resume_armed", False))` | no resume | no resume | **`"false"` → True → re-arms this connection if a hold exists for the session and no trip is pending (`client.armed = True` 11712)** | authorization |
| hello | device_token / device_storage | 4517 / 4524 | unbound | unbound | malformed → traced, unbound | settings profile |
| safety_trip_ack | — | 11739–11742 | acks whatever trip is current (no id in the frame) | — | — | trip banner |
| get_settings, halshow_refresh | — | 11749, 11815 | — | — | — | — |
| save_settings | section / data / base_rev | 4575 / settings_store.py:422 / :420 | refused | refused | refused | strict |
| save_settings | device | 4578–4590 | a device section → this connection's own profile (unbound → refused DEVICE_UNBOUND 4584); a machine section → the machine's | same as missing | non-str → refused DEVICE_UNKNOWN (4588); a device name on a machine section → refused (4590) | settings profile |
| device_rename | name | settings_store.py:498 (non-str → "") | "" (name cleared) | "" | "" | own/other profile |
| device_rename / device_reset | device | 4620–4621 (`None` → own device) | own profile (reset → template, simulation off) | own | non-str → refused DEVICE_UNKNOWN | no machine effect |
| device_delete | device | 4620–4621, 4625 | own → refused DEVICE_CONNECTED | same | — | — |
| client_diag | data | 11773–11776 `_trace.emit("client.diag", client_id=…, **data)` | ignored | ignored | non-dict ignored; **a key `client_id` or `tag` → TypeError (duplicate kwarg, lcnc_trace.py:208) → escapes the reader** (see §6); keys `level`/`msg` re-label the event | trace only |
| timing_log | enable | 11782 `bool(...)` | off | off | `"false"` → True → logging starts | diagnostics |
| halshow_live | on | 11803 `bool(...)` | off | off | `"false"` → True | diagnostics |
| tab_visibility | hidden | 11837 `bool(...)` | visible | visible | **`"false"` → True → status fan-out to this client stops** | display |

## 4. Counts

### finite_* call sites (gateway.py; no calls in command_policy.py / gateway_util.py besides the defs)
**69 calls on 63 lines.** The asked-for "24" is not reproduced; closest: 22 calls carry a default for the missing case, 25 are `finite_*(msg.get(…))`.

- **36 directly on a msg field**
  - 25 `finite_*(msg.get(`: 5587, 5788, 5964, 6105, 6106, 6107, 6185, 6186, 6265, 6266, 6267, 6398 (×2), 6409, 6462 (×2), 6463, 6488, 6493, 6536, 6543, 6549, 6554, 6601, 6620. All but the three `msg.get("axis")` (6398, 6409, 6462) pass a default → 22 calls where "missing" becomes a value.
  - 11 `finite_*(msg[`: 6052, 6067, 6069, 6071, 6091, 6121, 6154, 6155, 6184, 6202, 6833.
- **17 on values taken from msg** (map/list entries, locals): 5017 (entry x/y), 5395 (vars / sets values), 6273, 6274, 6295 (version), 6328 (probe_vars values), 6428 (×2), 6435, 6473 (×2), 6474, 6948 (touchoff values), 7214, 7228 (set_wcs), 10639, 10640.
- **16 on status / cache values**: 6031, 7028, 7029, 7033, 7048, 7064, 7069, 7112, 7123, 7126, 7133 (×3), 7168, 7222, 7236.
- The comment at cp:950–951 ("41 sites") is stale.

Where `null` is refused vs defaulted: `finite_int` without default refuses null (joint, mode, axis, line, pre_tool, spindle_speed, tool, pocket); `finite_float` defaults null (vel, distance, scale, speed, velocity, z_offset, diameter, vars values).

### bool( call sites on payload values
**8 literal `bool(msg.get(…))`** in gateway.py: 6268 (auto_run.safe_z), 6607 (set_optional_stop.value), 6613 (set_block_delete.value), 10804 (arm.armed), 11674 (hello.resume_armed), 11782 (timing_log.enable), 11803 (halshow_live.on), 11837 (tab_visibility.hidden).
The **ninth** is 6345 `clears_flag=bool(pre_tool)` — `pre_tool` is already `finite_int`'d at 6267, so it is no raw-payload coercion. Other truthiness on raw payload values without `bool(`: 5693 `msg.get("pre_tool")`, 6372 `if spindle_dir and spindle_speed > 0`. (`hal_watchdog.py:251/277/279/281 bool(msg[…])` are the gateway→watchdog IPC, not WS.) Strict boolean checks already exist at 5691 (`is True`) and 6821 (`isinstance(enable, bool)`).

## 5. What the shipped client sends (lcnc-webui/src/lcnc.ts `WsCommand`, lines 53–178)

The union is closed (`fire`/`send`/`request` take nothing else), but on the wire `undefined` drops a key and `NaN` becomes `null`.

| cmd | always sent | optional / conditional | sender (example) |
|---|---|---|---|
| arm | armed: boolean | — | App.vue:1505 |
| set_mode | mode: number | — | App.vue:1040 |
| home / unhome | joint: number (the axis index) | — | App.vue:1802/1806 ← SetupStrip.vue:220 `a.index` |
| home_all, cycle_start, cycle_pause, cycle_resume, abort, estop, spindle_stop, flood/mist on/off | — | via?: "gamepad" | useGamepad.ts, lcnc.ts:260 `viaGamepad` |
| auto_run | line, file, version, source | spindle_dir, spindle_speed, pre_tool, probe_vars, safe_z, entry_x, entry_y, entry_wcs, entry_units (each `undefined` when off — dropped) | App.vue:1828–1845 |
| load_file | path | — | App.vue:1904 |
| mdi | text | vars | useMdiHistory.ts:70, App.vue:1049/1060 |
| run_macro | name, revision, args | — | useMacros.ts:96/120 |
| jog_cont | axis, vel | via | JogStrip.vue:436/487, useGamepad.ts:147, useKeyboardShortcuts.ts:146 |
| jog_incr | axis, vel, distance | via | JogStrip.vue:427/485, useGamepad.ts:377 |
| jog_stop | axis | via | JogStrip.vue:380, jogGesture.ts:26 |
| jog_cont_multi / jog_incr_multi | axes[{axis, vel(, distance)}] | — | JogStrip.vue:422/431 |
| jog_stop_multi | axes: number[] | via | jogGesture.ts:27 |
| spindle_forward / _reverse | speed (may be 0) | — | App.vue:1873/1877 ← SpindleStrip.vue:54/47 |
| set_feed/spindle/rapid_override | scale (slider / 100) | — | App.vue:1861–1869 |
| set_optional_stop / set_block_delete | value: boolean | — | App.vue:1300/1303 |
| set_max_velocity | — | — | **never sent** (only a cooldown entry, lcnc.ts:246) |
| save_tool / add_tool | all ToolFields (tool_number, pocket, diameter, z_offset, remark, metadata) | — | ToolTablePanel.vue:282–319 |
| renumber_tool | old_tool_number + all ToolFields | — | ToolTablePanel.vue:316 |
| delete_tool / tool_change | tool_number (0 = unload) | — | ToolTablePanel.vue:396, App.vue:1445, ToolTablePanel.vue:377 |
| set_params | sets | — | ToolsetterSettings.vue:97 |
| probe_run | routine, vars | — | App.vue:1766 |
| surface_scan_run | vars | — | App.vue:1769 |
| tool_measure | tool (> 0; else tool_unload_measure) | — | App.vue:1422 |
| set_g30 | values, based_on | — | ToolsetterSettings.vue:255 |
| set_compensation | enable | — | useDialogState.ts:127 |
| set_compensation_method | method | — | ProbePanel.vue:307 |
| confirm_tool_change | — | **request only when known** (`...(seq != null ? {request} : {})`) | App.vue:1165 |
| clear_wcs | target ("all" or a name) | — | OffsetPanel.vue:147/151 |
| touchoff | axes | **expect only when known** | useTouchoffMath.ts:58 |
| set_kins_mode | mode: 0/1/2 | — | App.vue:1034 |
| set_wcs | target + one axis | — | OffsetPanel.vue:97 |
| save_settings | section, data, base_rev | device | lcncWs.ts:472, DevicesSettings.vue:107 |
| device_rename | name | device | DevicesSettings.vue:63/131 |
| device_reset | — | device | DevicesSettings.vue:132 |
| device_delete | device | — | DevicesSettings.vue:133 |
| timing_log / halshow_live / tab_visibility | enable / on / hidden (boolean) | — | DebugTab.vue:11, HalshowTab.vue:31, wsWorker.ts:295/411 |
| hello | session, resume_armed, device_token, device_storage | — | wsWorker.ts:288 |

So requiring `joint`, `scale`, `value`, `target` (clear_wcs), `line`, `vel`, `distance`, `speed`, `velocity`, `mode` breaks no sender in `lcnc-webui/src` (the only client checked; scripts such as the native stage were not searched). Requiring `expect` (touchoff) or `request` (confirm_tool_change, already refused) or the optional auto_run fields would. A required `speed` must still admit 0 (the page sends it).

`lcnc-webui/src/commandShapes.test.ts` holds the field contract against COMMAND_SCHEMA: `UNBOUNDED` (77–95) names every sent field the schema does not bound, with its reason; `DATA_MAPS` (102–118); `OPAQUE` (120–123); `WORKER_FRAMES` (125). A change to COMMAND_SCHEMA or the union must keep that list true. Note its reason for `jog_incr.distance` (line 84: "bounded by the handler against the axis window") is not backed by the gateway: `distance` appears only at gw:4088, 6460, 6463, 6474 — no window check.

### Mock gateway
`lcnc-webui/e2e/mock-gateway.mjs` validates no payload: it records commands (`cmds.push`, 288), answers scripted replies (`replies[cmd]`, 297), echoes `save_settings` by `typeof msg.section`/`msg.device` (298–310), and answers device commands, `get_tool_table`, `set_params` with ok (311–320). A gateway-side "required" rule needs no mock change unless a spec scripts the refusal.

## 6. Other findings in the same family (issue #27: a malformed frame must not tear the socket down)

The reader's `try` (gw:11612) has only `except (WebSocketDisconnect, RuntimeError)` (11896) and `except asyncio.CancelledError` (11899) — no `except Exception`. So:
- A **non-object JSON frame** (`[]`, `1`, `"x"`) → `msg.get` AttributeError at 11641 → the handler ends → `finally` runs the disconnect path (armed jog stop attempt, resume hold).
- An **unhashable `cmd`** (list/object) → `_rcmd in _WS_PREEMPT_CMDS` (11859) TypeError → same.
- **`client_diag.data` with a key `client_id` or `tag`** → TypeError in `_trace.emit(…, **data)` (11776) → same.
These are not per-field defaults, but they are the crash half of #27.

Also: `jog_stop` without `axis` is **refused** (6409) — for a stop the refusal is itself the hazard (a running jog continues until heartbeat/disarm/its proper stop); same for `jog_stop_multi` with one bad entry (6435: the comprehension raises before any stop). A rule "refuse what lacks its value" should not be applied blindly to stops.

---

## Candidates

### A. Missing / null / wrong type → a machine ACTION through a default (highest risk first)

1. **home / unhome, `joint` missing → −1** (gw:6488/6493 → 8477): MANUAL switch, then HOME ALL joints (every joint moves to its switch) / teleop off + UNHOME ALL. `home_all`/`unhome_all` exist for "all"; −1 as an explicit value is the only way it should stay. Null is already refused. Bool `true`/`false` → joint 1/0.
2. **clear_wcs, `target` missing → "active"** (gw:6889 → 6909, 6915): zeroes the active work offset — irreversible; the next program runs from a zeroed fixture. Not in COMMAND_SCHEMA. The page always sends it.
3. **Tool table: `z_offset`/`diameter` null → 0.0** in save_tool (6069/6071) and renumber_tool (6185/6186), missing or null in add_tool (6106/6107): a measured tool length replaced by 0 in tool.tbl and reloaded into LinuxCNC (4465/4481); a later G43 assumes a zero-length tool. A NaN in the editor form arrives as null. `remark` null → the string "None".
4. **set_block_delete / set_optional_stop, `value` via `bool()`** (6613/6607): `"false"` → ON (block delete then SKIPS "/" lines; optional stop then stops at M1); missing/null → OFF. Decides which program lines run. Not in COMMAND_SCHEMA.
5. **set_feed_override / set_rapid_override / set_spindle_override, `scale` missing or null → 1.0** (6536/6601/6543): the override jumps to 100 % (e.g. from a reduced first-run feed). A NaN slider value arrives as null.
6. **Parameter maps, a value null → 0** (5395) in `mdi.vars`, `probe_run.vars`, `surface_scan_run.vars`: `#n=0` goes into the interpreter and the var file, then the routine runs with it. COMMAND_SCHEMA's VarNumbers (`_check_var_numbers` cp:1243) and `purpose_refusal` (features.py:127) check keys only; `set_params` is already strict (features.py:162–164).
7. **auto_run modifiers that decide motion silently**: an invalid `entry_units`/`entry_wcs` → modal units/WCS for the entry rapid (6275–6276 → 4978–4992); an invalid `spindle_dir` → MANUAL switch, no spindle, program starts (6372–6377, 5121–5127); `line` missing → from the top (6266); `safe_z: "false"` → retract + RFL path (6268); `pre_tool: true` → T1 pre-measure (6267, still bound to the server basis).
8. **Bool and float coercion where a number picks the target**: `true` → 1 in tool_change (T1 M6; `false` → T0 M6 + G49), tool_measure (T1 M600), set_mode (MANUAL), set_kins_mode (TCP), set_compensation_method (linear), home joint, set_wcs/touchoff values (writes 1.0); truncation `2.9` → AUTO (set_mode 5788, finite_int), `1.9` → TCP (set_kins_mode, Enum `to_int`). Cause: `to_float`/`to_int`/`finite_*` accept bool and truncate.
9. **spindle_forward / spindle_reverse, `speed` missing or null → 0** (6549/6554): MANUAL switch, then spindle on at 0 rpm. What a 0-rpm spindle-on does in HAL is **not verified**. The page sends an explicit 0 for an empty field, so a "required" rule must keep 0 valid.
10. **Jogs with a 0 default**: `vel` missing or null (6398/6462), `distance` missing or null (6463, not in COMMAND_SCHEMA), entry `vel`/`distance` null in the multi forms (6428/6473–6474): a MANUAL switch (4136) and a 0-speed or 0-distance jog booked in `_active_jogs`. `jog_*_multi` with `axes` missing → MANUAL switch, reply ok, nothing jogged. The motion effect of vel 0 is **not verified**; the mode switch is a real write.
11. **set_max_velocity, `velocity` missing or null → `maxvel(0)`** (6620). Effect not verified. The page never sends this command.

### A2. A controller write happens BEFORE the field that decides is checked (the order S5 must fix)
- **run_macro `args`**: `_start_guard` (gw:5891) may switch to MDI and write `#3116=0` (4796–4797) before `build_call` (5920) checks the values.
- **jog_cont_multi / jog_incr_multi, homed, an out-of-range `axis`**: set_mode(MANUAL) (4136), then `CMD.jog` is left to reject it (docstring 4264); `axes` missing or empty → the same switch, reply ok.
- **touchoff, U/V/W on the Plane route**: set_mode(MDI) (6970), then refused (7004).
- **auto_run `spindle_dir` invalid**: never refused. `_start_guard` (6366), `_toolsetter_sync` (6369) and set_mode(MANUAL) (6373) all run, then the program starts without a spindle.
- Every other field in §2 is read before the handler's first write; validate_payload (7348) runs before any handler.

### B. Wrong type → authorization or display change (no machine action itself)
- **arm `armed: "false"` → ARMS** (10804). The worker handles it, so validate_payload never sees it.
- **hello `resume_armed: "false"` → re-arm** if a hold exists (11674 → 11712).
- **tab_visibility `hidden: "false"`** → this client's status stream stops (11837). timing_log/halshow_live: diagnostics only.

### C. Defaults that are explicitly safe (keep)
- **arm, `armed` missing or null → disarm** (10804; the disarm also stops jogs, 10831). This is the safe direction.
- **jog_stop_multi, `axes` missing → no-op ok** (6435–6439). A stop never makes up a target. Refusing a stop would be the hazard (§6).
- **set_wcs, an axis absent or null → not written** (7209–7214). `target` missing is already refused (7204).
- **mdi, `vars` missing or null → no parameter write** (5851–5854). **run_macro, `args` missing → []**, then the arity check refuses (5882, macro_files.py:329).
- **auto_run optional fields missing** (spindle_dir/speed, pre_tool, probe_vars, safe_z, entry_*) → a plain run from line. The page leaves them out on purpose (App.vue:1833–1844).
- **save_tool, a field missing → unchanged** (6066–6073). **renumber_tool pocket/z_offset/diameter/remark missing → kept** (6184–6187, R321 FI321-02). **add_tool pocket missing → the tool number** (6105).
- **touchoff, `expect` missing → no expectation check.** The controller re-check of the route still runs (from 6983). The page leaves it out when it has none (useTouchoffMath.ts:58), so it cannot be made required without a client change.
- **via missing → not a gamepad command** (5673). It is a marker; the strip and keyboard send the same commands without it.
- **device_rename / device_reset, `device` missing → this client's own profile** (4620–4621). No machine effect. hello `resume_armed` missing → no resume; tab_visibility `hidden` missing → visible; timing_log / halshow_live missing → off.
- **Already strict on missing and null** (no change needed): set_mode (5790), set_kins_mode (5966), set_compensation (6822), set_compensation_method (6832), confirm_tool_change (4668), tool_measure (5589), the tool numbers of tool_change/save/add/delete/renumber (KeyError/ValueError), load_file (6635), mdi.text (5845), run_macro name/revision (5885/5887), probe_run routine/vars, surface_scan_run vars (5594), set_params (features.py:150), set_g30 values/based_on (KeyError/10646), touchoff axes (6947), set_wcs target (7204), auto_run file/version/source (6297), save_settings (settings_store.py:420–422).

Uncertain, not checked here: what LinuxCNC/HAL does with a 0-velocity jog, a 0-rpm spindle-on and `maxvel(0)`. The upstream motion source is not on this machine; only `~/claude-work/bg/upstream-2.9.4/emctaskmain.cc` is.
