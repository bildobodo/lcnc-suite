import * as THREE from "three";

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
  corner_radius?: number | null;
  holder_segments?: HolderSegment[] | null;
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
  const eps = 0.01 * unitsPerMm;
  // Do not inflate small, valid cutters to an arbitrary minimum diameter.
  const r = Math.max(0, diam * 0.5);
  const type = meta?.type ?? "other";
  const fluteLen = meta?.flute_length ?? len * 0.6;
  const bodyLen = meta?.body_length ?? fluteLen;
  const shaftR = (meta?.shaft_diameter ?? diam) * 0.5;
  const oal = meta?.oal ?? len;
  const tipR = (meta?.tip_diameter ?? 0) * 0.5;
  const cornerR = meta?.corner_radius ?? 0;
  const pointAngle = meta?.point_angle ?? 118;
  const taperAngle = meta?.taper_angle ?? 45;

  const pts: THREE.Vector2[] = [];
  const V = (x: number, y: number) => new THREE.Vector2(Math.max(0, x), y);

  // The cutter ends at LCF; the shoulder extends to its own axial length.
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
    case "endmill":
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
        // Native CAM envelope: complete teeth spaced by TP, capped by NT and
        // LCF. A longer LCF adds neck, not more teeth. The post also emits this
        // pointed envelope for flat/round tips; their crest details remain
        // unverified and the corresponding metadata is preserved separately.
        const neckR = Math.max(0, r - pitch / (2 * Math.tan(angle * Math.PI / 360)));
        const count = Math.max(0, Math.min(Math.trunc(teeth), Math.floor(fluteLen / pitch + 1e-10)));
        pts.push(V(0, 0), V(neckR, 0));
        for (let i = 0; i < count; i++) {
          pts.push(V(r, (i + 0.5) * pitch), V(neckR, (i + 1) * pitch));
        }
        pts.push(V(neckR, fluteLen));
        appendShoulderAndShaft(neckR);
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
      // Slot mills may have corner radius (RE) — render like bullnose when present
      if (cornerR > eps) {
        const cr = Math.min(cornerR, r);
        const arcN = 8;
        pts.push(V(0, 0), V(r - cr, 0));
        for (let i = 1; i <= arcN; i++) {
          const a = (Math.PI / 2) * (i / arcN);
          pts.push(V(r - cr + cr * Math.sin(a), cr - cr * Math.cos(a)));
        }
        pts.push(V(r, fluteLen));
      } else {
        pts.push(V(0, 0), V(r, 0), V(r, fluteLen));
      }
      if (Math.abs(shaftR - r) > eps) pts.push(V(shaftR, fluteLen));
      pts.push(V(shaftR, oal), V(0, oal));
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
      const cr = Math.min(cornerR || r * 0.2, r);
      const arcN = 8;
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
      const cr = cornerR || r * 0.2;
      const arcN = 8;
      const arcTop = r + cr;
      const cylTop = Math.max(cr, bodyLen);
      pts.push(V(0, 0), V(r, 0));
      for (let i = 1; i <= arcN; i++) {
        const a = (Math.PI / 2) * (i / arcN);
        pts.push(V(r + cr * (1 - Math.cos(a)), cr * Math.sin(a)));
      }
      if (Math.abs(shaftR - arcTop) > eps) pts.push(V(shaftR, cr));
      pts.push(V(shaftR, cylTop));
      pts.push(V(shaftR, oal), V(0, oal));
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
      const pilotR = tipR > eps ? tipR : r * 0.3;
      const pilotH = pilotR / Math.tan(tipHalfA || 1);
      const bodyH = (r - pilotR) / Math.tan(bodyHalfA || 1);
      pts.push(V(0, 0), V(pilotR, pilotH), V(r, pilotH + bodyH), V(r, fluteLen));
      if (Math.abs(shaftR - r) > eps) pts.push(V(shaftR, fluteLen));
      pts.push(V(shaftR, oal), V(0, oal));
      break;
    }
    case "chamfer": {
      // taper_angle is full included angle (gateway doubled TA) — halve for slope
      const chamA = (taperAngle / 2) * (Math.PI / 180);
      const chamH = (r - tipR) / Math.tan(chamA || 1);
      pts.push(V(0, 0));
      if (tipR > eps) pts.push(V(tipR, 0));
      pts.push(V(r, chamH), V(r, fluteLen));
      if (Math.abs(shaftR - r) > eps) pts.push(V(shaftR, fluteLen));
      pts.push(V(shaftR, oal), V(0, oal));
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
      // Confirmed for the sharp, RE=0 dovetail; rounded edges remain future work.
      const sideAngle = taperAngle * Math.PI / 180;
      const neckR = Math.max(0, r - fluteLen * Math.tan(sideAngle));
      pts.push(V(0, 0), V(r, 0), V(neckR, fluteLen));
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
      pts.push(V(0, 0), V(r, 0), V(r, fluteLen));
      appendShoulderAndShaft(r);
      break;
    }
    case "probe": {
      // Full ball at tip (bottom at Y=0, center at Y=ballR) + stylus from center up
      const ballR = r;
      const stylusR = shaftR > eps && shaftR < ballR ? shaftR : ballR * 0.5;
      const arcN = 12;
      pts.push(V(0, 0));
      for (let i = 1; i <= arcN; i++) {
        const a = Math.PI * (i / arcN);  // 0→π full circle profile
        pts.push(V(ballR * Math.sin(a), ballR - ballR * Math.cos(a)));
      }
      // Stylus shaft from ball center (Y=ballR) up to OAL — overlaps ball, that's fine
      pts.push(V(stylusR, ballR), V(stylusR, oal), V(0, oal));
      break;
    }
    case "formmill": {
      const profile = meta?.profile;
      if (profile && profile.length >= 2) {
        let px = 0, py = 0;
        for (const seg of profile) {
          const [ex, ey] = seg.end;
          if (seg.arc && seg.center) {
            const [cx, cy] = seg.center;
            const arcR = Math.sqrt((px - cx) ** 2 + (py - cy) ** 2);
            const startA = Math.atan2(py - cy, px - cx);
            const endA = Math.atan2(ey - cy, ex - cx);
            let sweep = endA - startA;
            if (seg.ccw && sweep < 0) sweep += 2 * Math.PI;
            if (!seg.ccw && sweep > 0) sweep -= 2 * Math.PI;
            const steps = Math.max(8, Math.ceil(Math.abs(sweep) / (Math.PI / 12)));
            for (let i = 1; i <= steps; i++) {
              const a = startA + sweep * (i / steps);
              pts.push(V(cx + arcR * Math.cos(a), cy + arcR * Math.sin(a)));
            }
          } else {
            const dx = ex - px, dy = ey - py;
            if (dx * dx + dy * dy > 0.001 * unitsPerMm * unitsPerMm) pts.push(V(ex, ey));
          }
          px = ex; py = ey;
        }
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
  return { pts, fluteY: fluteLen };
}

/** Split a profile at the given Y coordinate into cutter (below) and shaft (above) sub-profiles */
export function splitProfileAt(pts: THREE.Vector2[], splitY: number, unitsPerMm = 1): { cutter: THREE.Vector2[], shaft: THREE.Vector2[] } {
  const eps = 0.01 * unitsPerMm;
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
  if (edgeR > eps) cutter.push(new THREE.Vector2(0, splitY));

  const shaft: THREE.Vector2[] = [new THREE.Vector2(0, splitY)];
  if (atBound.length > 1) {
    for (let i = 1; i < atBound.length; i++) shaft.push(atBound[i]!);
  } else if (above.length > 0) {
    const r = interpPt ? interpPt.x : edgeR;
    if (r > eps) shaft.push(new THREE.Vector2(r, splitY));
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

/** Build holder geometry from stacked frustum segments, starting at Z=toolOAL */
export function buildHolderGeometry(
  segments: HolderSegment[], toolOAL: number, latheSegments = 24
): THREE.LatheGeometry | null {
  if (!segments.length) return null;
  const pts: THREE.Vector2[] = [];
  let z = toolOAL;
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
