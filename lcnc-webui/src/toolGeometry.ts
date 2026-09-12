import * as THREE from "three";
import { validHolderSegments } from "./toolHolder";

export interface ShaftSegment {
  height: number;
  lower_diameter: number;
  upper_diameter: number;
}

// Holders use the same frustum shape but have a separate assembly origin.
export type HolderSegment = ShaftSegment;

export interface ProfileSegment {
  end: [number, number];
  arc?: boolean;
  ccw?: boolean;
  center?: [number, number];
}

export interface ToolMeta {
  type?: string | null;
  source_format?: string | null;
  source_z_min?: number | null;
  native_profile?: [number, number][] | null;
  native_mesh?: { vertices: [number, number, number][]; triangles: [number, number, number][] } | null;
  geometry_note?: string | null;
  geometry_tolerance?: number | null;
  fusion_type?: string | null;
  tapered_type?: string | null;
  thread_pitch?: number | null;
  thread_pitch_min?: number | null;
  thread_pitch_max?: number | null;
  number_of_teeth?: number | null;
  thread_profile_angle?: number | null;
  thread_tip_type?: string | null;
  thread_tip_width?: number | null;
  thread_tip_radius?: number | null;
  shaft_segments?: ShaftSegment[] | null;
  oal?: number | null;
  flute_length?: number | null;
  shoulder_length?: number | null;
  shoulder_diameter?: number | null;
  body_length?: number | null;
  shaft_diameter?: number | null;
  taper_angle?: number | null;
  point_angle?: number | null;
  tip_diameter?: number | null;
  tip_length?: number | null;
  // CAM compensation metadata, separate from the physical outline and measured
  // length. Fusion already applies this to the verified form/Trace NC positions.
  tip_offset?: number | null;
  corner_radius?: number | null;
  maximum_cutting_diameter?: number | null;
  upper_radius?: number | null;
  chamfer_width?: number | null;
  chamfer_angle?: number | null;
  lower_radius?: number | null;
  profile_radius?: number | null;
  axial_distance?: number | null;
  holder_segments?: HolderSegment[] | null;
  holder_gauge_length?: number | null;
  assembly_gauge_length?: number | null;
  profile?: ProfileSegment[] | null;
}

// ---- Parametric tool profile generation ----
// Geometry inputs and outputs use machine units. Legacy visual thresholds and
// fallback sizes below are expressed in mm, independently of that machine unit.
// Builds 2D outline (radius vs height) for THREE.LatheGeometry.
// Tip at Y=0, extends upward. LatheGeometry revolves around Y axis.
// Returns profile points and fluteY (Y coordinate where cutting flutes end).
export function buildToolProfile(
  diam: number, len: number, meta: ToolMeta | null, unitsPerMm = 1
): { pts: THREE.Vector2[], fluteY: number } {
  if (meta?.native_profile?.length) {
    return { pts: meta.native_profile.map(([r, z]) => new THREE.Vector2(r, z)), fluteY: 0 };
  }
  const eps = 0.01 * unitsPerMm;
  // Do not inflate small, valid cutters to an arbitrary minimum diameter.
  const r = Math.max(0, diam * 0.5);
  const type = meta?.type ?? "other";
  const fluteLen = meta?.flute_length ?? len * 0.6;
  let fluteY = fluteLen;
  const shaftR = (meta?.shaft_diameter ?? diam) * 0.5;
  const oal = meta?.oal ?? len;
  const tipR = (meta?.tip_diameter ?? 0) * 0.5;
  const cornerR = meta?.corner_radius ?? 0;
  const pointAngle = meta?.point_angle ?? 118;
  const taperAngle = meta?.taper_angle ?? 45;

  const pts: THREE.Vector2[] = [];
  const V = (x: number, y: number) => new THREE.Vector2(Math.max(0, x), y);
  // Meridian arcs target 0.001 mm, with bounded allocation for extreme inputs.
  const arcSteps = (radius: number, sweep: number) => {
    const step = 4 * Math.asin(Math.sqrt(Math.min(1, 0.001 * unitsPerMm / (2 * radius))));
    return Math.min(4096, Math.max(6, Math.ceil(Math.abs(sweep) / step)));
  };

  // Continue from the actual cutting-profile end to the shoulder's axial length.
  // Custom shaft segments start there and are clipped at physical OAL. Neither
  // LB nor a measured installation length sets a shoulder/shaft coordinate.
  const appendShoulderAndShaft = (shoulderRadius: number) => {
    const end = pts[pts.length - 1]!;
    const shoulderY = Math.min(oal, Math.max(end.y, meta?.shoulder_length ?? end.y));
    const shoulderR = (meta?.shoulder_diameter ?? shoulderRadius * 2) / 2;
    pts.push(V(shoulderR, end.y), V(shoulderR, shoulderY));
    let z = shoulderY;
    let radius = shaftR;
    const segments = meta?.shaft_segments;
    if (segments?.length) {
      for (const seg of segments) {
        if (z >= oal) break;
        if (seg.height <= 0) continue;
        const height = Math.min(seg.height, oal - z);
        const lowerR = seg.lower_diameter / 2;
        radius = lowerR + (seg.upper_diameter / 2 - lowerR) * height / seg.height;
        pts.push(V(lowerR, z), V(radius, z + height));
        z += height;
      }
    } else {
      pts.push(V(radius, z));
    }
    if (z < oal) pts.push(V(radius, oal));
    pts.push(V(0, oal));
  };

  switch (type) {
    case "reamer":
    case "endmill":
    case "blockdrill":
    case "tap": {
      pts.push(V(0, 0), V(r, 0), V(r, fluteLen));
      appendShoulderAndShaft(r);
      break;
    }
    case "threadmill": {
      const pitch = meta?.thread_pitch;
      const angle = meta?.thread_profile_angle;
      const teeth = meta?.number_of_teeth ?? 1;
      if (pitch != null && pitch > 0 && Number.isFinite(pitch)
          && angle != null && angle > 0 && angle < 180 && Number.isFinite(teeth)) {
        // Native simulation, including crest/root flats and roundings. The
        // CAM post emits pointed teeth even when the simulation differs.
        const a = angle * Math.PI / 360;
        const cot = 1 / Math.tan(a);
        const neckR = Math.max(0, r - pitch * cot / 2);
        const count = Math.max(0, Math.min(Math.trunc(teeth), Math.floor(fluteLen / pitch + 1e-10)));
        const width = meta?.thread_tip_width;
        const radius = meta?.thread_tip_radius;
        const widthLimit = pitch / (teeth === 1 ? 1 : 2);
        const radiusLimit = pitch / ((teeth === 1 ? 2 : 4) * Math.cos(a));
        if (count > 0 && meta?.thread_tip_type === "flat" && width != null
            && Number.isFinite(width) && width >= 0 && width <= widthLimit + 1e-10 * unitsPerMm) {
          // Both the crest and root have axial width W. The crest ends at
          // half-pitch; flattening also increases the physical root radius.
          // Native JSON can round the exact limit upwards (0.8750000000000001).
          // Clamp only this floating-point boundary, consistently in mm/inch.
          const w = Math.min(width, widthLimit);
          const rootR = Math.max(0, r - (pitch / 2 - (teeth === 1 ? w / 2 : w)) * cot);
          pts.push(V(0, 0), V(rootR, 0));
          if (teeth === 1) {
            // A single crest is centered at half-pitch, without root flats.
            pts.push(V(r, (pitch - w) / 2), V(r, (pitch + w) / 2), V(rootR, pitch));
          } else {
            for (let i = 0; i < count; i++) {
              const z = i * pitch;
              pts.push(V(r, z + pitch / 2 - w), V(r, z + pitch / 2),
                V(rootR, z + pitch - w), V(rootR, z + pitch));
            }
          }
          pts.push(V(rootR, fluteLen));
          appendShoulderAndShaft(rootR);
        } else if (count > 0 && meta?.thread_tip_type === "round" && radius != null
            && Number.isFinite(radius) && radius > 0 && radius <= radiusLimit + 1e-6 * unitsPerMm
            && r - pitch * cot / 2 >= 0) {
          // Fusion rounds the exact radius limit to seven decimal places.
          const cr = Math.min(radius, radiusLimit);
          const offset = cr * Math.cos(a);
          const rootR = neckR + (teeth === 1 ? 1 : 2) * cr * (1 / Math.sin(a) - 1);
          const rootCenterR = rootR + cr;
          const arc = (cx: number, cy: number, start: number, sweep: number) => {
            const n = arcSteps(cr, sweep);
            for (let j = 0; j <= n; j++) {
              const theta = start + sweep * j / n;
              pts.push(V(cx + cr * Math.cos(theta), cy + cr * Math.sin(theta)));
            }
          };
          if (teeth === 1) {
            // One rounded crest, centered at half-pitch, with sharp roots.
            pts.push(V(0, 0), V(rootR, 0));
            arc(r - cr, pitch / 2, a - Math.PI / 2, Math.PI - 2 * a);
            pts.push(V(rootR, pitch));
          } else {
            pts.push(V(0, 0), V(rootCenterR - cr * Math.sin(a), 0));
            for (let i = 0; i < count; i++) {
              arc(r - cr, (i + 0.5) * pitch - offset, a - Math.PI / 2, Math.PI - 2 * a);
              // The final root ends at the arc's minimum radius. A longer LCF
              // adds a straight neck there; it does not add another tooth.
              arc(rootCenterR, (i + 1) * pitch - offset, -Math.PI / 2 - a,
                i === count - 1 ? a - Math.PI / 2 : 2 * a - Math.PI);
            }
          }
          fluteY = fluteLen - (teeth === 1 ? 0 : offset);
          pts.push(V(rootR, fluteY));
          appendShoulderAndShaft(rootR);
        } else {
          // Pointed tools, unavailable crest metadata and unsupported crest
          // dimensions retain the established native-post envelope.
          pts.push(V(0, 0), V(neckR, 0));
          for (let i = 0; i < count; i++) {
            pts.push(V(r, (i + 0.5) * pitch), V(neckR, (i + 1) * pitch));
          }
          pts.push(V(neckR, fluteLen));
          appendShoulderAndShaft(neckR);
        }
      } else {
        // Older sidecars have no pitch/angle: retain the legacy approximation
        // until those discarded fields can be refreshed from the source JSON.
        pts.push(V(0, 0), V(r, 0), V(r, fluteLen));
        if (Math.abs(shaftR - r) > eps) pts.push(V(shaftR, fluteLen));
        pts.push(V(shaftR, oal), V(0, oal));
      }
      break;
    }
    case "slotmill": {
      // Native slot contours round both edges. If LCF < 2*RE, Fusion keeps
      // LCF in the metadata but extends the physical head to fit both arcs.
      const cr = Math.min(Math.max(0, cornerR), r);
      if (cr > 0) {
        const top = Math.max(fluteLen, 2 * cr);
        // Quarter circles with a 0.001 mm chord target, bounded for extreme
        // inputs. At least six steps also keeps small radii visibly rounded.
        const angleStep = 4 * Math.asin(Math.sqrt(Math.min(1, 0.001 * unitsPerMm / (2 * cr))));
        const arcN = Math.min(4096, Math.max(6, Math.ceil(Math.PI / 2 / angleStep)));
        pts.push(V(0, 0), V(r - cr, 0));
        for (let i = 1; i <= arcN; i++) {
          const a = (Math.PI / 2) * (i / arcN);
          pts.push(V(r - cr + cr * Math.sin(a), cr - cr * Math.cos(a)));
        }
        pts.push(V(r, top - cr));
        for (let i = 1; i <= arcN; i++) {
          const a = (Math.PI / 2) * (i / arcN);
          pts.push(V(r - cr + cr * Math.cos(a), top - cr + cr * Math.sin(a)));
        }
      } else {
        pts.push(V(0, 0), V(r, 0), V(r, fluteLen));
      }
      appendShoulderAndShaft(shaftR);
      break;
    }
    case "ball": {
      const steps = 12;
      pts.push(V(0, 0));
      for (let i = 1; i <= steps; i++) {
        const a = (Math.PI / 2) * (1 - i / steps);
        pts.push(V(r * Math.cos(a), r - r * Math.sin(a)));
      }
      pts.push(V(r, fluteLen));
      appendShoulderAndShaft(r);
      break;
    }
    case "bullnose": {
      const cr = Math.min(Math.max(0, meta?.corner_radius ?? r * 0.2), r);
      const arcN = cr > 0 ? arcSteps(cr, Math.PI / 2) : 0;
      const cylTop = Math.max(cr, fluteLen);
      pts.push(V(0, 0), V(r - cr, 0));
      for (let i = 1; i <= arcN; i++) {
        const a = (Math.PI / 2) * (i / arcN);
        pts.push(V(r - cr + cr * Math.sin(a), cr - cr * Math.cos(a)));
      }
      pts.push(V(r, cylTop));
      appendShoulderAndShaft(r);
      break;
    }
    case "radiusmill": {
      const cr = Math.max(0, meta?.corner_radius ?? r * 0.2);
      const arcN = cr > 0 ? arcSteps(cr, Math.PI / 2) : 0;
      const arcTop = r + cr;
      pts.push(V(0, 0), V(r, 0));
      for (let i = 1; i <= arcN; i++) {
        const a = (Math.PI / 2) * (i / arcN);
        pts.push(V(r + cr * (1 - Math.cos(a)), cr * Math.sin(a)));
      }
      pts.push(V(arcTop, Math.max(cr, fluteLen)));
      appendShoulderAndShaft(arcTop);
      break;
    }
    case "drill": {
      const halfA = (pointAngle / 2) * (Math.PI / 180);
      // Support flat tip (spot drills have tip_diameter > 0)
      const tipH = (r - tipR) / Math.tan(halfA || 1);
      pts.push(V(0, 0));
      if (tipR > eps) pts.push(V(tipR, 0));
      pts.push(V(r, tipH), V(r, fluteLen));
      appendShoulderAndShaft(r);
      break;
    }
    case "centerdrill": {
      // Center drill: small pilot point tip, then wider countersink body
      // point_angle = full included tip angle, taper_angle = full included body angle
      const tipHalfA = (pointAngle / 2) * (Math.PI / 180);
      const bodyHalfA = (taperAngle / 2) * (Math.PI / 180);
      const pilotR = meta?.tip_diameter != null ? tipR : r * 0.3;
      const pilotH = pilotR / Math.tan(tipHalfA || 1);
      const pilotEnd = Math.max(pilotH, meta?.tip_length ?? pilotH);
      const bodyH = (r - pilotR) / Math.tan(bodyHalfA || 1);
      pts.push(V(0, 0), V(pilotR, pilotH), V(pilotR, pilotEnd),
        V(r, pilotEnd + bodyH), V(r, Math.max(fluteLen, pilotEnd + bodyH)));
      appendShoulderAndShaft(r);
      break;
    }
    case "cornerchamfer": {
      // Width is radial. This angle is measured from the bottom plane, unlike
      // the ordinary chamfer mill's included cone angle.
      const width = Math.min(r, Math.max(0, meta?.chamfer_width ?? 0));
      const angle = (meta?.chamfer_angle ?? 45) * Math.PI / 180;
      const height = width * Math.tan(angle);
      pts.push(V(0, 0), V(r - width, 0), V(r, height), V(r, Math.max(height, fluteLen)));
      appendShoulderAndShaft(r);
      break;
    }
    case "chamfer": {
      // taper_angle is full included angle (gateway doubled TA) — halve for slope
      const chamA = (taperAngle / 2) * (Math.PI / 180);
      const slope = Math.tan(chamA || 1);
      const chamH = (r - tipR) / slope;
      const neckR = Math.min(r, (meta?.shoulder_diameter ?? shaftR * 2) / 2);
      // The return flank starts at the widest point, using the same side angle.
      // A longer LCF adds neck; a shorter LCF does not clip either conical flank.
      const returnY = chamH + (r - neckR) / slope;
      pts.push(V(0, 0));
      if (tipR > 0) pts.push(V(tipR, 0));
      pts.push(V(r, chamH), V(neckR, returnY), V(neckR, Math.max(returnY, fluteLen)));
      appendShoulderAndShaft(neckR);
      break;
    }
    case "countersink": {
      // Countersink cone angle comes from SIG (point_angle), not TA
      // Fusion SIG / point_angle is already the full included angle.
      const coneA = (pointAngle / 2) * (Math.PI / 180);
      const coneH = (r - tipR) / Math.tan(coneA || 1);
      pts.push(V(0, 0));
      if (tipR > eps) pts.push(V(tipR, 0));
      pts.push(V(r, coneH), V(r, fluteLen));
      appendShoulderAndShaft(r);
      break;
    }
    case "tapered": {
      // DC is the unfilleted diameter at z=0; TA is the side angle.
      // Bull nose: circle centre is offset from the axis. Ball: on-axis centre.
      // Fusion normalizes DC to the ball's tangent-cone intercept for that subtype.
      const taperRad = taperAngle * (Math.PI / 180);
      const sinA = Math.sin(taperRad), cosA = Math.cos(taperRad);
      const flatR = meta?.tapered_type === "tapered_ball" ? 0
        : Math.max(0, r - cornerR * (1 - sinA) / cosA);
      pts.push(V(0, 0));
      if (flatR > 0) pts.push(V(flatR, 0));
      if (cornerR > 0) {
        const arcN = 24;
        for (let i = 1; i <= arcN; i++) {
          const a = -Math.PI / 2 + (Math.PI / 2 - taperRad) * i / arcN;
          pts.push(V(flatR + cornerR * Math.cos(a), cornerR * (1 + Math.sin(a))));
        }
      }
      const coneR = flatR + cornerR * (1 - sinA) / cosA;
      const fluteR = coneR + fluteLen * Math.tan(taperRad);
      pts.push(V(fluteR, fluteLen));
      appendShoulderAndShaft(fluteR);
      break;
    }
    case "dovetail": {
      // Fusion TA is the side angle here (unmodified by the importer).
      const sideAngle = taperAngle * Math.PI / 180;
      const cr = Math.min(r, Math.max(0, cornerR));
      const flatR = r - cr;
      pts.push(V(0, 0), V(flatR, 0));
      if (cr > 0) {
        const sweep = Math.PI / 2 + sideAngle;
        const steps = arcSteps(cr, sweep);
        for (let i = 1; i <= steps; i++) {
          const a = -Math.PI / 2 + sweep * i / steps;
          pts.push(V(flatR + cr * Math.cos(a), cr * (1 + Math.sin(a))));
        }
      }
      const coneR = flatR + cr * (1 + Math.sin(sideAngle)) / Math.cos(sideAngle);
      const endY = Math.max(fluteLen, pts[pts.length - 1]!.y);
      const neckR = Math.max(0, coneR - endY * Math.tan(sideAngle));
      pts.push(V(neckR, endY));
      appendShoulderAndShaft(neckR);
      break;
    }
    case "lollipop": {
      // Trim the sphere where it meets the neck, rather than closing the ball
      // at 2R and doubling back to LCF. A custom shaft's first diameter is at
      // the shoulder; Fusion also exports this as shoulder-diameter.
      const neckR = Math.min(r, (meta?.shoulder_diameter
        ?? meta?.shaft_segments?.[0]?.lower_diameter ?? shaftR * 2) / 2);
      const endAngle = r > 0 ? Math.acos(neckR / r) : 0;
      const arcN = 64;
      pts.push(V(0, 0));
      for (let i = 1; i <= arcN; i++) {
        const a = -Math.PI / 2 + (endAngle + Math.PI / 2) * i / arcN;
        pts.push(V(r * Math.cos(a), r + r * Math.sin(a)));
      }
      pts.push(V(neckR, Math.max(fluteLen, pts[pts.length - 1]!.y)));
      appendShoulderAndShaft(neckR);
      break;
    }
    case "facemill": {
      // DC is the unfilleted cone intercept; DCX is the maximum head diameter.
      // Keep them separate: LinuxCNC's D continues to come from DC. TA is the
      // side angle. An upper radius rounds the cone into the vertical maximum
      // diameter, rather than rounding the horizontal shoulder return.
      const a = (meta?.taper_angle ?? 0) * Math.PI / 180;
      const cr = Math.max(0, cornerR);
      const upper = Math.max(0, meta?.upper_radius ?? 0);
      const maxR = (meta?.maximum_cutting_diameter ?? (diam + 2 * fluteLen * Math.tan(a))) / 2;
      const flatR = Math.max(0, r - cr * (1 - Math.sin(a)) / Math.cos(a));
      pts.push(V(0, 0), V(flatR, 0));
      if (cr > 0) {
        const n = arcSteps(cr, Math.PI / 2 - a);
        for (let i = 1; i <= n; i++) {
          const theta = -Math.PI / 2 + (Math.PI / 2 - a) * i / n;
          pts.push(V(flatR + cr * Math.cos(theta), cr * (1 + Math.sin(theta))));
        }
      }
      if (a > 0 && a < Math.PI / 2) {
        const top = Math.max(pts[pts.length - 1]!.y,
          (maxR - r) / Math.tan(a) + upper * Math.tan(a / 2));
        if (upper > 0) {
          const n = arcSteps(upper, a);
          for (let i = 0; i <= n; i++) {
            const theta = -a + a * i / n;
            pts.push(V(maxR - upper + upper * Math.cos(theta), top + upper * Math.sin(theta)));
          }
        } else pts.push(V(maxR, top));
      } else pts.push(V(r, Math.max(cr, fluteLen)));
      fluteY = pts[pts.length - 1]!.y;
      appendShoulderAndShaft(r);
      break;
    }
    case "probe": {
      // Approximate ball/stylus union; a native probe reference is still missing.
      // Trim at the stem intersection so the lathed outline does not double
      // back through the sphere. Keep the legacy stem-size fallback until the
      // actual Fusion shoulder/stylus semantics have an independent reference.
      const ballR = r;
      const stylusR = shaftR > eps && shaftR < ballR ? shaftR : ballR * 0.5;
      const sweep = ballR > 0 ? Math.PI / 2 + Math.acos(stylusR / ballR) : 0;
      const arcN = ballR > 0 ? arcSteps(ballR, sweep) : 0;
      pts.push(V(0, 0));
      for (let i = 1; i <= arcN; i++) {
        const a = sweep * i / arcN;
        pts.push(V(ballR * Math.sin(a), ballR - ballR * Math.cos(a)));
      }
      const top = Math.max(oal, pts[pts.length - 1]!.y);
      pts.push(V(stylusR, top), V(0, top));
      break;
    }
    case "formmill": {
      const profile = meta?.profile;
      if (profile && profile.length >= 2) {
        // Fusion serializes a closed half-profile: the first end is the start
        // point, including the axis point that closes the bottom of the tool.
        // Preserve short segments and exact exported arc endpoints.
        let [px, py] = profile[0]!.end;
        pts.push(V(px, py));
        const chordTolerance = 0.001 * unitsPerMm;
        for (const seg of profile.slice(1)) {
          const [ex, ey] = seg.end;
          if (seg.arc && seg.center) {
            const [cx, cy] = seg.center;
            const arcR = Math.sqrt((px - cx) ** 2 + (py - cy) ** 2);
            const startA = Math.atan2(py - cy, px - cx);
            const endA = Math.atan2(ey - cy, ex - cx);
            let sweep = endA - startA;
            if (ex === px && ey === py) {
              sweep = seg.ccw ? 2 * Math.PI : -2 * Math.PI;
            } else {
              if (seg.ccw && sweep < 0) sweep += 2 * Math.PI;
              if (!seg.ccw && sweep > 0) sweep -= 2 * Math.PI;
            }
            if (arcR > 0) {
              const maxStep = Math.min(Math.PI / 12,
                4 * Math.asin(Math.sqrt(Math.min(1, chordTolerance / (2 * arcR)))));
              // Target a 1 micron chord error, with a finite allocation bound
              // for extreme input radii. asin avoids cancellation at tiny ratios.
              const steps = Math.min(4096, Math.max(1, Math.ceil(Math.abs(sweep) / maxStep)));
              for (let i = 1; i < steps; i++) {
                const a = startA + sweep * (i / steps);
                pts.push(V(cx + arcR * Math.cos(a), cy + arcR * Math.sin(a)));
              }
            }
          }
          if (seg.arc || ex !== px || ey !== py) pts.push(V(ex, ey));
          px = ex; py = ey;
        }
        // The usual axis-to-axis profile already describes both end caps.
        // For an off-axis closed profile (e.g. an annular section), include
        // its implicit closing edge as well.
        const first = pts[0]!, last = pts[pts.length - 1]!;
        if ((first.x !== 0 || last.x !== 0) && !first.equals(last)) pts.push(first.clone());
        // Either sketch traversal describes the same solid. LatheGeometry needs
        // positive winding to produce outward-facing surfaces.
        const area2 = pts.reduce((sum, p, i) => {
          const next = pts[(i + 1) % pts.length]!;
          return sum + p.x * next.y - next.x * p.y;
        }, 0);
        if (area2 < 0) pts.reverse();
      } else {
        pts.push(V(0, 0), V(r, 0), V(r, oal), V(0, oal));
      }
      break;
    }
    default: {
      pts.push(V(0, 0), V(r, 0), V(r, oal), V(0, oal));
      break;
    }
  }
  return { pts, fluteY };
}

/** Shared mesh inputs for both viewers. A form tool's closed outline can have
 * undercuts and multiple crossings of LCF. Keep its topology intact as one
 * cutting body; LCF describes Fusion's approximating end mill, not a verified
 * boundary between cutting and non-cutting regions of the custom profile. */
export function buildToolParts(diam: number, len: number, meta: ToolMeta | null, unitsPerMm = 1)
  : { cutter: THREE.Vector2[], shaft: THREE.Vector2[] } {
  const { pts, fluteY } = buildToolProfile(diam, len, meta, unitsPerMm);
  if (meta?.type === "formmill" && meta.profile && meta.profile.length >= 2) {
    return { cutter: pts, shaft: [] };
  }
  return splitProfileAt(pts, fluteY, unitsPerMm);
}

/** Shared evaluated geometry for both viewers. Imported native bodies are kept
 * whole: FreeCAD does not classify their cutting faces. No length/diameter edit
 * stretches a source mesh or changes its physical tip origin. */
export function buildToolGeometries(diam: number, len: number, meta: ToolMeta | null, unitsPerMm = 1)
  : { cutter: THREE.BufferGeometry | null, shaft: THREE.BufferGeometry | null } {
  if (meta?.native_mesh) {
    const mesh = meta.native_mesh;
    const indexed = new THREE.BufferGeometry();
    indexed.setAttribute("position", new THREE.Float32BufferAttribute(mesh.vertices.flat(), 3));
    indexed.setIndex(mesh.triangles.flat());
    // Flat normals preserve edges of arbitrary custom shapes, including holes.
    const geometry = indexed.toNonIndexed();
    indexed.dispose();
    geometry.computeVertexNormals();
    return { cutter: null, shaft: geometry };
  }
  if (meta?.native_profile?.length) {
    const { pts } = buildToolProfile(diam, len, meta, unitsPerMm);
    // Keep circumferential tessellation within the same 0.01 mm target as the
    // exporter, with a bounded segment count for large saw blades.
    const radius = Math.max(...meta.native_profile.map(p => p[0]));
    const step = 2 * Math.acos(Math.max(-1, 1 - .01 * unitsPerMm / radius));
    const segments = Math.min(512, Math.max(48, Math.ceil(2 * Math.PI / step)));
    return { cutter: null, shaft: buildToolGeometry(pts, segments) };
  }
  const { cutter, shaft } = buildToolParts(diam, len, meta, unitsPerMm);
  return { cutter: cutter.length >= 3 ? buildToolGeometry(cutter) : null,
    shaft: shaft.length >= 3 ? buildToolGeometry(shaft) : null };
}

/** Split a profile at the given Y coordinate into cutter (below) and shaft (above) sub-profiles */
export function splitProfileAt(pts: THREE.Vector2[], splitY: number, unitsPerMm = 1): { cutter: THREE.Vector2[], shaft: THREE.Vector2[] } {
  // This is a topological split, not a visual simplification. A 0.01 mm band
  // would assign small fillets to the split plane and create slanted end caps.
  const eps = 1e-10 * unitsPerMm;
  const below: THREE.Vector2[] = [];
  const atBound: THREE.Vector2[] = [];
  const above: THREE.Vector2[] = [];
  let interpPt: THREE.Vector2 | null = null;

  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    if (p.y < splitY - eps) {
      below.push(p.clone());
      const next = pts[i + 1];
      if (next && next.y > splitY + eps) {
        const t = (splitY - p.y) / (next.y - p.y);
        interpPt = new THREE.Vector2(Math.max(0, p.x + t * (next.x - p.x)), splitY);
      }
    } else if (Math.abs(p.y - splitY) <= eps) {
      atBound.push(p.clone());
    } else {
      above.push(p.clone());
    }
  }

  const cutter = [...below];
  if (interpPt) cutter.push(interpPt);
  if (atBound.length > 0) cutter.push(atBound[0]!);
  const edgeR = cutter.length > 0 ? cutter[cutter.length - 1]!.x : 0;
  if (edgeR > 0) cutter.push(new THREE.Vector2(0, splitY));

  const shaft: THREE.Vector2[] = [new THREE.Vector2(0, splitY)];
  if (atBound.length > 1) {
    for (let i = 1; i < atBound.length; i++) shaft.push(atBound[i]!);
  } else if (above.length > 0) {
    const r = interpPt ? interpPt.x : edgeR;
    if (r > 0) shaft.push(new THREE.Vector2(r, splitY));
  }
  shaft.push(...above);

  return { cutter, shaft };
}

/** Build LatheGeometry from 2D profile, rotated to Z-up with tip at Z=0 */
export function buildToolGeometry(profile: THREE.Vector2[], segments = 24): THREE.LatheGeometry {
  const geom = new THREE.LatheGeometry(profile, segments);
  geom.rotateX(Math.PI / 2);
  return geom;
}

/** Stack the full holder outline at an explicitly supplied tip-relative base.
 * Nominal Fusion previews supply LB. No installed placement is inferred here.
 * Gauge length describes a reference plane and must not clip the outline.
 */
export function buildHolderGeometry(
  segments: HolderSegment[], baseZ: number, latheSegments = 24
): THREE.LatheGeometry | null {
  if (!validHolderSegments(segments) || !Number.isFinite(baseZ)) return null;
  const pts: THREE.Vector2[] = [];
  let z = baseZ;
  pts.push(new THREE.Vector2(0, z));
  for (const seg of segments) {
    pts.push(new THREE.Vector2(seg.lower_diameter * 0.5, z));
    z += seg.height;
    pts.push(new THREE.Vector2(seg.upper_diameter * 0.5, z));
  }
  pts.push(new THREE.Vector2(0, z));
  const geom = new THREE.LatheGeometry(pts, latheSegments);
  geom.rotateX(Math.PI / 2);
  return geom;
}
