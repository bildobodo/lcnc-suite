import { buildCollisionModel, sweepCollisions, toolCylinderPositions, type CollisionBody, type CollisionMachine,
         type CollisionModel } from "@coll";
import { ContactStore } from "@src/contactStore";
import { buildContactView, targetAt, targetKind, trackLineAt, viewCounts, T_NEAR, T_RAPID, T_POSSIBLE } from "@src/contactView";
import { boxPositions } from "@src/collisionFixtures";
import { emptyLineIndex } from "@src/lineIndex";
export { buildCollisionModel, sweepCollisions, toolCylinderPositions, boxPositions, ContactStore };
export type { CollisionBody, CollisionMachine, CollisionModel };
export const G5X = [200, 150, -100];
export const WCS = { g5x: [...G5X, 0, 0, 0], g92: [0, 0, 0, 0, 0, 0], rotationDeg: 0, tool: [0, 0, 0] };
export const MARGIN = 2;
export const MACHINE: CollisionMachine = {
  groups: [
    { id: "table", parent: "root" },
    { id: "gx", parent: "root" }, { id: "gy", parent: "gx" }, { id: "gz", parent: "gy" }, { id: "tool", parent: "gz" },
  ],
  kinematics: [
    { group: "gx", joint: 0, type: "translate", direction: "x", sign: 1 },
    { group: "gy", joint: 1, type: "translate", direction: "y", sign: 1 },
    { group: "gz", joint: 2, type: "translate", direction: "z", sign: 1 },
  ],
  workGroup: "table", toolGroup: "tool", unitScale: 1, axes: ["X", "Y", "Z"],
};
export type Box = [number, number, number, number, number, number];
export const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number) =>
  boxPositions(x1 - x0, y1 - y0, z1 - z0, (x0 + x1) / 2 + G5X[0]!, (y0 + y1) / 2 + G5X[1]!, (z0 + z1) / 2 + G5X[2]!);
export interface Pt { x: number; y: number; z: number; rapid: boolean; line: number; band?: boolean; tlo?: number; brk?: boolean; ustart?: boolean }
export class Prog {
  lines: string[] = [];
  pts: Pt[] = [];
  cur = { x: 0, y: 0, z: 0 };
  band = false; tlo = 0;
  say(s: string) { this.lines.push(s); }
  move(rapid: boolean, p: Partial<{ x: number; y: number; z: number }>) {
    const n = { ...this.cur, ...p };
    const w = (k: "x" | "y" | "z") => (p[k] != null ? ` ${k.toUpperCase()}${+n[k].toFixed(4)}` : "");
    this.lines.push(`${rapid ? "G0" : "G1"}${w("x")}${w("y")}${w("z")}`);
    this.cur = n;
    this.pts.push({ ...n, rapid, line: this.lines.length, band: this.band, tlo: this.tlo });
    return this;
  }
  g0(p: Partial<{ x: number; y: number; z: number }>) { return this.move(true, p); }
  g1(p: Partial<{ x: number; y: number; z: number }>) { return this.move(false, p); }
  track() {
    const n = this.pts.length;
    const pos = new Float32Array(n * 3), cum = new Float32Array(n);
    this.pts.forEach((p, i) => { pos.set([p.x, p.y, p.z], i * 3); });
    for (let i = 1; i < n; i++) {
      const a = this.pts[i - 1]!, b = this.pts[i]!;
      cum[i] = cum[i - 1]! + Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    }
    const t: any = { pos, abc: new Float32Array(n * 3), lines: new Uint32Array(this.pts.map(p => p.line)),
             rapid: new Uint8Array(this.pts.map(p => (p.rapid ? 1 : 0))), cum, count: n,
             lineIndex: emptyLineIndex(), timeBased: false };
    if (this.pts.some(p => p.band)) t.band = new Uint8Array(this.pts.map(p => p.band ? 1 : 0));
    if (this.pts.some(p => p.brk)) t.brk = new Uint8Array(this.pts.map(p => p.brk ? 1 : 0));
    if (this.pts.some(p => p.tlo)) t.tlo = new Uint32Array(this.pts.map(p => p.tlo ?? 0));
    return t;
  }
}
export interface RunOpts { stock: Box | Float32Array; tool?: Float32Array; toolR?: number; toolL?: number; plate?: boolean; extra?: any; open?: boolean }
export function sweep(track: any, o: RunOpts) {
  const L = o.toolL ?? 60, tool = o.tool ?? toolCylinderPositions(2 * (o.toolR ?? 3), L);
  const bodies: CollisionBody[] = [
    { id: "stock", group: "table", positions: o.stock instanceof Float32Array ? o.stock : box(...o.stock), stock: true },
    { id: "tool", group: "tool", positions: tool, tool: true },
  ];
  const model = buildCollisionModel(MACHINE, bodies);
  const st = new ContactStore(1, 0);
  const t0 = performance.now();
  const r = sweepCollisions(model, track, WCS as any, { margin: MARGIN, contacts: { store: st }, ...(o.extra ?? {}) } as any);
  const ms = performance.now() - t0;
  const end = track.cum[track.count - 1]!;
  const pairName = (pi: number) => ({ a: model.bodies[model.pairs[pi]![0]]!.id, b: model.bodies[model.pairs[pi]![1]]!.id });
  const view = buildContactView({ sources: [{ stores: [st], ownCoverage: end, at: (c: number) => c }], pairName, coverage: end } as any);
  const lineAt = trackLineAt(track);
  const by: Record<string, number> = {};
  const list: string[] = [];
  for (let i = 0; i < view.n; i++) {
    const t = targetAt(view, i, lineAt), k = targetKind(view, i);
    const cls = k & T_POSSIBLE ? "possible" : k & T_NEAR ? "near" : "collision";
    const key = `${cls} ${k & T_RAPID ? "rapid" : "feed"}`;
    by[key] = (by[key] ?? 0) + 1;
    if (list.length < 40) list.push(`${key} L${(t as any).line}`);
  }
  const ivs: any[] = [], eps: any[] = [];
  for (let i = 0; i < st.episodes.rows; i++) eps.push({ on: st.episodes.get(i, "onset"), end: st.episodes.get(i, "end"), f: st.episodes.get(i, "flags"), d: st.episodes.get(i, "closeDist"), iv: st.episodes.get(i, "ivCount") });
  for (let i = 0; i < st.intervals.rows; i++) ivs.push({ a: st.intervals.get(i, "enter"), b: st.intervals.get(i, "exit"), f: st.intervals.get(i, "flags"), w: st.intervals.get(i, "witness") });
  return { counts: viewCounts(view), by, list, eps, ivs, gaps: st.gaps.rows, ms, samples: r.samples, notes: r.notes ?? [], r, st };
}
