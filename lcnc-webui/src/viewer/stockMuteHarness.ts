// Test support for the stock rule (stockMute.test.ts): a head that moves X Y Z
// over a table, a block of stock, programs as points, a sweep and its findings
// as the contact view shows them. Not shipped (imported by tests only).
import { buildCollisionModel, sweepCollisions, sweepCollisionsIter, toolCylinderPositions, type CollisionBody, type CollisionMachine,
         type CollisionModel, type CollisionOptions } from "./collision";
import { ContactStore } from "./contactStore";
import { buildContactView, targetAt, targetKind, trackLineAt, T_NEAR, T_POSSIBLE, T_RAPID } from "./contactView";
import { boxPositions } from "./collisionFixtures";
import { emptyLineIndex } from "./lineIndex";
import type { ScrubTrack } from "../ws/bulkData";

export const G5X = [200, 150, -100];
export const WCS = { g5x: [...G5X, 0, 0, 0], g92: [0, 0, 0, 0, 0, 0], rotationDeg: 0, tool: [0, 0, 0] };
export const MARGIN = 2;
export const MACHINE: CollisionMachine = {
  groups: [{ id: "table", parent: "root" }, { id: "gx", parent: "root" }, { id: "gy", parent: "gx" }, { id: "gz", parent: "gy" }, { id: "tool", parent: "gz" }],
  kinematics: [{ group: "gx", joint: 0, type: "translate", direction: "x", sign: 1 }, { group: "gy", joint: 1, type: "translate", direction: "y", sign: 1 },
               { group: "gz", joint: 2, type: "translate", direction: "z", sign: 1 }],
  workGroup: "table", toolGroup: "tool", unitScale: 1, axes: ["X", "Y", "Z"],
};
export type Box = [number, number, number, number, number, number];
/** A box in program coordinates (the fixture G5X added). */
export const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number) =>
  boxPositions(x1 - x0, y1 - y0, z1 - z0, (x0 + x1) / 2 + G5X[0]!, (y0 + y1) / 2 + G5X[1]!, (z0 + z1) / 2 + G5X[2]!);
/** The block of most scenes: 120 × 80, its top at Z0, 30 deep. */
export const BLOCK: Box = [-10, 110, -10, 70, -30, 0];

export interface Pt { x: number; y: number; z: number; rapid: boolean; line: number; band?: boolean; tlo?: number; brk?: boolean; ustart?: boolean }
/** A program as the points its moves end at, one line each. */
export class Prog {
  pts: Pt[] = [];
  cur = { x: 0, y: 0, z: 0 };
  band = false; tlo = 0;
  move(rapid: boolean, p: Partial<{ x: number; y: number; z: number }>) {
    this.cur = { ...this.cur, ...p };
    this.pts.push({ ...this.cur, rapid, line: this.pts.length + 1, band: this.band, tlo: this.tlo });
    return this;
  }
  g0(p: Partial<{ x: number; y: number; z: number }>) { return this.move(true, p); }
  g1(p: Partial<{ x: number; y: number; z: number }>) { return this.move(false, p); }
  /** The track (a distance axis). */
  track(): ScrubTrack {
    const n = this.pts.length, pos = new Float32Array(n * 3), cum = new Float32Array(n);
    this.pts.forEach((p, i) => pos.set([p.x, p.y, p.z], i * 3));
    for (let i = 1; i < n; i++) {
      const a = this.pts[i - 1]!, b = this.pts[i]!;
      cum[i] = cum[i - 1]! + Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    }
    const t = { pos, abc: new Float32Array(n * 3), lines: new Uint32Array(this.pts.map(p => p.line)), rapid: new Uint8Array(this.pts.map(p => (p.rapid ? 1 : 0))),
                cum, count: n, lineIndex: emptyLineIndex(), timeBased: false } as unknown as ScrubTrack & Record<string, unknown>;
    if (this.pts.some(p => p.band)) t.band = new Uint8Array(this.pts.map(p => (p.band ? 1 : 0)));
    if (this.pts.some(p => p.brk)) t.brk = new Uint8Array(this.pts.map(p => (p.brk ? 1 : 0)));
    if (this.pts.some(p => p.ustart)) t.ustart = new Uint8Array(this.pts.map(p => (p.ustart ? 1 : 0)));
    if (this.pts.some(p => p.tlo)) t.tlo = new Uint32Array(this.pts.map(p => p.tlo ?? 0));
    return t;
  }
}
export const start = (z = 15) => new Prog().g0({ x: 50, y: 30, z });

export interface Scene { stock?: Box | Float32Array; stocks?: number; tool?: Float32Array; toolR?: number; toolL?: number; opts?: Partial<CollisionOptions> }
export function modelOf(o: Scene = {}): CollisionModel {
  const stock = o.stock instanceof Float32Array ? o.stock : box(...(o.stock ?? BLOCK));
  const bodies: CollisionBody[] = Array.from({ length: o.stocks ?? 1 }, (_, k) => ({ id: k ? `stock${k}` : "stock", group: "table", positions: stock, stock: true }));
  bodies.push({ id: "tool", group: "tool", positions: o.tool ?? toolCylinderPositions(2 * (o.toolR ?? 3), o.toolL ?? 60), tool: true });
  return buildCollisionModel(MACHINE, bodies);
}
/** The findings the contact view shows: "collision rapid L5", "near feed L3", "possible …". */
export function findings(t: ScrubTrack, o: Scene = {}) {
  const model = modelOf(o), st = new ContactStore(1, 0);
  const r = sweepCollisions(model, t, WCS as never, { margin: MARGIN, contacts: { store: st }, ...(o.opts ?? {}) } as CollisionOptions);
  const end = t.cum[t.count - 1]!;
  const pairName = (pi: number) => ({ a: model.bodies[model.pairs[pi]![0]]!.id, b: model.bodies[model.pairs[pi]![1]]!.id });
  const view = buildContactView({ sources: [{ stores: [st], ownCoverage: end, at: (c: number) => c }], pairName, coverage: end } as never);
  const lineAt = trackLineAt(t), list: string[] = [];
  for (let i = 0; i < view.n; i++) {
    const k = targetKind(view, i), tg = targetAt(view, i, lineAt) as unknown as { line: number };
    list.push(`${k & T_POSSIBLE ? "possible" : k & T_NEAR ? "near" : "collision"} ${k & T_RAPID ? "rapid" : "feed"} L${tg.line}`);
  }
  const count = (cls: string) => list.filter(s => s.startsWith(cls)).length;
  return { list, collisions: count("collision"), near: count("near"), r, st, model };
}
export { sweepCollisionsIter };
