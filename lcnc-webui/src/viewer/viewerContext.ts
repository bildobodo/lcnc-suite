// Per-call viewer context (frontend split, A3).
//
// The viewer controllers (surface, toolpath, …) are factories created once in
// <script setup>, but they must never CACHE the scene-graph pointers they
// operate on: scene / workRotGroup / workOrigin are REASSIGNED on every scene
// rebuild (ensureCoreGroups makes fresh groups). So the orchestrator hands a
// fresh ViewerCtx snapshot into each controller call; controllers read the
// fields they need and return — caching one would render into an orphaned
// graph (invisible objects + leaks, no error). requestRender is stable but
// rides along for convenience.
//
// This interface is intentionally minimal; A3.4 extends it with the fields the
// toolpath controller needs (boundsClipPlanes, viewerDefaults, unitScale, …).
import type * as THREE from "three";

export interface ViewerCtx {
  scene: THREE.Scene | null;
  workRotGroup: THREE.Group | null;
  workOrigin: THREE.Group | null;
  requestRender: () => void;
}
