# DMU 160 P machine model (nutating B head + C table)

Viewer model for `lcnc_suite_sim_dmu160p.ini` — a large portal mill with a
**45° nutating spindle head** (B rotates about the axis `[0, sin45°, cos45°]`)
and a rotary C table. This is the opposite rotary layout from the
`machine-xyzac` trunnion sim: there the rotaries carry the *work*, here B is
on the *tool* chain.

## Provenance & license

Machine STLs by **Sigma1912**, from
[LinuxCNC_Demo_Configs](https://github.com/Sigma1912/LinuxCNC_Demo_Configs)
(`5axis-twp/spindle-nutating_table-rotary/DMU-160-P/vismach-stl-files/`,
**GPL v3**). The kinematic constants in `machine.json` are mirrored from the
companion [vtk-vismach](https://github.com/Sigma1912/vtk-vismach) model
`vtk-dmu-160-p-gui.py`: nutation angle 45°, pivot_y 0, pivot_z −80 (spindle
nose 80 mm above the pivot on the local Z), Z-slide mesh offset −759.5.

The committed STLs are converted to binary (~9 MB vs ~53 MB ASCII upstream)
with the B-head's static vismach pre-rotation (+45° about X) baked into the
mesh. `fetch-model.sh` re-fetches and re-converts from upstream.

## Frame conventions

World origin = C-table center, table top at world Z0. Machine coordinates
are the trivkins controlled point with **Z0 at the TOP of travel** (the
real-machine convention, and it makes the joints-at-zero startup pose a
legal, parked-high position): X0 Y0 = table center, Z −970..0 (nose
1120..150 above the table — the Z-slide body reaches 124 below the nose,
so nose-at-table is mechanically impossible), B0 = spindle vertical, C0.
The 500 mm stock's top face is machine Z −620; `dmu160_demo.ngc` sets G54
there so its work Z0 = stock top. In machine.json this frame is carried by
BOTH chains: the tool chain places the nose at world `1120 + Zmach`, and
the work chain is lifted `+1120` (meshes shifted back down) so the
tool-vs-work relative pose ≡ machine coords — the identity the toolpath
overlay and the scrub pose rely on. The
`work_piece_1.stl` (500 mm cube) on the platter is flagged **`stock: true`**
— the one body the tool may FEED into (cutting); rapid-onset contact with it
is the gouge class, and any tool contact with a machine part remains a crash.

## Known boundary (trivkins + tilted head)

The sim runs plain trivkins: LinuxCNC applies G43 tool length along machine
Z regardless of B, while the drawn tool marker rides the tilted spindle
axis. At B=0 the two agree exactly; with the head tilted **and** a nonzero
TLO they diverge — that is inherent to non-TCP kinematics, not a viewer
defect. Upstream's real config uses `xyzbc_sntr_kins` + TWP remaps (TCP);
out of scope here.
