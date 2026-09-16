# Native follow-up silhouettes

Fusion 2705.1.15, captured on 2026-09-12 in the isolated
`LCNC Tool Geometry Audit` document. These 21 original front screenshots cover
17 thread mills, two face mills, one corner-chamfer mill and one form mill.
The [follow-up report](../../docs/fusion-tool-followup.md) records the parameter
findings and remaining limitations.

`native-silhouettes.json` retains each operation's canonical tool JSON, the
orthographic camera, original PNG SHA-256, scale calibration and measured
left/right cutting edges. The images have not been redrawn or rescaled.
The saved JSON is sufficient to rerun the importer and renderer without Fusion.

## Independent pixel measurement

For an image of width `w` and height `h`, the axis is `w/2`. The camera points
along Y, with Z up; its vertical extent is in centimetres. The pixel scale is
`h / (camera.extents[2] * 10)` pixels/mm. No LCNC profile is used to fit it.

Cutting pixels are selected from the original RGB image using
`R>30, G>18, R>1.08*G, G>1.6*B, B<90`. The bottom edge is one pixel below
the last selected row. For each selected row `y`, with leftmost pixel `x0`
and rightmost pixel `x1`, the saved measurements are:

```
zMm           = (bottomEdge - y - 0.5) / pixelsPerMm
leftRadiusMm  = (w/2 - x0) / pixelsPerMm
rightRadiusMm = (x1 + 1 - w/2) / pixelsPerMm
```

Coordinates are rounded to eight decimal places. A separate grey stock block
checks the scale: below the cutter, select `abs(R-G)<5, abs(G-B)<5, R>60`.
The median width of rows wider than 5 mm must agree with the known 20 mm block
within 2.1 pixels. Camera translation and the native bottom edge also provide
`tipWorldZMm`; measured machine offsets are not involved.

## Bounds and exclusions

The TypeScript tests compare both sides bidirectionally, in both machine
units. The screen bounds are 0.04 mm for threads and 0.08 mm otherwise.
`fu-face-upper` has a separately recorded 0.06814835 mm native meridian chord
error, plus two pixels; its independent native SVG remains checked to 0.002 mm.
These are raster/mesh bounds, not machining tolerances or a complete 3D claim.

The major/reversed synthetic form screenshots are retained separately under
[`fusion-tool-unverified`](../fusion-tool-unverified/) and described in
[`fusion-tool-unverified.json`](../fusion-tool-unverified.json). They expose
native serialization differences and are deliberately excluded from positive
contour comparisons.
