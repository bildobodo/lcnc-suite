// Backplot controller (frontend split, A3 — extracted from ThreeViewer.vue).
//
// The backplot is the live tool-history trail in WORK coordinates. Owns its own
// line/geometry and the ring cursor; the orchestrator (ThreeViewer) computes the
// tool-tip's work-local position each tick and calls push().
//
// Drawn 2 CSS px wide (viewer contrast plan, E11): the width ladder — path 1 px,
// backplot 2 px — is the FORM cue that tells the executed
// path from the programmed one and from the limit overlay (feed and backplot
// differ in lightness by only ~1.15 : 1, and colour alone is no cue for
// colour-blind eyes). WebGL draws core lines 1 px wide everywhere, so the trail
// is a screen-space fat line (LineSegments2): a RING OF SEGMENTS, each the pair
// of two consecutive history points — independent instances, so the ring never
// needs linearising, a wrap can never join the newest point to the oldest, and a
// push uploads only what was written since the last upload (one covering range).
//
// Factory pattern (per the A3 plan): created once in <script setup>, closes over
// the STABLE requestRender (a plain function, never reassigned). The parent
// group IS reassigned every scene rebuild, so build() takes it per-call and is
// re-invoked from ensureCoreGroups — the controller never caches a parent.
import * as THREE from "three";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";

const BACKPLOT_MAX = 20000;   // points (10 Hz -> ~33 min)
const SEG_MAX = BACKPLOT_MAX - 1;   // segments between them
const BACKPLOT_EPS = 0.01;    // mm; min distance before adding a point
/** The backplot's width in CSS px — twice the path's 1 px line. */
export const BACKPLOT_WIDTH_PX = 2;

export interface BackplotController {
  /** Build a fresh line under `parent` (call once per scene rebuild). */
  build(parent: THREE.Object3D, color: string, depthTest: boolean): void;
  push(x: number, y: number, z: number): void;
  reset(): void;
  setVisible(on: boolean): void;
  setColor(color: string): void;
  setDepthTest(depthTest: boolean): void;
  dispose(): void;
  readonly count: number;
  readonly isFull: boolean;
}

export function createBackplotController(requestRender: () => void): BackplotController {
  let line: LineSegments2 | null = null;
  let geom: LineSegmentsGeometry | null = null;
  let buf: THREE.InstancedInterleavedBuffer | null = null;
  let count = 0;            // points in the window, 0..BACKPLOT_MAX
  let segs = 0;             // segments in the ring, 0..SEG_MAX (= count - 1 once drawing)
  let head = 0;             // next segment slot, 0..SEG_MAX-1
  // Scalar dedup anchor and the previous point (no retained Vector3 → no per-point allocation).
  let lastX = 0, lastY = 0, lastZ = 0, hasLast = false;

  function reset() {
    count = 0;
    segs = 0;
    head = 0;
    hasLast = false;
    if (geom) geom.instanceCount = 0;   // keep the allocation, draw nothing
    buf?.clearUpdateRanges();           // nothing pending of the cleared trail
    requestRender();
  }

  return {
    build(parent, color, depthTest) {
      geom = new LineSegmentsGeometry();
      // One interleaved record per segment: start xyz, end xyz.
      buf = new THREE.InstancedInterleavedBuffer(new Float32Array(SEG_MAX * 6), 6, 1);
      buf.setUsage(THREE.DynamicDrawUsage);
      geom.setAttribute("instanceStart", new THREE.InterleavedBufferAttribute(buf, 3, 0));
      geom.setAttribute("instanceEnd", new THREE.InterleavedBufferAttribute(buf, 3, 3));
      geom.instanceCount = 0;

      const mat = new LineMaterial({ color, linewidth: BACKPLOT_WIDTH_PX, worldUnits: false, depthTest, depthWrite: false });
      mat.userData.role = "backplot";   // the viewer palette's role (diagnostics read it)
      line = new LineSegments2(geom, mat);
      line.renderOrder = 11;
      line.frustumCulled = false;   // ✅ prevents disappearing when origin is off-screen
      // The width is screen pixels: the material learns the drawing size right before each draw.
      line.onBeforeRender = (renderer) => { renderer.getSize(mat.resolution); };
      parent.add(line);

      reset();
    },

    push(x, y, z) {
      if (!geom || !buf || !line) return;

      if (hasLast) {
        const dx = x - lastX, dy = y - lastY, dz = z - lastZ;
        if (dx * dx + dy * dy + dz * dz < BACKPLOT_EPS * BACKPLOT_EPS) return;
        // The segment from the previous point to this one, into the next ring slot.
        const a = head * 6, arr = buf.array as Float32Array;
        arr[a] = lastX; arr[a + 1] = lastY; arr[a + 2] = lastZ;
        arr[a + 3] = x; arr[a + 4] = y; arr[a + 5] = z;
        // ONE pending range covering every segment written since the last
        // upload (codex review round 3, VK-I01): a hidden trail is never
        // rendered, so a range per point grew without bound; covering them
        // keeps it at one — at worst the whole ring on the next upload.
        const pending = buf.updateRanges[0];
        if (!pending) buf.addUpdateRange(a, 6);
        else {
          const end = Math.max(pending.start + pending.count, a + 6);
          pending.start = Math.min(pending.start, a);
          pending.count = end - pending.start;
        }
        buf.needsUpdate = true;
        head = (head + 1) % SEG_MAX;
        if (segs < SEG_MAX) segs++;
        geom.instanceCount = segs;
      }
      if (count < BACKPLOT_MAX) count++;
      lastX = x; lastY = y; lastZ = z; hasLast = true;
    },

    reset,

    setVisible(on) { if (line) line.visible = on; },

    setColor(color) { if (line) (line.material as LineMaterial).color.set(color); },

    setDepthTest(depthTest) {
      if (line) {
        const m = line.material as LineMaterial;
        m.depthTest = depthTest;
        m.depthWrite = false; // backplot is transparent, never write depth
        m.needsUpdate = true;
      }
    },

    dispose() {
      if (line) {
        line.parent?.remove(line);
        (line.material as THREE.Material).dispose();  // created in build(), owned here
      }
      geom?.dispose();
      line = null; geom = null; buf = null;
    },

    get count() { return count; },
    get isFull() { return count >= BACKPLOT_MAX; },
  };
}
