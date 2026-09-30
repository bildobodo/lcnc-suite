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
  // Viewer palette (design wave D8c): resolved roles, the colours actually on
  // the tagged materials, and the stored mode — e2e/viewer.spec.ts reads it.
  getPalette?: () => { resolved: Record<string, string>; drawn: Record<string, string>; mode: string };
  tintPart?: (id: string, on: boolean) => void;
  setCollisionHits?: (hits: { line: number; frac: number; rapid?: boolean }[]) => boolean;
  getLabels?: () => { total: number; laidOut: number };
  // Viewer contrast plan (R1/R2): each role's drawn material kind (the form
  // cue), width and opacity; the longest visible segment of a role on screen.
  getRoleMaterials?: () => { role: string; kind: string; widthPx: number | null; dashed: boolean; opacity: number; transparent: boolean }[];
  // Part B (Codex R39 VP39-01): the path memory ledger by owner.
  runAbMeasurement?: (durations?: Record<string, number>) => Promise<void>;
  cancelAbMeasurement?: () => void;
  getGroundGridDepth?: () => { min: number; max: number; near: number; far: number } | null;
  getPathBox?: () => { min: number[]; max: number[] } | null;
  setCameraPose?: (position: number[], target: number[]) => void;
  getPathMemory?: () => { mode: string; cpu: Record<string, number>; gpu: Record<string, number>; allocated: number; peak: number;
    generation: number; pairs: { source: number; lod: number; drawn: number } };
  projectRole?: (role: string) => { x: number; y: number; dx: number; dy: number; length: number } | null;
  projectRoleSegments?: (role: string) => { x: number; y: number; dx: number; dy: number; length: number }[];
  // Viewer contrast plan (V4): the tilted work plane as drawn, and a seam to
  // draw a simulated plane (null = none, undefined = back to live).
  getToolTip?: () => number[] | null;
  getBackplot?: () => { points: number; segments: number };
  getToolsetter?: () => { visible: boolean; top: number[]; screen: { x: number; y: number } | null; onTop: boolean } | null;
  getToolChange?: () => { visible: boolean; top: number[]; screen: { x: number; y: number } | null; onTop: boolean } | null;
  getPlane?: () => { visible: boolean; label: string | null; role: string | null; dashed: boolean;
    edge: { color: string; opacity: number; transparent: boolean } | null; arrowStale: boolean; hudWord: string | null } | null;
  simulatePlane?: (plane: number[] | null | undefined) => void;
  getAppearance?: () => {
    grid: { visible: boolean; position: number[]; color: number[] } | null;
    outlinedParts: number;
    parts: { id: string; normalsVersion: number; position: number[]; color: string }[];
  };
  // Camera gate (WP5): the default frame must start outside every non-stock
  // part for every orbit direction — e2e/viewer.spec.ts drives these.
  getCamera?: () => { position: number[]; target: number[]; near: number; far: number;
    ortho: boolean; minDistance: number } | null;
  getPartBounds?: () => { id: string; min: number[]; max: number[] }[];
  getFrameBox?: () => { min: number[]; max: number[] } | null;
  setView?: (preset: string) => void;
  setViewDirection?: (dir: number[], distance?: number) => void;
  switchProjection?: () => void;
  defaultFrameDir?: number[];
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

/** The commit the app was built / served from (vite.config.ts define). */
declare const __APP_COMMIT__: string;

interface Window {
  __viewerDiag?: ViewerDiag;
  __viewerLeakProbe?: () => ViewerLeakProbe | null;
}
