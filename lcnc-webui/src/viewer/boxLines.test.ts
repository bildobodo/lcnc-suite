// The two-tone lines: a dark solid pass with light cells over it — one width,
// one geometry. The bounds (both boxes, the reach outlines) carry ONE
// geometry-anchored pattern (package 4, plan Fassungen 2–3.1, Codex R62–R65);
// the pins keep a dash in CSS px along each projected segment (R44 VP-I10's
// screen dash, now theirs alone).
import { describe, it, expect } from "vitest";
import * as THREE from "three";
import type { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { boxGeoState, geoDashShaders, makeBoxEdges, makeBoxTicks, makeGeoTwoTone, makeTwoToneSegments, screenDashShaders,
  worldPerPixel, GeoDashState, REACH_PX, MACHINE_BOX_PX, TICK_ARM_PX, TICK_CORE_PX, TICK_UNDER_PX } from "./boxLines";
import { buildChains, chooseCells, clipParam } from "./geoDash";

const renderer = { getSize: (v: THREE.Vector2) => v.set(800, 600) } as unknown as THREE.WebGLRenderer;
const render = (line: LineSegments2, cam: THREE.Camera) =>
  (line as THREE.Object3D).onBeforeRender(renderer, new THREE.Scene(), cam, line.geometry, line.material as LineMaterial, null as never);
const ortho = (zoom: number) => {
  const c = new THREE.OrthographicCamera(-400, 400, 300, -300, 0.1, 10000);
  c.position.set(0, 0, 1000);   // in front of everything drawn at z = 0
  c.zoom = zoom; c.updateProjectionMatrix(); c.updateMatrixWorld();
  return c;
};
const reachState = (soup: Float32Array) => {
  const ch = buildChains(soup);
  return new GeoDashState(soup, Uint32Array.from(ch.chainOf), ch.t, Uint32Array.from(ch.starts), Uint32Array.from(ch.order));
};

describe("two-tone lines", () => {
  it("the pins' segments keep the dash in CSS px along each projected segment", () => {
    const soup = new Float32Array([0, 0, 0, 100, 0, 0, 100, 0, 0, 100, 50, 0]);
    const g = makeTwoToneSegments(soup, { color: "#15181c", alt: "#00e5ff", width: 2, dashPx: 3, role: "marker" });
    const [solid, dashes] = g.children as LineSegments2[];
    const sm = solid!.material as LineMaterial, dm = dashes!.material as LineMaterial;
    expect([sm.userData.role, dm.userData.role]).toEqual(["marker", "markerAlt"]);
    for (const zoom of [1, 3]) {
      render(dashes!, ortho(zoom));
      expect([dm.dashSize, dm.gapSize]).toEqual([3, 3]);
    }
    expect(["SCREEN_DASH" in dm.defines, "GEO_DASH" in dm.defines]).toEqual([true, false]);
  });

  it("the bounds: dark solid + light cells of the geometry pattern — one width, one geometry with the state's attributes", () => {
    const soup = new Float32Array([0, 0, 0, 100, 0, 0, 100, 0, 0, 100, 50, 0]);
    const g = makeGeoTwoTone(reachState(soup), { color: "#15181c", alt: "#f0f2f4", width: REACH_PX, role: "reach", renderOrder: 3 });
    const [solid, dashes] = g.children as LineSegments2[];
    const sm = solid!.material as LineMaterial, dm = dashes!.material as LineMaterial;
    expect([sm.userData.role, dm.userData.role]).toEqual(["reach", "reachAlt"]);
    expect([sm.linewidth, dm.linewidth]).toEqual([REACH_PX, REACH_PX]);
    expect([solid!.renderOrder, dashes!.renderOrder]).toEqual([3, 4]);
    expect(dashes!.geometry).toBe(solid!.geometry);
    expect([sm.transparent, dm.transparent], "opaque like every role line").toEqual([false, false]);
    expect(["GEO_DASH" in dm.defines, "SCREEN_DASH" in dm.defines, "GEO_DASH" in sm.defines]).toEqual([true, false, false]);
    const geom = solid!.geometry;
    expect(geom.getAttribute("instanceGeoT")?.count).toBe(2);
    const cells = geom.getAttribute("instanceGeoCells") as THREE.InstancedBufferAttribute;
    expect(cells.array).toBe(g.geo.cells);
    expect(cells.usage).toBe(THREE.DynamicDrawUsage);
    g.setColors("#000000", "#ffffff");
    expect([sm.color.getHexString(), dm.color.getHexString()]).toEqual(["000000", "ffffff"]);
  });

  it("the machine box: built at its real size (setSize), each edge a unit phased at its smaller coordinate", () => {
    const box = makeBoxEdges([1, 1, 1], { color: "#15181c", alt: "#f0f2f4", width: MACHINE_BOX_PX, role: "bounds" });
    const [solid, dashes] = box.children as LineSegments2[];
    const before = solid!.geometry, stateBefore = box.geo;
    box.setSize(500, 400, 310);
    expect(solid!.geometry, "a new geometry").not.toBe(before);
    expect(box.geo, "new units").not.toBe(stateBefore);
    expect(dashes!.geometry).toBe(solid!.geometry);
    expect(box.scale.toArray()).toEqual([1, 1, 1]);
    const start = solid!.geometry.getAttribute("instanceStart") as THREE.InterleavedBufferAttribute;
    const end = solid!.geometry.getAttribute("instanceEnd") as THREE.InterleavedBufferAttribute;
    const xs = Array.from({ length: start.count }, (_, i) => Math.abs(start.getX(i)));
    expect(Math.max(...xs), "real half-size along X").toBeCloseTo(250, 6);
    // every edge runs from its smaller coordinate (t = 0) to its larger (t = 1)
    const t = solid!.geometry.getAttribute("instanceGeoT") as THREE.InstancedBufferAttribute;
    for (let i = 0; i < start.count; i++) {
      const d = [end.getX(i) - start.getX(i), end.getY(i) - start.getY(i), end.getZ(i) - start.getZ(i)];
      expect(d.every(v => v >= 0) && d.some(v => v > 0), `edge ${i} runs up its axis`).toBe(true);
      expect([t.getX(i), t.getY(i)]).toEqual([0, 1]);
    }
  });

  it("the shader patches LineMaterial's own source — the trim gets the trim point's t; every anchor once, or it throws", () => {
    const m = new LineMaterial();
    const { vertex, fragment } = geoDashShaders(m.vertexShader, m.fragmentShader);
    expect(vertex).toContain("gTE = mix( gTS, gTE, ( gNear - start.z ) / ( end.z - start.z ) );");
    expect(vertex).toContain("vGeoT = ( position.y < 0.5 ) ? gTS : gTE;");
    expect(fragment).toContain("mod( floor( vGeoT * vGeoCells ), 2.0 ) < 0.5");
    expect(() => geoDashShaders(m.vertexShader.replace("vec4 end = modelViewMatrix", "vec4 end=modelViewMatrix"), m.fragmentShader)).toThrow(/vertex end point/);
    expect(() => geoDashShaders(m.vertexShader, m.fragmentShader.replace("// todo - FIX", ""))).toThrow(/fragment dash test/);
    // the pins' screen dash keeps its own patch
    const sd = screenDashShaders(m.vertexShader, m.fragmentShader);
    expect(sd.fragment).toContain("mod( vDashW / vDashInvW + dashOffset, dashSize + gapSize )");
  });

  it("world units per pixel: orthographic by the frustum and zoom, perspective by the distance", () => {
    const o = new THREE.Object3D();
    expect(worldPerPixel(ortho(1), o, 600)).toBeCloseTo(1, 9);
    expect(worldPerPixel(ortho(4), o, 600)).toBeCloseTo(0.25, 9);
    const p = new THREE.PerspectiveCamera(90, 1, 0.1, 1e5);
    p.position.set(0, 0, 300); p.updateMatrixWorld();
    // 2 · 300 · tan(45°) / 600 = 1
    expect(worldPerPixel(p, o, 600)).toBeCloseTo(1, 6);
  });
});

describe("GeoDashState: the cell count per unit for this view", () => {
  it("zooming within an octave keeps N, past the band it doubles — the cells stay on the geometry", () => {
    // one 100-unit edge along X in an 800 px wide ortho view: 100 px at zoom 1
    const st = boxGeoState(new Float32Array([-50, 0, 0, 50, 0, 0]));
    const o = new THREE.Object3D(); o.updateMatrixWorld();
    st.update(o, ortho(1), 800, 600);
    expect(st.cellsOf()).toEqual([16]);          // 6.25 px
    st.update(o, ortho(1.8), 800, 600);
    expect(st.cellsOf(), "11.25 px: kept").toEqual([16]);
    st.update(o, ortho(2.5), 800, 600);
    expect(st.cellsOf(), "15.6 px: doubled").toEqual([32]);
    expect(Array.from(st.cells)).toEqual([32]);
  });

  it("an upload only when a count changed", () => {
    const st = boxGeoState(new Float32Array([-50, 0, 0, 50, 0, 0]));
    const attr = new THREE.InstancedBufferAttribute(st.cells, 1);
    st.attrs.push(attr);
    const o = new THREE.Object3D(); o.updateMatrixWorld();
    expect(st.update(o, ortho(1), 800, 600)).toBe(true);
    const v = attr.version;
    expect(st.update(o, ortho(1.01), 800, 600)).toBe(false);
    expect(attr.version, "no upload for an unchanged count").toBe(v);
  });

  it("Codex R63: an edge through the near plane takes N from its visible part — 512 cells, both tones in view", () => {
    // camera at the origin looking down −Z, 500 CSS px focal length, 500 px high
    const cam = new THREE.PerspectiveCamera(2 * Math.atan(0.5) * 180 / Math.PI, 1, 1, 1e5);
    cam.updateProjectionMatrix(); cam.updateMatrixWorld();
    const st = boxGeoState(new Float32Array([10.2, 0, 49, 0, 0, -2]));
    const o = new THREE.Object3D(); o.updateMatrixWorld();
    st.update(o, cam, 500, 500);
    const n = st.cellsOf()[0]!;
    expect(n).toBe(512);
    // the visible t ∈ [50/51, 1] holds an inner boundary k / N
    expect(Math.ceil((50 / 51) * n) < n).toBe(true);
  });

  it("a reach chain: one N for its segments, chosen by its visible pieces", () => {
    // a 3-segment chain, 300 units long along X, in view
    const soup = new Float32Array([-150, 0, 0, -50, 0, 0, -50, 0, 0, 50, 0, 0, 50, 0, 0, 150, 0, 0]);
    const st = reachState(soup);
    const o = new THREE.Object3D(); o.updateMatrixWorld();
    st.update(o, ortho(1), 800, 600);
    const n = st.cellsOf();
    expect(n).toHaveLength(1);
    expect(300 / n[0]!).toBeGreaterThan(6);
    expect(300 / n[0]!).toBeLessThanOrEqual(12);
    expect(new Set(Array.from(st.cells))).toEqual(new Set([n[0]]));
  });

  it("a chain with two visible pieces takes the larger of their L / Δt (plan Fassung 3)", () => {
    // perspective eye at the origin looking down −Z; the chain leaves the view
    // behind the eye in its middle and comes back: two visible pieces
    const cam = new THREE.PerspectiveCamera(60, 1, 1, 1e5);
    cam.updateProjectionMatrix(); cam.updateMatrixWorld();
    const soup = new Float32Array([
      -60, 0, -100, -20, 0, -100,      // piece 1 …
      -20, 0, -100, 20, 0, 50,         // … into the eye's back
      20, 0, 50, 60, 0, -300,          // piece 2, back in view, far away
    ]);
    const st = reachState(soup);
    const o = new THREE.Object3D(); o.updateMatrixWorld();
    st.update(o, cam, 800, 800);
    // the two pieces measured apart: visible screen length over visible t
    const mvp = new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    const clip = (x: number, y: number, z: number) => new THREE.Vector4(x, y, z, 1).applyMatrix4(mvp).toArray();
    const px = (c: number[]) => [c[0]! / c[3]! * 400, c[1]! / c[3]! * 400];
    const part = (i: number) => {
      const a = clip(soup[i * 6]!, soup[i * 6 + 1]!, soup[i * 6 + 2]!), b = clip(soup[i * 6 + 3]!, soup[i * 6 + 4]!, soup[i * 6 + 5]!);
      const out = [0, 0];
      if (!clipParam(a, b, out)) return { L: 0, dt: 0, full0: false, full1: false };
      const at = (f: number) => px(a.map((v, k) => v + (b[k]! - v) * f));
      const [p0, p1] = [at(out[0]!), at(out[1]!)];
      return { L: Math.hypot(p1[0]! - p0[0]!, p1[1]! - p0[1]!), dt: Math.abs(st.t[i * 2 + 1]! - st.t[i * 2]!) * (out[1]! - out[0]!), full0: out[0] === 0, full1: out[1] === 1 };
    };
    const [s0, s1, s2] = [part(0), part(1), part(2)];
    expect(s0.full1 && s1.full0 && !s1.full1, "piece 1 runs from segment 0 into segment 1").toBe(true);
    expect(s2.L > 0 && !s2.full0, "piece 2 starts inside segment 2").toBe(true);
    const r1 = (s0.L + s1.L) / (s0.dt + s1.dt), r2 = s2.L / s2.dt;
    expect(st.cellsOf()).toEqual([chooseCells(Math.max(r1, r2), 0)]);
    expect(Math.max(r1, r2) / Math.min(r1, r2), "the pieces differ: the rule picks one").toBeGreaterThan(1.5);
  });
});

describe("the toolpath box's dimension end marks", () => {
  const W = 800, H = 600;
  /** A world point on the page (CSS px, y down). */
  const screen = (p: number[], cam: THREE.Camera): [number, number] => {
    const v = new THREE.Vector3(p[0], p[1], p[2]).project(cam);
    return [(v.x + 1) / 2 * W, (1 - v.y) / 2 * H];
  };
  const persp = () => {
    const c = new THREE.PerspectiveCamera(40, W / H, 1, 1e5);
    c.position.set(300, -500, 400); c.up.set(0, 0, 1); c.lookAt(50, 30, 20);
    c.updateProjectionMatrix(); c.updateMatrixWorld();
    return c;
  };
  for (const [name, mk] of [["parallel", () => { const c = ortho(1.5); c.position.set(200, -300, 400); c.up.set(0, 0, 1); c.lookAt(0, 0, 0); c.updateMatrixWorld(); return c; }],
    ["perspective", persp]] as const) {
    it(`a bar across each end of every edge, ${2 * TICK_ARM_PX} px long on screen, centred on the corner (${name})`, () => {
      const box = makeBoxEdges([120, 80, 40], { color: "#15181c", alt: "#f0f2f4", width: 1, role: "toolpathBounds" });
      box.position.set(-10, 5, 3);
      const ticks = makeBoxTicks({ dark: "#15181c", light: "#f0f2f4", role: "toolpathBounds" });
      box.add(ticks);
      const cam = mk();
      box.updateMatrixWorld(true);
      ticks.pose(box, cam, W, H);
      ticks.updateMatrixWorld(true);
      const bars = ticks.worldSegments();
      expect(bars.length).toBe(24);
      const P = box.geo!.positions;
      let checked = 0;
      for (let s = 0; s < 12; s++) {
        const a = new THREE.Vector3(P[s * 6], P[s * 6 + 1], P[s * 6 + 2]).applyMatrix4(box.matrixWorld).toArray();
        const b = new THREE.Vector3(P[s * 6 + 3], P[s * 6 + 4], P[s * 6 + 5]).applyMatrix4(box.matrixWorld).toArray();
        const [ax, ay] = screen(a, cam), [bx, by] = screen(b, cam);
        const el = Math.hypot(bx - ax, by - ay);
        if (el < 1) continue;   // seen end-on: no direction to cross
        for (let end = 0; end < 2; end++) {
          const bar = bars[s * 2 + end]!;
          const [x0, y0] = screen(bar.slice(0, 3), cam), [x1, y1] = screen(bar.slice(3), cam);
          const len = Math.hypot(x1 - x0, y1 - y0);
          expect(len, `edge ${s} end ${end}`).toBeCloseTo(2 * TICK_ARM_PX, 0);
          // across the edge: perpendicular on screen
          expect(Math.abs((x1 - x0) * (bx - ax) + (y1 - y0) * (by - ay)) / (len * el), `edge ${s}`).toBeLessThan(0.02);
          // centred on the corner it marks
          const [cx, cy]: [number, number] = end ? [bx, by] : [ax, ay];
          expect(Math.hypot((x0 + x1) / 2 - cx, (y0 + y1) / 2 - cy)).toBeLessThan(0.05);
          checked++;
        }
      }
      expect(checked).toBeGreaterThanOrEqual(18);
    });
  }

  it("its own contrast carrier: a light underlay under a dark core, over the box's passes; colours follow setColors", () => {
    const ticks = makeBoxTicks({ dark: "#15181c", light: "#f0f2f4", role: "toolpathBounds" });
    const [under, core] = ticks.children as LineSegments2[];
    const um = under!.material as LineMaterial, cm = core!.material as LineMaterial;
    expect([um.linewidth, cm.linewidth]).toEqual([TICK_UNDER_PX, TICK_CORE_PX]);
    expect(um.linewidth).toBeGreaterThan(cm.linewidth);
    expect([um.userData.role, cm.userData.role]).toEqual(["toolpathBoundsTickAlt", "toolpathBoundsTick"]);
    expect(core!.renderOrder).toBeGreaterThan(under!.renderOrder);
    expect(under!.renderOrder).toBeGreaterThan(1);
    ticks.setColors("#000000", "#ffffff");
    expect([cm.color.getHexString(), um.color.getHexString()]).toEqual(["000000", "ffffff"]);
  });
});
