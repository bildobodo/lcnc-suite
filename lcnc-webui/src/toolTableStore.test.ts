// The one tool table reader (P6-c plan v8 §1.1, §1.5, §1.8, Codex R477
// MT477-03/-04, R480, R482): two outputs that never read each other, a `same`
// reply resolved before anyone sees it, nothing decoded kept. Through the
// store's own read(), with a gateway in small and a hand-driven scheduler.
import { readFileSync, readdirSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FORM_PAYLOAD_FIELDS, type FormRecord } from "./toolForm";
import { LIBRARY_BYTES_MAX, LIBRARY_FULL } from "./toolLibrary";
import { NOT_CONNECTED, READ_SLOW_MS, ToolTableStore, type CurrentRead } from "./toolTableStore";
import { runSteps, type StepRun, type Steps } from "./viewer/steps";

const MESH = { vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 5]], triangles: [[0, 1, 2], [0, 1, 3], [0, 2, 3], [1, 2, 3]] };
type Lib = Record<number, any>;
const LIB: Lib = { 1: { type: "formmill", native_mesh: MESH, oal: 5 }, 2: { type: "ball", native_profile: [[0, 0], [3, 0], [3, 40], [0, 40]], description: "two" },
                   3: { type: "endmill", shaft_segments: [{ height: 5, lower_diameter: 6, upper_diameter: 6 }], holder_segments: [{ height: 5, lower_diameter: 20, upper_diameter: 20 }] },
                   4: { native_profile: Array.from({ length: 4096 }, (_, i) => [1, i]) }, 5: { type: "" } };

/** A gateway in small: its table, its library, and the reply get_tool_table gives. */
class Gateway {
  table = { path: "/t.tbl", instance: "11:1" };
  lib: Lib = LIB;
  rev = "L1";
  rows: any[] = [1, 2, 3, 4, 5].map(T => ({ T, P: T, D: 6, Z: 50 + T, remark: `tool ${T}` }));
  proven: number[] | null = null;             // null: complete
  asked: Array<string | null> = [];
  old = false;                                 // a gateway without `library`
  /** what the next reads answer instead (a function of `have`) */
  script: Array<(have: string | null) => any> = [];
  reply(have: string | null): any {
    const same = have === this.rev && !this.old;
    const tools = this.rows.map(r => {
      const m = this.lib[r.T] ?? {}, row: any = { ...r, description: m.description ?? r.remark, type: m.type ?? "", oal: m.oal ?? null };
      for (const k of FORM_PAYLOAD_FIELDS) if (!same) row[k] = structuredClone(m[k] ?? null);
      return row;
    });
    const proof = { state: this.proven ? "partial" : "complete", proven: this.proven ?? tools.map(t => t.T), differs: [], missing: [], extra: [], duplicates: [], why: null };
    return { ok: true, tools, table: { ...this.table }, proof, unread: [], edit_refusal: null, rev: { table: "t", library: this.rev },
             ...(this.old ? {} : { library: { state: same ? "same" : "full", rev: this.rev } }) };
  }
  ask = (have: string | null): Promise<any> => {
    this.asked.push(have);
    const s = this.script.shift();
    return Promise.resolve(s ? s(have) : this.reply(have));
  };
}
/** Runs jobs only when told. */
class Jobs {
  jobs: Array<{ job: Steps<void>; cancelled: boolean; done: boolean }> = [];
  run = (job: Steps<void>): StepRun<void> => {
    const j = { job, cancelled: false, done: false };
    this.jobs.push(j);
    return { promise: new Promise(() => {}), cancel() { j.cancelled = true; job.return(); }, get running() { return !j.cancelled && !j.done; } };
  };
  step(n = 1): void {
    for (const j of this.jobs) for (let i = 0; i < n && !j.cancelled && !j.done; i++) j.done = !!j.job.next().done;
  }
  all(): void { this.step(1e6); }
}
interface World { gw: Gateway; jobs: Jobs; store: ToolTableStore; seen: CurrentRead[]; units: { v: number | null }; traces: string[]; forms: () => number }
function world(open = true): World {
  const gw = new Gateway(), jobs = new Jobs(), seen: CurrentRead[] = [], units = { v: 1 as number | null }, traces: string[] = [];
  let n = 0;
  const store = new ToolTableStore({ ask: gw.ask, units: () => units.v, inlineMs: 0, run: jobs.run, onCurrent: c => seen.push(c), onForms: () => { n++; }, trace: e => traces.push(e) });
  if (open) store.opened();
  return { gw, jobs, store, seen, units, traces, forms: () => n };
}
const T = (w: World) => w.store.current.view?.rows.map(r => r.T);
const kinds = (w: World) => [1, 2, 3, 4, 5].map(t => { const f = w.store.formOf(t); return f === "pending" || f === null ? f : f.kind; });

describe("two outputs", () => {
  it("a good read shows its rows and is the evidence; a failed one after it shows none and leaves the evidence", async () => {
    const w = world();
    await w.store.read();
    w.jobs.all();
    expect([T(w), w.store.current.table, w.store.record.binding]).toEqual([[1, 2, 3, 4, 5], w.gw.table, { ...w.gw.table, units: 1, rev: "L1" }]);
    const evidence = [w.store.record.keys, w.store.record.decide({ T: 1, D: 6, Z: 51 })!.body];
    for (const bad of [{ ok: false, error: "Tool library not JSON" }, null]) {
      w.gw.script.push(() => bad);
      await w.store.read();
      expect([w.store.current.view!.kind, T(w), w.store.current.table, w.store.current.reading]).toEqual(["failed", [], null, false]);
      expect(w.store.current.error).toBe(bad ? "Tool library not JSON" : "No reply from the gateway — retry");
      expect([w.store.record.keys, w.store.record.decide({ T: 1, D: 6, Z: 51 })!.body]).toEqual(evidence);
    }
  });
  it("a superseded read changes neither; an old connection's reply neither", async () => {
    const w = world();
    let late!: (r: any) => void;
    w.gw.ask = (() => new Promise(f => { late = f; })) as any;
    (w.store as any).deps.ask = () => new Promise(f => { late = f; });
    const first = w.store.read(), answerFirst = late;
    (w.store as any).deps.ask = (h: string | null) => Promise.resolve(w.gw.reply(h));
    w.gw.rows = w.gw.rows.slice(0, 1);
    await w.store.read();
    w.gw.rows = [];
    answerFirst({ ...w.gw.reply(null), tools: [] });
    await first;
    expect([T(w), w.store.record.keys]).toEqual([[1], [1]]);
    (w.store as any).deps.ask = () => new Promise(f => { late = f; });
    const second = w.store.read();
    w.store.closed();
    w.store.opened();
    late(w.gw.reply(null));
    await second;
    expect([w.store.current.view, w.store.record.binding]).toEqual([null, null]);
  });
  it("a closed connection clears the read and the evidence, and keeps the forms of a settled library", async () => {
    const w = world();
    await w.store.read();
    w.jobs.all();
    w.store.closed();
    expect(w.store.current).toMatchObject({ open: false, reading: false, view: null, table: null, error: NOT_CONNECTED });
    expect([w.store.record.binding, w.store.record.keys, kinds(w)]).toEqual([null, [], ["mesh", "profile", "param", "refused", "none"]]);
    await w.store.read();                                  // a Retry while closed
    expect([w.gw.asked.length, w.store.current.error]).toEqual([1, NOT_CONNECTED]);
  });
  it("the Tools tab, the strip and the dialogs never import the evidence", () => {
    const dir = new URL("./", import.meta.url), names = readdirSync(dir).filter(f => /\.(vue|ts)$/.test(f) && !/\.test\.ts$/.test(f));
    const users = names.filter(f => /from "\.\/toolShapeRecord"/.test(readFileSync(new URL(f, dir), "utf8")));
    expect(users).toEqual(["toolTableStore.ts"]);
    expect(readFileSync(new URL("toolTable.ts", dir), "utf8")).not.toMatch(/\.record\b/);
    for (const f of ["ToolTablePanel.vue", "ToolStrip.vue"]) expect(readFileSync(new URL(f, dir), "utf8")).not.toMatch(/from "\.\/toolTableStore"|cmd: "get_tool_table"/);
  });
  it("a `partial` or `unchecked` read shows its rows with its note, and proves what rule R proved", async () => {
    const w = world();
    w.gw.proven = [2];
    await w.store.read();
    w.jobs.all();
    expect([w.store.current.view!.kind, w.store.record.keys]).toEqual(["partial", [2]]);
  });
});

describe("the time of a read (as the Tools tab had it)", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });
  it("a slow reply is said after 8 s and still taken", async () => {
    const w = world();
    let answer!: (r: any) => void;
    (w.store as any).deps.ask = () => new Promise(f => { answer = f; });
    const p = w.store.read();
    await vi.advanceTimersByTimeAsync(READ_SLOW_MS - 1);
    expect([w.store.current.reading, w.store.current.error]).toEqual([true, null]);
    await vi.advanceTimersByTimeAsync(2);
    expect([w.store.current.reading, w.store.current.error]).toEqual([true, "No reply from the gateway yet — retry"]);
    answer(w.gw.reply(null));
    await p;
    expect([w.store.current.reading, w.store.current.error, T(w)]).toEqual([false, null, [1, 2, 3, 4, 5]]);
  });
  it("opened says it reads before the read begins", () => {
    const w = world(false);
    expect(w.store.current).toMatchObject({ open: false, error: NOT_CONNECTED });
    w.store.opened();
    expect(w.store.current).toMatchObject({ open: true, reading: true, error: null, view: null });
  });
});

describe("nothing decoded is kept", () => {
  /** What is reachable from the store and is a decoded list of a reply. */
  function decoded(w: World): string[] {
    const seen = new Set<unknown>(), out: string[] = [];
    const walk = (x: unknown, path: string) => {
      if (typeof x !== "object" || x === null || seen.has(x) || ArrayBuffer.isView(x)) return;
      seen.add(x);
      if (FORM_PAYLOAD_FIELDS.some(k => (x as any)[k] && !ArrayBuffer.isView((x as any)[k]) && !("pos" in Object((x as any)[k])))) out.push(path);
      if (Array.isArray(x) && x.length > 3 && Array.isArray(x[0])) out.push(path);
      const each = x instanceof Map || x instanceof Set ? [...x.entries()] : Object.entries(x);
      for (const [k, v] of each) if (k !== "deps") walk(v, `${path}.${String(k)}`);
    };
    walk(w.store, "store");
    return out;
  }
  it("once normalised: no list in the rows, the forms, the evidence or the job — refused shapes included", async () => {
    const w = world();
    await w.store.read();
    expect(w.store.current.view!.rows.every(r => FORM_PAYLOAD_FIELDS.every(k => !(k in r)))).toBe(true);
    expect(kinds(w)).toEqual(["pending", "pending", "pending", "pending", "pending"]);
    expect(decoded(w).length).toBeGreaterThan(0);                  // its normaliser's, until done
    w.jobs.all();
    expect(kinds(w)).toEqual(["mesh", "profile", "param", "refused", "none"]);
    expect(decoded(w)).toEqual([]);
    expect((w.store.formOf(4) as FormRecord).refused).toEqual({ why: "shape too detailed", field: "native_profile", size: 4096 });
    expect(w.store.current.view!.rows[3]).toMatchObject({ T: 4, P: 4, D: 6, Z: 54, remark: "tool 4" });   // its fields stay
  });
  it("eight reads of one library: the same records, one full reply", async () => {
    const w = world();
    await w.store.read();
    w.jobs.all();
    const first = [1, 2, 3, 4, 5].map(t => w.store.formOf(t));
    for (let i = 0; i < 8; i++) {
      w.gw.rows[0] = { ...w.gw.rows[0], Z: 60 + i };
      await w.store.read();
      expect([1, 2, 3, 4, 5].map(t => w.store.formOf(t))).toEqual(first);
      for (const [k, t] of [1, 2, 3, 4, 5].entries()) expect(w.store.formOf(t)).toBe(first[k]);
    }
    expect(w.gw.asked).toEqual([null, ...Array(8).fill("L1")]);
    expect([w.jobs.jobs.length, w.store.record.rowsOf(1).length, decoded(w)]).toEqual([1, 8, []]);
  });
  it("several libraries while one is being normalised: the older ones are dropped, one is reachable", async () => {
    const w = world();
    for (let i = 1; i <= 4; i++) {
      w.gw.rev = `L${i}`;
      w.gw.lib = { ...LIB, 2: { type: `ball${i}` } };
      await w.store.read();
      w.jobs.step(1);
    }
    expect(w.jobs.jobs.map(j => j.cancelled)).toEqual([true, true, true, false]);
    expect(w.store.libraryState).toMatchObject({ binding: { rev: "L4" }, settled: false });
    w.jobs.all();
    expect([w.store.libraryState!.settled, (w.store.formOf(2) as FormRecord).scalars.type, decoded(w)]).toEqual([true, "ball4", []]);
  });
  it("a close ends the normaliser and drops what it had not made", async () => {
    const w = world();
    await w.store.read();
    w.jobs.step(1);
    w.store.closed();
    expect([w.jobs.jobs[0]!.cancelled, w.store.libraryState, decoded(w)]).toEqual([true, null, []]);
  });
  it("an ordinary library is made with its rows: no consumer sees a pending form, no second draw for it", async () => {
    const w = world();
    (w.store as any).deps.inlineMs = 1000;
    let at: unknown = null;
    (w.store as any).deps.onCurrent = (c: CurrentRead) => { if (c.applied === 1 && at === null) at = kinds(w); };
    await w.store.read();
    expect([at, w.jobs.jobs.length, w.store.libraryState!.settled]).toEqual([["mesh", "profile", "param", "refused", "none"], 0, true]);
  });
  it("the same revision sent in full again keeps its records (an older gateway names it and sends everything)", async () => {
    const w = world();
    w.gw.old = true;
    await w.store.read();
    w.jobs.all();
    const first = w.store.formOf(1);
    await w.store.read();
    expect([w.gw.asked, w.store.formOf(1) === first, w.jobs.jobs.length, decoded(w)]).toEqual([[null, "L1"], true, 1, []]);
    w.gw.rows = [...w.gw.rows, { T: 8, P: 8, D: 1, Z: 1, remark: "" }];      // a tool it has no record of
    await w.store.read();
    w.jobs.all();
    expect([(w.store.formOf(8) as FormRecord).kind, w.jobs.jobs.length]).toEqual(["none", 2]);
  });
  it("a fault of the page in the job is traced and drops the library (no endless 'Loading shape')", async () => {
    const w = world(), errors: unknown[] = [];
    (w.store as any).deps.run = (job: Steps<void>, onError: (e: unknown) => void) =>
      runSteps((function* () { yield; throw new Error("boom"); job.next(); })(), { schedule: f => queueMicrotask(f), onError: e => { errors.push(e); onError(e); } });
    process.once("unhandledRejection", () => {});
    await w.store.read();
    await new Promise(f => setTimeout(f, 5));
    expect([errors.length, w.store.libraryState, w.traces.includes("tools.forms_failed"), w.store.formOf(1)]).toEqual([1, null, true, null]);
  });
});

describe("a library past the bases of its rows", () => {
  it("settles: no fault, the shared refusal shown (Codex R494)", async () => {
    const w = world();
    w.gw.rows = Array.from({ length: 65_537 }, (_, i) => ({ T: i + 1, P: i + 1, D: 6, Z: 40, remark: "" }));
    w.gw.lib = {};
    await w.store.read();
    w.jobs.all();
    expect([w.traces.includes("tools.forms_failed"), w.store.libraryState?.settled, w.store.libraryState?.bytes]).toEqual([false, true, LIBRARY_BYTES_MAX]);
    expect([w.store.formOf(1) !== LIBRARY_FULL, w.store.formOf(65_537)]).toEqual([true, LIBRARY_FULL]);
  });
});

describe("have_library", () => {
  const settled = async () => { const w = world(); await w.store.read(); w.jobs.all(); return w; };
  it("is named once the library is settled, in the units it was made in", async () => {
    const w = world();
    await w.store.read();
    await w.store.read();                                         // not settled yet: asked in full
    w.jobs.all();
    await w.store.read();
    expect(w.gw.asked).toEqual([null, null, "L1"]);
    w.units.v = 1 / 25.4;
    await w.store.read();
    expect(w.gw.asked[3]).toBeNull();
  });
  it("same gives exactly what full gives: rows and records, the refused and the none included", async () => {
    const a = await settled(), b = await settled();
    const changed = { ...a.gw.rows[2], remark: "resharpened", Z: 47 };
    for (const w of [a, b]) w.gw.rows = [w.gw.rows[0], w.gw.rows[1], changed, w.gw.rows[3], w.gw.rows[4]];
    await a.store.read();                                         // same
    b.store.unitsChanged();
    await b.store.read();                                         // full
    b.jobs.all();
    expect([a.gw.asked[1], b.gw.asked[1]]).toEqual(["L1", null]);
    expect(a.store.current.view!.rows).toEqual(b.store.current.view!.rows);
    expect([1, 2, 3, 4, 5].map(t => a.store.formOf(t))).toEqual([1, 2, 3, 4, 5].map(t => b.store.formOf(t)));
    expect(a.store.current.view!.rows[2]).toMatchObject({ description: "resharpened", Z: 47 });      // the reply's own, no cache's
  });
  const unresolved = async (w: World, answer: (have: string | null) => any) => {
    const before = w.gw.asked.length, shown = w.seen.length;
    w.gw.script.push(answer);
    await w.store.read();
    return { asked: w.gw.asked.slice(before), delivered: w.seen.slice(shown).filter(c => c.view && !c.reading) };
  };
  for (const [name, change] of [
    ["another table", (r: any) => ({ ...r, table: { ...r.table, path: "/u.tbl" } })],
    ["another LinuxCNC", (r: any) => ({ ...r, table: { ...r.table, instance: "12:9" } })],
    ["no table named", (r: any) => ({ ...r, table: undefined })],
    ["another revision", (r: any) => ({ ...r, library: { state: "same", rev: "L9" } })],
    ["two revisions in one reply", (r: any) => ({ ...r, rev: { ...r.rev, library: "L9" } })],
    ["a tool the full reply had not", (r: any) => ({ ...r, tools: [...r.tools, { T: 77, P: 77, D: 1, Z: 1, remark: "" }] })],
  ] as const) it(`a same of ${name}: nothing of it is delivered, ONE full read in its place`, async () => {
    const w = await settled();
    const got = await unresolved(w, have => change(w.gw.reply(have)));
    expect(got.asked).toEqual(["L1", null]);
    expect(got.delivered.length).toBe(1);
    expect([got.delivered[0]!.view!.rows.map(r => r.T), got.delivered[0]!.table, w.traces.filter(t => t === "tools.same_unresolved").length])
      .toEqual([[1, 2, 3, 4, 5], w.gw.table, 1]);
    w.jobs.all();
    expect(kinds(w)).toEqual(["mesh", "profile", "param", "refused", "none"]);
  });
  it("another unit while the read is out: the same is not used", async () => {
    const w = await settled();
    const got = await unresolved(w, have => { w.units.v = 1 / 25.4; return w.gw.reply(have); });
    expect([got.asked, w.store.record.binding!.units]).toEqual([["L1", null], 1 / 25.4]);
  });
  it("a library that went while the read was out (a reconnect in between is another read)", async () => {
    const w = await settled();
    const got = await unresolved(w, have => { w.store.unitsChanged(); return w.gw.reply(have); });
    expect(got.asked).toEqual(["L1", null]);
  });
  it("a same nobody asked for is a failed read — never a loop, never an empty library", async () => {
    const w = world();
    w.gw.script.push(() => w.gw.reply("L1"), () => w.gw.reply("L1"), () => w.gw.reply("L1"));
    await w.store.read();
    expect([w.gw.asked, w.store.current.view!.kind, w.store.current.error, w.store.record.binding]).toEqual([[null], "failed", "Tool table without its shapes — retry", null]);
    const v = await settled();
    v.gw.script.push(have => ({ ...v.gw.reply(have), table: null }), () => v.gw.reply("L1"));
    await v.store.read();
    expect([v.gw.asked.slice(1), v.store.current.view!.kind]).toEqual([["L1", null], "failed"]);
  });
  it("the library changes between the request and the read: full, and the new forms", async () => {
    const w = await settled();
    w.gw.script.push(have => { w.gw.rev = "L2"; w.gw.lib = { ...LIB, 2: { type: "flat" } }; return w.gw.reply(have); });
    await w.store.read();
    w.jobs.all();
    expect([w.gw.asked, (w.store.formOf(2) as FormRecord).kind, w.store.record.binding!.rev]).toEqual([[null, "L1"], "param", "L2"]);
  });
  it("a reconnect keeps the library and asks with it; the evidence is proven anew", async () => {
    const w = await settled();
    w.store.closed();
    w.store.opened();
    expect(w.store.record.keys).toEqual([]);
    await w.store.read();
    expect([w.gw.asked[1], kinds(w), w.store.record.decide({ T: 1, D: 6, Z: 51 })!.body]).toEqual(["L1", ["mesh", "profile", "param", "refused", "none"], "envelope"]);
  });
  it("an older gateway (no `library`): a full reply each time, its forms drawn", async () => {
    const w = world();
    w.gw.old = true;
    await w.store.read();
    w.jobs.all();
    await w.store.read();
    w.jobs.all();
    expect([w.gw.asked[0], kinds(w)]).toEqual([null, ["mesh", "profile", "param", "refused", "none"]]);
  });
  it("units not known yet: the rows and forms show, nothing is evidence, nothing is asked by revision", async () => {
    const w = world();
    w.units.v = null;
    await w.store.read();
    w.jobs.all();
    await w.store.read();
    expect([w.gw.asked, T(w), w.store.record.binding]).toEqual([[null, null], [1, 2, 3, 4, 5], null]);
  });
});
