# Remaining Fusion tool geometry work

Audited on 2026-09-12 at `96218e7`, with Fusion 2705.1.15. Scope: tool bodies,
without holders. Holder placement and machine calibration are deferred by the
user. This audit changes documentation only; the findings below are not fixes.

The review compared every importer mapping and renderer branch with all 76
committed native-post cases (71 usable contours across the fixture set), the
separate simulation/form references, installed Autodesk sample libraries, and
Autodesk's [supported tool list](https://help.autodesk.com/cloudhelp/ENU/Fusion-CAM/files/MFG-TOOL-LIBRARY-SUPPORTED-TOOLS.htm).
Nine additional detached tool JSON roundtrips checked type names and fields.
Their results and current-renderer reproductions are retained in
[the evidence record](fusion-tool-remaining-evidence.json).

Detached JSON acceptance does **not** establish a valid generated operation,
the geometric meaning of each field, or a matching native contour. No probe
selection parameter was accessed. Fusion remained in `SelectCommand`.

## 1. Concrete gaps in existing renderer branches

| Tool | Current finding | Required work and acceptance reference |
| --- | --- | --- |
| Bull nose end mill / torus cutter | Fusion retains `DC=10, RE=0`. The Suite evaluates `cornerR || r*0.2`, generating a 1 mm corner radius. Its first off-axis bottom point is radius 4 mm. | Distinguish an explicit zero from absent metadata. Capture a native zero-radius contour and compare it with a small positive radius, in mm and inch. Retain the existing imported physical length and shoulder/shaft behavior. |
| Face mill | Only the straight baseline and a shoulder variant are covered. A canonical `RE=0.5` changes tip diameter from 50 to 49 mm, but the Suite's entire profile is unchanged. With `TA=0.5°`, Fusion exports shoulder diameter 50.104722 mm; the Suite keeps radius 25 mm through LCF=6 mm and adds a step to the wider shoulder. | Obtain native contours varying angle, corner radius and shoulder independently, then determine the actual cutting flank and corner construction. Canonical dependent dimensions are evidence of missing behavior, not a substitute for the native contour. |
| Probe | The old profile traces the full ball to Z=6 mm and then goes backward to the stylus at radius 2.25 mm, Z=3 mm. It ignores the shared shoulder/custom-shaft construction. No native probe shape reference exists. | Establish the native ball/stylus junction and stem/shoulder contour using a library preview or an already valid probe operation. Use several ball/stem ratios and both units. Then replace the overlapping profile and verify topology. The documented `probe_selection.value` getter must not be retried. |

The probe's blocking condition concerns the native reference workflow, not access
to the repository or the MCP connection. The public `Tool` API reviewed here
exposes JSON and tool-block geometry, but no direct cutter-body mesh export.
Do not treat attached tool-block geometry as the probe body. See
[the prior native failure record](fusion-probe-api-failure.md).

## 2. Missing tool families

Autodesk documents four circle-segment families. The installed Fusion API also
roundtrips each exact type below unchanged. All currently import as `other` and
render as the generic cylinder. Their shape-specific fields are discarded by
the importer and cannot be recovered from existing sidecars without refreshing
the source export.

| Exact Fusion type | Additional exported geometry fields to investigate |
| --- | --- |
| `circle segment barrel` | `profile-radius`, `upper-radius`, `lower-radius`, `axial-distance` |
| `circle segment lens` | The same radius/distance fields, plus the interaction with `RE` and tip diameter |
| `circle segment oval` | Profile/lower radii and axial distance; determine which exported fields actually drive this subtype |
| `circle segment taper` | Profile/upper/lower radii, axial distance and `TA`; do not reuse the ordinary tapered-mill formula without a native reference |
| `corner chamfer end mill` | `chamfer-width`, `chamfer-angle`; this is distinct from the already supported `chamfer mill` |

The corner-chamfer type is evidenced by the installed `tool_isMill` expression
and a detached roundtrip; the reviewed public type list does not enumerate it.
Its appearance in the current interactive library creation UI was not tested.

For each family, the required sequence is:

1. Create a valid isolated native reference and confirm which export or
   simulation view actually includes its full outline.
2. Vary one shape parameter at a time, recording requested and canonical JSON.
   Determine arc centers, tangencies, axial reference points and angle meaning.
3. Add a type mapping and preserve the required fields through import, sidecar,
   metadata refresh and viewer payload. Scale linear fields with tool units;
   preserve angles as angles.
4. Add the profile construction and independent native-contour comparisons,
   including shoulder/custom-shaft combinations and unchanged measured offsets.

Until implemented, these types must not be described as faithfully reproduced.
Visible identification of unsupported/approximated imports should accompany
support expansion so a generic cylinder cannot be mistaken for a verified tool.

## 3. Smaller coverage and classification tasks

| Area | What is still required |
| --- | --- |
| Thread mills | Existing native simulations cover pointed/flat/round teeth at 60° and 90°, several radii and longer flute lengths. Add valid boundary cases for zero/large flat widths, near-limit round radii, a single tooth, other angles and the relation between LCF, pitch and tooth count. Record native normalization/rejection before deciding which inputs need support. Unsupported crest dimensions still fall back to a pointed envelope. |
| Form mills | Three physical profiles have native simulation evidence; compensation offsets 0/+10/-10 were also checked. Additional real exported profiles, especially major arcs and undercuts, need a native simulation comparison if they are to be included in the fidelity claim. The post's form-mill SVG remains unsuitable. Existing pure profile tests alone do not add native coverage. |
| Left-hand taps | Already map to the `tap` renderer. A detached Fusion roundtrip preserves the type and sets `HAND=false`; a native left/right exterior-profile pair is still missing. No separate body algorithm is yet justified by the evidence. |
| `block drill` | Recognized by the installed `tool_isDrill` expression and retained in JSON, but absent from the reviewed public type list and current Suite mapping. Establish its actual shape and supported use before mapping it to an ordinary drill; the detached input returned `SIG=0`. This is a classification task, not proof of a missing conical drill shape. |
| `engraving cutter` / `engraver` | The Suite has a legacy import mapping and menu label, but no dedicated renderer. This exact input type roundtrips to `unspecified` with zero geometry in Fusion 2705.1.15. Current Autodesk documentation and sample libraries use `chamfer mill` for engrave/chamfer tools, which is already supported. Do not count the legacy string as a confirmed missing current Fusion family or remove compatibility without checking old exports. |

The standard end, ball, bull-nose, drill/spot, counterbore, reamer, boring-bar,
countersink, center-drill, chamfer, dovetail, lollipop, slot, radius and tapered
families already have bounded native references. Coverage varies: several
families have only a single baseline. This supports those recorded cases, not
every combination of their parameters.

Turning tools, jet cutting and additive tools are separate manufacturing
families and are outside this milling/hole-making/probe review. Full helical
flutes, insert pockets and other non-axisymmetric detail are also beyond the
current rotational exterior model; they are not prerequisites for closing the
specific exterior-profile gaps listed here.

## Suggested execution order

First correct the bounded zero-radius behavior and obtain the missing face-mill
contours. Then establish a safe probe reference and correct its profile. Add
corner-chamfer and circle-segment families with their own parameter matrices.
Finish with the valid thread/form boundary cases and left-hand tap comparison.
No holder work or machine calibration is needed for these tasks.

Before claiming completion, each supported family must have an explicit set of
native reference cases and known limits. Build and regression checks remain
required for the implementation steps. This documentation-only audit ran the
real importer/renderer reproductions and native JSON reads; it did not rerun
the unchanged full test suite or claim new geometry tests passed.
