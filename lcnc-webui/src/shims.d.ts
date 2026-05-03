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
}

interface Window {
  __viewerDiag?: ViewerDiag;
}
