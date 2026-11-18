# Coverage at `d79d7d28` — PASS

61 functions; 70 gaps by name; 0 evaluation errors.

## Gaps

- **F-ESTOP:** checked S4 (no gate evidence); checked S4b (no gate evidence)
- **F-POWER:** triggered cmd:machine_on (not sent in a passed Chromium attempt)
- **F-SHUTDOWN:** triggered cmd:shutdown (not sent in a passed Chromium attempt)
- **F-SIMTRIP:** triggered cmd:simulate_probe_trip (not sent in a passed Chromium attempt); checked S2b (no gate evidence)
- **F-HOME:** checked S2c (no gate evidence)
- **F-JOG:** triggered cmd:jog_cont_multi (not sent in a passed Chromium attempt); triggered cmd:jog_incr_multi (not sent in a passed Chromium attempt); triggered cmd:jog_stop_multi (not sent in a passed Chromium attempt); checked S5 (no gate evidence)
- **F-GOTO:** triggered cmd:go_to_zero (not sent in a passed Chromium attempt); checked S1 (no gate evidence); checked S1b (no gate evidence); checked S1c (no gate evidence); checked S1d (no gate evidence); checked S2 (no gate evidence)
- **F-OVERRIDE:** checked S2 (no gate evidence); checked S2b (no gate evidence); checked S2c (no gate evidence)
- **F-COOLANT:** checked S2 (no gate evidence)
- **F-TOUCHOFF:** checked S3b (no gate evidence)
- **F-WCS:** triggered cmd:get_wcs_table (not sent in a passed Chromium attempt)
- **F-TWP:** triggered cmd:twp_capture (not sent in a passed Chromium attempt); checked S3 (no gate evidence)
- **F-LOAD:** triggered cmd:unload_file (not sent in a passed Chromium attempt); triggered http:GET /files (never answered by a server (replaced)); triggered http:GET /gcode (never answered by a server (fallback, replaced)); triggered http:GET /subfile (never answered by a server (fallback, replaced))
- **F-UPLOAD:** triggered http:POST /upload (never answered by a server (replaced, rewritten))
- **F-EDIT:** triggered http:PUT /save (never answered by a server (replaced))
- **F-RFL:** checked S3 (no gate evidence)
- **F-PREVIEW:** triggered cmd:reparse_preview (not sent in a passed Chromium attempt)
- **F-TOOLTABLE:** triggered http:GET /tool-table (never answered by a server (held, replaced))
- **F-TOOLEDIT:** triggered cmd:renumber_tool (not sent in a passed Chromium attempt); triggered cmd:save_tool (not sent in a passed Chromium attempt); checked S4b (no gate evidence)
- **F-TOOLIMPORT:** triggered http:GET /tool-library-file (never answered by a server (replaced)); triggered http:GET /tool-library-files (never answered by a server (replaced)); triggered http:POST /import-tool-library (never answered by a server (replaced)); triggered http:POST /import-tool-library/apply (never answered by a server (replaced)); triggered http:POST /import-tool-library/refresh (never answered by a server (replaced))
- **F-TOOLCHANGE:** checked S2 (no gate evidence)
- **F-TOOLMEASURE:** checked S5 (no gate evidence); checked S6b (no gate evidence)
- **F-TOOLSETTER:** checked S2c (no gate evidence)
- **F-G30:** triggered http:GET /g30 (never answered by a server (closing, fallback, fetch-fallback, replaced, rewritten))
- **F-PROBE:** triggered cmd:list_probe_macros (not sent in a passed Chromium attempt); checked S3 (no gate evidence)
- **F-SURFACE:** triggered http:GET /surface_points (never answered by a server (replaced)); checked S2 (no gate evidence)
- **F-COMP:** triggered cmd:set_compensation (not sent in a passed Chromium attempt); triggered http:GET /comp_grid (not requested); checked S4 (no gate evidence)
- **F-MACROFILES:** triggered http:DELETE /macro (never answered by a server (replaced)); triggered http:GET /macro (never answered by a server (replaced)); triggered http:POST /macro-upload (not requested); triggered http:PUT /macro (never answered by a server (replaced, rewritten))
- **F-CAMERA:** triggered http:GET /camera/status (not requested); triggered http:GET /camera/stream (not requested)
- **F-SETTINGS:** triggered http:POST /settings/{section} (never answered by a server (aborted, fallback, replaced)); triggered http:PUT /settings/{section} (not requested)
- **F-DEVICES:** triggered cmd:device_reset (not sent in a passed Chromium attempt)
- **F-DIAG:** triggered cmd:timing_log (not sent in a passed Chromium attempt); triggered http:GET /health (not requested); triggered http:POST /telemetry (never answered by a server (aborted-early, closing, fallback, replaced))
- **SYS-CONN:** triggered http:GET /index.html (not requested); triggered http:GET /ready (never answered by a server (closing, fallback)); checked S1 (no gate evidence); checked S4 (no gate evidence)

## Inventory (source level)

1183 atoms; complete: True; unresolved 0, excluded 1, open variants 47 — the source inventory: an open variant is a site whose members are not derived — assigned to no function, counted apart from the gaps (Codex R396 VM-I37).

- open variant: web controls — App.vue · v-for family · `(entry, i) in mdiHistory`
- open variant: web controls — App.vue · v-for family · `p in dialogFile.params`
- open variant: web controls — ChoiceGroup.vue · v-for family · `(o, i) in options`
- open variant: web controls — DevicesSettings.vue · v-for family · `d in others`
- open variant: web controls — FileBrowser.vue · v-for family · `entry in files`
- open variant: web controls — GamepadTab.vue · v-for family · `(label, key) in GP_BTN_LABELS`
- open variant: web controls — GamepadTab.vue · v-for family · `a in stickAxes`
- open variant: web controls — GcodePanel.vue · v-for family · `(item, i) in visibleLines`
- open variant: web controls — GcodePanel.vue · v-for family · `(token, ti) in item.tokens`
- open variant: web controls — HalshowTab.vue · v-for family · `[group, params] of paramGroups`
- open variant: web controls — HalshowTab.vue · v-for family · `[group, pins] of pinGroups`
- open variant: web controls — JogStrip.vue · v-for family · `(ra, i) in abcAxes`
- open variant: web controls — JogStrip.vue · v-for family · `(ra, i) in uvwAxes`
- open variant: web controls — JogStrip.vue · v-for family · `btn in xyBtns`
- open variant: web controls — KeyboardTab.vue · v-for family · `action in COMMAND_ACTIONS`
- open variant: web controls — KeyboardTab.vue · v-for family · `action in LINEAR_JOG_ACTIONS`
- open variant: web controls — KeyboardTab.vue · v-for family · `action in ROTARY_JOG_ACTIONS`
- open variant: web controls — MacroBar.vue · v-for family · `b in shown`
- open variant: web controls — MacrosPanel.vue · v-for family · `f in shownRows`
- open variant: web controls — MacrosPanel.vue · v-for family · `n in missing`
- open variant: web controls — MessagesDialog.vue · v-for family · `m in rows`
- open variant: web controls — OffsetPanel.vue · v-for family · `axis in offsetColumns`
- open variant: web controls — OffsetPanel.vue · v-for family · `row in props.wcsTable`
- open variant: web controls — ProbePanel.vue · v-for family · `op in angleGrid`
- open variant: web controls — ProbePanel.vue · v-for family · `op in bossGrid`
- open variant: web controls — ProbePanel.vue · v-for family · `op in insideGrid`
- open variant: web controls — ProbePanel.vue · v-for family · `op in outsideGrid`
- open variant: web controls — ProbePanel.vue · v-for family · `op in ridgeGrid`
- open variant: web controls — SettingsPanel.vue · v-for family · `f in FEATURE_NAMES`
- open variant: web controls — SettingsPanel.vue · v-for family · `lf in g.rows`
- open variant: web controls — SettingsPanel.vue · v-for family · `m in [0, 5, 10, 20, 30]`
- open variant: web controls — SettingsPanel.vue · v-for family · `part in machineParts`
- open variant: web controls — SettingsPanel.vue · v-for family · `row in PALETTE_ROWS`
- open variant: web controls — SettingsPanel.vue · v-for family · `s in HUD_SCALES`
- open variant: web controls — SettingsPanel.vue · v-for family · `t in HUD_TOGGLES`
- open variant: web controls — SetupStrip.vue · v-for family · `a in chunk`
- open variant: web controls — SimPanel.vue · v-for family · `r in renderedRows`
- open variant: web controls — TabNav.vue · v-for family · `t in tabs`
- open variant: web controls — TextKeypadStrip.vue · v-for family · `(k, i) in keys`
- open variant: web controls — TextKeypadStrip.vue · v-for family · `p in PAGE_ORDER`
- open variant: web controls — ToolsetterSettings.vue · v-for family · `a in g30Axes`
- open variant: web controls — ToolsetterSettings.vue · v-for family · `v in [0, 1, 2, 3]`
- open variant: web controls — ToolsetterSettings.vue · v-for family · `v in [0, 1, 2]`
- open variant: web controls — ToolsetterSettings.vue · v-for family · `v in [5, 500]`
- open variant: web controls — ToolTablePanel.vue · v-for family · `tool in filteredTools`
- open variant: py routines — gateway.py · the probe_run job: the web adapter's probe routines · `O<{routine}> CALL`
- open variant: py routines — macro_files.py · the macro class · `o<{meta['name']}> call`
- excluded: web routines — gcodeReference.ts · `O<name> call` (the G-code reference's syntax text, not a call)

## Notes

- the payload checker's counter-check: replay_refusals.json lists what is expected; none was expected in this run
- mutation records of the packages are bound to no statement — outside this report
- native evidence needs a report of THIS commit (--native-report); without one it is 'not at this commit'
- run ids from the gate
