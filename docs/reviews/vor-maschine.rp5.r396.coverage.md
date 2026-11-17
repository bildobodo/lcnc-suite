# Coverage at `9d7d7c0e` — PASS

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
- **F-G30:** triggered http:GET /g30 (never answered by a server (aborted-early, closing, contact-closed, fallback, fetch-fallback, replaced, rewritten))
- **F-PROBE:** triggered cmd:list_probe_macros (not sent in a passed Chromium attempt); checked S3 (no gate evidence)
- **F-SURFACE:** triggered http:GET /surface_points (never answered by a server (replaced)); checked S2 (no gate evidence)
- **F-COMP:** triggered cmd:set_compensation (not sent in a passed Chromium attempt); triggered http:GET /comp_grid (not requested); checked S4 (no gate evidence)
- **F-MACROFILES:** triggered http:DELETE /macro (never answered by a server (replaced)); triggered http:GET /macro (never answered by a server (replaced)); triggered http:POST /macro-upload (not requested); triggered http:PUT /macro (never answered by a server (replaced, rewritten))
- **F-CAMERA:** triggered http:GET /camera/status (not requested); triggered http:GET /camera/stream (not requested)
- **F-SETTINGS:** triggered http:POST /settings/{section} (never answered by a server (aborted, aborted-early, fallback, replaced)); triggered http:PUT /settings/{section} (not requested)
- **F-DEVICES:** triggered cmd:device_reset (not sent in a passed Chromium attempt)
- **F-DIAG:** triggered cmd:timing_log (not sent in a passed Chromium attempt); triggered http:GET /health (not requested); triggered http:POST /telemetry (never answered by a server (aborted-early, closing, fallback, replaced))
- **SYS-CONN:** triggered http:GET /index.html (not requested); triggered http:GET /ready (never answered by a server (closing, fallback)); checked S1 (no gate evidence); checked S4 (no gate evidence)

## Notes

- the payload checker's counter-check: replay_refusals.json lists what is expected; none was expected in this run
- mutation records of the packages are bound to no statement — outside this report
- native evidence needs a report of THIS commit (--native-report); without one it is 'not at this commit'
