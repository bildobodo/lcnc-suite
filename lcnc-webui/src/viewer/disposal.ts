// Scene-graph disposal (frontend split, A2 — extracted from ThreeViewer.vue).
//
// THREE resources (geometries, materials, textures) hold GPU memory that the
// JS GC cannot reclaim — they must be .dispose()d explicitly. This helper
// walks an Object3D subtree and releases everything it owns, while skipping
// resources that are OWNED ELSEWHERE and merely referenced here.
//
// The ownership marker is `userData._shared === true`, applied uniformly to:
//   • the central STL geometry cache (reused across viewer instances), and
//   • the shared MAT.* materials (one instance reused across every rebuild).
// Anything WITHOUT the flag is private to one scene generation — per-program
// toolpath geometry, backplot/bounds/edge/surface materials, color clones —
// and is disposed here. (Before this split, disposeObject skipped ALL shared
// geometry AND never disposed materials at all, so private materials leaked
// on every reconnect rebuild — the A2 hazard class.)
import type { Object3D, BufferGeometry, Material } from "three";

function _isShared(res: { userData?: { _shared?: boolean } } | null | undefined): boolean {
  return res?.userData?._shared === true;
}

function _disposeMaterial(mat: Material | Material[] | null | undefined): void {
  if (!mat) return;
  if (Array.isArray(mat)) {
    for (const m of mat) if (!_isShared(m)) m.dispose?.();
  } else if (!_isShared(mat)) {
    mat.dispose?.();
  }
}

/**
 * Dispose every geometry and material under `obj`, skipping any marked
 * `userData._shared` (externally owned). Also calls `child.dispose?.()` for
 * objects that own GPU resources directly (e.g. InstancedMesh.instanceMatrix,
 * troika Text) when not shared.
 */
export function disposeObject(obj: Object3D): void {
  obj.traverse((child: Object3D & {
    geometry?: BufferGeometry;
    material?: Material | Material[];
    dispose?: () => void;
    isMesh?: boolean; isLine?: boolean; isPoints?: boolean; isInstancedMesh?: boolean;
  }) => {
    if (child.geometry && !_isShared(child.geometry)) child.geometry.dispose?.();
    _disposeMaterial(child.material);
    // InstancedMesh carries an instanceMatrix buffer freed by its own dispose();
    // guard so we don't re-dispose the renderable types whose GPU resources the
    // geometry/material branches already handled.
    if (child.isInstancedMesh && typeof child.dispose === "function") child.dispose();
  });
}
