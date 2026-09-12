# Fusion holder references

Captured on 2026-09-12 with Fusion 2705.1.15. `fusion-tool-holders.json` preserves
requested JSON separately from the canonical operation tool and native post
result. No LCNC geometry was used to create the references.

Four isolated Trace operations use a 10 mm flat mill, OAL 70 mm, LCF/shoulder
15 mm, and a three-segment holder: heights 10/20/20 mm, diameters 20→30,
30→30 and 24→12 mm. Each tool was created with `Tool.createFromJson`, assigned
to an audit Trace operation, and given a generated toolpath. A local JSON-only
post read `tool.getHolderProfileAsSVGPath()` in millimeter output. The user’s
tool libraries and live machine were not changed.

| Case | Requested LB | Requested holder gauge | Canonical LB | Canonical holder gauge |
| --- | ---: | ---: | ---: | ---: |
| holder-gauge30 | 30 | 30 | 30 | 50 |
| holder-lb40 | 40 | 30 | 40 | 50 |
| holder-gauge20 | 30 | 20 | 30 | 50 |
| holder-inch | 30 | 30, supplied in inches | 30 | approximately 50 |

All table lengths are expressed in mm for comparison. Fusion converted the
inch holder to mm and recomputed gauge/assembly lengths. The requested gauge
variants are evidence of API normalization, **not** evidence for a native
holder with geometry above the gauge plane. Tests compare canonical outputs.
A separate backend test verifies that LCNC preserves mixed source units and an
exported gauge value distinct from total segment height.

`fusion-tool-holder-native.png` is the unmodified 2400×2400 initial simulation
frame for `holder-gauge30`. The capture opened only that audit simulation,
set an orthographic camera, called `Viewport.saveAsImageFile`, terminated its
own simulation command and restored the previous camera. Its hash and camera
are stored in the JSON fixture. The 120 mm camera height gives 20 pixels/mm;
the independent 20 mm stock block spans 400 pixels. The lowest gold cutter
pixel establishes the tip; the image center establishes the rotational axis.
The blue hue identifies the holder including its dark shaded silhouette.

Run `python3 test-fixtures/extract-fusion-holder.py` with Pillow and NumPy to
recompute the stored edge samples. It reads the original image without changing
pixels. `toolHolder.test.ts` verifies the hash and camera/stock scale, then
compares both contour directions with a 0.08 mm raster tolerance. It separately
compares mm/in geometry against the native SVG at 0.00001 mm coordinate tolerance.
These checks certify the recorded exterior cross-sections, not machining
accuracy, hidden bores, arbitrary holder families or an installed spindle datum.
