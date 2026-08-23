// Unit tests for viewer/toolpathController.ts (A3.4). THREE geometry/material
// ops are pure JS → headless. troika labels are faked (they need a font loader).
// Covers the disposal-on-rebuild contract (the hardest part: shared geometry +
// ad-hoc materials must all be freed), the feedLineMap fallback, label
// unregistration, and the overflow flag.
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { ref, type Ref } from "vue";
import { disposeObject } from "./disposal";
import { createToolpathController, type ToolpathCtx, type ToolpathController } from "./toolpathController";

// Fake troika label: an Object3D (addable, has .position) with a dispose spy.
function fakeLabel() {
  const o = new THREE.Object3D() as THREE.Object3D & { dispose: () => void };
  o.dispose = vi.fn();
  return o;
}

function makeDeps(overflow: Ref<boolean>) {
  return {
    requestRender: vi.fn(),
    boundsClipPlanes: [] as THREE.Plane[],       // empty → no overflow overlay lines
    insideBoundsClipPlanes: [] as THREE.Plane[],
    billboardLabels: [] as any[],
    makeLabel: vi.fn(() => fakeLabel()),
    disposeObject,
    colors: () => ({ feed: "#22b8cf", rapid: "#f5a623", toolpathBounds: "#f5a623" }),
    axisCss: { x: "#f00", y: "#0f0", z: "#00f" },
    overflow,
  };
}

function makeCtx(over: Partial<ToolpathCtx> = {}): ToolpathCtx & { workRotGroup: THREE.Group } {
  return {
    scene: new THREE.Scene(),
    workOrigin: new THREE.Group(),
    workRotGroup: new THREE.Group(),
    pathAlwaysOnTop: false,
    machineBounds: { origin: [0, 0, 0], size: [100, 100, 100] },
    units: "mm",
    ...over,
  } as any;
}

const GCODE = {
  feedPos: new Float32Array([0, 0, 0, 10, 0, 0, 10, 10, 0]),   // 3 pts
  rapidPos: new Float32Array([0, 0, 5, 0, 0, 0]),              // 2 pts
  feed_lines: [10, 11, 12],
  bounds: { min: [0, 0, 0], max: [10, 10, 0] },
} as any;

// The feed line: renderOrder 10, non-dashed, 3 position points.
function feedLineOf(g: THREE.Group): THREE.Line {
  return g.children.find(c =>
    (c as any).isLine && c.renderOrder === 10 &&
    !((c as any).material instanceof THREE.LineDashedMaterial) &&
    (c as THREE.Line).geometry.getAttribute("position")?.count === 3) as THREE.Line;
}

let overflow: Ref<boolean>;
let deps: ReturnType<typeof makeDeps>;
let c: ToolpathController;

beforeEach(() => {
  overflow = ref(false);
  deps = makeDeps(overflow);
  // deps uses fake troika labels (Object3D + dispose) rather than real Text,
  // which need a font loader — cast at this test-only boundary.
  c = createToolpathController(deps as any);
});

describe("toolpathController.apply", () => {
  it("builds feed/rapid/highlight lines + bounds box + labels under workRotGroup", () => {
    const ctx = makeCtx();
    c.apply(ctx, GCODE);
    expect(c.feedSegs).toBe(3);
    expect(c.rapidSegs).toBe(2);
    expect(feedLineOf(ctx.workRotGroup)).toBeTruthy();
    // 3 axis labels created + registered for billboarding.
    expect(deps.makeLabel).toHaveBeenCalledTimes(3);
    expect(deps.billboardLabels).toHaveLength(3);
    expect(deps.requestRender).toHaveBeenCalled();
  });

  it("double apply disposes every replaced resource (shared geom + per-line materials)", () => {
    const ctx = makeCtx();
    c.apply(ctx, GCODE);
    const feed = feedLineOf(ctx.workRotGroup);
    const geomSpy = vi.spyOn(feed.geometry as THREE.BufferGeometry, "dispose");
    const matSpy = vi.spyOn(feed.material as THREE.Material, "dispose");

    c.apply(ctx, GCODE);   // rebuild
    expect(geomSpy).toHaveBeenCalled();   // shared feed geometry freed
    expect(matSpy).toHaveBeenCalledOnce(); // ad-hoc feed material freed
  });

  it("labels are disposed + unregistered on rebuild (billboard registry does not grow)", () => {
    const ctx = makeCtx();
    c.apply(ctx, GCODE);
    const firstLabels = [...deps.billboardLabels];
    c.apply(ctx, GCODE);
    for (const lbl of firstLabels) expect((lbl as any).dispose).toHaveBeenCalled();
    expect(deps.billboardLabels).toHaveLength(3);   // 3 freed, 3 added — not 6
  });

  it("no-op before scene/workOrigin exist", () => {
    const ctx = makeCtx({ scene: null });
    c.apply(ctx, GCODE);
    expect(c.feedSegs).toBe(0);
  });
});

describe("highlight", () => {
  it("builds the feedLineMap from feed_lines when the worker map is absent, and ranges it", () => {
    const ctx = makeCtx();
    c.apply(ctx, GCODE);   // no g.feedLineMap → built from feed_lines [10,11,12]
    c.setHighlight(11);    // line 11 → point index 1
    const hl = ctx.workRotGroup.children.find(o => o.renderOrder === 12) as THREE.Line;
    // effectiveLine 11 has range {start:1,end:1}; drawRange start = max(0, 0) = 0, count = 1.
    expect(hl.geometry.drawRange).toMatchObject({ start: 0, count: 1 });
    c.setHighlight(null);
    expect(hl.geometry.drawRange.count).toBe(0);
  });

  it("prefers the worker-provided feedLineMap (Map) over rebuilding", () => {
    const ctx = makeCtx();
    const workerMap = new Map([[99, { start: 2, end: 2 }]]);
    c.apply(ctx, { ...GCODE, feedLineMap: workerMap });
    c.setHighlight(99);
    const hl = ctx.workRotGroup.children.find(o => o.renderOrder === 12) as THREE.Line;
    expect(hl.geometry.drawRange).toMatchObject({ start: 1, count: 2 });
  });
});

describe("overflow / visibility / colours", () => {
  it("the overflow flag follows the per-line validator, not a geometric box", () => {
    // One source of truth (W2 follow-up, operator-caught): the old
    // geometric box applied one live TLO to a mixed-TLO envelope and
    // contradicted the validator (and the real run) on a G53 retract.
    // A geometrically "overflowing" bbox with a CLEAN validator must not
    // flag…
    const ctx = makeCtx({ machineBounds: { origin: [0, 0, 0], size: [5, 5, 5] } });
    c.apply(ctx, { ...GCODE, violations_total: 0 });
    expect(overflow.value).toBe(false);
    // …and validator findings flag regardless of the box.
    const ctx2 = makeCtx({ machineBounds: { origin: [0, 0, 0], size: [100, 100, 100] } });
    c.apply(ctx2, { ...GCODE, violations_total: 3 });
    expect(overflow.value).toBe(true);
  });

  it("an unchecked payload (no violations data) never claims overflow", () => {
    // null/absent = the INI had no limits to check against — unchecked ≠
    // clean, and the stats dialog says "Not validated"; the HUD must not
    // claim either way.
    const ctx = makeCtx({ machineBounds: { origin: [0, 0, 0], size: [5, 5, 5] } });
    c.apply(ctx, { ...GCODE, violations_total: undefined });
    expect(overflow.value).toBe(false);
  });

  it("fallback cut box takes X/Y from rapids but Z from feed only", () => {
    const ctx = makeCtx();
    // No worker bounds: rapid swings to X50/Z5, feed stays within X10/Z0.
    c.apply(ctx, {
      ...GCODE,
      bounds: undefined,
      rapidPos: new Float32Array([0, 0, 5, 50, 0, 5]),
    });
    // Labels render the cut box sizes: X spans rapids (50), Z ignores rapid Z (0).
    const texts = (deps.makeLabel as any).mock.calls.map((args: any[]) => args[0]);
    expect(texts).toContain("X: 50 mm");
    expect(texts).toContain("Z: 0 mm");
  });

  it("setVisible / setBoundsVisible toggle the live objects", () => {
    const ctx = makeCtx();
    c.apply(ctx, GCODE);
    c.setVisible(false);
    expect(feedLineOf(ctx.workRotGroup).visible).toBe(false);
    c.apply(ctx, GCODE);   // stored visibility re-applied
    expect(feedLineOf(ctx.workRotGroup).visible).toBe(false);
  });

  it("setColors updates feed/rapid/toolpathBounds materials live", () => {
    const ctx = makeCtx();
    c.apply(ctx, GCODE);
    c.setColors({ feed: "#00ff00" });
    expect((feedLineOf(ctx.workRotGroup).material as THREE.LineBasicMaterial).color.getHexString()).toBe("00ff00");
  });

  it("dispose frees the toolpath and unregisters labels", () => {
    const ctx = makeCtx();
    c.apply(ctx, GCODE);
    const feed = feedLineOf(ctx.workRotGroup);
    const geomSpy = vi.spyOn(feed.geometry as THREE.BufferGeometry, "dispose");
    // Bounds box is the only LineSegments here (overflow edges need clip planes);
    // its EdgesGeometry was previously missed by dispose().
    const boundsBox = ctx.workRotGroup.children.find(o => (o as any).isLineSegments) as THREE.LineSegments;
    const boundsGeomSpy = vi.spyOn(boundsBox.geometry as THREE.BufferGeometry, "dispose");
    c.dispose();
    expect(geomSpy).toHaveBeenCalled();
    expect(boundsGeomSpy).toHaveBeenCalled();
    expect(deps.billboardLabels).toHaveLength(0);
    expect(c.feedSegs).toBe(0);
  });

  it("forgetAfterSceneClear drops refs without disposing (scene-cleared contract, H6 parallel)", () => {
    const ctx = makeCtx();
    c.apply(ctx, GCODE);
    const feed = feedLineOf(ctx.workRotGroup);
    const geomSpy = vi.spyOn(feed.geometry as THREE.BufferGeometry, "dispose");

    overflow.value = true;               // pretend the old program overflowed
    c.forgetAfterSceneClear();
    expect(geomSpy).not.toHaveBeenCalled();  // clearScene owns the freeing
    expect(c.feedSegs).toBe(0);              // telemetry stops reporting the dead program
    expect(overflow.value).toBe(false);      // stale HUD warning cleared

    // Next apply builds fresh under a NEW group and doesn't touch the forgotten line.
    const ctx2 = makeCtx();
    c.apply(ctx2, GCODE);
    expect(geomSpy).not.toHaveBeenCalled();
    expect(feedLineOf(ctx2.workRotGroup)).toBeTruthy();
    expect(c.feedSegs).toBe(3);
  });
});
