// Backplot controller (frontend split, A3 — extracted from ThreeViewer.vue).
//
// The backplot is the live tool-history trail in WORK coordinates: a single
// THREE.Line backed by a linearized circular buffer. Owns its own line/geometry
// and the ring-buffer cursor; the orchestrator (ThreeViewer) computes the
// tool-tip's work-local position each tick and calls push().
//
// Factory pattern (per the A3 plan): created once in <script setup>, closes over
// the STABLE requestRender (a plain function, never reassigned). The parent
// group IS reassigned every scene rebuild, so build() takes it per-call and is
// re-invoked from ensureCoreGroups — the controller never caches a parent.
import * as THREE from "three";

const BACKPLOT_MAX = 20000;   // points (10 Hz -> ~33 min)
const BACKPLOT_EPS = 0.01;    // mm; min distance before adding a point

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
  let line: THREE.Line | null = null;
  let geom: THREE.BufferGeometry | null = null;
  let pos: Float32Array | null = null;
  let count = 0;            // valid points in the window, 0..BACKPLOT_MAX
  let head = 0;             // next write slot, 0..BACKPLOT_MAX-1
  // Scalar dedup anchor (no retained Vector3 → no per-point allocation).
  let lastX = 0, lastY = 0, lastZ = 0, hasLast = false;

  function reset() {
    count = 0;
    head = 0;
    hasLast = false;
    if (geom && pos) {
      // Keep allocation, just “empty” it
      geom.setDrawRange(0, 0);
      geom.attributes.position!.needsUpdate = true;
    }
    requestRender();
  }

  return {
    build(parent, color, depthTest) {
      geom = new THREE.BufferGeometry();
      // 2× length: linearized circular buffer (see push). +480 KB.
      pos = new Float32Array(BACKPLOT_MAX * 2 * 3);
      geom.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      geom.setDrawRange(0, 0);

      const mat = new THREE.LineBasicMaterial({ color, depthTest, depthWrite: false });
      line = new THREE.Line(geom, mat);
      line.renderOrder = 11;
      line.frustumCulled = false;   // ✅ prevents disappearing when origin is off-screen
      parent.add(line);

      reset();
    },

    push(x, y, z) {
      if (!geom || !pos || !line) return;

      if (hasLast) {
        const dx = x - lastX, dy = y - lastY, dz = z - lastZ;
        if (dx * dx + dy * dy + dz * dz < BACKPLOT_EPS * BACKPLOT_EPS) return;
      }

      // Linearized circular buffer: the backing array is 2×BACKPLOT_MAX long, and
      // every point is written to BOTH `slot` and `slot+BACKPLOT_MAX`. That keeps
      // the most-recent BACKPLOT_MAX points contiguous and in chronological order
      // at indices [head, head+BACKPLOT_MAX) once full — a single setDrawRange with
      // zero per-point memmove (the old copyWithin shifted ~60 KB on every point).
      const N = BACKPLOT_MAX;
      const slot = head;
      const a = slot * 3;
      const b = (slot + N) * 3;
      pos[a + 0] = x; pos[a + 1] = y; pos[a + 2] = z;
      pos[b + 0] = x; pos[b + 1] = y; pos[b + 2] = z;

      head = (slot + 1) % N;
      if (count < N) count++;

      lastX = x; lastY = y; lastZ = z; hasLast = true;

      // Not yet wrapped: points fill [0, count). Full: window starts at head.
      const start = count < N ? 0 : head;
      geom.setDrawRange(start, count);
      geom.attributes.position!.needsUpdate = true;
    },

    reset,

    setVisible(on) { if (line) line.visible = on; },

    setColor(color) { if (line) (line.material as THREE.LineBasicMaterial).color.set(color); },

    setDepthTest(depthTest) {
      if (line) {
        const m = line.material as THREE.LineBasicMaterial;
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
      line = null; geom = null; pos = null;
    },

    get count() { return count; },
    get isFull() { return count >= BACKPLOT_MAX; },
  };
}
