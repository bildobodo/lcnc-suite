// Toolpath controller (frontend split, A3.4 — extracted from ThreeViewer.vue).
//
// The largest controller: owns the rendered program preview — feed + rapid
// polylines drawn as CHUNKS (viewer/lineChunks.ts: a few dozen contiguous
// index ranges over ONE shared position attribute, each its own object with an
// explicit bounding sphere so frustum culling and display LOD work per
// chunk; the outside-limits overlay is a per-chunk index SUBSET of the pairs
// touching a vertex the producing worker flagged beyond a joint limit —
// joint-side, TLO-inclusive, no clip planes), the toolpath bounding box +
// axis labels + out-of-bounds edges, and the machine-bounds overflow check.
// No 3D highlight of the current line (operator 2026-09-28): the code panel
// names the line, the tool shows where it is.
//
// Factory deps are STABLE references (created once, mutated in place): the two
// clip-plane arrays (transformed per-frame by the orchestrator), the billboard-
// label registry, the troika label factory, the live colour getter, the
// disposeObject helper, and the overflow ref the HUD reads. Per-call ToolpathCtx
// carries the REASSIGNED scene-graph pointers (scene/workOrigin/workRotGroup)
// plus per-program data (pathAlwaysOnTop/units) — never cached.
import * as THREE from "three";
import { binPairs, buildFrameIndex, CHUNK_MAX, chunkBounds, chunkGrid, cumulativeDistances, splitPairsByFrame } from "./lineChunks";
import type { AnchorTerms } from "./partFrame";
import { makeBoxEdges, boxEdgePositions, countedLineDistances, screenDash, TOOLPATH_BOX_PX, TOOLPATH_BOX_DASH_PX, type BoxEdges } from "./boxLines";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { fatBytes, fatGeometry, packPairs, PATH_PX } from "./fatPaths";
import { allocatedBytes, counted, countedGeometry, f32, u32 } from "./allocMeter";
import type { Ref } from "vue";
import type { Text } from "troika-three-text";
import type { ViewerGcode } from "../lcncWs";
import type { Vec3 } from "../defaults";

type BBox = { min: [number, number, number]; max: [number, number, number] };
/** The roles this controller draws (viewer/viewerPalette.ts resolves them:
 *  the theme's --viewer-* tokens, the operator's Custom colours over the
 *  user roles). */
/** A track-segment run [first, last] and the streams to show it in. */
export interface PathSection { run: [number, number]; feed: boolean; rapid: boolean }

type Colors = { feed: string; rapid: string; toolpathBounds: string; boundsAlt: string; limit: string };

export interface ToolpathDeps {
  requestRender: () => void;
  boundsClipPlanes: THREE.Plane[];
  insideBoundsClipPlanes: THREE.Plane[];
  billboardLabels: Text[];
  makeLabel: (text: string, color: string, fontSize: number) => Text;
  disposeObject: (o: THREE.Object3D) => void;
  colors: () => Colors;              // the resolved palette, read fresh each call
  /** How much of the path colour survives the stale mute (the
   *  --opacity-disabled token, read by the host). Applied as an OPAQUE colour
   *  mix toward `sceneBackground`, never as alpha: a million blended
   *  segments held the Mac's GPU three frames behind during every re-parse
   *  (viewerPerf, 2026-09-09) while the same lines opaque ran at 60 fps. */
  staleOpacity?: () => number;
  /** The scene's background and foreground (theme `--bg` / `--fg`): the
   *  stale grey is the background lifted toward the foreground by
   *  `staleOpacity` — one neutral grey for every stale stream, on every
   *  theme (operator, 2026-09-12: "make it a real grey", not a dim cyan). */
  sceneBackground: () => THREE.Color;
  sceneForeground: () => THREE.Color;
  axisCss: { x: string; y: string; z: string };
  overflow: Ref<boolean>;            // HUD warning flag, owned by ThreeViewer for the template
  /** The validator's violation count behind the flag (the HUD chip shows it). */
  overflowCount?: Ref<number>;
  /** Spatial grid cells (≈ chunks) per stream — lineChunks.spatialChunks. */
  chunkCells?: number;
  /** The initial line mode (default "fat"); "gl" keeps the previous GL
   *  lines — for the A/B measurement and the selection tests written against
   *  their index ranges. */
  lineMode?: PathLineMode;
}

export interface ToolpathCtx {
  scene: THREE.Scene | null;
  workOrigin: THREE.Group | null;
  workRotGroup: THREE.Group | null;
  /** Baked-toolpath anchor (sibling of workOrigin under the work group):
   *  posed ONLY by apply(), from the terms the geometry was baked with, so
   *  the lines and their origin can never disagree for a frame. */
  pathAnchor: THREE.Group | null;
  /** XY-rotation child of pathAnchor — the lines' actual parent. */
  pathRot: THREE.Group | null;
  /** Room-fixed parents (2026-09-11), one-to-one with the table side:
   *  roomOrigin/roomRotGroup follow the LIVE offsets (programmed path),
   *  roomAnchor/roomRot are posed by apply() from a bake's own terms. All
   *  null when the work chain has no rotary — then every vertex rides. */
  roomOrigin: THREE.Group | null;
  roomRotGroup: THREE.Group | null;
  roomAnchor: THREE.Group | null;
  roomRot: THREE.Group | null;
  pathAlwaysOnTop: boolean;
  units: string | undefined;
}

export interface ToolpathController {
  /** `anchor` = the WCS terms the vertices in `g` were baked against
   *  (part-frame output, or a programmed multi-epoch rebase): the lines are
   *  parented under ctx.pathRot and pathAnchor/pathRot are posed from it in
   *  the same call. null = raw program coordinates (no bake): the lines hang
   *  under the LIVE workRotGroup, whose re-add IS the transform. */
  apply(ctx: ToolpathCtx, g: ViewerGcode, anchor?: AnchorTerms | null): void;
  /** Per rendered frame: picks each chunk's display LOD level from the
   *  world size of a device pixel at its distance (`heightPx` =
   *  drawing-buffer height; a level switch flips visibility) and counts the
   *  chunks inside the camera frustum for the perf probe. ~100 sphere
   *  tests; cheaper than tracking dirtiness. */
  updateCulling(ctx: ToolpathCtx, camera: THREE.Camera, heightPx?: number): void;
  setVisible(on: boolean): void;
  /** The Rapids layer (fixed palette P3): the rapid lines only — their
   *  limit overlay stays with the toolpath layer. */
  setRapidsVisible(on: boolean): void;
  /** A finding's SECTION on a hidden layer (Codex R31 VP-I03): the drawn
   *  pairs of the named streams whose source TRACK segment (feedSrc /
   *  rapidSrc — the segment ending at a vertex) lies in `run`, drawn in the
   *  stream's own material while its layer hides it — the rest of the hidden
   *  layer stays hidden; with the whole toolpath off also the run's limit
   *  mark. No selection look (operator 2026-09-28). Sticky across apply()
   *  (a re-bake of the same program); null ends it. */
  setReveal(r: PathSection | null): void;
  setBoundsVisible(on: boolean): void;
  setAlwaysOnTop(on: boolean): void;
  /** The A/B measurement's switch (Codex R39 VP39-03; removed after the
   *  acceptance): rebuild the last applied program in the given line mode —
   *  never both held, so each mode's memory is its own. */
  setLineMode(mode: PathLineMode, ctx: ToolpathCtx): void;
  readonly lineMode: PathLineMode;
  /** The A/B measurement only (Codex R47 VP-I14): rebuild the last applied
   *  program in the CURRENT mode — every build phase a real build, whether or
   *  not the mode changes (setLineMode keeps its cheap no-op). apply()
   *  disposes before it builds, so a rebuild's peak is the new build plus its
   *  scratch, never old + new. */
  rebuild(ctx: ToolpathCtx): void;
  /** The A/B measurement only (VP-I17): dispose every path object, keep the
   *  program's data — the ledger then holds the payload alone; rebuild()
   *  restores the view. Never unloads the operator's program. */
  release(): void;
  /** Bumped by every path build (apply / rebuild). */
  readonly generation: number;
  /** The A/B measurement only: hold the limit overlays hidden. */
  holdOverlays(on: boolean): void;
  /** Whether the drawn program carries limit overlays at all. */
  readonly hasOverlays: boolean;
  /** The drawn path's box in world coordinates (every chunk of every set,
   *  at the parents' current pose), or null without a path. */
  pathWorldBox(): THREE.Box3 | null;
  /** The memory ledger (Codex R39 VP39-01): bytes by owner — CPU per unique
   *  ArrayBuffer, GPU per buffer actually uploaded. */
  pathMemory(): PathMemory;
  /** The ArrayBuffers the ledger's CPU side counts (a test's view: what a
   *  build leaves alive must be among them — Codex R49 VP-I17). */
  heldBuffers(): Set<ArrayBufferLike>;
  /** Live-update feed/rapid/toolpath-bounds colours on existing lines. */
  setColors(c: Colors): void;
  /** Mute the drawn path while it is known not to match the machine's
   *  live inputs — a re-parse in flight, or offsets / tool length changed
   *  since the parse. Sticky across apply(). Every stream turns the one
   *  stale grey (rapids keep their dashes) and the outside-bounds overlays
   *  are hidden — the bounds verdict is as stale as the path. Opaque colour
   *  writes only — never alpha (GPU cost, see ToolpathDeps.staleOpacity);
   *  call again after a theme change. */
  setStale(on: boolean): void;
  /** Drop all refs WITHOUT disposing — clearScene already freed the objects.
   *  Parallel to surfaceController.forgetAfterSceneClear (H6): stale refs
   *  would keep feedSegs/updateOverflow reporting the disposed program and
   *  double-dispose on the next apply(). Call from ensureCoreGroups. */
  forgetAfterSceneClear(): void;
  dispose(): void;
  /** Vertex counts of the drawn streams (the probe's `feed_segs`/`rapid_segs`
   *  rows — kept as vertices so the trace history stays comparable). */
  readonly feedSegs: number;
  readonly rapidSegs: number;
  /** Segments actually submitted at the current draw ranges (both streams). */
  readonly drawSegs: number;
  readonly chunks: number;
  /** From the last updateCulling: chunks inside the frustum / overlays drawn. */
  readonly chunksVisible: number;
  readonly overlayChunks: number;
  /** Segments dropped because their endpoints lie in different frames —
   *  must read 0 (see lineChunks.FrameIndex.mixed). */
  readonly frameMixed: number;
  /** Segments drawn room-fixed (both streams). */
  readonly roomSegs: number;
  /** Display LOD: the finest/coarsest level any chunk currently draws, and
   *  the worker time the levels cost (ms). */
  readonly lodMin: number;
  readonly lodMax: number;
  readonly lodMs: number;
}


export interface PathMemory {
  mode: PathLineMode;
  /** CPU bytes HELD, by owner — each ArrayBuffer ONCE, at its CAPACITY (a
   *  small view keeps its whole buffer alive; Codex R47 VP-I17): the drawn
   *  base lines, the dash distances, the limit overlays, the finding's
   *  reveal, the fat geometries' own quad mesh, the controller's derived
   *  arrays (binned level indices, computed distances) and the PAYLOAD it
   *  keeps for rebuilds (the program's positions, LOD lists, breaks, flags,
   *  source ids), and the toolpath box with its overflow edges (built with
   *  the path, Codex R48). A buffer shared by two owners counts under the
   *  first. */
  cpu: { base: number; dist: number; overlay: number; reveal: number; mesh: number; box: number; source: number; payload: number; total: number };
  /** GPU bytes of the buffers actually uploaded (the uploaded views; a level
   *  never drawn is not). */
  gpu: { base: number; dist: number; overlay: number; reveal: number; mesh: number; box: number; total: number };
  /** Bytes the controller allocated since it was created — cumulative (a
   *  reveal built three times counts three times). */
  allocated: number;
  /** For the CURRENT path (since the last apply / rebuild): the highest
   *  (bytes held when a build began + bytes the build allocated, scratch
   *  included — every allocation counted where it happens, viewer/
   *  allocMeter.ts, Codex R48) — an UPPER bound on the simultaneous
   *  footprint, every allocation of the build taken as alive at once. */
  peak: number;
  /** The last build's EAGER pack (Codex R39/R48): its bytes ESTIMATED from
   *  the pair counts before the first pair was packed, and what the pack
   *  then allocated (≤ the estimate: degenerate pairs are dropped). */
  eager: { estimate: number; packed: number };
  /** Builds so far (apply / rebuild). */
  generation: number;
  /** Segment pairs: of the source (level 0), at the chunks' CURRENT levels,
   *  and actually DRAWN (visible objects' instances — degenerate pairs
   *  dropped by the pack, hidden chunks and layers excluded). */
  pairs: { source: number; lod: number; drawn: number };
}

/** One drawn stream in one frame: its chunks (objects sharing the stream's
 *  position attribute + this set's index attribute), materials, and the
 *  per-chunk local boxes the overlay gate tests. */
/** One chunk (a grid cell) of a set: one geometry PER LOD LEVEL sharing the
 *  stream's position attribute and that level's index attribute, only the
 *  current level's objects visible — a level switch is a visibility flip
 *  (no VAO rebind), and disposing every level's geometry frees every index
 *  buffer (a swapped-out index attribute would otherwise leak its GL
 *  buffer: Three only deletes a geometry's CURRENT index on dispose). */
/** A drawn path object: a GL line (the previous renderer, kept for the A/B
 *  measurement only) or a screen-space line of PATH_PX (part B). */
type PathObj = THREE.LineSegments | LineSegments2;
type PathMat = THREE.LineBasicMaterial | THREE.LineDashedMaterial | LineMaterial;
/** "fat" = LineSegments2 at PATH_PX (the product); "gl" = the previous GL
 *  lines, selectable only for the A/B measurement (Codex R39 VP39-03). */
export type PathLineMode = "fat" | "gl";

interface Chunk {
  lines: PathObj[];             // per level
  overlays: (PathObj | null)[]; // per level — null where nothing is flagged
  /** The chunk's bounding-sphere radius before the line-width margin
   *  updateCulling adds in fat mode. */
  radius0: number;
  counts: number[];                        // index entries per level (0 = nothing at that level)
  ovCounts: number[];                      // flagged index entries per level
  level: number;
}

interface LineSet {
  stream: "feed" | "rapid";
  frame: 0 | 1;
  parent: THREE.Group;
  mat: PathMat;
  overMat: PathMat | null;  // built with the overlays (fillOverlays)
  bounds: Float32Array;                  // 6 per chunk (union over levels), parent-local coordinates
  tols: number[];                        // tolerance of level k ≥ 1 (machine units)
  chunks: Chunk[];
  posAttr: THREE.BufferAttribute;        // the shared vertices (overlays rebuild from them)
  levels: ReturnType<typeof binPairs>[]; // binned pairs per level, chunk order (level 0 first)
  used: number[];                        // grid cell of each chunk
  pairs: number;                         // level-0 segments
  src: Uint32Array | null;               // source track index per vertex (setReveal); null = none
  dist: THREE.BufferAttribute | null;    // the dashed stream's lineDistance
  outside: Uint8Array | null;            // the validator's flags (the reveal's limit mark)
  /** A finding's section (setReveal): its pairs in the set's material, and
   *  the flagged ones among them in the limit role. */
  reveal: { line: PathObj | null; over: PathObj | null };
  /** The limit overlays' flagged pairs per level, prepared before the pack:
   *  one exact index per level with each chunk's range in it. TRANSIENT —
   *  fillOverlays consumes it and lets it go (the fat pack copied the pairs,
   *  a GL overlay's geometry holds its index): nothing the ledger cannot see
   *  stays held (Codex R49 VP-I17). */
  ovIdx: ({ index: Uint32Array; starts: Uint32Array; counts: Uint32Array } | null)[];
}

/** A level is used when its tolerance is under this many pixels (device
 *  px) at the chunk's nearest point; stepping back to a finer level waits
 *  until the current level's tolerance exceeds LOD_PX × LOD_HYST. */
const LOD_PX = 0.5;
const LOD_HYST = 1.25;

const _sph = new THREE.Sphere();
const _camPos = new THREE.Vector3();
const _frustum = new THREE.Frustum();
const _projView = new THREE.Matrix4();
const _camInv = new THREE.Matrix4();

function sphereOfBox(b: Float32Array, o: number): THREE.Sphere {
  if (b[o]! > b[o + 3]!) return new THREE.Sphere(new THREE.Vector3(), 0);
  const cx = (b[o]! + b[o + 3]!) / 2, cy = (b[o + 1]! + b[o + 4]!) / 2, cz = (b[o + 2]! + b[o + 5]!) / 2;
  const dx = b[o + 3]! - cx, dy = b[o + 4]! - cy, dz = b[o + 5]! - cz;
  return new THREE.Sphere(new THREE.Vector3(cx, cy, cz), Math.sqrt(dx * dx + dy * dy + dz * dz));
}

/** The limit overlay draws OVER the backplot (11) and the path (10): a
 *  backplot lying on a violation never hides the finding (fixed palette P5,
 *  Codex R30 — "Backplot über einer Grenzverletzung"). */
export const LIMIT_OVERLAY_RENDER_ORDER = 12;

/** The toolpath box's dash and gap (and its overflow edges'), in the box's
 *  own units: the two meet at the machine window and dash alike. */
const BOX_DASH = 3;
const BOX_GAP = 2;
/** The rapid's dash and gap, in the path's own units (as the GL line had them). */
const RAPID_DASH = 10;
const RAPID_GAP = 6;

export function createToolpathController(deps: ToolpathDeps): ToolpathController {
  let sets: LineSet[] = [];
  let feedPosAttr: THREE.BufferAttribute | null = null;
  let rapidPosAttr: THREE.BufferAttribute | null = null;
  // Cut envelope: X/Y over feed+rapid, Z over feed only (drawn bounds box).
  let toolpathBBox: BBox | null = null;
  // Full feed+rapid envelope (machine-limit overflow check).
  let motionBBox: BBox | null = null;

  let toolpathBoundsBox: BoxEdges | null = null;
  let toolpathBoundsLabels: THREE.Group | null = null;
  let toolpathOverflowEdges: PathObj | null = null;

  let toolpathVisible = true;
  let rapidsVisible = true;
  let toolpathBoundsVisible = false;
  let pathAlwaysOnTop = true;
  let pathStale = false;
  let _chunksVisible = 0;
  let _overlayChunks = 0;
  let _frameMixed = 0;
  let _lodMin = 0;
  let _lodMax = 0;
  let _lodMs = 0;
  let lineMode: PathLineMode = deps.lineMode ?? "fat";
  // The A/B measurement's "overlay off" phase (Codex R39 VP39-03; removed
  // with the switch): the limit overlays held hidden, nothing rebuilt.
  let _overlaysHeld = false;
  // The memory ledger (Codex R39 VP39-01, R47/R48 VP-I17): GPU bytes count
  // a buffer once it was actually uploaded (three calls onUpload after the
  // first transfer); _allocated sums what the builds allocated (the meter's
  // difference across each build — viewer/allocMeter.ts counts every array
  // where it is created, scratch included), _peak the highest held-at-build-
  // start + allocated-in-build.
  const _uploaded = new WeakSet<object>();
  let _allocated = 0;
  let _peak = 0;
  let _generation = 0;
  let _eager = { estimate: 0, packed: 0 };
  const _watchUpload = (b: THREE.BufferAttribute | THREE.InterleavedBuffer) => { b.onUpload(() => { _uploaded.add(b); }); };
  /** The toolpath box's buffers, watched for their upload (the ledger's "box"). */
  const _watchBox = (root: THREE.Object3D) => root.traverse(o => {
    const g = (o as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
    if (g) _watchGeometry(g);
  });
  /** Every buffer of a geometry, watched for its upload. */
  const _watchGeometry = (g: THREE.BufferGeometry) => {
    for (const a of Object.values(g.attributes)) {
      const inter = (a as THREE.InterleavedBufferAttribute).data;
      _watchUpload(inter ?? (a as THREE.BufferAttribute));
    }
    if (g.index) _watchUpload(g.index);
  };
  /** Run a build step and raise the peak bound by what it allocated. */
  function _measured<T>(build: () => T): T {
    const held = ledger().cpu.total, a0 = allocatedBytes();
    const out = build();
    const d = allocatedBytes() - a0;
    _allocated += d;
    _peak = Math.max(_peak, held + d);
    return out;
  }
  // The last apply's DATA (never its ctx — the scene pointers are fresh per
  // call): a line-mode switch rebuilds from it.
  let _lastApply: { g: ViewerGcode; anchor: AnchorTerms | null } | null = null;

  /** The memory ledger now (Codex R39 VP39-01, R47 VP-I17) — see PathMemory. */
  function ledger(collect?: Set<ArrayBufferLike>): PathMemory {
    const seenCpu = new Set<ArrayBufferLike>();
    const seenGpu = new Set<object>();
    type Owner = "base" | "dist" | "overlay" | "reveal" | "mesh" | "box";
    const cpu = { base: 0, dist: 0, overlay: 0, reveal: 0, mesh: 0, box: 0, source: 0, payload: 0, total: 0 };
    const gpu = { base: 0, dist: 0, overlay: 0, reveal: 0, mesh: 0, box: 0, total: 0 };
    const addCpu = (owner: keyof typeof cpu, a: ArrayBufferView | null | undefined) => {
      if (!a || !ArrayBuffer.isView(a) || seenCpu.has(a.buffer)) return;
      seenCpu.add(a.buffer);
      cpu[owner] += a.buffer.byteLength;   // the CAPACITY a view keeps alive
    };
    const addGpu = (owner: Owner, buf: THREE.BufferAttribute | THREE.InterleavedBuffer | null | undefined) => {
      if (!buf || !_uploaded.has(buf) || seenGpu.has(buf)) return;
      seenGpu.add(buf);
      gpu[owner] += (buf.array as ArrayBufferView).byteLength;   // what was uploaded
    };
    const account = (o: PathObj | null, owner: Owner) => {
      if (!o) return;
      const g = o.geometry;
      const distOwner: Owner = owner === "base" ? "dist" : owner;
      if ((o as LineSegments2).isLineSegments2) {
        const st = g.getAttribute("instanceStart") as THREE.InterleavedBufferAttribute;
        addCpu(owner, st.data.array as Float32Array); addGpu(owner, st.data);
        const di = g.getAttribute("instanceDistanceStart") as THREE.InterleavedBufferAttribute | undefined;
        if (di) { addCpu(distOwner, di.data.array as Float32Array); addGpu(distOwner, di.data); }
        for (const a of [g.getAttribute("position"), g.getAttribute("uv"), g.index] as (THREE.BufferAttribute | null)[]) {
          if (a) { addCpu("mesh", a.array as ArrayBufferView); addGpu("mesh", a); }
        }
        return;
      }
      if (g.index) { addCpu(owner, g.index.array as Uint32Array); addGpu(owner, g.index); }
      addGpu("base", g.getAttribute("position") as THREE.BufferAttribute);
      addGpu("dist", g.getAttribute("lineDistance") as THREE.BufferAttribute | undefined);
    };
    for (const st of sets) {
      for (const ch of st.chunks) {
        for (const o of ch.lines) account(o, "base");
        for (const o of ch.overlays) account(o, "overlay");
      }
      account(st.reveal.line, "reveal");
      account(st.reveal.over, "reveal");
    }
    // the toolpath box and its overflow edges: every array of their geometries
    const accountBox = (root: THREE.Object3D | null) => root?.traverse(o => {
      const g = (o as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
      if (!g) return;
      for (const a of Object.values(g.attributes)) {
        const inter = (a as THREE.InterleavedBufferAttribute).data;
        const buf = inter ?? (a as THREE.BufferAttribute);
        addCpu("box", buf.array as ArrayBufferView); addGpu("box", buf);
      }
      if (g.index) { addCpu("box", g.index.array as ArrayBufferView); addGpu("box", g.index); }
    });
    accountBox(toolpathBoundsBox);
    accountBox(toolpathOverflowEdges);
    // what the controller derived and keeps (binned levels, computed distances)
    for (const st of sets) {
      for (const l of st.levels) addCpu("source", l.index);
      addCpu("source", st.bounds);   // the chunk boxes the culling keeps reading
      addCpu("source", st.dist?.array as Float32Array | undefined);
      addCpu("source", st.posAttr.array as Float32Array);
    }
    // the program's data kept for a rebuild (every typed array of the payload)
    if (_lastApply) {
      for (const v of Object.values(_lastApply.g as unknown as Record<string, unknown>)) {
        if (ArrayBuffer.isView(v)) addCpu("payload", v);
        else if (Array.isArray(v)) for (const e of v) if (ArrayBuffer.isView(e)) addCpu("payload", e);
      }
    }
    cpu.total = cpu.base + cpu.dist + cpu.overlay + cpu.reveal + cpu.mesh + cpu.box + cpu.source + cpu.payload;
    if (collect) for (const b of seenCpu) collect.add(b);
    gpu.total = gpu.base + gpu.dist + gpu.overlay + gpu.reveal + gpu.mesh + gpu.box;
    let source = 0, lod = 0, drawn = 0;
    const shown = (o: THREE.Object3D) => { for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) return false; return true; };
    for (const st of sets) {
      source += st.pairs;
      for (const ch of st.chunks) {
        lod += ch.counts[ch.level]! >> 1;
        const o = ch.lines[ch.level];
        if (!o || !shown(o)) continue;
        drawn += (o as LineSegments2).isLineSegments2
          ? (o.geometry as THREE.InstancedBufferGeometry).instanceCount
          : o.geometry.drawRange.count === Infinity ? (o.geometry.index?.count ?? 0) >> 1 : o.geometry.drawRange.count >> 1;
      }
    }
    return { mode: lineMode, cpu, gpu, allocated: _allocated, peak: _peak, eager: { ..._eager }, generation: _generation,
      pairs: { source, lod, drawn } };
  }

  /** A path material in the current line mode. depthWrite is off explicitly
   *  (LineMaterial starts with it on — Codex R39). */
  function pathMaterial(colorHex: string, dashed: boolean, role: string): PathMat {
    let m: PathMat;
    if (lineMode === "fat") {
      const lm = new LineMaterial({ color: colorHex, linewidth: PATH_PX, worldUnits: false });
      if (dashed) { lm.dashed = true; lm.dashSize = RAPID_DASH; lm.gapSize = RAPID_GAP; }
      m = lm;
    } else {
      m = dashed ? new THREE.LineDashedMaterial({ color: colorHex, dashSize: RAPID_DASH, gapSize: RAPID_GAP })
        : new THREE.LineBasicMaterial({ color: colorHex });
    }
    m.userData.role = role;
    m.depthTest = !pathAlwaysOnTop;
    m.depthWrite = false;
    return m;
  }

  /** One drawn object over the pairs index[start .. start+count): the GL
   *  line shares the stream's position attribute and `indexAttr`; the fat
   *  line PACKS them (viewer/fatPaths.ts — the dash distances from the
   *  stream's own `dist`, never re-summed). */
  function pathObject(posAttr: THREE.BufferAttribute, index: Uint32Array, indexAttr: THREE.BufferAttribute | null,
    start: number, count: number, mat: PathMat, dist: THREE.BufferAttribute | null, sphere: THREE.Sphere | null): PathObj {
    if (lineMode === "fat") {
      // packed exactly, the mesh counted by fatGeometry (allocMeter)
      const g = fatGeometry(packPairs(posAttr.array as Float32Array, index, start, count, dist ? dist.array as Float32Array : null), sphere);
      _watchGeometry(g);
      return new LineSegments2(g, mat as LineMaterial);
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", posAttr);
    if (dist) geom.setAttribute("lineDistance", dist);
    if (indexAttr) {
      geom.setIndex(indexAttr);
      geom.setDrawRange(start, count);
    } else {
      // a whole index is taken as it is (the reveal builds its own exactly)
      const own = new THREE.BufferAttribute(start === 0 && count === index.length ? index : counted(index.slice(start, start + count)), 1);
      _watchUpload(own);
      geom.setIndex(own);
    }
    if (sphere) geom.boundingSphere = sphere;
    return new THREE.LineSegments(geom, mat);
  }

  // The lines' own colours (deps.colors at apply/setColors time). The drawn
  // material colour is ONE writer's output: these, or their mix toward the
  // background while stale.
  const _feedBase = new THREE.Color();
  const _rapidBase = new THREE.Color();
  const _grey = new THREE.Color();

  function _applyStale() {
    const keep = pathStale ? (deps.staleOpacity ? deps.staleOpacity() : 0.4) : 1.0;
    if (keep < 1) {
      // ONE neutral grey for everything stale: the background lifted toward
      // the foreground by the disabled-opacity token — reads as grey on every
      // theme instead of "a dim version of the path's own colour".
      _grey.copy(deps.sceneBackground()).lerp(deps.sceneForeground(), keep);
      for (const s of sets) s.mat.color.copy(_grey);
    } else {
      for (const s of sets) s.mat.color.copy(s.stream === "feed" ? _feedBase : _rapidBase);
    }
  }

  /** Prepare one stream-in-frame set: the chunk grid and the binned level
   *  indices over the shared position attribute, the chunk boxes and the
   *  overlays' flagged pairs — everything but the drawn objects. `index`
   *  lists the real segment pairs (viewer/lineChunks.ts buildFrameIndex —
   *  section breaks are already index-skipped: the connector into a section
   *  start would be a FALSE move skipping the other stream's motion). */
  function prepareSet(
    stream: "feed" | "rapid", frame: 0 | 1, parent: THREE.Group,
    posAttr: THREE.BufferAttribute, index0: Uint32Array, lod: Uint32Array[], tols: number[],
    colorHex: string, dashed: boolean, distAttr: THREE.BufferAttribute | null,
    outside: Uint8Array | null, src: Uint32Array | null,
  ): LineSet | null {
    if (index0.length < 2) return null;
    const mat = pathMaterial(colorHex, dashed, stream);   // role = the viewer palette's (diagnostics, tests)
    // Dashed rapids need a per-vertex distance; the worker precomputes it
    // (P4.1), the legacy/WS path gets it here (indexed geometry cannot use
    // Three's computeLineDistances). A plain BufferAttribute: a
    // Float32BufferAttribute would copy the fresh array once more.
    if (dashed && !distAttr) distAttr = new THREE.BufferAttribute(cumulativeDistances(posAttr.array as Float32Array), 1);
    const pos = posAttr.array as Float32Array;
    // One grid from the level-0 pairs, every level binned into it (the index
    // buffers are permuted, the vertex order is not) so chunk c is the same
    // cell at every level; a cell used at any level becomes a chunk.
    const grid = chunkGrid(index0, pos, deps.chunkCells ?? CHUNK_MAX);
    const levels = [index0, ...lod.slice(0, tols.length)].map(l => binPairs(l, pos, grid));
    const used: number[] = [];
    for (let c = 0; c < grid.cells; c++) if (levels.some(b => b.plan[c]!.count > 0)) used.push(c);
    const bounds = f32(used.length * 6);
    bounds.fill(Infinity); for (let c = 0; c < used.length; c++) bounds.fill(-Infinity, c * 6 + 3, c * 6 + 6);
    for (const b of levels) {
      const bl = chunkBounds(b.index, pos, used.map(c => b.plan[c]!));
      for (let c = 0; c < used.length; c++) {
        if (bl[c * 6]! > bl[c * 6 + 3]!) continue;
        for (let k = 0; k < 3; k++) {
          if (bl[c * 6 + k]! < bounds[c * 6 + k]!) bounds[c * 6 + k] = bl[c * 6 + k]!;
          if (bl[c * 6 + 3 + k]! > bounds[c * 6 + 3 + k]!) bounds[c * 6 + 3 + k] = bl[c * 6 + 3 + k]!;
        }
      }
    }
    const set: LineSet = {
      stream, frame, parent, mat, overMat: null, bounds, tols: tols.slice(0, levels.length - 1),
      chunks: [], posAttr, levels, used, pairs: index0.length >> 1,
      src, dist: dashed ? distAttr : null, outside, reveal: { line: null, over: null }, ovIdx: [],
    };
    prepareOverlays(set, outside);
    return set;
  }

  /** What filling a prepared set will allocate (Codex R39/R48: the eager
   *  capacity, known BEFORE the pack): per chunk and level a fat geometry
   *  over its pairs, per flagged range an overlay geometry. The GL lines
   *  share the prepared indices and allocate no array. An upper bound —
   *  the pack drops degenerate pairs. */
  function estimateSet(s: LineSet): number {
    if (lineMode !== "fat") return 0;
    let n = 0;
    for (const cell of s.used) for (const l of s.levels) n += fatBytes(l.plan[cell]!.count >> 1, !!s.dist);
    for (const ov of s.ovIdx) {
      if (!ov) continue;
      for (let ci = 0; ci < s.used.length; ci++) if (ov.counts[ci]) n += fatBytes(ov.counts[ci]! >> 1, false);
    }
    return n;
  }

  /** The drawn objects of a prepared set: one per chunk and LOD level, then
   *  the limit overlays. Each chunk's geometry is PER-PROGRAM, not externally
   *  owned: apply() disposes it on program change, and disposeObject frees it
   *  on scene teardown — so it is deliberately NOT marked userData._shared
   *  (that flag is only for the STL cache + MAT.*, which survive a rebuild).
   *  Disposing one chunk releases the shared GL buffers; the sibling chunks
   *  go in the same pass, so nothing dangles. */
  function fillSet(set: LineSet) {
    const { stream, parent, posAttr, levels, used, bounds, mat, dist } = set;
    const attrs = levels.map(b => new THREE.BufferAttribute(b.index, 1));
    if (lineMode === "gl") {
      _watchUpload(posAttr);
      for (const a of attrs) _watchUpload(a);
      if (dist) _watchUpload(dist);
    }
    for (let ci = 0; ci < used.length; ci++) {
      const cell = used[ci]!;
      const chunk: Chunk = { lines: [], overlays: [], counts: [], ovCounts: [], level: 0,
        radius0: sphereOfBox(bounds, ci * 6).radius };
      for (let k = 0; k < levels.length; k++) {
        const range = levels[k]!.plan[cell]!;
        // Explicit sphere: a null one makes Three compute it over the WHOLE
        // shared attribute — every chunk would then carry the full program's
        // sphere and culling could never fire.
        const line = pathObject(posAttr, levels[k]!.index, attrs[k]!, range.start, range.count, mat,
          dist, sphereOfBox(bounds, ci * 6));
        line.renderOrder = 10;
        line.frustumCulled = true;
        line.visible = toolpathVisible && (stream !== "rapid" || rapidsVisible) && k === 0 && range.count > 0;
        parent.add(line);
        chunk.lines.push(line);
        chunk.overlays.push(null);
        chunk.ovCounts.push(0);
        chunk.counts.push(range.count);
      }
      set.chunks.push(chunk);
    }
    fillOverlays(set);
  }

  /** Outside-limits overlays (2026-09-12): per chunk and LOD level, the
   *  index pairs whose run ends at or passes a flagged vertex — a flag on
   *  vertex i means "the segment ending at i had a joint outside" (the
   *  gateway validator's verdict, the one source the marks and the count
   *  share), so a level-k pair (a, b) standing for the run a..b is flagged
   *  when any vertex in (a, b] is (prefix sum), and a decimated chord over
   *  an excursion stays yellow. Plain yellow, opaque, its own index buffer
   *  per level sharing the chunk's vertices; no clip planes, no box gate,
   *  nothing derived from tip geometry (the drawn path is the TOOL TIP,
   *  the limits bound the JOINTS). null = unchecked: nothing drawn.
   *  Prepared before the pack — counted, then allocated exactly — so the
   *  eager estimate knows them. */
  function prepareOverlays(s: LineSet, outside: Uint8Array | null) {
    s.ovIdx = s.levels.map(() => null);
    const nV = s.posAttr.count;
    if (!outside || outside.length !== nV) return;
    const pre = u32(nV + 1);
    for (let i = 0; i < nV; i++) pre[i + 1] = pre[i]! + (outside[i] ? 1 : 0);
    if (pre[nV] === 0) return;
    const flaggedPair = (a: number, b: number) => {
      const lo = a < b ? a : b, hi = a < b ? b : a;
      return pre[hi + 1]! - pre[lo + 1]! > 0;
    };
    const nC = s.used.length;
    for (let k = 0; k < s.levels.length; k++) {
      const { index, plan } = s.levels[k]!;
      const starts = u32(nC), counts = u32(nC);
      let w = 0;
      for (let ci = 0; ci < nC; ci++) {
        const r = plan[s.used[ci]!]!;
        starts[ci] = w;
        for (let q = r.start; q < r.start + r.count; q += 2) if (flaggedPair(index[q]!, index[q + 1]!)) w += 2;
        counts[ci] = w - starts[ci]!;
      }
      if (w === 0) continue;
      const flagged = u32(w);
      let o = 0;
      for (let ci = 0; ci < nC; ci++) {
        const r = plan[s.used[ci]!]!;
        for (let q = r.start; q < r.start + r.count; q += 2) {
          const a = index[q]!, b = index[q + 1]!;
          if (flaggedPair(a, b)) { flagged[o++] = a; flagged[o++] = b; }
        }
      }
      s.ovIdx[k] = { index: flagged, starts, counts };
    }
  }

  function fillOverlays(s: LineSet) {
    try { packOverlays(s); } finally { s.ovIdx = []; }
  }

  function packOverlays(s: LineSet) {
    if (!s.ovIdx.some(Boolean)) return;
    s.overMat = pathMaterial(deps.colors().limit, false, "limit");
    for (let k = 0; k < s.ovIdx.length; k++) {
      const ov = s.ovIdx[k];
      if (!ov) continue;
      const attr = lineMode === "gl" ? new THREE.BufferAttribute(ov.index, 1) : null;
      if (attr) _watchUpload(attr);
      for (let ci = 0; ci < s.used.length; ci++) {
        if (ov.counts[ci] === 0) continue;
        const ch = s.chunks[ci]!;
        const o = pathObject(s.posAttr, ov.index, attr, ov.starts[ci]!, ov.counts[ci]!, s.overMat, null, sphereOfBox(s.bounds, ci * 6));
        o.renderOrder = LIMIT_OVERLAY_RENDER_ORDER;
        o.frustumCulled = true;
        o.visible = false;
        s.parent.add(o);
        ch.overlays[k] = o;
        ch.ovCounts[k] = ov.counts[ci]!;
      }
    }
  }

  function rebuildOverflowEdges(size: Vec3, offset: Vec3): PathObj | null {
    if (deps.boundsClipPlanes.length === 0) return null;
    const [sx, sy, sz] = size;
    if (sx <= 0 || sy <= 0 || sz <= 0) return null;
    const [ox, oy, oz] = offset;
    if (lineMode === "fat") {
      // The box OUTSIDE the machine window, a limit finding: the limit's
      // colour at the box's width, dashed like the box — in CSS px along
      // each projected edge (screenDash, Codex R44 VP-I10; part B, Codex R39
      // — at the box's own width, TOOLPATH_BOX_PX).
      const mat = new LineMaterial({ color: deps.colors().limit, linewidth: TOOLPATH_BOX_PX, worldUnits: false });
      screenDash(mat, TOOLPATH_BOX_DASH_PX);
      mat.clipIntersection = true;
      mat.clippingPlanes = deps.boundsClipPlanes;
      mat.depthWrite = false;
      mat.userData.role = "limitBox";
      const geom = new LineSegmentsGeometry();
      countedGeometry(geom);   // three's quad mesh (allocMeter)
      geom.setPositions(boxEdgePositions(sx, sy, sz));
      const lines = new LineSegments2(geom, mat);
      lines.computeLineDistances();   // LineMaterial's own dash attributes (unused under SCREEN_DASH)
      countedLineDistances(geom);
      lines.onBeforeRender = (renderer) => { renderer.getSize(mat.resolution); };
      lines.position.set(ox + sx / 2, oy + sy / 2, oz + sz / 2);
      lines.renderOrder = 2;   // over the neutral box where the two meet
      return lines;
    }
    // the box's twelve edges written out (no BoxGeometry / EdgesGeometry scratch)
    const geom = new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(boxEdgePositions(sx, sy, sz), 3));
    // The box OUTSIDE the machine window: a limit finding, so the limit
    // overlay's ochre (fixed palette P2 — it was the collision red, a line
    // in a body's colour), dashed like the box inside.
    const mat = new THREE.LineDashedMaterial({
      color: deps.colors().limit,
      dashSize: BOX_DASH,
      gapSize: BOX_GAP,
      // Opaque (viewer contrast plan, R2): a line's contrast is its COMPOSITED
      // colour — at 0.8 the role lost a fifth of it.
      clipIntersection: true,
      clippingPlanes: deps.boundsClipPlanes,
    });
    mat.userData.role = "limitBox";
    const lines = new THREE.LineSegments(geom, mat);
    lines.computeLineDistances();
    counted(geom.getAttribute("lineDistance").array as Float32Array);
    lines.position.set(ox + sx / 2, oy + sy / 2, oz + sz / 2);
    lines.renderOrder = 2;   // over the neutral box where the two meet
    return lines;
  }

  // Parent of the current program's lines + bounds (baked anchor or the
  // live workRotGroup) — set by apply(), read by rebuildToolpathBounds.
  let _lineParent: THREE.Group | null = null;

  /** Detach + free every chunk object. Chunk geometries
   *  are private per program (disposing one releases the shared GL buffers;
   *  its siblings go in the same pass), the two materials of a set are
   *  disposed ONCE per set — not once per chunk through deps.disposeObject,
   *  which would re-dispose a shared material per object (idempotent in
   *  Three, but a wrong shape for the disposal contract tests). */
  function teardownLines() {
    for (const s of sets) {
      _dropReveal(s);
      for (const ch of s.chunks) {
        for (const o of [...ch.lines, ...ch.overlays]) {
          if (!o) continue;
          o.parent?.remove(o);
          o.geometry.dispose();
        }
      }
      s.mat.dispose();
      s.overMat?.dispose();
    }
    sets = [];
    feedPosAttr = rapidPosAttr = null;
    _chunksVisible = _overlayChunks = _frameMixed = 0;
  }

  /** Detach + free the bounds box, its labels, and the overflow edges.
   *  Removes from the object's ACTUAL parent (may be an older workRotGroup). */
  function teardownBounds() {
    if (toolpathBoundsBox) {
      toolpathBoundsBox.parent?.remove(toolpathBoundsBox);
      deps.disposeObject(toolpathBoundsBox);
      toolpathBoundsBox = null;
    }
    if (toolpathBoundsLabels) {
      toolpathBoundsLabels.traverse((c: any) => {
        if (c.dispose) {
          c.dispose();
          const i = deps.billboardLabels.indexOf(c);
          if (i >= 0) deps.billboardLabels.splice(i, 1);
        }
      });
      toolpathBoundsLabels.parent?.remove(toolpathBoundsLabels);
      toolpathBoundsLabels = null;
    }
    if (toolpathOverflowEdges) {
      toolpathOverflowEdges.parent?.remove(toolpathOverflowEdges);
      deps.disposeObject(toolpathOverflowEdges);
      toolpathOverflowEdges = null;
    }
  }

  function rebuildToolpathBounds(ctx: ToolpathCtx) {
    // The bounds box is in the SAME coordinates as the drawn vertices, so
    // it hangs under the same parent (the baked anchor when there is one;
    // the room parent when EVERY drawn segment is room-fixed).
    const workRotGroup = _lineParent ?? ctx.workRotGroup;
    teardownBounds();
    if (!toolpathBBox || !workRotGroup) return;

    const sx = toolpathBBox.max[0] - toolpathBBox.min[0];
    const sy = toolpathBBox.max[1] - toolpathBBox.min[1];
    const sz = toolpathBBox.max[2] - toolpathBBox.min[2];
    if (sx <= 0 && sy <= 0 && sz <= 0) return;

    const cx = (toolpathBBox.min[0] + toolpathBBox.max[0]) / 2;
    const cy = (toolpathBBox.min[1] + toolpathBBox.max[1]) / 2;
    const cz = (toolpathBBox.min[2] + toolpathBBox.max[2]) / 2;

    // Two-tone like the machine box, with SHORT dashes (operator 2026-09-29);
    // its size labels name it.
    const pal = deps.colors();
    toolpathBoundsBox = makeBoxEdges([sx, sy, sz], {
      color: pal.toolpathBounds, alt: pal.boundsAlt, width: TOOLPATH_BOX_PX, dashPx: TOOLPATH_BOX_DASH_PX,
      role: "toolpathBounds", clippingPlanes: deps.insideBoundsClipPlanes,
    });
    toolpathBoundsBox.position.set(cx, cy, cz);
    toolpathBoundsBox.visible = toolpathBoundsVisible;
    _watchBox(toolpathBoundsBox);
    workRotGroup.add(toolpathBoundsBox);

    toolpathOverflowEdges = rebuildOverflowEdges(
      [sx, sy, sz],
      [toolpathBBox.min[0], toolpathBBox.min[1], toolpathBBox.min[2]],
    );
    if (toolpathOverflowEdges) {
      _watchBox(toolpathOverflowEdges);
      toolpathOverflowEdges.visible = toolpathBoundsVisible;
      workRotGroup.add(toolpathOverflowEdges);
    }

    toolpathBoundsLabels = new THREE.Group();
    const fs = Math.max(sx, sy, sz) * 0.05;
    const unit = ctx.units === "in" || ctx.units === "inch" ? "in" : "mm";
    const ox = toolpathBBox.min[0], oy = toolpathBBox.min[1], oz = toolpathBBox.min[2];
    const axes: [string, number, THREE.Vector3, string][] = [
      ["X", sx, new THREE.Vector3(ox + sx / 2, oy, oz), deps.axisCss.x],
      ["Y", sy, new THREE.Vector3(ox, oy + sy / 2, oz), deps.axisCss.y],
      ["Z", sz, new THREE.Vector3(ox, oy, oz + sz / 2), deps.axisCss.z],
    ];
    for (const [name, size, pos, c] of axes) {
      const lbl = deps.makeLabel(`${name}: ${size.toFixed(0)} ${unit}`, c, fs);
      lbl.position.copy(pos);
      toolpathBoundsLabels.add(lbl);
      deps.billboardLabels.push(lbl);
    }
    toolpathBoundsLabels.visible = toolpathBoundsVisible;
    workRotGroup.add(toolpathBoundsLabels);
  }

  // The HUD "exceeds bounds" verdict comes from the per-line soft-limit
  // VALIDATOR — the same source of truth as the marked lines and scrub
  // findings (W2 follow-up, operator-caught): the old geometric box here
  // applied ONE live TLO uniformly to an envelope built from mixed-TLO
  // segments, so a `G53 G0 Z0` retract with G43 active flagged Z by
  // exactly the tool length while the validator (per-segment TLO,
  // joint-side) and the real run were both clean. Two implementations of
  // one check will disagree; the weaker one is gone. The validator stays
  // current via the P4 TLO-drift auto-reparse; WCS drift between
  // reparses is covered by the "Preview uses older offsets — Refresh"
  // hint, not by a second geometric guess. null violations (INI without
  // limits) = unchecked, and the stats dialog already says "Not
  // validated" — the HUD must not claim either way.
  function updateOverflowFromValidator(g: ViewerGcode) {
    const n = typeof g.violations_total === "number" && g.violations_total > 0 ? g.violations_total : 0;
    deps.overflow.value = n > 0;
    if (deps.overflowCount) deps.overflowCount.value = n;
  }

  /** Only the chunk's current level draws; the overlay of that level only
   *  where it has flagged pairs, and never while the path is stale (its
   *  limits verdict is stale too). */
  /** A chunk's lines follow the toolpath layer — a rapid's the Rapids layer
   *  too — while its limit overlay follows the toolpath layer ALONE: a
   *  finding stays visible on a hidden rapid (Codex R29 VP29-04). */
  function _chunkVis(s: LineSet, ci: number) {
    const ch = s.chunks[ci]!;
    for (let k = 0; k < ch.lines.length; k++) {
      const on = toolpathVisible && k === ch.level && ch.counts[k]! > 0;
      ch.lines[k]!.visible = on && (s.stream !== "rapid" || rapidsVisible);
      const ov = ch.overlays[k];
      if (ov) ov.visible = on && !pathStale && !_overlaysHeld && (ch.ovCounts[k] ?? 0) > 0;
    }
  }

  function _applyVisibility() {
    for (const s of sets) {
      for (let ci = 0; ci < s.chunks.length; ci++) _chunkVis(s, ci);
      _revealVis(s);
    }
  }

  /** A section draws only where its stream's own lines are hidden; its limit
   *  mark only where the toolpath layer hides the stream's overlay. */
  function _revealVis(s: LineSet) {
    const own = toolpathVisible && (s.stream !== "rapid" || rapidsVisible);
    if (s.reveal.line) s.reveal.line.visible = !own;
    if (s.reveal.over) s.reveal.over.visible = !toolpathVisible && !pathStale;
  }

  function _dropReveal(s: LineSet) {
    for (const o of [s.reveal.line, s.reveal.over]) {
      if (!o) continue;
      o.parent?.remove(o);
      o.geometry.dispose();   // the materials are the set's
    }
    s.reveal = { line: null, over: null };
  }

  let _section: PathSection | null = null;
  /** (Re)build the section's objects per set from the level-0 pairs (every
   *  real segment of the set — breaks and frame flips are already out). */
  function _buildReveal() {
    for (const s of sets) {
      _dropReveal(s);
      const r = _section;
      if (!r || !s.src || !(s.stream === "feed" ? r.feed : r.rapid)) continue;
      const [a, b] = r.run;
      const index = s.levels[0]!.index, src = s.src, outside = s.outside;
      // the segment ending at the pair's later vertex
      const inRun = (q: number) => { const j = src[Math.max(index[q]!, index[q + 1]!)]!; return j >= a && j <= b; };
      const isFlagged = (q: number) => !!outside?.[Math.max(index[q]!, index[q + 1]!)];
      // counted, then allocated exactly (allocMeter — no growing JS array)
      let np = 0, nf = 0;
      for (let q = 0; q + 1 < index.length; q += 2) if (inRun(q)) { np++; if (isFlagged(q)) nf++; }
      const pairs = u32(np * 2), flagged = u32(s.overMat ? nf * 2 : 0);
      let wp = 0, wf = 0;
      for (let q = 0; q + 1 < index.length; q += 2) {
        if (!inRun(q)) continue;
        pairs[wp++] = index[q]!; pairs[wp++] = index[q + 1]!;
        if (flagged.length && isFlagged(q)) { flagged[wf++] = index[q]!; flagged[wf++] = index[q + 1]!; }
      }
      const make = (idx: Uint32Array, mat: PathMat, order: number) => {
        const o = pathObject(s.posAttr, idx, null, 0, idx.length, mat, s.dist, null);
        o.renderOrder = order;
        o.frustumCulled = false;   // a handful of segments
        s.parent.add(o);
        return o;
      };
      if (pairs.length) s.reveal.line = make(pairs, s.mat, 10);
      if (flagged.length && s.overMat) s.reveal.over = make(flagged, s.overMat, LIMIT_OVERLAY_RENDER_ORDER);
      _revealVis(s);
    }
  }

  return {
    apply(ctx, g, anchor = null) {
      if (!ctx.scene || !ctx.workOrigin) return;
      _lastApply = { g, anchor };
      pathAlwaysOnTop = ctx.pathAlwaysOnTop;
      const workRotGroup = ctx.workRotGroup;
      // Baked geometry rides its OWN anchor, posed here and nowhere else —
      // the pose and the vertices change in the same call (the run-time
      // "jump then return" was the live origin moving ahead of a re-bake).
      const baked = anchor != null && ctx.pathAnchor != null && ctx.pathRot != null;
      const lineParent: THREE.Group | null = baked ? ctx.pathRot : workRotGroup;
      // Room-fixed parent, same rule: a bake's own anchor, else the live
      // origin — under the MACHINE frame. null = the machine has no work-
      // chain rotary (every vertex rides, as before).
      const roomParent: THREE.Group | null = baked ? ctx.roomRot : ctx.roomRotGroup;
      _lineParent = lineParent;
      if (baked) {
        ctx.pathAnchor!.position.set(anchor!.ox, anchor!.oy, anchor!.oz);
        ctx.pathRot!.rotation.z = THREE.MathUtils.degToRad(anchor!.thetaDeg);
        if (ctx.roomAnchor && ctx.roomRot) {
          ctx.roomAnchor.position.set(anchor!.ox, anchor!.oy, anchor!.oz);
          ctx.roomRot.rotation.z = THREE.MathUtils.degToRad(anchor!.thetaDeg);
        }
      }

      // Program change: free every replaced line (geometry + material).
      teardownLines();
      // The ledger (Codex R47 VP-I17): what is held once the old lines are
      // gone, and what this build allocates — the peak bound of the rebuild.
      // The box goes with the lines: it is rebuilt below, and held from here
      // on is what this build starts from.
      teardownBounds();
      _generation++;
      const held0 = ledger().cpu.total, a0 = allocatedBytes();

      // Prefer the flat Float32Array buffers from previewWorker (P4.1); fall back to
      // the nested arrays (WS path / older payloads). The wire's raw Uint8Array form
      // never reaches here — previewWorker always converts it to feedPos/rapidPos —
      // so the fallback accepts only the nested-list shape. feed_lines is
      // index-aligned to the point index either way.
      const _legacyPts = (v: unknown): number[][] => (Array.isArray(v) ? (v as number[][]) : []);
      const _flat = (d: number[][] | Float32Array): Float32Array => {
        if (d instanceof Float32Array) return d;
        const f = f32(d.length * 3);   // filled in place: no flat() scratch array
        for (let i = 0; i < d.length; i++) { const p = d[i]!; f[i * 3] = p[0]!; f[i * 3 + 1] = p[1]!; f[i * 3 + 2] = p[2]!; }
        return f;
      };
      const feedData: number[][] | Float32Array = g.feedPos ?? _legacyPts(g.feed);
      const rapidData: number[][] | Float32Array = g.rapidPos ?? _legacyPts(g.rapid);
      const _pointCount = (d: number[][] | Float32Array) =>
        d instanceof Float32Array ? d.length / 3 : d.length;

      // Feed + Rapid toolpath chunks — each chunk's geometry is shared with its
      // overflow overlay. Section breaks (track-derived streams) index-skip the
      // false connectors across feed/rapid interleaves; absent on legacy data,
      // every consecutive pair is a segment.
      const feedColor = deps.colors().feed;
      const rapidColor = deps.colors().rapid;
      _feedBase.set(feedColor);
      _rapidBase.set(rapidColor);
      // Per stream: real segment pairs split by frame (viewer/lineChunks.ts
      // buildFrameIndex — a room mask only counts when a room parent exists),
      // each frame's pairs as one chunked set under its own parent.
      const roomMaskOf = (m: Uint8Array | undefined, n: number): Uint8Array | null =>
        (roomParent && m instanceof Uint8Array && m.length === n) ? m : null;
      // Outside-limits flags must address THESE vertices; a length mismatch
      // (flags from another vertex set) is dropped loudly, never misdrawn.
      const outsideOf = (m: Uint8Array | undefined, n: number, stream: string): Uint8Array | null => {
        if (!(m instanceof Uint8Array)) return null;
        if (m.length !== n) { console.warn(`[toolpath] ${stream} outside flags (${m.length}) do not match the drawn vertices (${n}) — overlay dropped`); return null; }
        return m;
      };
      // Display LOD levels the producing worker cut over these vertices (see
      // lineChunks.buildLodLevels), split per frame here; absent = level 0.
      const lodTols = Array.isArray(g.lodTols) ? g.lodTols.filter(t => typeof t === "number" && t > 0) : [];
      const levelsByFrame = (lod: Uint32Array[] | undefined, room: Uint8Array | null): { table: Uint32Array[]; room: Uint32Array[] } => {
        const out = { table: [] as Uint32Array[], room: [] as Uint32Array[] };
        if (!Array.isArray(lod)) return out;
        for (let k = 0; k < lodTols.length && k < lod.length; k++) {
          const sp = splitPairsByFrame(lod[k]!, room);
          out.table.push(sp.table); out.room.push(sp.room);
          _frameMixed += sp.mixed;
        }
        return out;
      };
      _lodMs = typeof g.lodMs === "number" ? g.lodMs : 0;
      // Source track index per drawn vertex (the finding's section, setReveal):
      // must address THESE vertices, else no section is drawn.
      const srcOf = (m: Uint32Array | undefined, n: number): Uint32Array | null =>
        (m instanceof Uint32Array && m.length === n) ? m : null;
      const prepared: LineSet[] = [];
      if (lineParent && _pointCount(feedData) >= 2) {
        const flat = _flat(feedData);
        const n = flat.length / 3;
        feedPosAttr = new THREE.BufferAttribute(flat, 3);
        const rm = roomMaskOf(g.feedRoom, n);
        const fi = buildFrameIndex(n, g.feedBreaks ?? null, rm);
        _frameMixed += fi.mixed;
        const lv = levelsByFrame(g.feedLod, rm);
        const ov = outsideOf(g.feedOutside, n, "feed");
        const src = srcOf(g.feedSrc, n);
        const st = prepareSet("feed", 0, lineParent, feedPosAttr, fi.table, lv.table, lodTols, feedColor, false, null, ov, src);
        if (st) prepared.push(st);
        const sr = roomParent ? prepareSet("feed", 1, roomParent, feedPosAttr, fi.room, lv.room, lodTols, feedColor, false, null, ov, src) : null;
        if (sr) prepared.push(sr);
      }
      if (lineParent && _pointCount(rapidData) >= 2) {
        const flat = _flat(rapidData);
        const n = flat.length / 3;
        rapidPosAttr = new THREE.BufferAttribute(flat, 3);
        // Worker-precomputed lineDistance when the flat buffer is in use (P4.1);
        // undefined on the WS/legacy path → the set computes its own.
        const _rapidDist = rapidData === g.rapidPos && g.rapidDist instanceof Float32Array ? g.rapidDist : undefined;
        const distAttr = _rapidDist ? new THREE.BufferAttribute(_rapidDist, 1) : null;   // the worker's array, no copy
        const rm = roomMaskOf(g.rapidRoom, n);
        const fi = buildFrameIndex(n, g.rapidBreaks ?? null, rm);
        _frameMixed += fi.mixed;
        const lv = levelsByFrame(g.rapidLod, rm);
        const ov = outsideOf(g.rapidOutside, n, "rapid");
        const src = srcOf(g.rapidSrc, n);
        const st = prepareSet("rapid", 0, lineParent, rapidPosAttr, fi.table, lv.table, lodTols, rapidColor, true, distAttr, ov, src);
        if (st) prepared.push(st);
        const sr = roomParent ? prepareSet("rapid", 1, roomParent, rapidPosAttr, fi.room, lv.room, lodTols, rapidColor, true, distAttr, ov, src) : null;
        if (sr) prepared.push(sr);
      }
      // The EAGER pack (Codex R39/R48): its capacity estimated from the
      // prepared pair counts BEFORE the first pair is packed, then packed.
      const estimate = prepared.reduce((n, st) => n + estimateSet(st), 0);
      const p0 = allocatedBytes();
      for (const st of prepared) { fillSet(st); sets.push(st); }
      _eager = { estimate, packed: allocatedBytes() - p0 };
      // Every drawn segment room-fixed ⇒ the bounds box rides the room parent.
      if (roomParent && sets.length && sets.every(s => s.frame === 1)) _lineParent = roomParent;
      _applyStale();   // sticky across rebuilds: a re-parse in flight keeps the new lines muted too
      _buildReveal();  // sticky too: a re-bake of the same program keeps the finding's section

      // Toolpath bounding boxes (work coordinates). `toolpathBBox` is the cut
      // envelope for the drawn bounds box: X/Y over feed+rapid, Z over feed only
      // so vertical rapids (retracts, safe-height moves) don't inflate the
      // displayed Z extent. `motionBBox` is the full feed+rapid envelope for the
      // machine-limit overflow check. Prefer the boxes the parse worker computed
      // over the same decimated polyline (P4.1) so we don't re-scan every point
      // on the UI thread; fall back to a main-thread pass for the WS/legacy path
      // that carries no bounds.
      toolpathBBox = null;
      motionBBox = null;
      const _asBBox = (b: unknown): BBox | null => {
        const w = b as { min?: number[]; max?: number[] } | null | undefined;
        if (w && Array.isArray(w.min) && Array.isArray(w.max) && w.min.length === 3) {
          return {
            min: [w.min[0]!, w.min[1]!, w.min[2]!],
            max: [w.max[0]!, w.max[1]!, w.max[2]!],
          };
        }
        return null;
      };
      toolpathBBox = _asBBox(g.bounds);
      motionBBox = _asBBox(g.motion_bounds);
      if (!toolpathBBox || !motionBBox) {
        const mn: [number, number, number] = [Infinity, Infinity, Infinity];
        const mx: [number, number, number] = [-Infinity, -Infinity, -Infinity];
        const mmn: [number, number, number] = [Infinity, Infinity, Infinity];
        const mmx: [number, number, number] = [-Infinity, -Infinity, -Infinity];
        let _anyPt = false;
        // axes: 3 = all (feed), 2 = X/Y only (rapid — Z excluded from the cut box)
        const _scanBBox = (d: number[][] | Float32Array, axes: 2 | 3) => {
          if (d instanceof Float32Array) {
            for (let i = 0; i + 2 < d.length; i += 3) {
              _anyPt = true;
              for (let k = 0; k < 3; k++) {
                const v = d[i + k]!;
                if (k < axes) { if (v < mn[k]!) mn[k] = v; if (v > mx[k]!) mx[k] = v; }
                if (v < mmn[k]!) mmn[k] = v; if (v > mmx[k]!) mmx[k] = v;
              }
            }
          } else {
            for (const p of d) {
              _anyPt = true;
              for (let k = 0; k < 3; k++) {
                const v = p[k]!;
                if (k < axes) { if (v < mn[k]!) mn[k] = v; if (v > mx[k]!) mx[k] = v; }
                if (v < mmn[k]!) mmn[k] = v; if (v > mmx[k]!) mmx[k] = v;
              }
            }
          }
        };
        const _anyFeed = _pointCount(feedData) > 0;
        _scanBBox(feedData, 3);
        _scanBBox(rapidData, 2);
        if (!toolpathBBox && _anyFeed) toolpathBBox = { min: mn, max: mx };
        if (!motionBBox && _anyPt) motionBBox = { min: mmn, max: mmx };
      }
      updateOverflowFromValidator(g);
      rebuildToolpathBounds(ctx);

      // Apply stored toolpath visibility (may have been set before lines existed)
      _applyVisibility();
      // this build's peak — reset per build (a phase record compares ITS
      // build, never the highest since the controller began); a later reveal
      // on this path raises it
      const d = allocatedBytes() - a0;
      _allocated += d;
      _peak = held0 + d;

      deps.requestRender();
    },

    updateCulling(_ctx, camera, heightPx = 1000) {
      if (sets.length === 0) { _chunksVisible = _overlayChunks = 0; _lodMin = _lodMax = 0; return; }
      camera.updateMatrixWorld();
      _camInv.copy(camera.matrixWorld).invert();
      _projView.multiplyMatrices(camera.projectionMatrix, _camInv);
      _frustum.setFromProjectionMatrix(_projView);
      camera.getWorldPosition(_camPos);
      // World units per DEVICE pixel at a distance d: perspective = 2·d·tan(fov/2)/h,
      // orthographic = the frustum height over the viewport.
      const pc = camera as THREE.PerspectiveCamera;
      const oc = camera as THREE.OrthographicCamera;
      const persp = !!pc.isPerspectiveCamera;
      const tanHalf = persp ? Math.tan(THREE.MathUtils.degToRad(pc.fov) / 2) : 0;
      const h = Math.max(1, heightPx);
      const orthoWupp = (!persp && oc.isOrthographicCamera) ? Math.abs(oc.top - oc.bottom) / (oc.zoom || 1) / h : 0;
      let visible = 0, overlaysOn = 0, lodMin = Infinity, lodMax = 0;
      for (const s of sets) {
        s.parent.updateWorldMatrix(true, false);
        for (let ci = 0; ci < s.chunks.length; ci++) {
          const ch = s.chunks[ci]!;
          _sph.copy(ch.lines[0]!.geometry.boundingSphere!).applyMatrix4(s.parent.matrixWorld);
          if (_frustum.intersectsSphere(_sph)) visible++;
          let changed = false;
          // LOD: the coarsest level whose tolerance is under LOD_PX device
          // pixels at the chunk's NEAREST point (conservative); stepping back
          // to a finer level only once the current one clearly exceeds it.
          const d = persp ? Math.max(1e-6, _sph.center.distanceTo(_camPos) - _sph.radius) : 0;
          const wupp = persp ? 2 * d * tanHalf / h : orthoWupp;
          // A fat line reaches PATH_PX (CSS px, up to DPR 2 device px each)
          // past its centre line: widen the chunk's sphere by that much at its
          // distance, or a stroke still reaching into the view is culled at
          // the frame edge (Codex R39).
          if (lineMode === "fat") {
            const r = ch.radius0 + PATH_PX * 2 * wupp;
            for (const o of ch.lines) { const bs = o.geometry.boundingSphere; if (bs) bs.radius = r; }
            for (const o of ch.overlays) { const bs = o?.geometry.boundingSphere; if (bs) bs.radius = r; }
          }
          if (s.tols.length) {
            let target = 0;
            for (let k = 1; k <= s.tols.length; k++) {
              if (s.tols[k - 1]! <= LOD_PX * wupp) target = k; else break;
            }
            if (target < ch.level && s.tols[ch.level - 1]! <= LOD_PX * LOD_HYST * wupp) target = ch.level;
            if (target !== ch.level) { ch.level = target; changed = true; }
          }
          if (changed) _chunkVis(s, ci);
          const ov = ch.overlays[ch.level];
          if (ov?.visible) overlaysOn++;
          if (ch.level < lodMin) lodMin = ch.level;
          if (ch.level > lodMax) lodMax = ch.level;
        }
      }
      _chunksVisible = visible;
      _overlayChunks = overlaysOn;
      _lodMin = lodMin === Infinity ? 0 : lodMin;
      _lodMax = lodMax;
    },

    setStale(on) {
      pathStale = on;
      _applyStale();
      _applyVisibility();
    },

    setVisible(on) {
      toolpathVisible = on;
      _applyVisibility();
    },

    setRapidsVisible(on) {
      rapidsVisible = on;
      _applyVisibility();
    },

    setReveal(r) {
      _section = r ? { run: [r.run[0], r.run[1]], feed: r.feed, rapid: r.rapid } : null;
      _measured(() => _buildReveal());
      deps.requestRender();
    },

    setBoundsVisible(on) {
      toolpathBoundsVisible = on;
      if (toolpathBoundsBox) toolpathBoundsBox.visible = on;
      if (toolpathBoundsLabels) toolpathBoundsLabels.visible = on;
      if (toolpathOverflowEdges) toolpathOverflowEdges.visible = on;
    },

    setLineMode(mode, ctx) {
      if (mode === lineMode) return;
      lineMode = mode;
      if (_lastApply) this.apply(ctx, _lastApply.g, _lastApply.anchor);
    },

    get lineMode() { return lineMode; },

    rebuild(ctx) {
      if (_lastApply) this.apply(ctx, _lastApply.g, _lastApply.anchor);
    },

    release() {
      teardownLines();
      teardownBounds();
      deps.requestRender();
    },

    get generation() { return _generation; },

    holdOverlays(on) {
      _overlaysHeld = on;
      _applyVisibility();
      deps.requestRender();
    },

    get hasOverlays() { return sets.some(st => st.overMat !== null); },

    pathWorldBox() {
      const out = new THREE.Box3();
      const b = new THREE.Box3();
      for (const st of sets) {
        st.parent.updateWorldMatrix(true, false);
        for (let ci = 0; ci < st.chunks.length; ci++) {
          const o = ci * 6;
          b.min.set(st.bounds[o]!, st.bounds[o + 1]!, st.bounds[o + 2]!);
          b.max.set(st.bounds[o + 3]!, st.bounds[o + 4]!, st.bounds[o + 5]!);
          out.union(b.applyMatrix4(st.parent.matrixWorld));
        }
      }
      return out.isEmpty() ? null : out;
    },

    pathMemory() { return ledger(); },
    heldBuffers() { const b = new Set<ArrayBufferLike>(); ledger(b); return b; },

    setAlwaysOnTop(on) {
      pathAlwaysOnTop = on;
      const dt = !on; // depthTest: false = always on top
      for (const s of sets) {
        for (const m of [s.mat, s.overMat]) {
          if (!m) continue;
          m.depthTest = dt; m.depthWrite = false; m.needsUpdate = true;
        }
      }
    },

    setColors(c) {
      _feedBase.set(c.feed);
      _rapidBase.set(c.rapid);
      toolpathBoundsBox?.setColors(c.toolpathBounds, c.boundsAlt);
      for (const s of sets) s.overMat?.color.set(c.limit);
      if (toolpathOverflowEdges) (toolpathOverflowEdges.material as PathMat).color.set(c.limit);
      _applyStale();   // the drawn colour is the base or its muted mix — one writer
    },

    forgetAfterSceneClear() {
      _lastApply = null;
      sets = [];
      feedPosAttr = rapidPosAttr = null;
      _chunksVisible = _overlayChunks = _frameMixed = 0;
      toolpathBoundsBox = toolpathOverflowEdges = null;
      toolpathBoundsLabels = null;
      toolpathBBox = null;
      motionBBox = null;
      deps.overflow.value = false;
      if (deps.overflowCount) deps.overflowCount.value = 0;
    },

    dispose() {
      _lastApply = null;
      teardownLines();
      teardownBounds();
      toolpathBBox = null;
      motionBBox = null;
      deps.overflow.value = false;
      if (deps.overflowCount) deps.overflowCount.value = 0;
    },

    get feedSegs() { return feedPosAttr?.count ?? 0; },
    get rapidSegs() { return rapidPosAttr?.count ?? 0; },
    get drawSegs() {
      let n = 0;
      for (const s of sets) for (const ch of s.chunks) n += ch.counts[ch.level]! >> 1;
      return n;
    },
    get chunks() { let n = 0; for (const s of sets) n += s.chunks.length; return n; },
    get lodMin() { return _lodMin; },
    get lodMax() { return _lodMax; },
    get lodMs() { return _lodMs; },
    get chunksVisible() { return _chunksVisible; },
    get overlayChunks() { return _overlayChunks; },
    get frameMixed() { return _frameMixed; },
    get roomSegs() { let n = 0; for (const s of sets) if (s.frame === 1) n += s.pairs; return n; },
  };
}
