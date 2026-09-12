# Native Fusion thread and form cutting silhouettes

Captured from Fusion 2705.1.15 on 2026-09-12. The 11 cases cover three thread
crest types at 60°/90°, flat/round tools with independently longer LCF, a smaller
rounding, a stepped form and a form containing opposite quarter-circle arcs.
Every canonical tool belongs to a successfully generated Trace operation in an
isolated unsaved audit document. No holder, machine connection or cloud save
was involved. The native CAM-post SVG is not the oracle for these cases.

Each case retains the original 2400 × 2400 Fusion image, camera record and
canonical operation geometry. `extract_edges.py` reads these original pixels;
it does not edit the image or fit the scale/shape to LCNC. Run it with Python,
Pillow and NumPy to reproduce `native-silhouettes.json`.
The regression tests verify the image SHA-256 hashes.

Scale comes from the recorded orthographic camera height and image height.
The known 20 mm reference block independently checks it within 2.1 pixels.
The camera looks along Y, centred at X=0; the image centre defines the tool axis.
The bottom gold silhouette edge defines the tool-local axial origin. Its camera
world coordinate is 21 mm for the thread captures and 20.9875 mm for the form
captures, consistent within a pixel. This is a shape comparison relative to the
native bottom edge, not an independent verification of installed length or CAM
point compensation. Those have separate fixtures.

Samples retain both native edges at every coloured image row. The test closes
the sampled outline at its measured top and bottom, then compares in both
directions at a 0.02 mm sampling pitch. Material edges and cap closures are
raster-derived. Rotational facets, antialiasing and pixel quantization limit
precision. Thresholds are 0.04 mm for these thread captures and 0.08 mm for the
form captures; they are not manufacturing tolerances.

The thread images include the full cutting/neck region but crop the upper
non-cutting shaft. The two form images include the complete tool silhouette.
Front silhouettes do not prove all 3D surfaces, arbitrary profiles, flute
grooves or holder placement. The unchanged renderer's full-body behavior is
covered separately by the native-post and analytic profile fixtures.

The snapshots show that flat width changes both the crest and root flats.
Rounded crests and roots share a radius and finish the cutting region at
`LCF-R*cos(profileAngle/2)`. See `docs/fusion-tool-geometry.md` for the resulting
parameter mapping and the valid dimension ranges currently handled.
