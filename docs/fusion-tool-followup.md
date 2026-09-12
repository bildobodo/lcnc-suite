# Fusion tool-body follow-up

Captured with Fusion 2705.1.15 on 2026-09-12, following the audit at `c22b9a9`.
All operations were created in the isolated `LCNC Tool Geometry Audit` document.
No user library, cloud document, tool table or machine was changed. Every
simulation opened for capture was closed again. Holders are outside this work.

## Implemented and independently checked

[28 native-post contours](../test-fixtures/fusion-tool-followup.json) add three
bull-nose, thirteen face-mill, seven corner-chamfer, three block-drill and two
tap references. Each record retains the requested input, the canonical operation
tool and Fusion's SVG. Circular SVG segments are sampled to a 0.0001 mm chord
error, independently of the LCNC renderer.

[21 native simulation captures](../test-fixtures/fusion-tool-followup-simulation/native-silhouettes.json)
add seventeen thread cases, two face mills, one corner-chamfer mill and one form
mill. Original PNG hashes, the orthographic camera and pixel measurements are
retained. The known 20 mm stock width checks the camera scale. No LCNC shape is
used to fit the native image scale or origin.

### Bull-nose / torus cutters

An explicit `RE=0` is a sharp corner, not a request for the legacy default
radius. Native `RE=0`, `0.01` and `2 mm` cases agree. Missing metadata retains the
old fallback. Meridian tessellation now targets 0.001 mm chord error, like the
other recently verified circular profiles.

### Face mills

`DCX` is the maximum cutting diameter and must be preserved separately from
`DC`. LinuxCNC's tool-table `D` still comes from `DC`; this change does not alter
compensation or measured offsets. `upper-radius` is also preserved.

For side angle `a=TA`, nominal radius `r=DC/2` and lower radius `c=RE`, the lower
fillet centre is `(r - c*(1-sin(a))/cos(a), c)`. It starts on the bottom plane
and ends tangent to the conical flank. For a positive angle, the flank reaches
`DCX/2`, not simply the radius implied by `LCF`.

An upper radius `u` rounds that flank into the maximum-diameter direction. Its
centre is `(DCX/2-u, h)`, with
`h=(DCX/2-r)/tan(a) + u*tan(a/2)`. The upper arc runs from `-a` to zero degrees.
It is not a quarter-round into the horizontal shoulder. At `TA=0`, the native
straight-sided head uses `DC` and `max(LCF, RE)`; the upper radius has no effect
in the tested cases.

The native cutter can extend beyond `LCF` and even the requested shoulder
length. The `DC=20, DCX=50, TA=15, RE=0, LCF=6` case reaches 55.9808 mm. The
renderer's cutting-material boundary follows the actual head end. Shoulder and
custom-shaft construction then continue independently of `LB`.

Fusion normalizes some requested dimensions: with `RE>0`, several inputs change
`DC` to reconcile the requested maximum diameter, angle and length. Tests use
the actual canonical export, not the original requested diameter.

Full contours agree within 0.002 mm of the native SVG in both machine units.
The simulation's R2/30-degree upper fillet uses a single straight meridian chord,
whose sagitta is about 0.06815 mm. Its screenshot test explicitly includes this
native faceting error plus two pixels; the separate SVG test keeps its 0.002 mm
bound. These are rendering comparisons, not machining tolerances.

### Corner-chamfer end mills

`corner chamfer end mill` maps to `cornerchamfer`. `chamfer-width` is radial,
while `chamfer-angle` is measured from the bottom plane. For width `w` and angle
`a`, the lower flat ends at `DC/2-w` and the chamfer rises by `w*tan(a)`.
This differs from the ordinary `chamfer mill` angle convention.

Native cases cover 30/45/60 degrees, widths 0/1/1.5/2 mm, `LCF` shorter than
the chamfer, a longer shoulder and a custom tapered shaft. The entire chamfer
remains present when its height exceeds `LCF`.

### Thread-mill boundaries and single teeth

The added simulations cover flat widths at zero and half-pitch, a 45-degree
flat profile, 120-degree round teeth, near-limit and limit round radii,
point/flat/round single teeth, 90-degree single teeth with a pitch range,
independently longer `LCF`, shortened `LCF` and a single tooth that cannot fit.

Two canonicalization details are recorded:

- Requested flat width zero becomes `TP/4` in the tested canonical tool.
  It is not a native zero-width-flat reference.
- Exact width/radius limits can round upwards in JSON. `0.8750000000000001`
  and radius `0.5051815` must not select the pointed fallback just because of
  serialization rounding. The width comparison tolerates floating arithmetic;
  the radius comparison permits 0.000001 mm and clamps to the mathematical limit.

Single teeth use a different construction from a repeating tooth train. With
`a=thread-profile-angle/2`, pitch `p`, outer radius `r` and flat width `w`,
`root=r-(p-w)*cot(a)/2`. The crest is centred at `p/2`, with ends at `(p-w)/2`
and `(p+w)/2`; there are no repeating root flats. A single rounded crest has
centre `(r-R, p/2)` and sharp roots at
`r-p*cot(a)/2 + R*(csc(a)-1)`. Its cutting height remains `LCF`, without the
multi-tooth axial radius shift. The existing repeating crest/root formulas
remain valid for the additional multi-tooth cases. Both units match the native
screen references within 0.04 mm.

The single-tooth limits are also different: `W <= p` and
`R <= p/(2*cos(a))`, twice the respective repeating-tooth limits. Native
single-tooth references with `p=1.75 mm`, `W=1.2 mm` and `R=0.8 mm` confirm that
valid single crests must not fall back to the pointed shape at the lower
multi-tooth thresholds.

### Block drills and left-hand taps

`block drill` generates with the regular Drill strategy, and receives its own
label/type with a straight body and the shared shoulder/shaft construction.
Requested point angles 90 and 118 degrees both canonicalize to `SIG=0`; these
are not ordinary conical drills. The exterior is natively verified, while its
absence from the public tool-creation list remains a classification note.

Left- and right-hand taps have identical native exterior contours in the
matched pair; the existing `tap` profile is sufficient for that exterior.
The source type preserves handedness. Helical flute/thread detail is outside
the rotational exterior model.

## Remaining native-reference limits

[Unverified inputs and outcomes](../test-fixtures/fusion-tool-unverified.json)
are kept separately from passing contour fixtures.

### Four circle-segment families

The importer now recognizes barrel, lens, oval and taper types, and preserves
`lower-radius`, `profile-radius`, `upper-radius` and `axial-distance` in machine
units. The distinct types and all these dimensions survive metadata refresh,
storage and viewer transmission. Their rendering is still a generic cylinder,
with an explicit approximation notice in the table, hover/editor previews and
both import modes.

Fusion accepts their tool JSON but rejects them in Trace with
`Tool (circle segment …) is not supported for the strategy.` The documented
Multi-Axis Finishing strategy reports `isGenerationAllowed=false` in this
session; it was not generated and no entitlement was bypassed. Native library
preview geometry or an available supported operation is still needed before
implementing and claiming their physical profiles. This does not imply that a
paid extension is the only possible route to a shape reference.

The installed library schema identifies axial distance as the height of the
profile-arc centre above the tip. Its required fields differ by subtype:
barrel uses all four fields plus shaft diameter; lens uses lower radius and
`RE`; oval uses lower/profile radii; taper uses lower/profile/upper radii,
`tip-diameter` and `TA`. Those field descriptions alone do not establish all
centres, tangent transitions or native clipping rules.

Sources: Autodesk's [supported tools](https://help.autodesk.com/cloudhelp/ENU/Fusion-CAM/files/MFG-TOOL-LIBRARY-SUPPORTED-TOOLS.htm)
and [circle-segment strategy overview](https://www.autodesk.com/products/fusion-360/blog/reduce-cycle-time-with-circle-segment-cutters-in-autodesk-fusion/),
plus the versioned installed Fusion tool-library schema/UI resources.

### Probe

A regular Drill operation with Points selection and the offered Custom cycle
(`cycleType='probe'`) was tested independently. Fusion still rejects the probe
as unsupported by that strategy. The dangerous `probe_selection.value` getter
was not accessed; [its native failure record](fusion-probe-api-failure.md) remains
applicable. No new Fusion crash occurred.

The prior LCNC profile went to the top of the sphere and then backwards to the
stem at the ball centre, creating a self-intersecting surface. It now follows
the sphere only to its intersection with the existing approximate stem radius.
The native ball/stylus/shoulder relationship remains unverified, and the UI
says so. Custom shaft metadata is retained but is not newly interpreted for
probes without that reference.

### Form-profile serialization limits

A further stepped form with multiple re-entrant regions matches the native
simulation within the existing 0.08 mm screen threshold. Together with the
previous three physical profiles, this expands the positive form coverage.

Two synthetic diagnostic profiles expose a limit: a single explicit 270-degree
arc does not reproduce its literal geometry in native simulation. Fusion shows
a lower quarter arc followed by a conical flank. Reversing the same closed
profile produces only a partial shape at a different origin. Canonical JSON
preserves both inputs, and toolpath generation succeeds, so neither JSON
acceptance nor a valid Trace is sufficient to claim faithful physical geometry.
These cases are retained as negative evidence, not passing native contours.

The Suite continues to display the supplied explicit profile, and flags major
arcs, reversed starting coordinates and backwards axial segments as unverified
against Fusion. A real tool-library export containing the intended topology,
or a further native serialization study, is needed to resolve these cases.
Existing verified form profiles and compensation offsets are unchanged.

### Legacy engraving type

The legacy `engraving cutter` mapping remains compatible and explicitly shows a
generic-cylinder notice. Current Fusion canonicalizes that exact type to
`unspecified`; current chamfer/engraving tools use the already-supported
`chamfer mill`. No speculative new engraving geometry was added.

## Validation

The full frontend suite passes 947 tests in 32 files. The backend suite passes
110 tests, including mm/inch source and target conversions through real import,
metadata refresh, sidecar storage, table preview and viewer metadata. Existing
signed Z, table D and pocket values are preserved; `DCX` never replaces D.
The production build and focused ESLint checks pass. Native fixtures require no
running Fusion or LinuxCNC in CI. Seven browser tests pass against an isolated
mock gateway, covering the approximation notices, both import modes, measured
offset preservation and the existing holder preview behavior. The editor and
import screenshots were inspected; long notices wrap without covering fields
or being clipped.
