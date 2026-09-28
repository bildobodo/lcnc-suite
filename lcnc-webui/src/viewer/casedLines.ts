// Cased edges (fixed viewer palette P2, operator 2026-09-28, Codex R30): a
// light neutral CORE on a dark CASING — the only cased lines in the viewer,
// the machine-bounds and toolpath-bounds boxes. The core reads on a dark
// background, the casing on a light one and on the lit table, so one pair of
// colours holds in every theme; a cased line is told from every path line by
// its structure, not by a hue. Dense path lines are never cased (core plus
// casing are 3 px — neighbouring paths would merge).
//
// Both passes are screen-space lines (LineSegments2) over ONE geometry, so a
// dashed box dashes core and casing with the same gaps (a solid casing under
// a dashed core would blur the dash again). Widths are CSS px; both respect
// depth (a box never hides a path in front of it), the casing writes none.
import * as THREE from "three";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";

/** The core's width, CSS px — the path's 1 px. */
export const CASED_CORE_PX = 1;
/** Core plus one casing pixel on each side, CSS px. */
export const CASED_TOTAL_PX = 3;

export interface CasedEdgesOptions {
  core: string;
  casing: string;
  /** The core's palette role (`userData.role`); the casing is `${role}Casing`. */
  role: string;
  /** Dash and gap in the edges' local units; absent = solid. */
  dashed?: { dash: number; gap: number };
  clippingPlanes?: THREE.Plane[];
}

export interface CasedEdges extends THREE.Group {
  setColors(core: string, casing: string): void;
}

/** A group of two LineSegments2 over the edges' segment pairs: the casing
 *  (drawn first) and the core. The source geometry is copied, not kept. */
export function makeCasedEdges(edges: THREE.BufferGeometry, o: CasedEdgesOptions): CasedEdges {
  const geom = new LineSegmentsGeometry().setPositions(edges.getAttribute("position").array as Float32Array);
  const mat = (color: string, width: number, role: string) => {
    const m = new LineMaterial({ color, linewidth: width, worldUnits: false });
    m.userData.role = role;
    if (o.dashed) {
      m.dashed = true;
      m.dashSize = o.dashed.dash;
      m.gapSize = o.dashed.gap;
    }
    if (o.clippingPlanes) m.clippingPlanes = o.clippingPlanes;
    return m;
  };
  const casingMat = mat(o.casing, CASED_TOTAL_PX, `${o.role}Casing`);
  casingMat.depthWrite = false;
  const coreMat = mat(o.core, CASED_CORE_PX, o.role);
  const group = new THREE.Group() as CasedEdges;
  for (const [m, order] of [[casingMat, 0], [coreMat, 1]] as const) {
    const line = new LineSegments2(geom, m);
    line.renderOrder = order;
    line.onBeforeRender = (renderer) => { renderer.getSize(m.resolution); };
    group.add(line);
  }
  // One distance attribute on the shared geometry: both passes dash alike.
  if (o.dashed) (group.children[0] as LineSegments2).computeLineDistances();
  group.setColors = (core, casing) => { coreMat.color.set(core); casingMat.color.set(casing); };
  return group;
}
