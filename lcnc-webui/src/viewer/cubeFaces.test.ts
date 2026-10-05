import { describe, it, expect } from "vitest";
import { CUBE_FACES, CUBE_SIZE, FACE_SIZE, FACE_BORDER_HALF, faceArrows, arrowOpacity, type Vec3 } from "./cubeFaces";

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a: Vec3) => Math.hypot(...a);
const cos = (deg: number) => Math.cos((deg * Math.PI) / 180);

describe("the ViewCube's faces, named by axis", () => {
  it("each face is named by the axis its normal points along, with its sign", () => {
    expect(CUBE_FACES.map(f => [f.label, f.normal.join(",")])).toEqual([
      ["X+", "1,0,0"], ["X−", "-1,0,0"], ["Y+", "0,1,0"], ["Y−", "0,-1,0"], ["Z+", "0,0,1"], ["Z−", "0,0,-1"],
    ]);
    for (const f of CUBE_FACES) expect(dot(f.visualUp, f.normal), f.label).toBe(0);
  });

  it("a face's two arrows are its in-plane axes, each pointing the axis' positive way", () => {
    for (const f of CUBE_FACES) {
      const arrows = faceArrows(f);
      expect(arrows.map(a => a.axis).sort(), f.label).toEqual(["X", "Y", "Z"].filter(l => l !== f.axis));
      for (const a of arrows) {
        const d = sub(a.tip, a.start);
        expect(dot(d, a.dir), `${f.label} ${a.axis}`).toBeGreaterThan(0);
        expect(dot(a.dir, f.normal)).toBe(0);
        expect(Math.max(...a.dir), `${f.label} ${a.axis} world +axis`).toBe(1);
      }
    }
  });

  it("they lie on the DISPLAYED square's border, the full side long, both from one corner", () => {
    expect(FACE_BORDER_HALF).toBeLessThan(FACE_SIZE / 2);
    expect(FACE_BORDER_HALF).toBeLessThan(CUBE_SIZE / 2);
    for (const f of CUBE_FACES) {
      const [a, b] = faceArrows(f);
      expect(a!.start, f.label).toEqual(b!.start);
      // in the face plane, at minus the border half on both in-plane axes
      expect(dot(a!.start, f.normal)).toBeCloseTo(CUBE_SIZE / 2, 12);
      for (const ar of [a!, b!]) {
        expect(dot(ar.start, ar.dir), `${f.label} ${ar.axis} starts at the border`).toBeCloseTo(-FACE_BORDER_HALF, 12);
        expect(len(sub(ar.tip, ar.start)), `${f.label} ${ar.axis} the whole side`).toBeCloseTo(2 * FACE_BORDER_HALF, 12);
        expect(dot(ar.label, ar.dir), `${f.label} ${ar.axis} letter outside`).toBeGreaterThan(FACE_SIZE / 2);
      }
    }
  });

  it("on screen the horizontal arrow runs right from X+, Y− and Z+, left from X− and Y+ — its corner moves with it", () => {
    // a straight view: the camera on the face normal, up = the face's
    // visualUp, so the screen's right is up × normal
    const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const horizontal = CUBE_FACES.map(f => {
      const right = cross(f.visualUp, f.normal);
      const a = faceArrows(f).find(ar => Math.abs(dot(ar.dir, right)) > 0.5)!;
      return `${f.label} ${a.axis} ${dot(sub(a.tip, a.start), right) > 0 ? "right" : "left"}`;
    });
    expect(horizontal).toEqual(["X+ Y right", "X\u2212 Y left", "Y+ X left", "Y\u2212 X right", "Z+ X right", "Z\u2212 X right"]);
  });

  it("only a straight view shows the arrows: none beyond 16°, whole within 6°, monotonic", () => {
    expect(arrowOpacity(cos(45))).toBe(0);
    expect(arrowOpacity(cos(16.5))).toBe(0);
    expect(arrowOpacity(cos(5.5))).toBe(1);
    expect(arrowOpacity(1)).toBe(1);
    let prev = 0;
    for (let d = 20; d >= 0; d -= 0.5) {
      const o = arrowOpacity(cos(d));
      expect(o).toBeGreaterThanOrEqual(prev);
      prev = o;
    }
    expect(arrowOpacity(cos(11))).toBeGreaterThan(0);
    expect(arrowOpacity(cos(11))).toBeLessThan(1);
  });
});
