// Unit tests for viewer/toolpathController.ts (A3.4). THREE geometry/material
// ops are pure JS → headless. troika labels are faked (they need a font loader).
// Covers the disposal-on-rebuild contract (the hardest part: shared geometry +
// ad-hoc materials must all be freed), the line-index fallback, label
// unregistration, and the overflow flag.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildLineIndex } from "./lineIndex";
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
    sceneBackground: () => new THREE.Color(SCENE_BG),
    axisCss: { x: "#f00", y: "#0f0", z: "#00f" },
    overflow,
  };
}
const SCENE_BG = "#102030";

function makeCtx(over: Partial<ToolpathCtx> = {}): ToolpathCtx & { workRotGroup: THREE.Group; pathAnchor: THREE.Group; pathRot: THREE.Group } {
  const pathAnchor = new THREE.Group();
  const pathRot = new THREE.Group();
  pathAnchor.add(pathRot);
  return {
    scene: new THREE.Scene(),
    workOrigin: new THREE.Group(),
    workRotGroup: new THREE.Group(),
    pathAnchor, pathRot,
    machineFrame: null,
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
  it("builds the line index from feed_lines when the worker index is absent, and ranges it", () => {
    const ctx = makeCtx();
    c.apply(ctx, GCODE);   // no g.feedLineIndex → built from feed_lines [10,11,12]
    c.setHighlight(11);    // line 11 → point index 1
    const hl = ctx.workRotGroup.children.find(o => o.renderOrder === 12) as THREE.Line;
    // effectiveLine 11 has range {start:1,end:1}; drawRange start = max(0, 0) = 0, count = 1.
    expect(hl.geometry.drawRange).toMatchObject({ start: 0, count: 1 });
    c.setHighlight(null);
    expect(hl.geometry.drawRange.count).toBe(0);
  });

  it("prefers the worker-provided line index (typed arrays) over rebuilding", () => {
    const ctx = makeCtx();
    const workerIndex = buildLineIndex(new Uint32Array([1, 1, 99]));   // line 99 → point 2 only
    c.apply(ctx, { ...GCODE, feedLineIndex: workerIndex });
    c.setHighlight(99);
    const hl = ctx.workRotGroup.children.find(o => o.renderOrder === 12) as THREE.Line;
    expect(hl.geometry.drawRange).toMatchObject({ start: 1, count: 2 });
  });
});

describe("stale mute", () => {
  // The mute is an OPAQUE colour mix toward the scene background at the
  // token's ratio — never alpha: a million blended segments held the Mac's
  // GPU three frames behind during every re-parse (viewerPerf, 2026-09-09).
  const mixOf = (hex: string, keep: number) => new THREE.Color(SCENE_BG).lerp(new THREE.Color(hex), keep).getHex();

  it("setStale mutes feed + rapid by an opaque mix at the host's token and survives a rebuild", () => {
    const ctx = makeCtx();
    (deps as any).staleOpacity = () => 0.4;
    c.apply(ctx, GCODE);
    const feedMat = () => feedLineOf(ctx.workRotGroup).material as THREE.LineBasicMaterial;
    expect(feedMat().color.getHex()).toBe(new THREE.Color("#22b8cf").getHex());
    c.setStale(true);
    expect(feedMat().color.getHex()).toBe(mixOf("#22b8cf", 0.4));
    expect(feedMat().transparent).toBe(false);
    expect(feedMat().opacity).toBe(1);
    c.apply(ctx, { ...GCODE });        // a publish while still stale keeps the new lines muted
    expect(feedMat().color.getHex()).toBe(mixOf("#22b8cf", 0.4));
    c.setStale(false);
    expect(feedMat().color.getHex()).toBe(new THREE.Color("#22b8cf").getHex());
    expect(feedMat().transparent).toBe(false);
  });

  it("a colour change while muted lands as the muted mix and the new colour returns on un-mute", () => {
    const ctx = makeCtx();
    (deps as any).staleOpacity = () => 0.4;
    c.apply(ctx, GCODE);
    const feedMat = () => feedLineOf(ctx.workRotGroup).material as THREE.LineBasicMaterial;
    c.setStale(true);
    c.setColors({ feed: "#ff0000" });
    expect(feedMat().color.getHex()).toBe(mixOf("#ff0000", 0.4));
    c.setStale(false);
    expect(feedMat().color.getHex()).toBe(0xff0000);
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
    // The bounds box is the LineSegments that is NOT a path chunk (renderOrder
    // 10); overflow edges need clip planes. Its EdgesGeometry was previously
    // missed by dispose().
    const boundsBox = ctx.workRotGroup.children.find(o => (o as any).isLineSegments && o.renderOrder !== 10) as THREE.LineSegments;
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

describe("baked-toolpath anchor (2026-09-03 run-time jump)", () => {
  it("apply with anchor parents the lines under pathRot and poses the anchor in the same call", () => {
    const ctx = makeCtx();
    c.apply(ctx, GCODE, { ox: 1300, oy: -200, oz: -1400, thetaDeg: 90 });
    const fl = feedLineOf(ctx.pathRot);
    expect(fl).toBeDefined();
    expect(feedLineOf(ctx.workRotGroup)).toBeUndefined();
    expect(ctx.pathAnchor.position.toArray()).toEqual([1300, -200, -1400]);
    expect(ctx.pathRot.rotation.z).toBeCloseTo(Math.PI / 2, 12);
    // the bounds box rides the same parent as the lines
    expect(ctx.workRotGroup.children.some(o => (o as any).isLineSegments || (o as any).isLine)).toBe(false);
  });
  it("apply without an anchor keeps raw program coordinates under the live workRotGroup", () => {
    const ctx = makeCtx();
    c.apply(ctx, GCODE, null);
    expect(feedLineOf(ctx.workRotGroup)).toBeDefined();
    expect(feedLineOf(ctx.pathRot)).toBeUndefined();
    expect(ctx.pathAnchor.position.toArray()).toEqual([0, 0, 0]);
  });
  it("a re-bake moves the anchor and replaces the lines together — never one without the other", () => {
    const ctx = makeCtx();
    c.apply(ctx, GCODE, { ox: 0, oy: 0, oz: 45.6, thetaDeg: 0 });
    const first = feedLineOf(ctx.pathRot);
    c.apply(ctx, GCODE, { ox: 1300, oy: -200, oz: -1400, thetaDeg: 0 });
    const second = feedLineOf(ctx.pathRot);
    expect(second).toBeDefined();
    expect(second).not.toBe(first);
    expect(first.parent).toBeNull();                       // old lines detached
    expect(ctx.pathAnchor.position.toArray()).toEqual([1300, -200, -1400]);
    // only NEW feed chunks (non-dashed, 3 points) remain under the anchor —
    // the same number as after the first apply, none of them the old object
    // (the highlight line shares feed's positions at renderOrder 12; rapid is dashed)
    const feedChunks = (g: THREE.Group) => g.children.filter(o => (o as any).isLine && o.renderOrder === 10
      && !((o as any).material instanceof THREE.LineDashedMaterial)
      && (o as THREE.Line).geometry.getAttribute("position")?.count === 3);
    const now = feedChunks(ctx.pathRot);
    expect(now.length).toBeGreaterThan(0);
    expect(now).not.toContain(first);
    expect(now.every(o => o.parent === ctx.pathRot)).toBe(true);
  });
  it("switching from baked to raw moves the lines back under workRotGroup", () => {
    const ctx = makeCtx();
    c.apply(ctx, GCODE, { ox: 5, oy: 5, oz: 5, thetaDeg: 0 });
    c.apply(ctx, GCODE, null);
    expect(feedLineOf(ctx.pathRot)).toBeUndefined();
    expect(feedLineOf(ctx.workRotGroup)).toBeDefined();
  });
});

describe("chunked draw (2026-09-11 headroom wave)", () => {
  // Six fake clip planes stand in for the machine-bounds planes: their mere
  // presence makes the controller build the outside-bounds overlays.
  const PLANES = () => Array.from({ length: 6 }, () => new THREE.Plane());
  const chunksOf = (g: THREE.Group) => g.children.filter(o => (o as any).isLineSegments && o.renderOrder === 10
    && !((o as any).material.clippingPlanes?.length)) as THREE.LineSegments[];
  const overlaysOf = (g: THREE.Group) => g.children.filter(o => (o as any).isLineSegments && o.renderOrder === 10
    && (o as any).material.clippingPlanes?.length) as THREE.LineSegments[];
  const lookAt = (x: number, y: number, z: number, from: [number, number, number]) => {
    const cam = new THREE.PerspectiveCamera(50, 1, 0.1, 10000);
    cam.position.set(...from);
    cam.lookAt(x, y, z);
    cam.updateMatrixWorld();
    return cam;
  };

  it("splits each stream into chunks sharing one position attribute, each with its own sphere and draw range", () => {
    const cc = createToolpathController({ ...(deps as any) });
    const ctx = makeCtx();
    cc.apply(ctx, GCODE);                 // feed: 2 segments → 2 chunks; rapid: 1 segment → 1 chunk
    const chunks = chunksOf(ctx.workRotGroup);
    expect(chunks).toHaveLength(3);
    expect(cc.chunks).toBe(3);
    expect(cc.drawSegs).toBe(3);
    expect(cc.feedSegs).toBe(3);          // still VERTICES (trace-row compatibility)
    const feedChunks = chunks.filter(o => !((o as any).material instanceof THREE.LineDashedMaterial));
    expect(feedChunks).toHaveLength(2);
    expect(feedChunks[0]!.geometry.attributes.position).toBe(feedChunks[1]!.geometry.attributes.position);
    expect(feedChunks[0]!.geometry.index).toBe(feedChunks[1]!.geometry.index);
    expect(feedChunks[0]!.geometry.drawRange).toEqual({ start: 0, count: 2 });
    expect(feedChunks[1]!.geometry.drawRange).toEqual({ start: 2, count: 2 });
    for (const ch of chunks) {
      expect(ch.geometry.boundingSphere).not.toBeNull();
      expect(ch.frustumCulled).toBe(true);
    }
    // the first feed chunk covers (0,0,0)-(10,0,0): centre x = 5, radius 5
    expect(feedChunks[0]!.geometry.boundingSphere!.center.x).toBeCloseTo(5, 9);
    expect(feedChunks[0]!.geometry.boundingSphere!.radius).toBeCloseTo(5, 9);
    // one material per stream, shared by its chunks
    expect(feedChunks[0]!.material).toBe(feedChunks[1]!.material);
  });

  it("a rebuild disposes every chunk and the highlight (registry teardown)", () => {
    const cc = createToolpathController({ ...(deps as any) });
    const ctx = makeCtx();
    cc.apply(ctx, GCODE);
    const spies = chunksOf(ctx.workRotGroup).map(o => vi.spyOn(o.geometry, "dispose"));
    const before = ctx.workRotGroup.children.length;
    cc.apply(ctx, GCODE);
    for (const sp of spies) expect(sp).toHaveBeenCalled();
    expect(ctx.workRotGroup.children.length).toBe(before);   // replaced, not accumulated
    cc.dispose();
    expect(chunksOf(ctx.workRotGroup)).toHaveLength(0);
    expect(cc.chunks).toBe(0);
  });

  it("overlay gate: a chunk whose box lies inside the machine bounds draws no overlay; outside chunks keep it", () => {
    const d = { ...(deps as any), boundsClipPlanes: PLANES() };
    const cc = createToolpathController(d);
    const mf = new THREE.Group();
    // Path spans x 0..10, y 0..10, z 0..5 (feed + rapid). Bounds box x 0..6
    // contains the first feed segment (0..10? no: 0..10 straddles) — use a
    // program whose chunks separate cleanly: feed (0,0,0)-(2,0,0)-(2,2,0),
    // rapid (50,50,0)-(60,50,0).
    const g = {
      feedPos: new Float32Array([0, 0, 0, 2, 0, 0, 2, 2, 0]),
      rapidPos: new Float32Array([50, 50, 0, 60, 50, 0]),
      feed_lines: [1, 2, 3],
      bounds: { min: [0, 0, 0], max: [60, 50, 0] },
    } as any;
    const ctx = makeCtx({ machineFrame: mf, machineBounds: { origin: [-1, -1, -1], size: [20, 20, 20] } });
    cc.apply(ctx, g);
    const ovs = overlaysOf(ctx.workRotGroup);
    expect(ovs).toHaveLength(3);          // one per chunk, all drawn until the gate runs
    expect(ovs.every(o => o.visible)).toBe(true);
    cc.updateCulling(ctx, lookAt(5, 5, 0, [5, 5, 100]));
    // overlays are solid LineBasic for both streams — tell the feed chunks
    // (x ≤ 2) from the rapid chunk (x 50..60) by their spheres
    const feedOvs = ovs.filter(o => o.geometry.boundingSphere!.center.x < 40);
    expect(feedOvs).toHaveLength(2);
    // the feed chunks (inside x,y ≤ 2) are gated off; the rapid chunk at x 50..60 stays
    expect(feedOvs.every(o => o.visible === false)).toBe(true);
    expect(cc.overlayChunks).toBe(1);
    // move the machine box past x = 3 so both feed chunks (x 0..2, x = 2) fall
    // outside it → their overlays come back on
    ctx.machineBounds = { origin: [3, -1, -1], size: [20, 20, 20] };
    cc.updateCulling(ctx, lookAt(5, 5, 0, [5, 5, 100]));
    expect(cc.overlayChunks).toBe(3);
    expect(feedOvs.every(o => o.visible)).toBe(true);
    // no machine frame → no gate: everything drawn
    ctx.machineFrame = null;
    ctx.machineBounds = { origin: [-1, -1, -1], size: [200, 200, 200] };
    cc.updateCulling(ctx, lookAt(5, 5, 0, [5, 5, 100]));
    expect(cc.overlayChunks).toBe(3);
  });

  it("the gate judges the chunk box at the parent's CURRENT pose in the machine frame", () => {
    const d = { ...(deps as any), boundsClipPlanes: PLANES() };
    const cc = createToolpathController(d);
    const mf = new THREE.Group();
    const ctx = makeCtx({ machineFrame: mf, machineBounds: { origin: [0, 0, -1], size: [20, 20, 20] } });
    const g = { feedPos: new Float32Array([1, 1, 0, 5, 1, 0]), feed_lines: [1, 2], bounds: { min: [1, 1, 0], max: [5, 1, 0] } } as any;
    cc.apply(ctx, g);
    cc.updateCulling(ctx, lookAt(3, 1, 0, [3, 1, 50]));
    expect(cc.overlayChunks).toBe(0);                     // inside at identity
    ctx.workRotGroup.rotation.z = Math.PI;                // the table turned: x 1..5 → −5..−1
    cc.updateCulling(ctx, lookAt(3, 1, 0, [3, 1, 50]));
    expect(cc.overlayChunks).toBe(1);                     // now outside the machine box
  });

  it("setVisible(false) hides overlays too and setVisible(true) restores only the needed ones", () => {
    const d = { ...(deps as any), boundsClipPlanes: PLANES() };
    const cc = createToolpathController(d);
    const mf = new THREE.Group();
    const g = {
      feedPos: new Float32Array([0, 0, 0, 2, 0, 0]), feed_lines: [1, 2],
      rapidPos: new Float32Array([50, 50, 0, 60, 50, 0]), bounds: { min: [0, 0, 0], max: [60, 50, 0] },
    } as any;
    const ctx = makeCtx({ machineFrame: mf, machineBounds: { origin: [-1, -1, -1], size: [20, 20, 20] } });
    cc.apply(ctx, g);
    cc.updateCulling(ctx, lookAt(5, 5, 0, [5, 5, 100]));
    cc.setVisible(false);
    expect(overlaysOf(ctx.workRotGroup).every(o => !o.visible)).toBe(true);
    expect(chunksOf(ctx.workRotGroup).every(o => !o.visible)).toBe(true);
    cc.setVisible(true);
    const ovs = overlaysOf(ctx.workRotGroup);
    const rapidOv = ovs.find(o => (o as any).material instanceof THREE.LineDashedMaterial) ?? null;
    // overlays are LineBasic even for rapids (solid yellow); tell them apart by position
    const outside = ovs.filter(o => o.geometry.boundingSphere!.center.x > 40);
    const inside = ovs.filter(o => o.geometry.boundingSphere!.center.x < 40);
    expect(rapidOv).toBeNull();
    expect(outside.every(o => o.visible)).toBe(true);
    expect(inside.every(o => !o.visible)).toBe(true);
  });

  it("counts the chunks inside the camera frustum for the perf probe", () => {
    const cc = createToolpathController({ ...(deps as any) });
    const ctx = makeCtx();
    cc.apply(ctx, GCODE);
    cc.updateCulling(ctx, lookAt(5, 5, 0, [5, 5, 100]));
    expect(cc.chunksVisible).toBe(3);
    cc.updateCulling(ctx, lookAt(5000, 5000, 0, [5000, 5000, 10]));   // looking elsewhere
    expect(cc.chunksVisible).toBe(0);
  });
});
