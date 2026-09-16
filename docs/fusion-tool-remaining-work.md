# Remaining Fusion tool geometry work

Status after the 2026-09-12 follow-up, Fusion 2705.1.15. The original audit was
performed at `96218e7` and committed at `c22b9a9`; its historical findings remain
in [the audit evidence](fusion-tool-remaining-evidence.json).

All items from that audit have now been investigated. Implementation details,
parameter meanings, native references and bounded remaining gaps are documented
in [the follow-up report](fusion-tool-followup.md).

| Area | Current result |
| --- | --- |
| Bull-nose / torus cutters | Explicit zero radius fixed; native zero/small/large radius contours checked. |
| Face mills | Lower/upper radii, side angle, maximum diameter `DCX`, actual head height, shoulders and custom shafts implemented and checked. `DCX` remains separate from tool-table D. |
| Corner-chamfer end mills | Own type and profile; width/angle, short flute and shaft variants checked. |
| Thread mills | Seventeen extra simulation cases. Single-tooth flat/round construction and JSON rounding at exact limits fixed; pitch/count/length boundaries checked. |
| Left-hand taps | Native matched left/right exterior pair agrees; shared tap profile retained. |
| Block drills | Regular Drill references established; own type with native flat-ended body. Requested point angles normalize to zero. |
| Form mills | Additional multi-undercut profile checked. Synthetic major/reversed arcs expose native serialization differences and are visibly flagged. |
| Probe | Self-intersecting approximate ball/stem surface fixed. Safe Drill/Custom reference attempt was rejected; native probe contour remains unresolved. |
| Circle-segment barrel/lens/oval/taper | Distinct import types and all shape metadata preserved. Still generic cylinder previews, visibly marked as approximations; native contour reference pending. |
| Legacy engraver | Compatibility retained, generic-cylinder preview identified. Current Fusion rejects the exact legacy type string; current chamfer-mill support is unchanged. |

The remaining work for a broader 1:1 exterior claim is:

1. Obtain native contours for the four circle-segment families, then derive and
   verify each subtype's tangencies, shoulder and shaft transitions. Trace does
   not support these tools; Multi-Axis Finishing is not generation-allowed in the
   present session. A native library preview is another possible reference.
2. Obtain a native probe preview or valid probe reference without the crashing
   selection getter, then verify the ball/stylus/shoulder/custom-shaft semantics.
3. Resolve the form serialization behavior for major arcs and reversed/backwards
   profiles using native library exports or a further controlled native study.
   Keep those separate from the four already checked physical form profiles.

The build, unit/integration tests and native comparisons do not imply that those
remaining families already match Fusion. Holders, machine calibration, turning,
jet/additive tools, helical flutes and other non-axisymmetric details remain
outside this tool-body follow-up.
