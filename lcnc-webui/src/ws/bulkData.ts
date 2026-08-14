// Bulk-data channels (frontend split, A1.2 — extracted from lcncWs.ts).
//
// Everything that arrives OUTSIDE the WS status stream because it's too big
// to ride the single-threaded WS writer: gcode preview polylines (HTTP +
// previewWorker decode), program text (GET /gcode), surface points and the
// compensation grid (HTTP msgpack). Owns the per-channel version sentinels,
// AbortControllers and the preview-worker singleton.
//
// Leaf module: imports vue / msgpack / defaults TYPES only; never imports
// lcncWs or its peers. lcncWs dispatches the *_ready frames here and passes
// the apply sinks for surface/grid (those write the status ref, which stays
// in lcncWs until the statusStore extraction) — reassigned scalars stay
// private to this module by design (A1 rule).
import { computed, markRaw, ref } from "vue";
import { decode as msgpackDecode } from "@msgpack/msgpack";
import type { Vec3 } from "../defaults";

// Viewer payloads. Static `viewer_init` (machine description, INI config,
// kinematics, parts list) is delivered once per WS connection; dynamic
// `viewer_gcode` is delivered on every program load and carries the parsed
// preview polylines. Types live here so consumers (App.vue, ThreeViewer.vue)
// share one shape — no per-callsite `as any` / `as ViewerInit | null`.
export interface ViewerPart {
  id: string;
  file: string;
  group?: string | null;
  translate?: Vec3;
  rotate?: Vec3;
  // Optional default color [r,g,b] 0–1 from machine.json (STL carries no
  // color); per-part user overrides in settings still win.
  color?: Vec3;
  // Legacy field names kept for backward compatibility with older payloads.
  parent?: string | null;
  t?: Vec3;
  r?: Vec3;
}
export type KinematicsList =
  | Array<{
      group: string;
      joint: number;
      type?: "translate" | "rotate";
      direction?: "x" | "y" | "z";
      axis?: [number, number, number];
      sign: number;
    }>
  | Record<string, { axis: number; sign: number }>;
export interface ViewerInit {
  units?: "mm" | "inch" | string;
  stl_base_url: string;
  groups?: Array<{ id: string; parent: string; translate?: Vec3 }>;
  parts: ViewerPart[];
  kinematics: KinematicsList;
  workGroup?: string;
  toolGroup?: string;
  machine_bounds?: { origin: Vec3; size: Vec3 };
  axes?: string[];
  ini_config?: Record<string, any>;
  [key: string]: any;  // gateway adds occasional extras (e.g. timestamp, git_sha)
}
export interface ViewerGcode {
  file?: string | null;
  feed?: number[][] | Uint8Array;  // wire: LE float32 bin (preferred) | legacy nested
  rapid?: number[][] | Uint8Array;
  feed_lines?: number[] | Uint32Array | Uint8Array;  // wire: LE uint32 bin | legacy list
  // P4.1: flat position buffers produced off-thread by previewWorker (preferred
  // over the nested arrays — ThreeViewer builds BufferAttributes directly).
  feedPos?: Float32Array;          // flat [x,y,z, ...]
  rapidPos?: Float32Array;
  // Rotary-aware preview: per-vertex A/B/C (degrees, raw program coords),
  // index-aligned with feedPos/rapidPos. Present ONLY when the program
  // actually sweeps a rotary axis — absence means the programmed polyline is
  // already exact and no part-frame transform is needed.
  feedAbc?: Float32Array;          // flat [a,b,c, ...]
  rapidAbc?: Float32Array;
  // P4.1: bounding boxes of the rendered polylines, computed in the parse worker
  // so ThreeViewer skips an O(n) main-thread scan per load. `bounds` is the cut
  // envelope shown as the toolpath bounds box (X/Y over feed+rapid, Z over feed
  // only — vertical rapids don't inflate the displayed Z extent);
  // `motion_bounds` is the full feed+rapid envelope for the machine-limit
  // overflow check.
  bounds?: { min: number[]; max: number[] } | null;
  motion_bounds?: { min: number[]; max: number[] } | null;
  // P4.1: source-line → point-index range map, built off-thread by previewWorker
  // (Maps survive structured clone) so ThreeViewer skips the O(points) build.
  feedLineMap?: Map<number, { start: number; end: number }>;
  // P4.1: cumulative lineDistance for the dashed rapid line, computed off-thread so
  // ThreeViewer sets the attribute directly instead of Three.computeLineDistances().
  rapidDist?: Float32Array;
  [key: string]: any;  // stats fields are folded in by GcodePanel watcher
}

export const viewerInit = ref<ViewerInit | null>(null);
export const viewerGcode = ref<ViewerGcode | null>(null);
// Tool-table version pinged by gateway after every save/add/delete/import.
// Components watch this ref and re-fetch via the existing get_tool_table RPC,
// so a remote edit propagates without manual refresh.
export const toolTableVersion = ref(0);
// File text for the currently loaded program. Fetched over HTTP (not WS) from
// GET /gcode when viewer_gcode arrives with a new file — keeps multi-MB bodies
// off the WS writer so the gateway's heartbeat loop isn't delayed by N-way
// broadcasts. Null when no program is loaded or the fetch failed.
export const gcodeContent = ref<string | null>(null);

// Per-channel load errors so a success on one fetch channel can't clear a real
// error on another (the three channels are independent HTTP fetches). The
// banner shows the union — first non-null wins.
const _previewErr = ref<string | null>(null);
const _surfaceErr = ref<string | null>(null);
const _compGridErr = ref<string | null>(null);
export const previewLoadError = computed<string | null>(
  () => _previewErr.value ?? _surfaceErr.value ?? _compGridErr.value,
);

let _gcodeContentFile: string | null = null;
// Preview version of the currently-fetched text. An in-place edit (web Save or
// external edit) keeps the path constant but bumps the version, so we must
// refetch on a version change too — otherwise the text panel shows stale code
// even though the file on disk (and the 3D preview) changed.
let _gcodeContentVersion = -1;
let _gcodeFetchAbort: AbortController | null = null;

// Fetched preview state (polylines, stats, line numbers) for the currently
// loaded file. Loaded off-thread by previewWorker on viewer_gcode_ready;
// staleness handled by the _previewLastVersion guard on the worker reply.
let _previewLastVersion = -1;

// Surface-scan / comp-grid fetch guards. Same pattern as preview: per-channel
// AbortController so a newer version cancels an in-flight older fetch, and a
// "last version" sentinel to skip duplicate pings.
let _surfaceFetchAbort: AbortController | null = null;
let _surfaceLastVersion = -1;
let _compGridFetchAbort: AbortController | null = null;
let _compGridLastVersion = -1;

function _fetchBulk(
  url: string,
  version: number,
  getLast: () => number,
  setLast: (v: number) => void,
  getAbort: () => AbortController | null,
  setAbort: (ac: AbortController | null) => void,
  apply: (data: any) => void,
  setError: (e: string | null) => void,
) {
  if (version === getLast()) return;
  setLast(version);
  const prev = getAbort();
  if (prev) { prev.abort(); }
  const ac = new AbortController();
  setAbort(ac);
  fetch(`${url}?v=${version}`, { signal: ac.signal })
    .then(r => r.ok ? r.arrayBuffer() : Promise.reject(new Error(`HTTP ${r.status}`)))
    .then(buf => {
      if (getLast() !== version) return;  // newer version already won
      const data = msgpackDecode(new Uint8Array(buf));
      apply(data);
      setError(null);  // clear only THIS channel's error
    })
    .catch(err => {
      if (err?.name !== "AbortError") {
        console.error(`GET ${url} failed`, err);
        setError(`${url} failed: ${err?.message ?? err}`);
        if (getLast() === version) setLast(-1);  // let next bump retry
      }
    });
}

function _applyGcodeFile(nextFile: string | null, version = -1) {
  // Refetch when the path OR the preview version changed. Same-path edits keep
  // the path but bump the version (see _gcodeContentVersion).
  if (nextFile === _gcodeContentFile && version === _gcodeContentVersion) return;
  _gcodeContentFile = nextFile;
  _gcodeContentVersion = version;
  if (_gcodeFetchAbort) { _gcodeFetchAbort.abort(); _gcodeFetchAbort = null; }
  if (!nextFile) {
    gcodeContent.value = null;
    return;
  }
  const ac = new AbortController();
  _gcodeFetchAbort = ac;
  const target = nextFile;
  const ver = version;
  // `v` is a cache-buster: FileResponse sets an mtime ETag but no immutable
  // header, so a same-path refetch could otherwise be served from cache. The
  // gateway ignores the unknown query param.
  fetch(`/gcode?path=${encodeURIComponent(target)}&v=${ver}`, { signal: ac.signal })
    .then(r => r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`)))
    .then(text => {
      if (_gcodeContentFile === target && _gcodeContentVersion === ver) gcodeContent.value = text;
    })
    .catch(err => {
      if (err?.name !== "AbortError") {
        console.error("GET /gcode failed", err);
        if (_gcodeContentFile === target && _gcodeContentVersion === ver) gcodeContent.value = null;
      }
    });
}

// Off-main-thread preview loader (P4.1). The fetch + multi-MB msgpack decode +
// nested→flat conversion run in previewWorker so they don't block the UI thread
// (which starved the heartbeat worker → disarm-on-load). Staleness is handled by
// the version guard on the reply rather than an AbortController across the worker
// boundary; a superseded decode still completes off-thread but its result is
// dropped.
let _previewWorker: Worker | null = null;

function _ensurePreviewWorker(): Worker {
  if (_previewWorker) return _previewWorker;
  _previewWorker = new Worker(new URL("../previewWorker.ts", import.meta.url), { type: "module" });
  _previewWorker.onmessage = (ev: MessageEvent) => {
    const m = ev.data as { version: number; gcode?: ViewerGcode; error?: string };
    if (m.version !== _previewLastVersion) return;  // stale — newer load in flight
    if (m.error) {
      console.error("preview load failed", m.error);
      _previewErr.value = `/preview failed: ${m.error}`;
      if (_previewLastVersion === m.version) _previewLastVersion = -1;  // allow retry
      return;
    }
    // markRaw: the payload holds transferred Float32Array/Uint32Array buffers;
    // letting Vue deep-proxy them would wrap the typed arrays in a Proxy, which
    // breaks/slows THREE.BufferAttribute's GPU upload. Consumers only react to
    // the ref reassignment, not deep mutation, so raw is correct here.
    viewerGcode.value = m.gcode ? markRaw(m.gcode) : null;
    _previewErr.value = null;
  };
  _previewWorker.onerror = (ev) => {
    console.error("previewWorker error", ev.message);
    _previewErr.value = `preview worker error: ${ev.message}`;
    _previewLastVersion = -1;
  };
  return _previewWorker;
}

function _fetchPreview(version: number) {
  if (version === _previewLastVersion) return;
  _previewLastVersion = version;
  _ensurePreviewWorker().postMessage({ version, url: `/preview?v=${version}` });
}

/** viewer_init frame: static machine description, once per WS connection. */
export function handleViewerInit(msg: { data?: ViewerInit | null }): void {
  viewerInit.value = msg.data ?? null;
}

/**
 * viewer_gcode frame — the empty-state path (file unloaded): gateway sends a
 * plain viewer_gcode with data.file = null. The "has data" case uses
 * viewer_gcode_ready.
 */
export function handleViewerGcode(msg: { data?: ViewerGcode | null }): void {
  viewerGcode.value = msg.data ?? null;
  _applyGcodeFile(msg.data?.file ?? null);
}

/**
 * viewer_gcode_ready frame: full preview lives on the server; fetch the cached
 * msgpack bytes via HTTP so multi-MB polylines don't ride the single-threaded
 * WS writer and stall the heartbeat loop. `version` is a cache-buster.
 */
export function handleViewerGcodeReady(msg: { version?: number; file?: string | null }): void {
  const version: number = msg.version ?? 0;
  const file: string | null = msg.file ?? null;
  _fetchPreview(version);
  _applyGcodeFile(file, version);
}

/** surface_points_ready: fetch + decode, then hand the data to the sink. */
export function fetchSurfacePoints(version: number, apply: (data: any) => void): void {
  _fetchBulk(
    "/surface_points", version,
    () => _surfaceLastVersion, v => { _surfaceLastVersion = v; },
    () => _surfaceFetchAbort, ac => { _surfaceFetchAbort = ac; },
    apply,
    e => { _surfaceErr.value = e; },
  );
}

/** comp_grid_ready: fetch + decode, then hand the data to the sink. */
export function fetchCompGrid(version: number, apply: (data: any) => void): void {
  _fetchBulk(
    "/comp_grid", version,
    () => _compGridLastVersion, v => { _compGridLastVersion = v; },
    () => _compGridFetchAbort, ac => { _compGridFetchAbort = ac; },
    apply,
    e => { _compGridErr.value = e; },
  );
}

/** tool_table_changed frame: bump so watchers re-fetch via get_tool_table. */
export function handleToolTableChanged(msg: { version?: number }): void {
  toolTableVersion.value = msg.version ?? 0;
}
