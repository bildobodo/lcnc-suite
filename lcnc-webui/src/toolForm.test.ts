// A tool library entry's form, normalised once (P6-c plan v8 §1.5, Codex R477
// MT477-04, R480): every field's bound, the refusal as content, the drawing it
// gives — and that nothing decoded is kept (toolLibrary.ts).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildToolParts, buildToolProfile, toolDrawing, type ToolMeta } from "./toolGeometry";
import { drawCounter, DRAW_BUDGET, MESH_TRIANGLES_MAX, MESH_VERTICES_MAX } from "./toolDrawing";
import {
  FORM_PAYLOAD_FIELDS, FORM_SEGMENTS_MAX, GEOMETRY_NOTE_MAX, HOLDER_NOT_USABLE, HOLDER_SEGMENTS_MAX, HOLDER_TOO_DETAILED, NOT_USABLE,
  PROFILE_POINTS_MAX, RECORD_BYTES, ROW_FIELDS_DROPPED, SHAFT_SEGMENTS_MAX, SHAPE_WORD_MAX, TOO_DETAILED, formMeta, formNotice, formSteps,
  holderNotice, predictedProfilePoints, rawForm, rowFields, type FormRecord,
} from "./toolForm";
import { FormLibrary, LIBRARY_BYTES_MAX, type ToolBinding } from "./toolLibrary";
import { toolPreviewNotice } from "./toolPreviewNotice";
import { runToEnd } from "./viewer/steps";

const ROOT = new URL("../../", import.meta.url);
const SEED: Record<string, any> = JSON.parse(readFileSync(new URL("examples/sim_config/xyz3/tool.seed.json", ROOT), "utf8"));
const form = (row: any, u = 1, room = LIBRARY_BYTES_MAX): FormRecord => runToEnd(formSteps(rowFields(row), rawForm(row), u, room));
const box = (nv = 4): any => ({ vertices: Array.from({ length: nv }, (_, i) => [i % 2, i % 3, i]), triangles: [[0, 1, 2], [0, 1, 3], [0, 2, 3], [1, 2, 3]] });
const B: ToolBinding = { path: "/t", instance: "1:1", units: 1, rev: "r" };

describe("the fields, by name", () => {
  it("are the gateway's form payload", () => {
    const py = readFileSync(new URL("lcnc-gateway/tool_table.py", ROOT), "utf8");
    const m = /FORM_PAYLOAD_FIELDS = \(([^)]*)\)/.exec(py)!;
    expect([...m[1]!.matchAll(/"(\w+)"/g)].map(x => x[1])).toEqual([...FORM_PAYLOAD_FIELDS]);
  });
  it("a row keeps every other field of the reply, in a new object; the note is cut", () => {
    const raw = { T: 3, P: 3, Z: 1, D: 6, remark: "r", description: "d", type: "ball", native_mesh: box(), source_metadata: { a: 1 },
                  source_id: "x", fusion_guid: "y", geometry_note: "n".repeat(GEOMETRY_NOTE_MAX + 5), material: "HSS" };
    const row = rowFields(raw);
    expect(row).not.toBe(raw);
    expect(Object.keys(row).sort()).toEqual(["D", "P", "T", "Z", "description", "geometry_note", "material", "remark", "type"]);
    expect((row.geometry_note as string).length).toBe(GEOMETRY_NOTE_MAX + 1);
    expect(raw.native_mesh).toBeDefined();
    expect(ROW_FIELDS_DROPPED.length).toBe(2);
  });
  it("nothing on the page reads what is dropped", () => {
    const uses = ["ToolTablePanel.vue", "ToolPreview.vue", "ToolStrip.vue", "toolGeometry.ts", "toolPreviewNotice.ts", "toolHolder.ts", "ThreeViewer.vue"]
      .filter(f => new RegExp([...ROW_FIELDS_DROPPED, "source_metadata"].join("|")).test(readFileSync(new URL(`lcnc-webui/src/${f}`, ROOT), "utf8")));
    expect(uses).toEqual([]);
  });
});

describe("what a row becomes", () => {
  it("every shipped tool: its branch, and the drawing of the record is the drawing of the row", () => {
    for (const [T, m] of Object.entries(SEED)) {
      const f = form(m), want = m.native_mesh ? "mesh" : m.native_profile?.length ? "profile" : m.type === "formmill" && m.profile?.length >= 2 ? "segments" : "param";
      expect([T, f.kind]).toEqual([T, want]);
      expect(toolDrawing(6, 80, formMeta(rowFields(m), f) as ToolMeta)).toEqual(toolDrawing(6, 80, m));
      expect(toolPreviewNotice(formMeta(rowFields(m), f) as ToolMeta)).toBe(toolPreviewNotice(m));
      expect(formNotice(f)).toBeNull();
    }
  });
  it("only the branch that is drawn is kept", () => {
    const f = form({ type: "formmill", native_mesh: box(), native_profile: [[0, 0], [1, 5]], profile: [{ end: [0, 0] }, { end: [1, 1] }],
                     shaft_segments: [{ height: 1, lower_diameter: 1, upper_diameter: 1 }] });
    expect([f.kind, f.profile, f.segments, f.shaft]).toEqual(["mesh", null, null, null]);
    const g = form({ type: "formmill", native_profile: [[0, 0], [1, 5]], profile: [{ end: [0, 0] }, { end: [1, 1] }] });
    expect([g.kind, g.segments]).toEqual(["profile", null]);
  });
  it("a row that names no shape is a proven none; a word or a number is a form", () => {
    expect(form({ T: 1, type: "", oal: null, description: "x", material: "HSS" }).kind).toBe("none");
    expect(form({ type: "endmill" }).kind).toBe("param");
    expect(form({ oal: 60 }).kind).toBe("param");
    expect(form({ shaft_segments: [{ height: 1, lower_diameter: 1, upper_diameter: 1 }] }).kind).toBe("param");
  });
  it("is frozen, and counts its arrays", () => {
    const f = form({ ...SEED["2015"] });
    expect(f.kind).toBe("mesh");
    expect(Object.isFrozen(f) && Object.isFrozen(f.scalars)).toBe(true);
    const note = SEED["2015"].geometry_note as string | undefined;
    expect(f.bytes).toBe(RECORD_BYTES + f.mesh!.pos.byteLength + f.mesh!.idx.byteLength + 2 * (note?.length ?? 0));
  });
});

describe("a refusal is content", () => {
  const refused: Array<[string, any, string, string]> = [
    ["a native profile of 4096 points", { native_profile: Array.from({ length: 4096 }, (_, i) => [1, i]) }, TOO_DETAILED, "native_profile"],
    ["one point past its bound", { native_profile: Array.from({ length: PROFILE_POINTS_MAX + 1 }, (_, i) => [1, i]) }, TOO_DETAILED, "native_profile"],
    ["a profile whose columns pass the vertices", { native_profile: Array.from({ length: 2000 }, (_, i) => [1000, i]) }, TOO_DETAILED, "native_profile vertices"],
    ["a form mill's segments", { type: "formmill", profile: Array.from({ length: FORM_SEGMENTS_MAX + 1 }, (_, i) => ({ end: [1, i] })) }, TOO_DETAILED, "profile"],
    ["a form mill's arc points", { type: "formmill", profile: [{ end: [0, 0] }, ...Array.from({ length: 200 }, (_, i) => ({ end: [5, i + 1], arc: true, center: [-500, i] }))] }, TOO_DETAILED, "profile points"],
    ["a shaft's segments", { type: "endmill", shaft_segments: Array.from({ length: SHAFT_SEGMENTS_MAX + 1 }, () => ({ height: 1, lower_diameter: 1, upper_diameter: 1 })) }, TOO_DETAILED, "shaft_segments"],
    ["a mesh's vertices", { native_mesh: { vertices: { length: 0 }, triangles: [[0, 1, 2]] } }, NOT_USABLE, "native_mesh"],
    ["a coordinate float32 cannot hold", { native_mesh: { ...box(), vertices: [[0, 0, 0], [1e39, 0, 0], [0, 1, 0], [0, 0, 1]] } }, NOT_USABLE, "a mesh coordinate"],
    ["a null coordinate (no 0)", { native_mesh: { ...box(), vertices: [[0, 0, 0], [null, 0, 0], [0, 1, 0], [0, 0, 1]] } }, NOT_USABLE, "a mesh coordinate"],
    ["an index out of range", { native_mesh: { ...box(), triangles: [[0, 1, 9]] } }, NOT_USABLE, "a mesh index"],
    ["a negative radius", { native_profile: [[0, 0], [-1, 5]] }, NOT_USABLE, "a profile point"],
    ["a text as a number", { type: "endmill", oal: "60" }, NOT_USABLE, "oal"],
    ["an endless word", { type: "x".repeat(SHAPE_WORD_MAX + 1) }, NOT_USABLE, "type"],
    ["a segment without its end", { type: "formmill", profile: [{ end: [0, 0] }, { start: [1, 1] }] }, NOT_USABLE, "a profile segment"],
    ["a shaft segment without a number", { type: "endmill", shaft_segments: [{ height: 1, lower_diameter: null, upper_diameter: 1 }] }, NOT_USABLE, "a segment"],
  ];
  for (const [name, row, why, field] of refused) it(name, () => {
    const f = form({ T: 4, type: "ball", flute_length: 12, ...row });
    expect([f.kind, f.refused?.why, f.refused?.field]).toEqual(["refused", why, field]);
    expect([f.mesh, f.profile, f.segments, f.shaft]).toEqual([null, null, null, null]);
    expect(f.scalars.flute_length).toBe(12);                    // the row's fields stay
    expect(f.bytes).toBeLessThan(RECORD_BYTES + 100);
    // it draws the table's cylinder, says why, and is never "no library shape"
    expect(toolDrawing(6, 80, formMeta({ type: "ball", oal: 60 }, f) as ToolMeta)).toEqual(toolDrawing(6, 80, null));
    expect(formNotice(f)).toBe(why === TOO_DETAILED ? "Shape too detailed to draw" : "Shape not usable");
    expect(f.kind).not.toBe("none");
  });
  it("sizes are judged by their lengths: no element of an oversized list is read", () => {
    const list = (n: number) => new Proxy([] as unknown[], {
      get(t, k) { if (k === "length") return n; if (typeof k === "string" && /^\d+$/.test(k)) throw new Error("read an element"); return Reflect.get(t, k); },
    });
    expect(form({ native_profile: list(PROFILE_POINTS_MAX + 1) }).refused!.size).toBe(PROFILE_POINTS_MAX + 1);
    expect(form({ native_mesh: { vertices: list(MESH_VERTICES_MAX + 1), triangles: list(4) } }).refused!.field).toBe("native_mesh vertices");
    expect(form({ native_mesh: { vertices: list(4), triangles: list(MESH_TRIANGLES_MAX + 1) } }).refused!.field).toBe("native_mesh triangles");
    expect(form({ type: "formmill", profile: list(FORM_SEGMENTS_MAX + 1) }).refused!.field).toBe("profile");
    expect(form({ type: "endmill", shaft_segments: list(SHAFT_SEGMENTS_MAX + 1) }).refused!.field).toBe("shaft_segments");
    expect(form({ type: "endmill", holder_segments: list(HOLDER_SEGMENTS_MAX + 1) }).holderWhy).toBe(HOLDER_TOO_DETAILED);
  });
  it("the holder is refused on its own, with its own words", () => {
    const seg = { height: 5, lower_diameter: 20, upper_diameter: 20 };
    const big = form({ type: "endmill", holder_segments: Array(HOLDER_SEGMENTS_MAX + 1).fill(seg) });
    expect([big.kind, big.holder, big.holderWhy, holderNotice(big), formNotice(big)]).toEqual(["param", null, HOLDER_TOO_DETAILED, HOLDER_TOO_DETAILED, null]);
    for (const bad of [[null], ["x"], [{ ...seg, height: -1 }], { length: 1 }]) expect(form({ type: "endmill", holder_segments: bad }).holderWhy).toBe(HOLDER_NOT_USABLE);
    for (const big of [[{ ...seg, height: 1e39 }], [{ ...seg, lower_diameter: 1e39 }], [{ ...seg, height: 3e38 }, { ...seg, height: 3e38 }]])
      expect(form({ type: "endmill", holder_segments: big }).holderWhy).toBe(HOLDER_NOT_USABLE);
    const ok = form({ type: "endmill", holder_segments: [seg], native_profile: Array.from({ length: 4096 }, () => [1, 1]) });
    expect([ok.kind, ok.holderWhy, Array.from(ok.holder!)]).toEqual(["refused", null, [5, 20, 20]]);   // a refused shape keeps a good holder
    expect((formMeta({}, ok) as ToolMeta).holder_segments).toEqual([seg]);
    expect(form({ type: "endmill", holder_segments: [] }).holderWhy).toBeNull();
  });
  it("a pending form draws the cylinder and says it loads; an unknown tool draws its own fields", () => {
    expect(toolDrawing(6, 80, formMeta({ type: "ball", oal: 60 }, "pending") as ToolMeta)).toEqual(toolDrawing(6, 80, null));
    expect(formNotice("pending")).toBe("Loading shape");
    expect(formMeta({ type: "ball", oal: 60 }, null)).toMatchObject({ type: "ball", oal: 60, native_mesh: null });
  });
});

describe("the points are known before a profile is built", () => {
  it("predicted is never less than made: every shipped tool, every type, extreme arcs, mm and inch", () => {
    const cases: Array<[any, number]> = Object.values(SEED).map(m => [m, 6] as [any, number]);
    const types = ["endmill", "reamer", "blockdrill", "tap", "threadmill", "slotmill", "ball", "bullnose", "radiusmill", "drill", "centerdrill",
      "cornerchamfer", "chamfer", "countersink", "tapered", "dovetail", "lollipop", "facemill", "probe", "formmill", "other"];
    for (const type of types) for (const D of [0.1, 6, 300]) for (const cr of [0, 0.5, 40, 149]) {
      cases.push([{ type, corner_radius: cr, upper_radius: cr, flute_length: 30, shaft_diameter: D, oal: 90, taper_angle: 20, maximum_cutting_diameter: D * 1.5,
                    thread_pitch: 0.5, thread_profile_angle: 60, number_of_teeth: 40, thread_tip_type: "round", thread_tip_radius: 0.05,
                    shaft_segments: Array.from({ length: 20 }, () => ({ height: 2, lower_diameter: 4, upper_diameter: 5 })) }, D]);
      cases.push([{ type, corner_radius: cr, thread_pitch: 1, thread_profile_angle: 55, number_of_teeth: 1, thread_tip_type: "flat", thread_tip_width: 0.1,
                    flute_length: 8 }, D]);
    }
    cases.push([{ type: "formmill", profile: [{ end: [0, 0] }, ...Array.from({ length: 30 }, (_, i) => ({ end: [5 + (i % 2), i + 1], arc: true, ccw: !!(i % 2), center: [4 - 7 * i, i] })), { end: [0, 40] }] }, 10]);
    for (const u of [1, 1 / 25.4]) for (const [m, D] of cases) {
      const f = form(m, u);
      if (f.refused) continue;
      const meta = formMeta(rowFields(m), f) as ToolMeta, made = buildToolProfile(D * u, 80 * u, meta, u).pts.length;
      const split = Object.values(buildToolParts(D * u, 80 * u, meta, u)).reduce((n, p) => n + p.length, 0);
      const predicted = f.mesh ? Infinity : predictedProfilePoints(f, D * u, 80 * u, u);
      expect([m.type, D, m.corner_radius, predicted >= made, predicted + 8 >= split]).toEqual([m.type, D, m.corner_radius, true, true]);
    }
  });
});

describe("the library of forms", () => {
  const rows = (o: Record<number, any>) => Object.entries(o).map(([T, m]) => ({ T: Number(T), ...m }));
  /** Every object reachable from `roots`: no array that holds numbers of a decoded list. */
  function decodedIn(...roots: unknown[]): string[] {
    const seen = new Set<unknown>(), found: string[] = [];
    const walk = (x: unknown, path: string) => {
      if (typeof x !== "object" || x === null || seen.has(x) || ArrayBuffer.isView(x)) return;
      seen.add(x);
      if (Array.isArray(x) && x.length > 3 && Array.isArray(x[0])) found.push(path);
      const each = x instanceof Map || x instanceof Set ? [...x.entries()] : Object.entries(x);
      for (const [k, v] of each) walk(v, `${path}.${String(k)}`);
    };
    roots.forEach((r, i) => walk(r, `root${i}`));
    return found;
  }
  it("takes the payload out of the rows it is given and keeps none of it — refused ones included", () => {
    const raw = rows({ 1: { type: "formmill", native_mesh: box(40) }, 2: { native_profile: Array.from({ length: 4096 }, (_, i) => [1, i]) },
                       3: { type: "endmill", shaft_segments: Array(80).fill({ height: 1, lower_diameter: 1, upper_diameter: 1 }) }, 4: { type: "" } });
    const fields = raw.map(rowFields);
    const lib = new FormLibrary(B, raw, 1);
    expect(raw.every(r => FORM_PAYLOAD_FIELDS.every(k => !(k in r)))).toBe(true);
    expect(lib.of(1)).toBe("pending");
    expect(decodedIn(lib).length).toBeGreaterThan(0);              // the normaliser's own, until done
    runToEnd(lib.normalise());
    expect(lib.settled).toBe(true);
    expect([1, 2, 3, 4].map(T => (lib.of(T) as FormRecord).kind)).toEqual(["mesh", "refused", "refused", "none"]);
    expect(decodedIn(lib, fields, raw)).toEqual([]);
    expect(lib.of(9)).toBeNull();
  });
  it("makes them in ascending T, releasing each tool's lists with its record", () => {
    const raw = rows({ 7: { native_mesh: box(30) }, 2: { native_mesh: box(30) }, 5: { native_mesh: box(30) } });
    const lib = new FormLibrary(B, raw, 1), order: number[] = [], left: number[] = [];
    const job = lib.normalise(drawCounter(), T => { order.push(T); });
    while (!job.next().done) left.push(decodedIn(lib).length);
    expect(order).toEqual([2, 5, 7]);
    expect(left).toEqual([...left].sort((a, b) => b - a));
    expect(left[0]).toBeGreaterThan(left[left.length - 1]!);
  });
  it("drops what is not made yet, and is then not settled", () => {
    const lib = new FormLibrary(B, rows({ 1: { native_mesh: box(30) }, 2: { native_mesh: box(30) } }), 1);
    lib.normalise().next();
    lib.drop();
    expect([lib.settled, lib.has(2), lib.of(2)]).toEqual([false, false, "pending"]);
    expect(decodedIn(lib)).toEqual([]);
  });
  it("is bounded over all its forms, in T order — by its lengths, before a conversion", () => {
    const tri = Array.from({ length: 200_000 }, () => [0, 1, 2]), vertices = Array.from({ length: 100_000 }, () => [0, 0, 1]);
    const big = { native_mesh: { vertices, triangles: tri } }, each = 12 * 300_000 + RECORD_BYTES;
    const fit = Math.floor(LIBRARY_BYTES_MAX / each);
    const raw = rows(Object.fromEntries(Array.from({ length: fit + 2 }, (_, i) => [i + 1, { ...big }])));
    const lib = new FormLibrary(B, raw, 1);
    runToEnd(lib.normalise());
    expect(lib.bytes).toBeLessThanOrEqual(LIBRARY_BYTES_MAX + 2 * RECORD_BYTES);
    const kinds = raw.map(r => (lib.of(r.T) as FormRecord));
    expect(kinds.slice(0, fit).every(f => f.kind === "mesh")).toBe(true);
    expect(kinds.slice(fit).map(f => [f.refused!.why, f.refused!.field])).toEqual([[TOO_DETAILED, "library"], [TOO_DETAILED, "library"]]);
    // a small tool after them still has its form
    const small = new FormLibrary(B, [...raw.map(r => ({ ...r, native_mesh: big.native_mesh })), { T: 900, type: "endmill" } as any], 1);
    runToEnd(small.normalise());
    expect((small.of(900) as FormRecord).kind).toBe("param");
  });
  it("counts every step: a maximum mesh stays within the budget", () => {
    const c = drawCounter();
    const raw = rows({ 1: { native_mesh: { vertices: Array.from({ length: 20_000 }, () => [0, 0, 1]), triangles: Array.from({ length: 40_000 }, () => [0, 1, 2]) } } });
    runToEnd(new FormLibrary(B, raw, 1).normalise(c));
    expect([c.max, c.total]).toEqual([DRAW_BUDGET, 4 * 60_000]);
  });
});
