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
  axisCss: { x: string; y: string; z: string };
  overflow: Ref<boolean>;            // HUD warning flag, owned by ThreeViewer for the template
}

export interface ToolpathCtx {
  scene: THREE.Scene | null;
  workOrigin: THREE.Group | null;
  workRotGroup: THREE.Group | null;
  pathAlwaysOnTop: boolean;
  machineBounds: { origin: Vec3; size: Vec3 } | undefined;
  units: string | undefined;
}

export interface ToolpathController {
  apply(ctx: ToolpathCtx, g: ViewerGcode): void;
  setHighlight(curLine: number | null): void;
  /** Recompute the machine-bounds overflow flag (workOrigin moved / new path). */
  updateOverflow(ctx: ToolpathCtx): void;
  setVisible(on: boolean): void;
  setBoundsVisible(on: boolean): void;
  setAlwaysOnTop(on: boolean): void;
  /** Live-update feed/rapid/toolpath-bounds colours on existing lines. */
  setColors(c: { feed?: string; rapid?: string; toolpathBounds?: string }): void;
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
  let feedLineMap: Map<number, { start: number; end: number }> = new Map();
  let toolpathBBox: BBox | null = null;

  let toolpathBoundsBox: THREE.LineSegments | null = null;
  let toolpathBoundsLabels: THREE.Group | null = null;
  let toolpathOverflowEdges: THREE.LineSegments | null = null;

  let toolpathVisible = true;
  let toolpathBoundsVisible = false;
  let pathAlwaysOnTop = true;

  function makeLine(points: number[][] | Float32Array, colorHex: number | string, dashed = false, opacity = 1.0, lineDist?: Float32Array) {
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

    const line = new THREE.Line(geom, mat);
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
    const line = new THREE.Line(geom, mat);
    line.renderOrder = 10;
    line.frustumCulled = true;
    // Idempotent: rapid channel already has lineDistance from rapidLine; feed channel doesn't.
    if (!geom.attributes.lineDistance) line.computeLineDistances();
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
    const workRotGroup = ctx.workRotGroup;
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

  function updateOverflow(ctx: ToolpathCtx) {
    deps.overflow.value = false;
    const workOrigin = ctx.workOrigin;
    if (!toolpathBBox || !workOrigin) return;
    const mb = ctx.machineBounds;
    if (!mb) return;
    const wo = workOrigin.position;
    // Machine bounds converted to work coordinates
    const bMin0 = mb.origin[0] - wo.x, bMin1 = mb.origin[1] - wo.y, bMin2 = mb.origin[2] - wo.z;
    const bMax0 = bMin0 + mb.size[0], bMax1 = bMin1 + mb.size[1], bMax2 = bMin2 + mb.size[2];
    // toolpathBBox is in pre-rotation work coords; rotate the 4 XY corners by
    // workRotGroup.rotation.z to get the rendered AABB. Z is unaffected.
    const theta = ctx.workRotGroup?.rotation.z ?? 0;
    const ca = Math.cos(theta), sa = Math.sin(theta);
    let mnX = Infinity, mxX = -Infinity, mnY = Infinity, mxY = -Infinity;
    for (const x of [toolpathBBox.min[0], toolpathBBox.max[0]]) {
      for (const y of [toolpathBBox.min[1], toolpathBBox.max[1]]) {
        const rx = x * ca - y * sa;
        const ry = x * sa + y * ca;
        if (rx < mnX) mnX = rx; if (rx > mxX) mxX = rx;
        if (ry < mnY) mnY = ry; if (ry > mxY) mxY = ry;
      }
    }
    deps.overflow.value =
      mnX < bMin0 || mxX > bMax0 ||
      mnY < bMin1 || mxY > bMax1 ||
      toolpathBBox.min[2] < bMin2 || toolpathBBox.max[2] > bMax2;
  }

  return {
    apply(ctx, g) {
      if (!ctx.scene || !ctx.workOrigin) return;
      pathAlwaysOnTop = ctx.pathAlwaysOnTop;
      const workRotGroup = ctx.workRotGroup;

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
      if (g.feedLineMap instanceof Map) {
        feedLineMap = g.feedLineMap;
      } else {
        feedLineMap = new Map();
        for (let i = 0; i < feedLines.length; i++) {
          const ln = feedLines[i]!;
          const entry = feedLineMap.get(ln);
          if (entry) entry.end = i;
          else feedLineMap.set(ln, { start: i, end: i });
        }
      }

      // Feed + Rapid toolpath lines — geometry is shared with the overflow overlay.
      const feedColor = deps.colors().feed ?? "#22b8cf";
      const rapidColor = deps.colors().rapid ?? "#f5a623";
      if (_pointCount(feedData) >= 2) {
        feedLine = makeLine(feedData, feedColor, false);
        feedSharedGeom = feedLine.geometry as THREE.BufferGeometry;
        workRotGroup!.add(feedLine);
        feedOverflow = makeOverflowLine(feedSharedGeom);
        if (feedOverflow) workRotGroup!.add(feedOverflow);
      }
      if (_pointCount(rapidData) >= 2) {
        // Pass the worker-precomputed lineDistance when the flat buffer is in use (P4.1);
        // undefined on the WS/legacy path → makeLine falls back to computeLineDistances.
        const _rapidDist = rapidData === g.rapidPos ? g.rapidDist : undefined;
        rapidLine = makeLine(rapidData, rapidColor, true, 1.0, _rapidDist);
        rapidSharedGeom = rapidLine.geometry as THREE.BufferGeometry;
        workRotGroup!.add(rapidLine);
        rapidOverflow = makeOverflowLine(rapidSharedGeom);
        if (rapidOverflow) workRotGroup!.add(rapidOverflow);
      }

      // Highlight line — shares feed's position attribute; independent drawRange.
      // Reuses the feed bounding sphere so frustum culling matches the full toolpath
      // extents (conservative: drawn subset is always inside the full bounds).
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
        workRotGroup!.add(highlightLine);
      }

      // Toolpath bounding box (work coordinates) for overflow detection. Prefer the
      // bounds the parse worker computed over the same decimated polyline (P4.1) so we
      // don't re-scan every point on the UI thread; fall back to a main-thread pass for
      // the WS/legacy path that carries no bounds.
      toolpathBBox = null;
      const _wb = g.bounds;
      if (_wb && Array.isArray(_wb.min) && Array.isArray(_wb.max) && _wb.min.length === 3) {
        toolpathBBox = {
          min: [_wb.min[0]!, _wb.min[1]!, _wb.min[2]!],
          max: [_wb.max[0]!, _wb.max[1]!, _wb.max[2]!],
        };
      } else {
        const mn: [number, number, number] = [Infinity, Infinity, Infinity];
        const mx: [number, number, number] = [-Infinity, -Infinity, -Infinity];
        let _bboxAny = false;
        const _scanBBox = (d: number[][] | Float32Array) => {
          if (d instanceof Float32Array) {
            for (let i = 0; i + 2 < d.length; i += 3) {
              _bboxAny = true;
              const x = d[i]!, y = d[i + 1]!, z = d[i + 2]!;
              if (x < mn[0]) mn[0] = x; if (x > mx[0]) mx[0] = x;
              if (y < mn[1]) mn[1] = y; if (y > mx[1]) mx[1] = y;
              if (z < mn[2]) mn[2] = z; if (z > mx[2]) mx[2] = z;
            }
          } else {
            for (const p of d) {
              _bboxAny = true;
              if (p[0]! < mn[0]) mn[0] = p[0]!; if (p[0]! > mx[0]) mx[0] = p[0]!;
              if (p[1]! < mn[1]) mn[1] = p[1]!; if (p[1]! > mx[1]) mx[1] = p[1]!;
              if (p[2]! < mn[2]) mn[2] = p[2]!; if (p[2]! > mx[2]) mx[2] = p[2]!;
            }
          }
        };
        _scanBBox(feedData);
        _scanBBox(rapidData);
        if (_bboxAny) toolpathBBox = { min: mn, max: mx };
      }
      updateOverflow(ctx);
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
        const effectiveLine = feedLineMap.has(curLine - 1) ? curLine - 1 : curLine;
        const range = feedLineMap.get(effectiveLine);
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

    updateOverflow,

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
      feedLineMap = new Map();
      deps.overflow.value = false;
    },

    dispose() {
      teardownLines();
      teardownBounds();
      toolpathBBox = null;
      feedLineMap = new Map();
      deps.overflow.value = false;
    },

    get feedSegs() { return feedSharedGeom?.getAttribute("position")?.count ?? 0; },
    get rapidSegs() { return rapidSharedGeom?.getAttribute("position")?.count ?? 0; },
  };
}
