import * as THREE from "three";

export interface HolderSegment {
  height: number;
  lower_diameter: number;
  upper_diameter: number;
}

export interface ProfileSegment {
  end: [number, number];
  arc?: boolean;
  ccw?: boolean;
  center?: [number, number];
}

export interface ToolMeta {
  type?: string;
  oal?: number;
  flute_length?: number;
  shoulder_length?: number;
  shoulder_diameter?: number;
  body_length?: number;
  shaft_diameter?: number;
  taper_angle?: number;
  point_angle?: number;
  tip_diameter?: number;
  corner_radius?: number;
  holder_segments?: HolderSegment[];
  profile?: ProfileSegment[];
}

// ---- Parametric tool profile generation ----
// Builds 2D outline (radius vs height) for THREE.LatheGeometry.
// Tip at Y=0, extends upward. LatheGeometry revolves around Y axis.
// Returns profile points and fluteY (Y coordinate where cutting flutes end).
export function buildToolProfile(
  diam: number, len: number, meta: ToolMeta | null
): { pts: THREE.Vector2[], fluteY: number } {
  const r = Math.max(0.2, diam * 0.5);
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

  switch (type) {
    case "endmill":
    case "threadmill": {
      pts.push(V(0, 0), V(r, 0), V(r, fluteLen));
      if (Math.abs(shaftR - r) > 0.01) pts.push(V(shaftR, fluteLen));
      pts.push(V(shaftR, oal), V(0, oal));
      break;
    }
    case "slotmill": {
      // Slot mills may have corner radius (RE) — render like bullnose when present
      if (cornerR > 0.01) {
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
      if (Math.abs(shaftR - r) > 0.01) pts.push(V(shaftR, fluteLen));
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
      if (Math.abs(shaftR - r) > 0.01) pts.push(V(shaftR, fluteLen));
      pts.push(V(shaftR, oal), V(0, oal));
      break;
    }
    case "bullnose": {
      const cr = Math.min(cornerR || r * 0.2, r);
      const arcN = 8;
      const cylTop = Math.max(cr, bodyLen);
      pts.push(V(0, 0), V(r - cr, 0));
      for (let i = 1; i <= arcN; i++) {
        const a = (Math.PI / 2) * (i / arcN);
        pts.push(V(r - cr + cr * Math.sin(a), cr - cr * Math.cos(a)));
      }
      pts.push(V(r, cylTop));
      if (Math.abs(shaftR - r) > 0.01) pts.push(V(shaftR, cylTop));
      pts.push(V(shaftR, oal), V(0, oal));
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
      if (Math.abs(shaftR - arcTop) > 0.01) pts.push(V(shaftR, cr));
      pts.push(V(shaftR, cylTop));
      pts.push(V(shaftR, oal), V(0, oal));
      break;
    }
    case "drill": {
      const halfA = (pointAngle / 2) * (Math.PI / 180);
      // Support flat tip (spot drills have tip_diameter > 0)
      const tipH = (r - tipR) / Math.tan(halfA || 1);
      pts.push(V(0, 0));
      if (tipR > 0.01) pts.push(V(tipR, 0));
      pts.push(V(r, tipH), V(r, fluteLen));
      if (Math.abs(shaftR - r) > 0.01) pts.push(V(shaftR, fluteLen));
      pts.push(V(shaftR, oal), V(0, oal));
      break;
    }
    case "centerdrill": {
      // Center drill: small pilot point tip, then wider countersink body
      // point_angle = full included tip angle, taper_angle = full included body angle
      const tipHalfA = (pointAngle / 2) * (Math.PI / 180);
      const bodyHalfA = (taperAngle / 2) * (Math.PI / 180);
      const pilotR = tipR > 0.01 ? tipR : r * 0.3;
      const pilotH = pilotR / Math.tan(tipHalfA || 1);
      const bodyH = (r - pilotR) / Math.tan(bodyHalfA || 1);
      pts.push(V(0, 0), V(pilotR, pilotH), V(r, pilotH + bodyH), V(r, fluteLen));
      if (Math.abs(shaftR - r) > 0.01) pts.push(V(shaftR, fluteLen));
      pts.push(V(shaftR, oal), V(0, oal));
      break;
    }
    case "chamfer": {
      // taper_angle is full included angle (gateway doubled TA) — halve for slope
      const chamA = (taperAngle / 2) * (Math.PI / 180);
      const chamH = (r - tipR) / Math.tan(chamA || 1);
      pts.push(V(0, 0));
      if (tipR > 0.01) pts.push(V(tipR, 0));
      pts.push(V(r, chamH), V(r, fluteLen));
      if (Math.abs(shaftR - r) > 0.01) pts.push(V(shaftR, fluteLen));
      pts.push(V(shaftR, oal), V(0, oal));
      break;
    }
    case "countersink": {
      // Countersink cone angle comes from SIG (point_angle), not TA
      // point_angle is full included angle (gateway doubled SIG) — halve for slope
      const coneA = (pointAngle / 2) * (Math.PI / 180);
      const coneH = (r - tipR) / Math.tan(coneA || 1);
      pts.push(V(0, 0));
      if (tipR > 0.01) pts.push(V(tipR, 0));
      pts.push(V(r, coneH), V(r, fluteLen));
      if (Math.abs(shaftR - r) > 0.01) pts.push(V(shaftR, fluteLen));
      pts.push(V(shaftR, oal), V(0, oal));
      break;
    }
    case "tapered": {
      // BTL/Fusion model: DC = max cutting diameter (at top of flutes).
      // Taper narrows from DC/2 at fluteLen down to a small tip.
      // TA = half-angle per side from axis, no multiplication.
      // RE (cornerR) = ball radius at tip, centered on axis.
      const taperRad = taperAngle * (Math.PI / 180);

      pts.push(V(0, 0));
      if (cornerR > 0.01) {
        // Ball tip: center at (0, RE) on axis.
        // Arc from (0, 0) sweeping to tangent point with taper line.
        // Tangent point: (RE·cos(TA), RE·(1 − sin(TA)))
        const arcN = 10;
        const startA = -Math.PI / 2;  // bottom of ball at (0, 0)
        const endA = -taperRad;       // tangent to taper line
        for (let i = 1; i <= arcN; i++) {
          const a = startA + (endA - startA) * (i / arcN);
          pts.push(V(cornerR * Math.cos(a), cornerR + cornerR * Math.sin(a)));
        }
      } else {
        // Sharp tip
        pts.push(V(0.1, 0));
      }
      // Taper to DC/2 at top of flutes, then shaft to OAL
      pts.push(V(r, fluteLen));
      if (Math.abs(shaftR - r) > 0.01) pts.push(V(shaftR, fluteLen));
      pts.push(V(shaftR, oal), V(0, oal));
      break;
    }
    case "dovetail": {
      // DC = max cutting diameter (wide bottom). TA = cutting angle (full included,
      // gateway doubled). Neck narrows above based on angle and flute length.
      const doveHalfA = (taperAngle / 2) * (Math.PI / 180);
      const neckR = Math.max(0.5, r - fluteLen * Math.tan(doveHalfA || 0.3));
      pts.push(V(0, 0), V(r, 0), V(neckR, fluteLen));
      if (Math.abs(shaftR - neckR) > 0.01) pts.push(V(shaftR, fluteLen));
      pts.push(V(shaftR, oal), V(0, oal));
      break;
    }
    case "lollipop": {
      const ballR = r;
      const neckR2 = (tipR || shaftR || r * 0.4);
      const steps2 = 10;
      pts.push(V(0, 0));
      for (let i = 0; i <= steps2; i++) {
        const a = -Math.PI / 2 + Math.PI * (i / steps2);
        pts.push(V(ballR * Math.cos(a), ballR + ballR * Math.sin(a)));
      }
      pts.push(V(neckR2, ballR * 2), V(neckR2, fluteLen));
      if (Math.abs(shaftR - neckR2) > 0.01) pts.push(V(shaftR, fluteLen));
      pts.push(V(shaftR, oal), V(0, oal));
      break;
    }
    case "facemill": {
      const discH = Math.max(5, bodyLen * 0.3);
      const arbor = shaftR || r * 0.3;
      pts.push(V(0, 0), V(r, 0), V(r, discH));
      pts.push(V(arbor, discH), V(arbor, oal), V(0, oal));
      break;
    }
    case "probe": {
      const probeR = tipR || r * 0.2;
      const probeLen = fluteLen || oal * 0.5;
      pts.push(V(0, 0), V(probeR, 0), V(probeR, probeLen));
      pts.push(V(shaftR || r, probeLen), V(shaftR || r, oal), V(0, oal));
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
            if (dx * dx + dy * dy > 0.001) pts.push(V(ex, ey));
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
export function splitProfileAt(pts: THREE.Vector2[], splitY: number): { cutter: THREE.Vector2[], shaft: THREE.Vector2[] } {
  const eps = 0.01;
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
