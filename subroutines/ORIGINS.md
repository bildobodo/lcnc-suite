# Subroutine Origins

## probe_basic/
- Origin: https://github.com/kcjengr/probe_basic
- Fork: https://github.com/bildobodo/probe_basic
- License: GPL-3.0
- Author: Chris P (kcjengr)
- Notes: Subroutines from `configs/probe_basic/subroutines/`. Excluded `go_to_g30.ngc` and `tool_touch_off.ngc` (TooTall's versions in tool_length_probe/ are preferred). Excluded ATC/carousel-specific files.
- Changed here (2026-11-03, Codex R254 PF-01): 38 calls in the pocket, valley and pocket-calibration routines passed `[3017]` (the number) as the traverse feed where `[#3017]` (the parameter) was meant; now `[#3017]`.
- Suite changes (P5, 2026-11-24, the probe calibration's candidate): the four `probe_cal_*` routines measure and report, they never write the active offset. Each lost its zeroing of `#3032` at the start, passes `[0]` to the XY probing calls in its place, keeps the result in `#1013` (volatile, like `#1000`–`#1012`), takes the gateway's run token as its first argument (`#1014 = #1`) and ends with ONE result line the gateway consumes. `probe_cal_reset.ngc` is unchanged and no longer called by the suite (Reset is a gateway command). The whole difference, the same in all four:

  ```diff
  -  (clear current probe calibration offset)
  -  #3032 = 0
  -  (DEBUG, EVAL[vcp.getWidget{"calibration_offset_3032"}.setValue{#3032}])
  +  (LCNC Suite: the run token, carried by the result line. The active offset)
  +  (#3032 stays untouched, the XY probing calls below take 0 instead of it)
  +  #1014 = #1
  …
  -  o<probe_x_plus> call [#3014][#3015][#3016][#3017][#3018][#3019][#3032]
  +  o<probe_x_plus> call [#3014][#3015][#3016][#3017][#3018][#3019][0]
  …  (the same for every probe_x_minus / probe_y_plus / probe_y_minus call)
  -      #3032 = [ABS[#<new_avg_cal_offset>]]
  -      (DEBUG, EVAL[vcp.getWidget{"calibration_offset_3032"}.setValue{#3032}])
  +      #1013 = [ABS[#<new_avg_cal_offset>]]
  …  (the same for the X and the Y branch, then after `o130 endif`)
  +  (LCNC Suite: the result with its run token, consumed by the gateway)
  +  (DEBUG, LCNC_CAL_CANDIDATE run=#1014 value=#1013 axis=#3036)
  ```

## tool_length_probe/
- Origin: https://github.com/TooTall18T/tool_length_probe
- Fork: https://github.com/bildobodo/tool_length_probe
- License: GPL-3.0
- Notes: Parameterized toolsetter config with var file refs (#3100-#3115).

## surfacemap/
- Origin: https://github.com/mhubig/surfacemap_usertab
- Fork: https://github.com/bildobodo/surfacemap_usertab
- License: GPL-2.0+ (compensation.py by Scott Alford)
- Notes: Surface compensation with scipy griddata interpolation.
