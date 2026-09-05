// Toolpath controller (frontend split, A3.4 — extracted from ThreeViewer.vue).
//
// The largest controller: owns the rendered program preview — feed + rapid
// polylines (geometry shared with the clipped "overflow" overlay), the
// highlight line (shares feed's position attribute, independent drawRange), the
// toolpath bounding box + axis labels + out-of-bounds edges, the source-line→
// point-range map, and the machine-bounds overflow check.
//
// Factory deps are STABLE references (created once, mutated in place): the two
// clip-plane arrays (transformed per-frame by the orchestrator), the billboard-
// label registry, the troika label factory, the live colour getter, the
// disposeObject helper, and the overflow ref the HUD reads. Per-call ToolpathCtx
// carries the REASSIGNED scene-graph pointers (scene/workOrigin/workRotGroup)
// plus per-program data (pathAlwaysOnTop/machineBounds/units) — never cached.
import * as THREE from "three";
import { buildLineIndex, emptyLineIndex, lineHas, lineRange, type LineIndex } from "./lineIndex";
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
  /** Opacity for a stale path (the --opacity-disabled token, read by the host). */
  staleOpacity?: () => number;
  axisCss: { x: string; y: string; z: string };
  overflow: Ref<boolean>;            // HUD warning flag, owned by ThreeViewer for the template
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
   *  tool length changed since the parse. Sticky across apply(). */
  setStale(on: boolean): void;
  /** Drop all refs WITHOUT disposing — clearScene already freed the objects.
   *  Parallel to surfaceController.forgetAfterSceneClear (H6): stale refs
   *  would keep feedSegs/updateOverflow reporting the disposed program and
   *  double-dispose on the next apply(). Call from ensureCoreGroups. */
  forgetAfterSceneClear(): void;
  dispose(): void;
  readonly feedSegs: number;
  readonly rapidSegs: number;
}

export function createToolpathController(deps: ToolpathDeps): ToolpathController {
  let feedLine: THREE.Line | null = null;
  let rapidLine: THREE.Line | null = null;
  let feedOverflow: THREE.Line | null = null;
  let rapidOverflow: THREE.Line | null = null;
  let highlightLine: THREE.Line | null = null;
  let feedSharedGeom: THREE.BufferGeometry | null = null;
  let rapidSharedGeom: THREE.BufferGeometry | null = null;
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

  function _applyStale() {
    const op = pathStale ? (deps.staleOpacity ? deps.staleOpacity() : 0.4) : 1.0;
    for (const ln of [feedLine, rapidLine]) {
      if (!ln) continue;
      const m = ln.material as THREE.LineBasicMaterial;
      m.transparent = op < 1;
      m.opacity = op;
      m.needsUpdate = true;
    }
  }

  function makeLine(points: number[][] | Float32Array, colorHex: number | string, dashed = false, opacity = 1.0, lineDist?: Float32Array, breaks?: Uint32Array) {
    const geom = new THREE.BufferGeometry();
    // This geometry is reused by the overflow line (same object) and its position
    // attribute by the highlight line — but it is PER-PROGRAM, not externally
    // owned: apply() disposes it on program change, and disposeObject frees it
    // on scene teardown. So it is deliberately NOT marked userData._shared (that
    // flag is only for the STL cache + MAT.*, which must survive a rebuild).
    // Prefer the flat Float32Array produced off-thread by previewWorker (P4.1);
    // fall back to flattening nested points (WS path / older payloads).
    const flat = points instanceof Float32Array ? points : new Float32Array(points.flat());
    geom.setAttribute("position", new THREE.BufferAttribute(flat, 3));

    // Sectioned stream (track-derived): `breaks` lists section-START vertex
    // indices — no segment may be drawn into them (the connector would be a
    // FALSE move skipping the other stream's motion, e.g. a feed drawn from
    // the pre-G0-lift position). An index buffer of real segment pairs +
    // LineSegments renders exactly the true segments; strip rendering stays
    // for break-less (legacy) data.
    if (breaks && breaks.length) {
      const n = flat.length / 3;
      const isBreak = new Uint8Array(n);
      for (const b of breaks) if (b < n) isBreak[b] = 1;
      const idx = new Uint32Array(Math.max(0, n - 1) * 2);
      let w = 0;
      for (let i = 1; i < n; i++) {
        if (isBreak[i]) continue;
        idx[w++] = i - 1; idx[w++] = i;
      }
      geom.setIndex(new THREE.BufferAttribute(idx.subarray(0, w).slice(), 1));
    }

    // Important: stable bounds so Three doesn't cull it incorrectly
    geom.computeBoundingSphere();

    let mat: THREE.LineBasicMaterial | THREE.LineDashedMaterial;

    if (dashed) {
      mat = new THREE.LineDashedMaterial({
        color: colorHex,
        dashSize: 10,
        gapSize: 6,
        transparent: opacity < 1,
        opacity,
      });
      mat.depthTest = !pathAlwaysOnTop;
      mat.depthWrite = false;
    } else {
      mat = new THREE.LineBasicMaterial({ color: colorHex, transparent: opacity < 1, opacity });
      mat.depthTest = !pathAlwaysOnTop;
      mat.depthWrite = false;
    }

    // Indexed geometry = segment pairs → LineSegments; plain strip → Line.
    const line = geom.index ? new THREE.LineSegments(geom, mat) : new THREE.Line(geom, mat);
    line.renderOrder = 10;

    // Bounding sphere is computed above; parent (workRotGroup) transforms apply
    // to it via matrixWorld at cull time, so workOrigin/WCS-rotation changes
    // don't require recomputation. Culling skips draw work when zoomed in.
    line.frustumCulled = true;

    if (dashed) {
      if (lineDist) {
        // Worker-precomputed (P4.1) — set the attribute directly instead of scanning
        // every point on the main thread. The overflow line shares this geometry, so
        // it reuses the attribute too (see makeOverflowLine).
        geom.setAttribute("lineDistance", new THREE.Float32BufferAttribute(lineDist, 1));
      } else {
        (line as any).computeLineDistances?.();
      }
    }
    return line;
  }

  /** Yellow dashed overlay sharing geometry with a toolpath line, clipped to show only outside machine bounds. */
  function makeOverflowLine(geom: THREE.BufferGeometry): THREE.Line | null {
    if (deps.boundsClipPlanes.length === 0) return null;
    const mat = new THREE.LineDashedMaterial({
      color: 0xffcc00,
      dashSize: 3,
      gapSize: 2,
      transparent: true,
      opacity: 0.9,
      depthTest: !pathAlwaysOnTop,
      depthWrite: false,
      clipIntersection: true,
      clippingPlanes: deps.boundsClipPlanes,
    });
    // Mirror the owner's object type: an indexed (sectioned) geometry rendered
    // as a strip would re-draw the false connectors this geometry exists to skip.
    const line = geom.index ? new THREE.LineSegments(geom, mat) : new THREE.Line(geom, mat);
    line.renderOrder = 10;
    line.frustumCulled = true;
    // Idempotent: rapid channel already has lineDistance from rapidLine; feed channel doesn't.
    if (!geom.attributes.lineDistance) {
      if (geom.index) {
        // Three's computeLineDistances refuses indexed geometry — build the
        // vertex-cumulative distances directly (dash phase across skipped
        // section gaps is irrelevant; only per-segment deltas matter).
        const p = geom.attributes.position!.array as Float32Array;
        const n = p.length / 3;
        const d = new Float32Array(n);
        for (let i = 1; i < n; i++) {
          const j = i * 3, k = j - 3;
          const dx = p[j]! - p[k]!, dy = p[j + 1]! - p[k + 1]!, dz = p[j + 2]! - p[k + 2]!;
          d[i] = d[i - 1]! + Math.sqrt(dx * dx + dy * dy + dz * dz);
        }
        geom.setAttribute("lineDistance", new THREE.Float32BufferAttribute(d, 1));
      } else {
        line.computeLineDistances();
      }
    }
    return line;
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

  /** Detach + free the five toolpath lines. deps.disposeObject frees private
   *  geometry AND materials (A2); the shared feed/rapid/highlight geoms are
   *  deliberately not _shared, so one pass releases everything (a second
   *  visit via the geometry-sharing overflow lines is idempotent). */
  // Parent of the current program's lines + bounds (baked anchor or the
  // live workRotGroup) — set by apply(), read by rebuildToolpathBounds.
  let _lineParent: THREE.Group | null = null;

  function teardownLines() {
    for (const old of [feedLine, rapidLine, feedOverflow, rapidOverflow, highlightLine]) {
      if (!old) continue;
      old.parent?.remove(old);
      deps.disposeObject(old);
    }
    feedLine = rapidLine = feedOverflow = rapidOverflow = highlightLine = null;
    feedSharedGeom = rapidSharedGeom = highlightGeom = null;
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

      // Feed + Rapid toolpath lines — geometry is shared with the overflow overlay.
      const feedColor = deps.colors().feed ?? "#22b8cf";
      const rapidColor = deps.colors().rapid ?? "#f5a623";
      if (_pointCount(feedData) >= 2) {
        // Section breaks (track-derived streams) index-skip the false
        // connectors across feed/rapid interleaves; absent on legacy data.
        feedLine = makeLine(feedData, feedColor, false, 1.0, undefined, g.feedBreaks);
        feedSharedGeom = feedLine.geometry as THREE.BufferGeometry;
        lineParent!.add(feedLine);
        feedOverflow = makeOverflowLine(feedSharedGeom);
        if (feedOverflow) lineParent!.add(feedOverflow);
      }
      if (_pointCount(rapidData) >= 2) {
        // Pass the worker-precomputed lineDistance when the flat buffer is in use (P4.1);
        // undefined on the WS/legacy path → makeLine falls back to computeLineDistances.
        const _rapidDist = rapidData === g.rapidPos ? g.rapidDist : undefined;
        rapidLine = makeLine(rapidData, rapidColor, true, 1.0, _rapidDist, g.rapidBreaks);
        rapidSharedGeom = rapidLine.geometry as THREE.BufferGeometry;
        lineParent!.add(rapidLine);
        rapidOverflow = makeOverflowLine(rapidSharedGeom);
        if (rapidOverflow) lineParent!.add(rapidOverflow);
      }
      _applyStale();   // sticky across rebuilds: a re-parse in flight keeps the new lines muted too

      // Highlight line — shares feed's position attribute; independent drawRange.
      // Reuses the feed bounding sphere so frustum culling matches the full toolpath
      // extents (conservative: drawn subset is always inside the full bounds).
      // Deliberately a plain strip (no section index): a single source line's
      // vertex range sits inside one feed section except when one line mixes
      // feed→rapid→feed (canned cycles) — there the highlight bridges its own
      // rapid gap, an acceptable "where is this line" cue.
      if (feedSharedGeom) {
        highlightGeom = new THREE.BufferGeometry();
        // Per-program (not externally owned): disposed by apply() on program
        // change and by disposeObject on teardown — deliberately not _shared.
        highlightGeom.setAttribute("position", feedSharedGeom.attributes.position!);
        highlightGeom.boundingSphere = feedSharedGeom.boundingSphere;
        highlightGeom.setDrawRange(0, 0); // hidden until motion_line updates
        const hlMat = new THREE.LineBasicMaterial({ color: 0xff3333 });
        hlMat.depthTest = !pathAlwaysOnTop;
        hlMat.depthWrite = false;
        highlightLine = new THREE.Line(highlightGeom, hlMat);
        highlightLine.renderOrder = 12;
        highlightLine.frustumCulled = true;
        lineParent!.add(highlightLine);
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
      if (!toolpathVisible) {
        if (feedLine) feedLine.visible = false;
        if (rapidLine) rapidLine.visible = false;
        if (feedOverflow) feedOverflow.visible = false;
        if (rapidOverflow) rapidOverflow.visible = false;
        if (highlightLine) highlightLine.visible = false;
      }

      deps.requestRender();
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
      if (feedLine) feedLine.visible = on;
      if (rapidLine) rapidLine.visible = on;
      if (feedOverflow) feedOverflow.visible = on;
      if (rapidOverflow) rapidOverflow.visible = on;
      if (highlightLine) highlightLine.visible = on;
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
      if (feedLine) {
        const m = feedLine.material as THREE.LineBasicMaterial;
        m.depthTest = dt; m.depthWrite = false; m.needsUpdate = true;
      }
      if (rapidLine) {
        const m = rapidLine.material as THREE.LineDashedMaterial;
        m.depthTest = dt; m.depthWrite = false; m.needsUpdate = true;
      }
      for (const ol of [feedOverflow, rapidOverflow]) {
        if (ol) {
          const m = ol.material as THREE.LineDashedMaterial;
          m.depthTest = dt; m.depthWrite = false; m.needsUpdate = true;
        }
      }
      if (highlightLine) {
        const m = highlightLine.material as THREE.LineBasicMaterial;
        m.depthTest = dt; m.depthWrite = false; m.needsUpdate = true;
      }
    },

    setColors(c) {
      if (feedLine && c.feed) (feedLine.material as THREE.LineBasicMaterial).color.set(c.feed);
      if (rapidLine && c.rapid) (rapidLine.material as THREE.LineDashedMaterial).color.set(c.rapid);
      if (toolpathBoundsBox && c.toolpathBounds) (toolpathBoundsBox.material as THREE.LineBasicMaterial).color.set(c.toolpathBounds);
    },

    forgetAfterSceneClear() {
      feedLine = rapidLine = feedOverflow = rapidOverflow = highlightLine = null;
      feedSharedGeom = rapidSharedGeom = highlightGeom = null;
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

    get feedSegs() { return feedSharedGeom?.getAttribute("position")?.count ?? 0; },
    get rapidSegs() { return rapidSharedGeom?.getAttribute("position")?.count ?? 0; },
  };
}
