declare module 'troika-three-text' {
  import { Object3D } from 'three';
  export class Text extends Object3D {
    text: string;
    fontSize: number;
    color: number | string;
    anchorX: string | number;
    anchorY: string | number;
    font: string | null;
    outlineWidth: number | string;
    outlineColor: number | string;
    depthWrite: boolean;
    sync(callback?: () => void): void;
    dispose(): void;
  }
}

// Diagnostic hook on window for the 3D viewer — exposed so dev-tools can
// inspect the last build state without ad-hoc `(window as any)` casts.
// Top-level `interface Window` in a script-mode .d.ts augments the global
// Window without making this file a module (which would break the troika
// ambient declaration above).
interface ViewerDiag {
  ready: boolean;
  meshCount?: number;
  boundsValid?: boolean;
  timestamp?: number;
  error?: string;
  // Snapshot of THREE.WebGLRenderer.info — set when the renderer exists.
  // Returns null when there is no renderer yet (pre-init or after teardown).
  getRenderInfo?: () => {
    geometries: number;
    textures: number;
    programs: number;
    calls: number;
    triangles: number;
  } | null;
}

// Leak probe (frontend split, A2): live THREE.WebGLRenderer.info counts plus
// our own backplot/toolpath instance tallies, available whenever the renderer
// exists (unlike __viewerDiag.getRenderInfo, which is gated on a successful
// build). e2e/viewer.spec.ts polls this across reconnect/reload cycles to
// assert resource counts return to a stable baseline — a monotonic climb is a
// disposal leak (the "~1 hr in" stutter class).
interface ViewerLeakProbe {
  geometries: number;   // renderer.info.memory.geometries
  textures: number;     // renderer.info.memory.textures
  programs: number;     // renderer.info.programs.length (unique shaders)
}

interface Window {
  __viewerDiag?: ViewerDiag;
  __viewerLeakProbe?: () => ViewerLeakProbe | null;
}
