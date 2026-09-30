// The two-tone lines (operator 2026-09-29): the boxes and the reach outlines
// are a dark solid pass with light dashes over it — one width, one geometry,
// the dash held in CSS px along each PROJECTED segment (Codex R44 VP-I10).
import { describe, it, expect } from "vitest";
import * as THREE from "three";
import type { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { alternateTones, makeBoxEdges, makeTwoToneSegments, screenDashShaders, worldPerPixel, REACH_PX, REACH_DASH_PX, MACHINE_BOX_PX, MACHINE_BOX_DASH_PX } from "./boxLines";

const renderer = { getSize: (v: THREE.Vector2) => v.set(800, 600) } as unknown as THREE.WebGLRenderer;
const render = (line: LineSegments2, cam: THREE.Camera) =>
  (line as THREE.Object3D).onBeforeRender(renderer, new THREE.Scene(), cam, line.geometry, line.material as LineMaterial, null as never);
const ortho = (zoom: number) => {
  const c = new THREE.OrthographicCamera(-400, 400, 300, -300, 0.1, 10000);
  c.zoom = zoom; c.updateProjectionMatrix();
  return c;
};

describe("two-tone lines", () => {
  it("a segment soup (the reach outlines): dark solid + light dashes, one width, one geometry, dotted in CSS px", () => {
    const soup = new Float32Array([0, 0, 0, 100, 0, 0, 100, 0, 0, 100, 50, 0]);
    const g = makeTwoToneSegments(soup, { color: "#15181c", alt: "#f0f2f4", width: REACH_PX, dashPx: REACH_DASH_PX, role: "reach", renderOrder: 3 });
    const [solid, dashes] = g.children as LineSegments2[];
    const sm = solid!.material as LineMaterial, dm = dashes!.material as LineMaterial;
    expect([sm.userData.role, dm.userData.role]).toEqual(["reach", "reachAlt"]);
    expect([sm.linewidth, dm.linewidth]).toEqual([REACH_PX, REACH_PX]);
    expect([sm.dashed, dm.dashed]).toEqual([false, true]);
    expect([solid!.renderOrder, dashes!.renderOrder]).toEqual([3, 4]);
    expect(dashes!.geometry).toBe(solid!.geometry);
    expect([sm.transparent, dm.transparent], "opaque like every role line").toEqual([false, false]);
    // the dash is CSS px on screen: no world length to re-express per frame
    for (const zoom of [1, 3]) {
      render(dashes!, ortho(zoom));
      expect([dm.dashSize, dm.gapSize]).toEqual([REACH_DASH_PX, REACH_DASH_PX]);
    }
    expect("SCREEN_DASH" in dm.defines, "its own program: the screen-space dash").toBe(true);
    expect("SCREEN_DASH" in sm.defines).toBe(false);
    g.setColors("#000000", "#ffffff");
    expect([sm.color.getHexString(), dm.color.getHexString()]).toEqual(["000000", "ffffff"]);
  });

  it("the machine box: built at its real size (setSize), never scaled — its dashes keep their pixels on every edge", () => {
    const box = makeBoxEdges([1, 1, 1], { color: "#15181c", alt: "#f0f2f4", width: MACHINE_BOX_PX, dashPx: MACHINE_BOX_DASH_PX, role: "bounds" });
    const [solid, dashes] = box.children as LineSegments2[];
    const before = solid!.geometry;
    box.setSize(500, 400, 310);
    expect(solid!.geometry, "a new geometry").not.toBe(before);
    expect(dashes!.geometry).toBe(solid!.geometry);
    expect(box.scale.toArray()).toEqual([1, 1, 1]);
    const start = solid!.geometry.getAttribute("instanceStart") as THREE.InterleavedBufferAttribute;
    const xs = Array.from({ length: start.count }, (_, i) => Math.abs(start.getX(i)));
    expect(Math.max(...xs), "real half-size along X").toBeCloseTo(250, 6);
    const dm = dashes!.material as LineMaterial;
    render(dashes!, ortho(2));
    expect([dm.dashSize, dm.gapSize, "SCREEN_DASH" in dm.defines]).toEqual([MACHINE_BOX_DASH_PX, MACHINE_BOX_DASH_PX, true]);
  });

  it("the screen-space dash patches LineMaterial's own shader — every anchor exactly once, or it throws", () => {
    const m = new LineMaterial();
    const { vertex, fragment } = screenDashShaders(m.vertexShader, m.fragmentShader);
    expect(vertex).toContain("vDashW = dPx * clip.w;");
    expect(vertex).toContain("length( sdPx )");
    expect(fragment).toContain("mod( vDashW / vDashInvW + dashOffset, dashSize + gapSize )");
    // the world dash stays for every other dashed line (the rapids)
    expect(fragment).toContain("mod( vLineDistance + dashOffset");
    // a three upgrade that moves an anchor must fail loudly, never draw world dashes
    expect(() => screenDashShaders(m.vertexShader.replace("gl_Position = clip;", "gl_Position=clip;"), m.fragmentShader)).toThrow(/vertex main/);
    expect(() => screenDashShaders(m.vertexShader, m.fragmentShader.replace("// todo - FIX", ""))).toThrow(/fragment dash test/);
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

// Codex R45 VP-I12: the reach cage is thousands of short segments; each one
// restarting its dash began light, and a ring of them read all light. Tones
// alternate along each chain of segments meeting end to end, and a segment
// shorter than two dash periods on screen draws wholly in its tone.
describe("alternating tones along chains (Codex R45 VP-I12)", () => {
  const ring = (n: number) => {
    const out: number[] = [];
    for (let k = 0; k < n; k++) {
      const a = (2 * Math.PI * k) / n, b = (2 * Math.PI * (k + 1)) / n;
      out.push(Math.cos(a), Math.sin(a), 0, Math.cos(b), Math.sin(b), 0);
    }
    return new Float32Array(out);
  };

  it("a ring alternates its segments' tones — an odd ring has one equal pair", () => {
    expect(Array.from(alternateTones(ring(8)))).toEqual([0, 1, 0, 1, 0, 1, 0, 1].map(v => v));
    const odd = Array.from(alternateTones(ring(7)));
    let same = 0;
    for (let k = 0; k < 7; k++) if (odd[k] === odd[(k + 1) % 7]) same++;
    expect(same).toBe(1);
    expect(odd.filter(t => t === 1).length).toBeGreaterThanOrEqual(3);
  });

  it("segments in any order in the soup (the cage interleaves rings, generators, spokes): neighbours still alternate", () => {
    const r = ring(10);
    const order = [3, 7, 0, 9, 5, 1, 8, 2, 6, 4];
    const shuffled = new Float32Array(order.flatMap(k => Array.from(r.slice(k * 6, k * 6 + 6))));
    const t = alternateTones(shuffled);
    const toneOf = new Map(order.map((k, i) => [k, t[i]!]));
    for (let k = 0; k < 10; k++) expect(toneOf.get(k), `segments ${k} and ${(k + 1) % 10}`).not.toBe(toneOf.get((k + 1) % 10));
  });

  it("a junction or an open end ends a chain; a lone segment is a chain of one", () => {
    // a T: three arms meeting at the origin, each two segments long, plus a lone one
    const arms = [[1, 0], [-1, 0], [0, 1]].flatMap(([x, y]) => [0, 0, 0, x!, y!, 0, x!, y!, 0, 2 * x!, 2 * y!, 0]);
    const t = Array.from(alternateTones(new Float32Array([...arms, 5, 5, 5, 6, 6, 6])));
    expect(t.every(v => v === 0 || v === 1), "every segment toned").toBe(true);
    for (let a = 0; a < 3; a++) expect(t[a * 2], `arm ${a} alternates`).not.toBe(t[a * 2 + 1]);
  });

  it("the reach outlines carry the tones; the boxes do not", () => {
    const g = makeTwoToneSegments(ring(12), { color: "#15181c", alt: "#f0f2f4", width: REACH_PX, dashPx: REACH_DASH_PX, role: "reach", tones: true });
    const dm = (g.children[1] as LineSegments2).material as LineMaterial;
    expect("SCREEN_DASH_TONE" in dm.defines).toBe(true);
    expect((g.children[0] as LineSegments2).geometry.getAttribute("instanceTone")?.count).toBe(12);
    const box = makeBoxEdges([10, 10, 10], { color: "#15181c", alt: "#f0f2f4", width: MACHINE_BOX_PX, dashPx: MACHINE_BOX_DASH_PX, role: "bounds" });
    expect("SCREEN_DASH_TONE" in ((box.children[1] as LineSegments2).material as LineMaterial).defines).toBe(false);
  });

  it("the shader: a short segment takes its tone, a long one keeps the screen dash", () => {
    const m = new LineMaterial();
    const { vertex, fragment } = screenDashShaders(m.vertexShader, m.fragmentShader);
    expect(vertex).toContain("vTone = instanceTone;");
    expect(fragment).toContain("if ( vSegPx < 2.0 * ( dashSize + gapSize ) ) {");
    expect(fragment).toContain("if ( vTone < 0.5 ) discard;");
  });
});
