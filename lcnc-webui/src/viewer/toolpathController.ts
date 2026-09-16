// Toolpath controller (frontend split, A3.4 — extracted from ThreeViewer.vue).
//
// The largest controller: owns the rendered program preview — feed + rapid
// polylines drawn as CHUNKS (viewer/lineChunks.ts: a few dozen contiguous
// index ranges over ONE shared position attribute, each its own object with an
// explicit bounding sphere so frustum culling and display LOD work per
// chunk; the outside-limits overlay is a per-chunk index SUBSET of the pairs
// touching a vertex the producing worker flagged beyond a joint limit —
// joint-side, TLO-inclusive, no clip planes), the highlight line (shares
// feed's position attribute,
// independent drawRange), the toolpath bounding box + axis labels + out-of-
// bounds edges, the source-line→point-range map, and the machine-bounds
// overflow check.
//
// Factory deps are STABLE references (created once, mutated in place): the two
// clip-plane arrays (transformed per-frame by the orchestrator), the billboard-
// label registry, the troika label factory, the live colour getter, the
// disposeObject helper, and the overflow ref the HUD reads. Per-call ToolpathCtx
// carries the REASSIGNED scene-graph pointers (scene/workOrigin/workRotGroup)
// plus per-program data (pathAlwaysOnTop/units) — never cached.
import * as THREE from "three";
import { buildLineIndex, emptyLineIndex, lineHas, lineRange, type LineIndex } from "./lineIndex";
import { binPairs, buildFrameIndex, CHUNK_MAX, chunkBounds, chunkGrid, cumulativeDistances, splitPairsByFrame, unionBounds } from "./lineChunks";
import type { AnchorTerms } from "./partFrame";
import type { Ref } from "vue";
import type { Text } from "troika-three-text";
import type { ViewerGcode } from "../lcncWs";
import type { Vec3 } from "../defaults";

type BBox = { min: [number, number, number]; max: [number, number, number] };
type Colors = { feed?: string; rapid?: string; toolpathBounds?: string };

export interface ToolpathDeps {
  requestRender: () => void;
  boundsClipPlanes: THREE.Plane[];
  insideBoundsClipPlanes: THREE.Plane[];
  billboardLabels: Text[];
  makeLabel: (text: string, color: string, fontSize: number) => Text;
  disposeObject: (o: THREE.Object3D) => void;
  colors: () => Colors;              // reads viewerDefaults.colors fresh each call
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
  setHighlight(curLine: number | null): void;
  /** Positional highlight (review P3): light the drawn-feed vertices whose
   *  source TRACK index falls in [start, end] — line numbers cannot address
   *  a run once a called sub's numbering collides with the main file's.
   *  No-op fallback to nothing when the drawn stream carries no src map. */
  setHighlightTrackRange(range: [number, number] | null): void;
  setVisible(on: boolean): void;
  setBoundsVisible(on: boolean): void;
  setAlwaysOnTop(on: boolean): void;
  /** Live-update feed/rapid/toolpath-bounds colours on existing lines. */
  setColors(c: { feed?: string; rapid?: string; toolpathBounds?: string }): void;
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

/** The scrub/line highlight, one per frame present: an indexed LineSegments
 *  over the feed position attribute with its OWN small index buffer, filled
 *  per highlight with the pairs of the lit vertex range that belong to this
 *  frame (a strip drawRange would draw a connector across a frame flip, and
 *  the spatially binned draw index is not in vertex order). */
interface Highlight { frame: 0 | 1; line: THREE.LineSegments; idx: Uint32Array; attr: THREE.BufferAttribute }
const HL_CAP = 1 << 15;   // pairs per highlight (a line run is far smaller; beyond it the cue truncates)

/** One drawn stream in one frame: its chunks (objects sharing the stream's
 *  position attribute + this set's index attribute), materials, and the
 *  per-chunk local boxes the overlay gate tests. */
/** One chunk (a grid cell) of a set: one geometry PER LOD LEVEL sharing the
 *  stream's position attribute and that level's index attribute, only the
 *  current level's objects visible — a level switch is a visibility flip
 *  (no VAO rebind), and disposing every level's geometry frees every index
 *  buffer (a swapped-out index attribute would otherwise leak its GL
 *  buffer: Three only deletes a geometry's CURRENT index on dispose). */
interface Chunk {
  lines: THREE.LineSegments[];             // per level
  overlays: (THREE.LineSegments | null)[]; // per level — null where nothing is flagged
  counts: number[];                        // index entries per level (0 = nothing at that level)
  ovCounts: number[];                      // flagged index entries per level
  level: number;
}

interface LineSet {
  stream: "feed" | "rapid";
  frame: 0 | 1;
  parent: THREE.Group;
  mat: THREE.LineBasicMaterial | THREE.LineDashedMaterial;
  overMat: THREE.LineBasicMaterial | null;  // built with the overlays (buildOverlays)
  bounds: Float32Array;                  // 6 per chunk (union over levels), parent-local coordinates
  tols: number[];                        // tolerance of level k ≥ 1 (machine units)
  chunks: Chunk[];
  posAttr: THREE.BufferAttribute;        // the shared vertices (overlays rebuild from them)
  levels: ReturnType<typeof binPairs>[]; // binned pairs per level, chunk order (level 0 first)
  used: number[];                        // grid cell of each chunk
  pairs: number;                         // level-0 segments
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

export function createToolpathController(deps: ToolpathDeps): ToolpathController {
  let sets: LineSet[] = [];
  let feedPosAttr: THREE.BufferAttribute | null = null;
  let rapidPosAttr: THREE.BufferAttribute | null = null;
  let highlights: Highlight[] = [];
  // Per feed vertex (drawn order): opens a section / draws room-fixed —
  // the highlight's pair filter.
  let feedIsBreak: Uint8Array | null = null;
  let feedRoomMask: Uint8Array | null = null;
  // g-code line number → { start, end } point-index range in feed arrays
  let feedLineIndex: LineIndex = emptyLineIndex();
  // Source track index per drawn feed vertex (ascending) — the positional
  // highlight's address space. Absent on legacy/track-less payloads.
  let feedSrc: Uint32Array | null = null;
  // Cut envelope: X/Y over feed+rapid, Z over feed only (drawn bounds box).
  let toolpathBBox: BBox | null = null;
  // Full feed+rapid envelope (machine-limit overflow check).
  let motionBBox: BBox | null = null;

  let toolpathBoundsBox: THREE.LineSegments | null = null;
  let toolpathBoundsLabels: THREE.Group | null = null;
  let toolpathOverflowEdges: THREE.LineSegments | null = null;

  let toolpathVisible = true;
  let toolpathBoundsVisible = false;
  let pathAlwaysOnTop = true;
  let pathStale = false;
  let _chunksVisible = 0;
  let _overlayChunks = 0;
  let _frameMixed = 0;
  let _lodMin = 0;
  let _lodMax = 0;
  let _lodMs = 0;
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

  /** Build one stream-in-frame set: chunk objects over the shared position
   *  attribute. `index` lists the real segment pairs (viewer/lineChunks.ts
   *  buildFrameIndex — section breaks are already index-skipped: the
   *  connector into a section start would be a FALSE move skipping the other
   *  stream's motion). Each chunk's geometry is PER-PROGRAM, not externally
   *  owned: apply() disposes it on program change, and disposeObject frees it
   *  on scene teardown — so it is deliberately NOT marked userData._shared
   *  (that flag is only for the STL cache + MAT.*, which survive a rebuild).
   *  Disposing one chunk releases the shared GL buffers; the sibling chunks
   *  go in the same pass, so nothing dangles. */
  function makeSet(
    stream: "feed" | "rapid", frame: 0 | 1, parent: THREE.Group,
    posAttr: THREE.BufferAttribute, index0: Uint32Array, lod: Uint32Array[], tols: number[],
    colorHex: string, dashed: boolean, distAttr: THREE.BufferAttribute | null,
    outside: Uint8Array | null,
  ): LineSet | null {
    if (index0.length < 2) return null;
    let mat: THREE.LineBasicMaterial | THREE.LineDashedMaterial;
    if (dashed) {
      mat = new THREE.LineDashedMaterial({ color: colorHex, dashSize: 10, gapSize: 6 });
    } else {
      mat = new THREE.LineBasicMaterial({ color: colorHex });
    }
    mat.depthTest = !pathAlwaysOnTop;
    mat.depthWrite = false;
    // Dashed rapids need a per-vertex distance; the worker precomputes it
    // (P4.1), the legacy/WS path gets it here (indexed geometry cannot use
    // Three's computeLineDistances).
    if (dashed && !distAttr) distAttr = new THREE.Float32BufferAttribute(cumulativeDistances(posAttr.array as Float32Array), 1);
    const pos = posAttr.array as Float32Array;
    // One grid from the level-0 pairs, every level binned into it (the index
    // buffers are permuted, the vertex order is not) so chunk c is the same
    // cell at every level; a cell used at any level becomes a chunk.
    const grid = chunkGrid(index0, pos, deps.chunkCells ?? CHUNK_MAX);
    const levels = [index0, ...lod.slice(0, tols.length)].map(l => binPairs(l, pos, grid));
    const attrs = levels.map(b => new THREE.BufferAttribute(b.index, 1));
    const used: number[] = [];
    for (let c = 0; c < grid.cells; c++) if (levels.some(b => b.plan[c]!.count > 0)) used.push(c);
    const bounds = new Float32Array(used.length * 6);
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
    };
    for (let ci = 0; ci < used.length; ci++) {
      const cell = used[ci]!;
      const chunk: Chunk = { lines: [], overlays: [], counts: [], ovCounts: [], level: 0 };
      for (let k = 0; k < levels.length; k++) {
        const range = levels[k]!.plan[cell]!;
        const geom = new THREE.BufferGeometry();
        geom.setAttribute("position", posAttr);
        if (dashed) geom.setAttribute("lineDistance", distAttr!);
        geom.setIndex(attrs[k]!);
        geom.setDrawRange(range.start, range.count);
        // Explicit sphere: a null one makes Three compute it over the WHOLE
        // shared attribute — every chunk would then carry the full program's
        // sphere and culling could never fire.
        geom.boundingSphere = sphereOfBox(bounds, ci * 6);
        const line = new THREE.LineSegments(geom, mat);
        line.renderOrder = 10;
        line.frustumCulled = true;
        line.visible = toolpathVisible && k === 0 && range.count > 0;
        parent.add(line);
        chunk.lines.push(line);
        chunk.overlays.push(null);
        chunk.ovCounts.push(0);
        chunk.counts.push(range.count);
      }
      set.chunks.push(chunk);
    }
    buildOverlays(set, outside);
    return set;
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
   *  the limits bound the JOINTS). null = unchecked: nothing drawn. */
  function buildOverlays(s: LineSet, outside: Uint8Array | null) {
    for (const ch of s.chunks) {
      for (const o of ch.overlays) {
        if (!o) continue;
        o.parent?.remove(o);
        o.geometry.dispose();
      }
      ch.overlays = ch.lines.map(() => null);
      ch.ovCounts = ch.lines.map(() => 0);
    }
    s.overMat?.dispose();
    s.overMat = null;
    const nV = s.posAttr.count;
    if (!outside || outside.length !== nV) return;
    const pre = new Uint32Array(nV + 1);
    for (let i = 0; i < nV; i++) pre[i + 1] = pre[i]! + (outside[i] ? 1 : 0);
    if (pre[nV] === 0) return;
    s.overMat = new THREE.LineBasicMaterial({ color: 0xffcc00, depthTest: !pathAlwaysOnTop, depthWrite: false });
    const nC = s.used.length;
    const starts = new Uint32Array(nC), counts = new Uint32Array(nC);
    for (let k = 0; k < s.levels.length; k++) {
      const { index, plan } = s.levels[k]!;
      const flagged = new Uint32Array(index.length);
      let w = 0;
      for (let ci = 0; ci < nC; ci++) {
        const r = plan[s.used[ci]!]!;
        starts[ci] = w;
        for (let q = r.start; q < r.start + r.count; q += 2) {
          const a = index[q]!, b = index[q + 1]!;
          const lo = a < b ? a : b, hi = a < b ? b : a;
          if (pre[hi + 1]! - pre[lo + 1]! > 0) { flagged[w++] = a; flagged[w++] = b; }
        }
        counts[ci] = w - starts[ci]!;
      }
      if (w === 0) continue;
      const attr = new THREE.BufferAttribute(flagged.slice(0, w), 1);
      for (let ci = 0; ci < nC; ci++) {
        if (counts[ci] === 0) continue;
        const ch = s.chunks[ci]!;
        const geom = new THREE.BufferGeometry();
        geom.setAttribute("position", s.posAttr);
        geom.setIndex(attr);
        geom.setDrawRange(starts[ci]!, counts[ci]!);
        geom.boundingSphere = sphereOfBox(s.bounds, ci * 6);
        const ov = new THREE.LineSegments(geom, s.overMat);
        ov.renderOrder = 10;
        ov.frustumCulled = true;
        ov.visible = false;
        s.parent.add(ov);
        ch.overlays[k] = ov;
        ch.ovCounts[k] = counts[ci]!;
      }
    }
  }

  function rebuildOverflowEdges(size: Vec3, offset: Vec3): THREE.LineSegments | null {
    if (deps.boundsClipPlanes.length === 0) return null;
    const [sx, sy, sz] = size;
    if (sx <= 0 || sy <= 0 || sz <= 0) return null;
    const [ox, oy, oz] = offset;
    const geom = new THREE.EdgesGeometry(new THREE.BoxGeometry(sx, sy, sz));
    const mat = new THREE.LineDashedMaterial({
      color: 0xff4444,
      dashSize: 3,
      gapSize: 2,
      transparent: true,
      opacity: 0.8,
      clipIntersection: true,
      clippingPlanes: deps.boundsClipPlanes,
    });
    const lines = new THREE.LineSegments(geom, mat);
    lines.computeLineDistances();
    lines.position.set(ox + sx / 2, oy + sy / 2, oz + sz / 2);
    return lines;
  }

  // Parent of the current program's lines + bounds (baked anchor or the
  // live workRotGroup) — set by apply(), read by rebuildToolpathBounds.
  let _lineParent: THREE.Group | null = null;

  /** Detach + free every chunk object and the highlight. Chunk geometries
   *  are private per program (disposing one releases the shared GL buffers;
   *  its siblings go in the same pass), the two materials of a set are
   *  disposed ONCE per set — not once per chunk through deps.disposeObject,
   *  which would re-dispose a shared material per object (idempotent in
   *  Three, but a wrong shape for the disposal contract tests). */
  function teardownLines() {
    for (const s of sets) {
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
    for (const h of highlights) {
      h.line.parent?.remove(h.line);
      h.line.geometry.dispose();
      (h.line.material as THREE.Material).dispose();
    }
    sets = [];
    highlights = [];
    feedIsBreak = feedRoomMask = null;
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

    const color = deps.colors().toolpathBounds ?? "#f5a623";
    const boxGeom = new THREE.BoxGeometry(Math.max(sx, 0.001), Math.max(sy, 0.001), Math.max(sz, 0.001));
    const edgeGeom = new THREE.EdgesGeometry(boxGeom);
    boxGeom.dispose();
    toolpathBoundsBox = new THREE.LineSegments(
      edgeGeom,
      new THREE.LineBasicMaterial({
        color,
        transparent: true,
        opacity: 0.9,
        clippingPlanes: deps.insideBoundsClipPlanes,
      })
    );
    toolpathBoundsBox.position.set(cx, cy, cz);
    toolpathBoundsBox.visible = toolpathBoundsVisible;
    workRotGroup.add(toolpathBoundsBox);

    toolpathOverflowEdges = rebuildOverflowEdges(
      [sx, sy, sz],
      [toolpathBBox.min[0], toolpathBBox.min[1], toolpathBBox.min[2]],
    );
    if (toolpathOverflowEdges) {
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
  function _chunkVis(s: LineSet, ci: number) {
    const ch = s.chunks[ci]!;
    for (let k = 0; k < ch.lines.length; k++) {
      const on = toolpathVisible && k === ch.level && ch.counts[k]! > 0;
      ch.lines[k]!.visible = on;
      const ov = ch.overlays[k];
      if (ov) ov.visible = on && !pathStale && (ch.ovCounts[k] ?? 0) > 0;
    }
  }

  function _applyVisibility() {
    for (const s of sets) for (let ci = 0; ci < s.chunks.length; ci++) _chunkVis(s, ci);
    for (const h of highlights) h.line.visible = toolpathVisible;
  }

  function makeHighlight(frame: 0 | 1, parent: THREE.Group, posAttr: THREE.BufferAttribute, bounds: Float32Array): Highlight {
    const geom = new THREE.BufferGeometry();
    // Per-program (not externally owned): disposed by teardownLines.
    geom.setAttribute("position", posAttr);
    const idx = new Uint32Array(HL_CAP * 2);
    const attr = new THREE.BufferAttribute(idx, 1);
    attr.setUsage(THREE.DynamicDrawUsage);
    geom.setIndex(attr);
    geom.setDrawRange(0, 0);   // hidden until motion_line updates
    geom.boundingSphere = sphereOfBox(unionBounds(bounds), 0);
    const mat = new THREE.LineBasicMaterial({ color: 0xff3333 });
    mat.depthTest = !pathAlwaysOnTop;
    mat.depthWrite = false;
    const line = new THREE.LineSegments(geom, mat);
    line.renderOrder = 12;
    line.frustumCulled = true;
    line.visible = toolpathVisible;
    parent.add(line);
    return { frame, line, idx, attr };
  }

  /** Light the feed vertex range [s, s+count) — every pair (v, v+1) inside
   *  it that does not cross a section break or a frame flip goes to the
   *  highlight of its frame. */
  function _setHighlightVertexRange(s: number, count: number) {
    const e = s + count - 1;
    for (const h of highlights) {
      let w = 0;
      if (count >= 2 && feedPosAttr) {
        const last = Math.min(e, feedPosAttr.count - 1);
        for (let v = Math.max(0, s); v < last; v++) {
          if (feedIsBreak?.[v + 1]) continue;
          const f = feedRoomMask?.[v + 1] ?? 0;
          if ((feedRoomMask?.[v] ?? 0) !== f || f !== h.frame) continue;
          if (w >= HL_CAP * 2) break;
          h.idx[w++] = v; h.idx[w++] = v + 1;
        }
      }
      h.attr.clearUpdateRanges();
      if (w > 0) h.attr.addUpdateRange(0, w);
      h.attr.needsUpdate = true;
      h.line.geometry.setDrawRange(0, w);
    }
  }

  return {
    apply(ctx, g, anchor = null) {
      if (!ctx.scene || !ctx.workOrigin) return;
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

      // Prefer the flat Float32Array buffers from previewWorker (P4.1); fall back to
      // the nested arrays (WS path / older payloads). The wire's raw Uint8Array form
      // never reaches here — previewWorker always converts it to feedPos/rapidPos —
      // so the fallback accepts only the nested-list shape. feed_lines is
      // index-aligned to the point index either way.
      const _legacyPts = (v: unknown): number[][] => (Array.isArray(v) ? (v as number[][]) : []);
      const _flat = (d: number[][] | Float32Array): Float32Array =>
        d instanceof Float32Array ? d : new Float32Array(d.flat());
      const feedData: number[][] | Float32Array = g.feedPos ?? _legacyPts(g.feed);
      const rapidData: number[][] | Float32Array = g.rapidPos ?? _legacyPts(g.rapid);
      const feedLines = (Array.isArray(g.feed_lines) || g.feed_lines instanceof Uint32Array) ? g.feed_lines : [];
      const _pointCount = (d: number[][] | Float32Array) =>
        d instanceof Float32Array ? d.length / 3 : d.length;

      // Prefer the line→point-range map built off-thread by previewWorker (P4.1); fall
      // back to building it here for the WS/legacy path that carries no worker map.
      feedSrc = g.feedSrc instanceof Uint32Array ? g.feedSrc : null;
      feedLineIndex = (g.feedLineIndex && g.feedLineIndex.start instanceof Uint32Array)
        ? g.feedLineIndex
        : buildLineIndex(feedLines);

      // Feed + Rapid toolpath chunks — each chunk's geometry is shared with its
      // overflow overlay. Section breaks (track-derived streams) index-skip the
      // false connectors across feed/rapid interleaves; absent on legacy data,
      // every consecutive pair is a segment.
      const feedColor = deps.colors().feed ?? "#22b8cf";
      const rapidColor = deps.colors().rapid ?? "#f5a623";
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
      if (lineParent && _pointCount(feedData) >= 2) {
        const flat = _flat(feedData);
        const n = flat.length / 3;
        feedPosAttr = new THREE.BufferAttribute(flat, 3);
        const rm = roomMaskOf(g.feedRoom, n);
        const fi = buildFrameIndex(n, g.feedBreaks ?? null, rm);
        _frameMixed += fi.mixed;
        const lv = levelsByFrame(g.feedLod, rm);
        const ov = outsideOf(g.feedOutside, n, "feed");
        const st = makeSet("feed", 0, lineParent, feedPosAttr, fi.table, lv.table, lodTols, feedColor, false, null, ov);
        if (st) sets.push(st);
        const sr = roomParent ? makeSet("feed", 1, roomParent, feedPosAttr, fi.room, lv.room, lodTols, feedColor, false, null, ov) : null;
        if (sr) sets.push(sr);
        feedIsBreak = new Uint8Array(n);
        if (g.feedBreaks) for (const b of g.feedBreaks) if (b < n) feedIsBreak[b] = 1;
        feedRoomMask = roomMaskOf(g.feedRoom, n);
      }
      if (lineParent && _pointCount(rapidData) >= 2) {
        const flat = _flat(rapidData);
        const n = flat.length / 3;
        rapidPosAttr = new THREE.BufferAttribute(flat, 3);
        // Worker-precomputed lineDistance when the flat buffer is in use (P4.1);
        // undefined on the WS/legacy path → the set computes its own.
        const _rapidDist = rapidData === g.rapidPos && g.rapidDist instanceof Float32Array ? g.rapidDist : undefined;
        const distAttr = _rapidDist ? new THREE.Float32BufferAttribute(_rapidDist, 1) : null;
        const rm = roomMaskOf(g.rapidRoom, n);
        const fi = buildFrameIndex(n, g.rapidBreaks ?? null, rm);
        _frameMixed += fi.mixed;
        const lv = levelsByFrame(g.rapidLod, rm);
        const ov = outsideOf(g.rapidOutside, n, "rapid");
        const st = makeSet("rapid", 0, lineParent, rapidPosAttr, fi.table, lv.table, lodTols, rapidColor, true, distAttr, ov);
        if (st) sets.push(st);
        const sr = roomParent ? makeSet("rapid", 1, roomParent, rapidPosAttr, fi.room, lv.room, lodTols, rapidColor, true, distAttr, ov) : null;
        if (sr) sets.push(sr);
      }
      // Every drawn segment room-fixed ⇒ the bounds box rides the room parent.
      if (roomParent && sets.length && sets.every(s => s.frame === 1)) _lineParent = roomParent;
      _applyStale();   // sticky across rebuilds: a re-parse in flight keeps the new lines muted too

      // Highlights — one per frame that has feed segments, sharing feed's
      // position attribute (see Highlight); sphere = that frame's feed extents.
      if (feedPosAttr) {
        for (const st of sets) {
          if (st.stream !== "feed") continue;
          highlights.push(makeHighlight(st.frame, st.parent, feedPosAttr, st.bounds));
        }
      }

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
          if (s.tols.length) {
            const d = persp ? Math.max(1e-6, _sph.center.distanceTo(_camPos) - _sph.radius) : 0;
            const wupp = persp ? 2 * d * tanHalf / h : orthoWupp;
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

    setHighlight(curLine) {
      if (!highlights.length) return;
      // motion_line can be ~1 line ahead during G64 blending; try previous line first
      if (curLine != null) {
        const effectiveLine = lineHas(feedLineIndex, curLine - 1) ? curLine - 1 : curLine;
        const range = lineRange(feedLineIndex, effectiveLine);
        if (range) {
          const s = Math.max(0, range.start - 1);
          _setHighlightVertexRange(s, range.end - s + 1);
          return;
        }
      }
      _setHighlightVertexRange(0, 0);
    },

    setHighlightTrackRange(range) {
      if (!highlights.length) return;
      if (!range || !feedSrc || feedSrc.length === 0) {
        _setHighlightVertexRange(0, 0);
        return;
      }
      const [i0, i1] = range;
      // feedSrc is ascending: first drawn vertex with src >= i0 …
      let lo = 0, hi = feedSrc.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (feedSrc[mid]! < i0) lo = mid + 1; else hi = mid;
      }
      const first = lo;
      // … last drawn vertex with src <= i1.
      hi = feedSrc.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (feedSrc[mid]! > i1) hi = mid - 1; else lo = mid;
      }
      const last = lo;
      if (feedSrc[first]! > i1 || feedSrc[last]! < i0) {
        _setHighlightVertexRange(0, 0);  // run is all-rapid — no feed to light
        return;
      }
      const s = Math.max(0, first - 1);
      _setHighlightVertexRange(s, last - s + 1);
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

    setBoundsVisible(on) {
      toolpathBoundsVisible = on;
      if (toolpathBoundsBox) toolpathBoundsBox.visible = on;
      if (toolpathBoundsLabels) toolpathBoundsLabels.visible = on;
      if (toolpathOverflowEdges) toolpathOverflowEdges.visible = on;
    },

    setAlwaysOnTop(on) {
      pathAlwaysOnTop = on;
      const dt = !on; // depthTest: false = always on top
      for (const s of sets) {
        for (const m of [s.mat, s.overMat]) {
          if (!m) continue;
          m.depthTest = dt; m.depthWrite = false; m.needsUpdate = true;
        }
      }
      for (const h of highlights) {
        const m = h.line.material as THREE.LineBasicMaterial;
        m.depthTest = dt; m.depthWrite = false; m.needsUpdate = true;
      }
    },

    setColors(c) {
      if (c.feed) _feedBase.set(c.feed);
      if (c.rapid) _rapidBase.set(c.rapid);
      if (toolpathBoundsBox && c.toolpathBounds) (toolpathBoundsBox.material as THREE.LineBasicMaterial).color.set(c.toolpathBounds);
      _applyStale();   // the drawn colour is the base or its muted mix — one writer
    },

    forgetAfterSceneClear() {
      sets = [];
      highlights = [];
      feedIsBreak = feedRoomMask = null;
      feedPosAttr = rapidPosAttr = null;
      _chunksVisible = _overlayChunks = _frameMixed = 0;
      toolpathBoundsBox = toolpathOverflowEdges = null;
      toolpathBoundsLabels = null;
      toolpathBBox = null;
      motionBBox = null;
      feedLineIndex = emptyLineIndex();
      deps.overflow.value = false;
      if (deps.overflowCount) deps.overflowCount.value = 0;
    },

    dispose() {
      teardownLines();
      teardownBounds();
      toolpathBBox = null;
      motionBBox = null;
      feedLineIndex = emptyLineIndex();
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
