import type { ToolMeta } from "./toolGeometry";
import { toolTypeLabel } from "./toolTypes";

/** Plain metadata only: showing a notice must not eagerly load Three.js. */
export function toolPreviewNotice(meta: ToolMeta | null | undefined, unitsPerMm = 1): string | null {
  if (meta?.source_format === "freecad") {
    if (!meta.native_profile?.length && !meta.native_mesh) return "FreeCAD geometry missing. Import the library again.";
    const origin = Math.abs(meta.source_z_min ?? 0) > .0001 * unitsPerMm
      ? " Native CAM origin differs from the physical bottom; verify the probing reference for this tool." : "";
    return `${meta.geometry_note || "Evaluated FreeCAD shape."} Geometry stays fixed; edit it in FreeCAD and re-import. Cutting faces are not classified.${origin}`;
  }
  if (!meta?.type) return null;
  const type = meta.type;
  if (["circlebarrel", "circlelens", "circleoval", "circletaper", "probe"].includes(type)) {
    return `${toolTypeLabel(type)}: approximate preview; native contour not verified.`;
  }
  if (type === "other" || type === "engraver") {
    return `${meta.fusion_type || toolTypeLabel(type)}: generic cylinder preview.`;
  }
  if ((type === "formmill" && !meta.profile?.length)
      || (type === "threadmill" && (meta.thread_pitch == null || meta.thread_profile_angle == null))
      || (type === "cornerchamfer" && (meta.chamfer_width == null || meta.chamfer_angle == null))
      || (type === "facemill" && (meta.taper_angle ?? 0) > 0 && meta.maximum_cutting_diameter == null)) {
    return "Approximate preview: geometry metadata is incomplete. Refresh from the Fusion export.";
  }
  if (type === "threadmill") {
    const pitch = meta.thread_pitch ?? 0, angle = meta.thread_profile_angle ?? 0;
    const single = (meta.number_of_teeth ?? 1) === 1;
    const crest = meta.thread_tip_type;
    if (!Number.isFinite(pitch) || pitch <= 0 || !Number.isFinite(angle) || angle <= 0 || angle >= 180
        || !["point", "flat", "round"].includes(crest ?? "")
        || (crest === "flat" && (meta.thread_tip_width == null || !Number.isFinite(meta.thread_tip_width)
          || meta.thread_tip_width < 0 || meta.thread_tip_width > pitch / (single ? 1 : 2) + 1e-10 * unitsPerMm))
        || (crest === "round" && (meta.thread_tip_radius == null || !Number.isFinite(meta.thread_tip_radius)
          || meta.thread_tip_radius <= 0 || meta.thread_tip_radius > pitch / ((single ? 2 : 4)
            * Math.cos(angle * Math.PI / 360)) + 1e-6 * unitsPerMm))) {
      return "Approximate thread preview: crest geometry is missing or outside the supported range.";
    }
  }
  if (type === "formmill" && meta.profile?.length) {
    const profile = meta.profile;
    // Native simulation does not reproduce the literal outline for reversed
    // synthetic contours or major arcs. Keep rendering the supplied profile,
    // but do not silently present those cases as equivalent to Fusion.
    if (profile[0]!.end[1] !== 0 || profile.slice(1).some((segment, i) => {
      const start = profile[i]!.end;
      if (segment.end[1] < start[1]) return true;
      if (!segment.arc || !segment.center) return false;
      const [cx, cy] = segment.center;
      let sweep = Math.atan2(segment.end[1] - cy, segment.end[0] - cx)
        - Math.atan2(start[1] - cy, start[0] - cx);
      if (segment.ccw && sweep < 0) sweep += 2 * Math.PI;
      if (!segment.ccw && sweep > 0) sweep -= 2 * Math.PI;
      return Math.abs(sweep) > Math.PI + 1e-10;
    })) return "Form profile shown as exported; this contour is not verified against Fusion simulation.";
  }
  return null;
}
