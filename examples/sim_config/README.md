# Example Sim Config

A minimal LinuxCNC sim configuration for lcnc-suite. Copy to your LinuxCNC configs directory and adjust paths.

## Setup

```bash
cp -r examples/sim_config ~/linuxcnc/configs/lcnc_suite_sim
```

Edit `lcnc_suite_sim.ini`:
- Set `SUBROUTINE_PATH` to your lcnc-suite clone location (LinuxCNC's INI parser expands `~`, so `~/lcnc-suite/...` is fine if you cloned there).

Edit `hallib/lcnc_webui.hal`:
- Replace `~/lcnc-suite/` with your absolute clone path in every `loadusr` line — halcmd does **not** expand `~`.
- Surface compensation is enabled by default and requires `python3-scipy` (auto-installed by `install.sh`). Comment out the `loadusr ... compensation.py` line and the `net eoffset-*` / `net compensation-*` block at the bottom of the file if you don't need it.
- Adjust the `unlinkp iocontrol.0.emc-enable-in` line if your config uses a different e-stop signal name.

## Key files

- `lcnc_suite_sim.ini` — INI with all required RS274NGC, HAL, and display settings
- `hallib/lcnc_webui.hal` — HAL wiring for safety watchdog, e-stop chain, tool change, compensation
- Other HAL files — sim-specific (homing, spindle, etc.)
