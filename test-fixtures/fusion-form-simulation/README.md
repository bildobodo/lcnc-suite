# Native Fusion form-tool simulation reference

Captured on 2026-09-12 in Fusion 2705.1.15, using the existing unsaved
`LCNC Tool Geometry Audit` document and its generated `Native bare-form-mill`
Trace operation. The tool is Autodesk's example form mill, with the holder
removed and LB set to OAL. No machine output or cloud save was involved.

- `native-operation.json`: canonical tool and operation validity read from Fusion.
- `native-simulation-state.json`: native Simulate dialog state at capture, with
  position X=0, Y=0, Z=15 mm and tip-offset zero in the tool JSON.
- `native-front.png`: original 2000 x 2000 native graphics screenshot, front view.
- `native-iso.png`: original 1600 x 1200 isometric screenshot for visual context.
- `native-silhouette.json`: independently measured image edges and calibration.
- `extract-silhouette.py`: reproducible extraction using Python and Pillow;
  run it in place to regenerate the silhouette JSON. It never changes image pixels.

The reference stock is 20 x 20 x 6 mm: a 20 x 20 x 5 mm block plus 1 mm top
stock. The WCS origin is on that stock's top face. The visible grey rectangle
provides the scale (162 pixels / 20 mm = 8.1 pixels/mm) and X origin. The stock's
top edge and the simulation's 15 mm Z readout provide the tool-tip Y coordinate.
**No tool dimensions or LCNC contour points are used to fit scale or alignment.**

The 644 rows provide 1,288 independently captured left/right boundary samples.
`formToolGeometry.test.ts` checks these against the production profile and also
checks the profile against both measured boundaries, in millimetres and inches.
The 0.5 mm acceptance threshold covers pixel calibration, antialiasing and the
native display mesh's faceting. It is not a machining tolerance. The initial
native-to-LCNC maximum is about 0.340 mm, with the 95th percentile about 0.177 mm;
the reverse maximum is about 0.407 mm.

Coverage is deliberately limited to axial z=1..160 mm: the front screenshot
clips the top of the 179.598 mm tool. The reverse comparison stays one mm inside
that sampled interval. The isometric screenshot supplies qualitative context
for the upper cylinder; it is not used for numeric measurements. This reference
does not prove the remaining height, caps, other form profiles, nonzero tip
offsets, optional holder placement or every surface of the 3D lathe mesh.

## Nonzero tip-offset follow-up

`tip-offset-plus10/` contains a second native capture of the same physical tool
with `tip-offset=10` mm. Both axial ends are visible. Edge samples now cover
z=1..178 mm; image-derived end bounds are z=0.120 and z=179.740 mm, compared with
the imported profile's 0 and 179.598 mm. These agree within the unchanged 0.5 mm
raster threshold without shifting the mesh by the tip offset.

For this capture the camera was explicitly set to an orthographic front view
with a 28 cm vertical extent. A 2000-pixel image therefore has 7.142857 pixels/mm.
The 20 mm stock independently agrees within one pixel of width. Merely counting
opaque stock pixels gives 7.1 pixels/mm because antialiased border pixels are
excluded; that scale error would accumulate to more than 1 mm over the tool's
height. No scale was fitted to the tool's OAL or profile. The screenshot and
original camera settings are retained together so this calibration is reviewable.

Regenerate this reference with Python/Pillow:

```sh
python3 test-fixtures/fusion-form-simulation/extract-silhouette.py \
  test-fixtures/fusion-form-simulation/tip-offset-plus10 178
```

The 1,264 edge samples have a native-to-LCNC maximum distance of 0.372 mm and a
reverse maximum of 0.392 mm. Tests run both captures in mm and inch and check the
visible top/bottom bounds. These are silhouette/end-position checks, not proof
of every 3D cap surface or other form profiles.

`../fusion-tool-form-offsets.json` records three generated Trace operations and
their canonical tools, with requested/canonical/post offsets 0, +10 and -10 mm.
`form-offset-coordinates.cps` is the JSON-only post used to capture their linear
positions. It emits no machine program. At the same reference line the cutting
Z values are -6, -16 and +4 mm respectively. Clearance remains +15 mm. Fusion
has already applied the tip offset to the cutting coordinates; applying another
mesh offset in LCNC would shift the physical body twice. Integration tests pass
all three tools through import, real sidecar persistence and both metadata paths,
keep measured Z=-42.3 intact and place the unshifted body at the posted position.

Fusion's CAM-post cylinder remains excluded as a form-shape oracle. Autodesk
[describes the simulation/toolpath distinction](https://help.autodesk.com/cloudhelp/ENU/Fusion-CAM/files/FORM-MILL-OVERVIEW.htm).
