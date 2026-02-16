// ─── Shared types (single source of truth) ───────────────────────

export type Vec3 = [number, number, number];

export type Layer = "backplot" | "toolpath" | "machine" | "workpiece" | "bounds" | "workzero" | "hud";
export const ALL_LAYERS: Layer[] = ["backplot", "toolpath", "machine", "workpiece", "bounds", "workzero", "hud"];

export type TrackMode = "none" | "tool" | "workpiece";
export type Projection = "perspective" | "parallel";

export interface ColorDefaults {
  feed: string;
  rapid: string;
  backplot: string;
  bounds: string;
  workpiece: string;
  tool: string;
}

export interface OpacityDefaults {
  workpiece: number;
  bounds: number;
  machine: number;
  toolpath: number;
  backplot: number;
  hud: number;
}

export interface ViewerDefaults {
  workpieceSize: Vec3;
  workpieceOffset: Vec3;
  layers: Record<Layer, boolean>;
  colors: ColorDefaults;
  opacities: OpacityDefaults;
  trackingMode: TrackMode;
  pathOnTop: boolean;
  projection: Projection;
}

// ─── Section registry ────────────────────────────────────────────

const STORAGE_KEY = "lcnc-defaults";

interface SectionDef<T> {
  fallback: T;
  merge: (saved: any, fallback: T) => T;
}

const sections = new Map<string, SectionDef<any>>();

/**
 * Register a defaults section. Call at module top-level.
 * Future features (tooltable, tool handling, etc.) register their own section.
 */
export function registerSection<T>(key: string, fallback: T, merge: (saved: any, fb: T) => T): void {
  sections.set(key, { fallback, merge });
}

// ─── Storage I/O ─────────────────────────────────────────────────

/** In-memory cache — localStorage is read at most once per page load. */
let _cache: Record<string, any> | null = null;

function readAll(): Record<string, any> {
  if (_cache) return _cache;

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      // Migration: flat format (has "layers" at top level, no "viewer" key)
      // → wrap under "viewer" section
      if (parsed && typeof parsed === "object" && !parsed.viewer && parsed.layers) {
        _cache = { viewer: parsed };
        return _cache;
      }
      _cache = parsed ?? {};
      return _cache;
    }
  } catch { /* ignore corrupt data */ }

  _cache = {};
  return _cache;
}

/** Load a section. Returns fully merged data (saved values + fallbacks). */
export function loadSection<T>(key: string): T {
  const def = sections.get(key);
  if (!def) throw new Error(`defaults: unknown section "${key}"`);

  const all = readAll();
  const saved = all[key];
  return def.merge(saved, def.fallback);
}

/** Save a section. Preserves other sections. */
export function saveSection(key: string, data: any): void {
  const all = readAll();
  all[key] = data;
  _cache = all;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
}

// ─── Viewer section ──────────────────────────────────────────────

const VIEWER_FALLBACK: ViewerDefaults = {
  workpieceSize: [100, 100, 20],
  workpieceOffset: [0, 0, -20],
  layers: { backplot: true, toolpath: true, machine: true, workpiece: true, bounds: true, workzero: true, hud: true },
  colors: { feed: "#22b8cf", rapid: "#f5a623", backplot: "#ff00ff", bounds: "#ffffff", workpiece: "#ffffff", tool: "#ffdd00" },
  opacities: { workpiece: 0.16, bounds: 0.10, machine: 1.0, toolpath: 1.0, backplot: 0.55, hud: 1.0 },
  trackingMode: "none",
  pathOnTop: true,
  projection: "perspective",
};

registerSection<ViewerDefaults>("viewer", VIEWER_FALLBACK, (saved, fb) => {
  if (!saved) return JSON.parse(JSON.stringify(fb));
  return {
    workpieceSize: (saved.workpieceSize ?? [...fb.workpieceSize]) as Vec3,
    workpieceOffset: (saved.workpieceOffset ?? [...fb.workpieceOffset]) as Vec3,
    layers: { ...fb.layers, ...saved.layers } as Record<Layer, boolean>,
    colors: { ...fb.colors, ...saved.colors },
    opacities: { ...fb.opacities, ...saved.opacities },
    trackingMode: (saved.trackingMode ?? fb.trackingMode) as TrackMode,
    pathOnTop: saved.pathOnTop ?? fb.pathOnTop,
    projection: (saved.projection ?? fb.projection) as Projection,
  };
});

/** Load viewer defaults (typed convenience wrapper). */
export function loadViewerDefaults(): ViewerDefaults {
  return loadSection<ViewerDefaults>("viewer");
}

/** Save viewer defaults (typed convenience wrapper). */
export function saveViewerDefaults(data: ViewerDefaults): void {
  saveSection("viewer", data);
}

// ─── Panels section ─────────────────────────────────────────────

export const MAX_PANELS = 3;

export interface PanelsDefaults {
  tabs: string[];
}

registerSection<PanelsDefaults>("panels", { tabs: ["viewer", "dro"] }, (saved, fb) => {
  if (!saved) return { ...fb };
  const tabs = saved.tabs;
  if (Array.isArray(tabs) && tabs.length > 0) return { tabs: tabs.slice(0, MAX_PANELS) };
  return { ...fb };
});

/** Load panels defaults (typed convenience wrapper). */
export function loadPanelsDefaults(): PanelsDefaults {
  return loadSection<PanelsDefaults>("panels");
}

/** Save panels defaults (typed convenience wrapper). */
export function savePanelsDefaults(data: PanelsDefaults): void {
  saveSection("panels", data);
}
