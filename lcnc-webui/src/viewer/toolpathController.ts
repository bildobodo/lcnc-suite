// Toolpath controller (frontend split, A3.4 — extracted from ThreeViewer.vue).
//
// The largest controller: owns the rendered program preview — feed + rapid
// polylines drawn as CHUNKS (viewer/lineChunks.ts: a few dozen contiguous
// index ranges over ONE shared position attribute, each its own object with an
// explicit bounding box so frustum culling and the outside-bounds overlay
// gate work per chunk), the highlight line (shares feed's position attribute,
// independent drawRange), the toolpath bounding box + axis labels + out-of-
// bounds edges, the source-line→point-range map, and the machine-bounds
// overflow check.
//
// Factory deps are STABLE references (created once, mutated in place): the two
// clip-plane arrays (transformed per-frame by the orchestrator), the billboard-
// label registry, the troika label factory, the live colour getter, the
// disposeObject helper, and the overflow ref the HUD reads. Per-call ToolpathCtx
// carries the REASSIGNED scene-graph pointers (scene/workOrigin/workRotGroup)
// plus per-program data (pathAlwaysOnTop/machineBounds/units) — never cached.
import * as THREE from "three";
import { buildLineIndex, emptyLineIndex, lineHas, lineRange, type LineIndex } from "./lineIndex";
import { boxInsideBounds, buildFrameIndex, CHUNK_MAX, chunkBounds, cumulativeDistances, spatialChunks, unionBounds, type ChunkRange } from "./lineChunks";
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
  /** The scene's background colour — the mute mixes toward it, so the muted
   *  path reads like an alpha fade over the background at opaque cost. */
  sceneBackground: () => THREE.Color;
  axisCss: { x: string; y: string; z: string };
  overflow: Ref<boolean>;            // HUD warning flag, owned by ThreeViewer for the template
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
  /** The MACHINE frame node: the work group's frame with every rotary DOF
   *  of the work chain at zero (= machine coordinates by the machine.json
   *  convention). The machine-bounds box lives here; the overlay gate
   *  transforms each chunk's box into it. null = no gate (overlays drawn). */
  machineFrame: THREE.Object3D | null;
  pathAlwaysOnTop: boolean;
  machineBounds: { origin: Vec3; size: Vec3 } | undefined;
  units: string | undefined;
}

export interface ToolpathController {
  /** `anchor` = the WCS terms the vertices in `g` were baked against
   *  (part-frame output, or a programmed multi-epoch rebase): the lines are
   *  parented under ctx.pathRot and pathAnchor/pathRot are posed from it in
   *  the same call. null = raw program coordinates (no bake): the lines hang
   *  under the LIVE workRotGroup, whose re-add IS the transform. */
  apply(ctx: ToolpathCtx, g: ViewerGcode, anchor?: AnchorTerms | null): void;
  /** Per rendered frame, before renderer.render: decides which chunks need
   *  their outside-bounds overlay drawn (a chunk whose box lies entirely
   *  inside the machine bounds — in the machine frame, at the CURRENT pose
   *  of its parent — shows no outside segment, so its overlay object is
   *  hidden) and counts the chunks inside the camera frustum for the perf
   *  probe. ~100 box/sphere tests; cheaper than tracking dirtiness. */
  updateCulling(ctx: ToolpathCtx, camera: THREE.Camera): void;
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
  /** Mute the drawn path (deps.staleOpacity) while it is known not to
   *  match the machine's live inputs — a re-parse in flight, or offsets /
   *  tool length changed since the parse. Sticky across apply(). An opaque
   *  colour mix toward deps.sceneBackground — never alpha (GPU cost, see
   *  ToolpathDeps.staleOpacity); call again after a background change. */
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
}

/** One drawn stream in one frame: its chunks (objects sharing the stream's
 *  position attribute + this set's index attribute), materials, and the
 *  per-chunk local boxes the overlay gate tests. */
interface LineSet {
  stream: "feed" | "rapid";
  frame: 0 | 1;
  parent: THREE.Group;
  mat: THREE.LineBasicMaterial | THREE.LineDashedMaterial;
  overMat: THREE.LineBasicMaterial | null;
  plan: ChunkRange[];
  bounds: Float32Array;                  // 6 per chunk, parent-local coordinates
  lines: THREE.LineSegments[];
  overlays: (THREE.LineSegments | null)[];
  overlayNeeded: Uint8Array;             // 1 until the gate proves the chunk inside
  pairs: number;
}

const _sph = new THREE.Sphere();
const _frustum = new THREE.Frustum();
const _projView = new THREE.Matrix4();
const _camInv = new THREE.Matrix4();
const _mfInv = new THREE.Matrix4();
const _toMachine = new THREE.Matrix4();

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
  let highlightLine: THREE.Line | null = null;
  let highlightGeom: THREE.BufferGeometry | null = null;
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
  // The lines' own colours (deps.colors at apply/setColors time). The drawn
  // material colour is ONE writer's output: these, or their mix toward the
  // background while stale.
  const _feedBase = new THREE.Color();
  const _rapidBase = new THREE.Color();

  function _applyStale() {
    const keep = pathStale ? (deps.staleOpacity ? deps.staleOpacity() : 0.4) : 1.0;
    const bg = keep < 1 ? deps.sceneBackground() : null;
    for (const s of sets) {
      const base = s.stream === "feed" ? _feedBase : _rapidBase;
      if (bg) s.mat.color.copy(bg).lerp(base, keep);
      else s.mat.color.copy(base);
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
    posAttr: THREE.BufferAttribute, index: Uint32Array, colorHex: string,
    dashed: boolean, distAttr: THREE.BufferAttribute | null,
  ): LineSet | null {
    if (index.length < 2) return null;
    let mat: THREE.LineBasicMaterial | THREE.LineDashedMaterial;
    if (dashed) {
      mat = new THREE.LineDashedMaterial({ color: colorHex, dashSize: 10, gapSize: 6 });
    } else {
      mat = new THREE.LineBasicMaterial({ color: colorHex });
    }
    mat.depthTest = !pathAlwaysOnTop;
    mat.depthWrite = false;
    // Plain yellow overlay sharing each chunk's geometry, clipped to show only
    // the part outside the machine bounds. Solid, opaque (2026-09-11,
    // operator's call): the dashed version read as solid yellow from afar
    // anyway (a 5 mm dash period is sub-pixel there) and as a yellow/base
    // mixture up close, and it cost a per-vertex dash-distance array plus a
    // blended second pass over every segment. Per chunk, updateCulling hides
    // it wherever the chunk cannot be outside.
    const overMat = deps.boundsClipPlanes.length > 0
      ? new THREE.LineBasicMaterial({
          color: 0xffcc00, depthTest: !pathAlwaysOnTop, depthWrite: false,
          clipIntersection: true, clippingPlanes: deps.boundsClipPlanes,
        })
      : null;
    // Dashed rapids need a per-vertex distance; the worker precomputes it
    // (P4.1), the legacy/WS path gets it here (indexed geometry cannot use
    // Three's computeLineDistances).
    if (dashed && !distAttr) distAttr = new THREE.Float32BufferAttribute(cumulativeDistances(posAttr.array as Float32Array), 1);
    // Bin the segments spatially (the index buffer is permuted, the vertex
    // order is not) so each chunk is a compact region of the part.
    const { index: ordered, plan } = spatialChunks(index, posAttr.array as Float32Array, deps.chunkCells ?? CHUNK_MAX);
    const indexAttr = new THREE.BufferAttribute(ordered, 1);
    const bounds = chunkBounds(ordered, posAttr.array as Float32Array, plan);
    const set: LineSet = {
      stream, frame, parent, mat, overMat, plan, bounds,
      lines: [], overlays: [], overlayNeeded: new Uint8Array(plan.length).fill(1),
      pairs: ordered.length >> 1,
    };
    for (let c = 0; c < plan.length; c++) {
      const geom = new THREE.BufferGeometry();
      geom.setAttribute("position", posAttr);
      if (dashed) geom.setAttribute("lineDistance", distAttr!);
      geom.setIndex(indexAttr);
      geom.setDrawRange(plan[c]!.start, plan[c]!.count);
      // Explicit sphere: a null one makes Three compute it over the WHOLE
      // shared attribute — every chunk would then carry the full program's
      // sphere and culling could never fire.
      geom.boundingSphere = sphereOfBox(bounds, c * 6);
      const line = new THREE.LineSegments(geom, mat);
      line.renderOrder = 10;
      line.frustumCulled = true;
      line.visible = toolpathVisible;
      parent.add(line);
      set.lines.push(line);
      let ov: THREE.LineSegments | null = null;
      if (overMat) {
        ov = new THREE.LineSegments(geom, overMat);
        ov.renderOrder = 10;
        ov.frustumCulled = true;
        ov.visible = toolpathVisible;
        parent.add(ov);
      }
      set.overlays.push(ov);
    }
    return set;
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
      for (const o of [...s.lines, ...s.overlays]) {
        if (!o) continue;
        o.parent?.remove(o);
        o.geometry.dispose();
      }
      s.mat.dispose();
      s.overMat?.dispose();
    }
    if (highlightLine) {
      highlightLine.parent?.remove(highlightLine);
      deps.disposeObject(highlightLine);
    }
    sets = [];
    highlightLine = null;
    highlightGeom = null;
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
    // it hangs under the same parent (the baked anchor when there is one).
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
    deps.overflow.value = (g.violations_total ?? 0) > 0;
  }

  function _applyVisibility() {
    for (const s of sets) {
      for (const l of s.lines) l.visible = toolpathVisible;
      for (let c = 0; c < s.overlays.length; c++) {
        const ov = s.overlays[c];
        if (ov) ov.visible = toolpathVisible && s.overlayNeeded[c] === 1;
      }
    }
    if (highlightLine) highlightLine.visible = toolpathVisible;
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
      _lineParent = lineParent;
      if (baked) {
        ctx.pathAnchor!.position.set(anchor!.ox, anchor!.oy, anchor!.oz);
        ctx.pathRot!.rotation.z = THREE.MathUtils.degToRad(anchor!.thetaDeg);
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
      if (lineParent && _pointCount(feedData) >= 2) {
        const flat = _flat(feedData);
        feedPosAttr = new THREE.BufferAttribute(flat, 3);
        const fi = buildFrameIndex(flat.length / 3, g.feedBreaks ?? null, null);
        _frameMixed += fi.mixed;
        const s = makeSet("feed", 0, lineParent, feedPosAttr, fi.table, feedColor, false, null);
        if (s) sets.push(s);
      }
      if (lineParent && _pointCount(rapidData) >= 2) {
        const flat = _flat(rapidData);
        rapidPosAttr = new THREE.BufferAttribute(flat, 3);
        // Worker-precomputed lineDistance when the flat buffer is in use (P4.1);
        // undefined on the WS/legacy path → the chunk computes its own.
        const _rapidDist = rapidData === g.rapidPos && g.rapidDist instanceof Float32Array ? g.rapidDist : undefined;
        const distAttr = _rapidDist ? new THREE.Float32BufferAttribute(_rapidDist, 1) : null;
        const fi = buildFrameIndex(flat.length / 3, g.rapidBreaks ?? null, null);
        _frameMixed += fi.mixed;
        const s = makeSet("rapid", 0, lineParent, rapidPosAttr, fi.table, rapidColor, true, distAttr);
        if (s) sets.push(s);
      }
      _applyStale();   // sticky across rebuilds: a re-parse in flight keeps the new lines muted too

      // Highlight line — shares feed's position attribute; independent drawRange.
      // Its sphere is the union of the feed chunks' boxes so frustum culling
      // matches the full feed extents (conservative: the drawn subset is always
      // inside). Deliberately a plain strip (no section index): a single source
      // line's vertex range sits inside one feed section except when one line
      // mixes feed→rapid→feed (canned cycles) — there the highlight bridges its
      // own rapid gap, an acceptable "where is this line" cue.
      if (feedPosAttr && lineParent) {
        highlightGeom = new THREE.BufferGeometry();
        // Per-program (not externally owned): disposed by apply() on program
        // change and by disposeObject on teardown — deliberately not _shared.
        highlightGeom.setAttribute("position", feedPosAttr);
        const feedSets = sets.filter(s => s.stream === "feed");
        const u = unionBounds(feedSets.length === 1 ? feedSets[0]!.bounds
          : new Float32Array(feedSets.flatMap(s => Array.from(s.bounds))));
        highlightGeom.boundingSphere = sphereOfBox(u, 0);
        highlightGeom.setDrawRange(0, 0); // hidden until motion_line updates
        const hlMat = new THREE.LineBasicMaterial({ color: 0xff3333 });
        hlMat.depthTest = !pathAlwaysOnTop;
        hlMat.depthWrite = false;
        highlightLine = new THREE.Line(highlightGeom, hlMat);
        highlightLine.renderOrder = 12;
        highlightLine.frustumCulled = true;
        lineParent.add(highlightLine);
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

    updateCulling(ctx, camera) {
      if (sets.length === 0) { _chunksVisible = _overlayChunks = 0; return; }
      camera.updateMatrixWorld();
      _camInv.copy(camera.matrixWorld).invert();
      _projView.multiplyMatrices(camera.projectionMatrix, _camInv);
      _frustum.setFromProjectionMatrix(_projView);
      const mf = ctx.machineFrame;
      const mb = ctx.machineBounds;
      const gate = !!(mf && mb?.origin && mb?.size && deps.boundsClipPlanes.length > 0);
      if (gate) {
        mf!.updateWorldMatrix(true, false);
        _mfInv.copy(mf!.matrixWorld).invert();
      }
      let visible = 0, overlaysOn = 0;
      for (const s of sets) {
        s.parent.updateWorldMatrix(true, false);
        if (gate) _toMachine.multiplyMatrices(_mfInv, s.parent.matrixWorld);
        for (let c = 0; c < s.lines.length; c++) {
          const line = s.lines[c]!;
          _sph.copy(line.geometry.boundingSphere!).applyMatrix4(s.parent.matrixWorld);
          if (_frustum.intersectsSphere(_sph)) visible++;
          const ov = s.overlays[c];
          if (ov && gate) {
            const need = !boxInsideBounds(s.bounds, c * 6, _toMachine.elements, mb!.origin, mb!.size);
            s.overlayNeeded[c] = need ? 1 : 0;
            ov.visible = toolpathVisible && need;
          }
          if (ov?.visible) overlaysOn++;
        }
      }
      _chunksVisible = visible;
      _overlayChunks = overlaysOn;
    },

    setHighlight(curLine) {
      // motion_line can be ~1 line ahead during G64 blending; try previous line first
      if (highlightLine && curLine != null) {
        const effectiveLine = lineHas(feedLineIndex, curLine - 1) ? curLine - 1 : curLine;
        const range = lineRange(feedLineIndex, effectiveLine);
        if (range) {
          const s = Math.max(0, range.start - 1);
          highlightLine.geometry.setDrawRange(s, range.end - s + 1);
        } else {
          highlightLine.geometry.setDrawRange(0, 0);
        }
      } else {
        if (highlightLine) highlightLine.geometry.setDrawRange(0, 0);
      }
    },

    setHighlightTrackRange(range) {
      if (!highlightLine) return;
      if (!range || !feedSrc || feedSrc.length === 0) {
        highlightLine.geometry.setDrawRange(0, 0);
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
        highlightLine.geometry.setDrawRange(0, 0);  // run is all-rapid — no feed to light
        return;
      }
      const s = Math.max(0, first - 1);
      highlightLine.geometry.setDrawRange(s, last - s + 1);
    },


    setStale(on) {
      pathStale = on;
      _applyStale();
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
      if (highlightLine) {
        const m = highlightLine.material as THREE.LineBasicMaterial;
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
      highlightLine = null;
      highlightGeom = null;
      feedPosAttr = rapidPosAttr = null;
      _chunksVisible = _overlayChunks = _frameMixed = 0;
      toolpathBoundsBox = toolpathOverflowEdges = null;
      toolpathBoundsLabels = null;
      toolpathBBox = null;
      motionBBox = null;
      feedLineIndex = emptyLineIndex();
      deps.overflow.value = false;
    },

    dispose() {
      teardownLines();
      teardownBounds();
      toolpathBBox = null;
      motionBBox = null;
      feedLineIndex = emptyLineIndex();
      deps.overflow.value = false;
    },

    get feedSegs() { return feedPosAttr?.count ?? 0; },
    get rapidSegs() { return rapidPosAttr?.count ?? 0; },
    get drawSegs() {
      let n = 0;
      for (const s of sets) for (const l of s.lines) n += l.geometry.drawRange.count >> 1;
      return n;
    },
    get chunks() { let n = 0; for (const s of sets) n += s.lines.length; return n; },
    get chunksVisible() { return _chunksVisible; },
    get overlayChunks() { return _overlayChunks; },
    get frameMixed() { return _frameMixed; },
  };
}
