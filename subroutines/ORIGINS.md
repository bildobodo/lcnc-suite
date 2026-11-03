# Subroutine Origins

## probe_basic/
- Origin: https://github.com/kcjengr/probe_basic
- Fork: https://github.com/bildobodo/probe_basic
- License: GPL-3.0
- Author: Chris P (kcjengr)
- Notes: Subroutines from `configs/probe_basic/subroutines/`. Excluded `go_to_g30.ngc` and `tool_touch_off.ngc` (TooTall's versions in tool_length_probe/ are preferred). Excluded ATC/carousel-specific files.
- Changed here (2026-11-03, Codex R254 PF-01): 38 calls in the pocket, valley and pocket-calibration routines passed `[3017]` (the number) as the traverse feed where `[#3017]` (the parameter) was meant; now `[#3017]`.

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
