// A tool library entry's form, normalised once (P6-c plan v8 §1.5, Codex R477
// MT477-04, R480): every field's bound, the refusal as content, the drawing it
// gives — and that nothing decoded is kept (toolLibrary.ts).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildToolParts, buildToolProfile, toolDrawing, type ToolMeta } from "./toolGeometry";
import { drawCounter, DRAW_BUDGET, MESH_TRIANGLES_MAX, MESH_VERTICES_MAX } from "./toolDrawing";
import {
  baseBytes, FORM_PAYLOAD_FIELDS, FORM_SEGMENTS_MAX, GEOMETRY_NOTE_MAX, HOLDER_NOT_USABLE, HOLDER_SEGMENTS_MAX, HOLDER_TOO_DETAILED, NOT_USABLE,
  PROFILE_POINTS_MAX, RECORD_BYTES, ROW_FIELDS_DROPPED, SHAFT_SEGMENTS_MAX, SHAPE_WORD_MAX, TOO_DETAILED, formMeta, formNotice, formSteps,
  holderNotice, predictedProfilePoints, rawForm, rowFields, type FormRecord,
} from "./toolForm";
import { FormLibrary, LIBRARY_BYTES_MAX, LIBRARY_FULL, type ToolBinding } from "./toolLibrary";
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
    const arrays = RECORD_BYTES + f.mesh!.pos.byteLength + f.mesh!.idx.byteLength;
    expect(f.bytes).toBe(arrays + 2 * ((SEED["2015"].geometry_note as string | undefined)?.length ?? 0));
    expect(form({ ...SEED["2015"], geometry_note: "x".repeat(40) }).bytes).toBe(arrays + 80);
    expect(form({ ...SEED["2015"], geometry_note: "x".repeat(9000) }).bytes).toBe(arrays + 2 * (GEOMETRY_NOTE_MAX + 1));
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
    ["a text that is no decimal number", { type: "endmill", oal: "60 mm" }, NOT_USABLE, "oal"],
    ["an exponent past any number", { type: "endmill", oal: "1e999" }, NOT_USABLE, "oal"],
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
    const raw = [7, 2, 5].map(T => ({ T, native_mesh: box(30) }));
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
  // Codex R492 MT-I48: ALL of a record is budgeted before it is taken over —
  // its base, its branch, its holder —, the bases of the rows to come reserved
  const vertices = Array.from({ length: 100_000 }, () => [0, 0, 1]), tri = Array.from({ length: 200_000 }, () => [0, 1, 2]);
  const BIG = 1024 + 12 * 300_000;                                    // a maximum mesh's record
  const seg = (n: number) => Array.from({ length: n }, () => ({ height: 1, lower_diameter: 6, upper_diameter: 6 }));
  const filled = (...more: any[]) => {
    const raw = [...Array.from({ length: 18 }, (_, i) => ({ T: i + 1, native_mesh: { vertices, triangles: tri } })), ...more];
    const lib = new FormLibrary(B, raw, 1);
    runToEnd(lib.normalise());
    const recs = new Set(raw.map(r => lib.of(r.T) as FormRecord));
    expect(lib.bytes).toBe([...recs].reduce((n, r) => n + r.bytes, 0));          // what it says it holds is what it holds
    expect(lib.bytes).toBeLessThanOrEqual(LIBRARY_BYTES_MAX);
    for (const row of raw) {
      const r = lib.of(row.T) as FormRecord;
      expect(r.bytes).toBe(baseBytes(row) + [r.mesh?.pos, r.mesh?.idx, r.profile, r.segments, r.shaft, r.holder]
        .reduce((n, a) => n + (a?.byteLength ?? 0), 0));
    }
    return lib;
  };
  it("Codex's library: a mesh that fits by its payload but not with its record, then 32 shanks with holders", () => {
    const lib = filled({ T: 19, native_mesh: { vertices, triangles: tri.slice(0, 90_869) } },
                       ...Array.from({ length: 32 }, (_, i) => ({ T: 20 + i, type: "endmill", shaft_segments: seg(64), holder_segments: seg(64) })));
    const f19 = lib.of(19) as FormRecord, f20 = lib.of(20) as FormRecord;
    expect([f19.kind, f19.refused?.field, f20.kind, f20.shaft?.length, f20.holder?.length]).toEqual(["refused", "library", "param", 192, 192]);
    expect(lib.bytes).toBe(18 * BIG + 1024 + 32 * (1024 + 2 * 64 * 24));
  });
  it("at the edge: a record that fills the library exactly is kept, one triangle more is refused — the row after keeps its base", () => {
    // 18 meshes leave 2 290 432 B; T20's base is reserved: T19 may take 2 289 408 B, its note of 4 characters included
    const edge = (nt: number) => filled({ T: 19, geometry_note: "abcd", native_mesh: { vertices, triangles: tri.slice(0, nt) } },
                                        { T: 20, type: "endmill", shaft_segments: seg(1), holder_segments: seg(1) });
    const exact = edge(90_698), past = edge(90_699);
    expect([exact.bytes, (exact.of(19) as FormRecord).kind, (past.of(19) as FormRecord).refused?.field]).toEqual([LIBRARY_BYTES_MAX, "mesh", "library"]);
    // after the exact fill only T20's base is left: its shank is refused, its holder dropped on its own
    const t20 = exact.of(20) as FormRecord, p20 = past.of(20) as FormRecord;
    expect([t20.kind, t20.refused?.field, t20.holder, t20.holderWhy, t20.bytes]).toEqual(["refused", "library", null, HOLDER_TOO_DETAILED, RECORD_BYTES]);
    expect([p20.kind, p20.shaft?.length, p20.holder?.length, p20.holderWhy]).toEqual(["param", 3, 3, null]);
  });
  it("a shank, a holder or a plain form after a full library: only within what is left, never past it", () => {
    const lib = filled({ T: 19, native_mesh: { vertices, triangles: tri.slice(0, 73_000) } },
                       ...Array.from({ length: 200 }, (_, i) => ({ T: 20 + i, type: "endmill", shaft_segments: seg(64), holder_segments: seg(64) })),
                       { T: 900, type: "ball" }, { T: 901, type: "ball", geometry_note: "n".repeat(5000) });
    expect([(lib.of(900) as FormRecord).kind, (lib.of(901) as FormRecord).kind]).toEqual(["param", "param"]);  // their base was reserved
    // the room left after the bases of everything to come: shanks until it is used, then refused — holders dropped on their own
    const kinds = Array.from({ length: 200 }, (_, i) => lib.of(20 + i) as FormRecord), kept = kinds.filter(f => f.kind === "param").length;
    expect([(lib.of(19) as FormRecord).kind, kept]).toEqual(["mesh", 1]);
    expect(kinds.map(f => f.kind)).toEqual([...Array(kept).fill("param"), ...Array(200 - kept).fill("refused")]);
    expect(kinds.slice(kept).every(f => f.refused?.field === "library" && f.holder === null && f.holderWhy === HOLDER_TOO_DETAILED)).toBe(true);
    expect(LIBRARY_BYTES_MAX - lib.bytes).toBeLessThan(4096);          // the next shank (4 096 B) would not have fit
  });
  it("more rows than any table: the bases that fit, the rest ONE shared refusal counted once", () => {
    const note = "n".repeat(GEOMETRY_NOTE_MAX + 50), n = 21_900;
    const lib = new FormLibrary(B, Array.from({ length: n }, (_, i) => ({ T: i + 1, type: "ball", geometry_note: note })), 1);
    runToEnd(lib.normalise());
    const base = RECORD_BYTES + 2 * (GEOMETRY_NOTE_MAX + 1), own = Math.floor((LIBRARY_BYTES_MAX - RECORD_BYTES) / base);
    expect([(lib.of(own) as FormRecord).kind, lib.of(own + 1), lib.of(n), lib.bytes]).toEqual(["param", LIBRARY_FULL, LIBRARY_FULL, own * base + RECORD_BYTES]);
    expect([formNotice(LIBRARY_FULL), lib.settled]).toEqual(["Shape too detailed to draw", true]);
  });
  it("a number given as decimal text is that number: the same record, the same drawing", () => {
    const num = { type: "tapered", taper_angle: 3.7, corner_radius: 1, flute_length: 47, shaft_diameter: 8, oal: 100,
                  shaft_segments: [{ height: 5, lower_diameter: 8, upper_diameter: 8 }], holder_segments: [{ height: 5, lower_diameter: 20, upper_diameter: 20 }] };
    const text = { type: "tapered", taper_angle: "3.7", corner_radius: "+1", flute_length: "4.7e1", shaft_diameter: "8.", oal: "100",
                   shaft_segments: [{ height: "5", lower_diameter: "8", upper_diameter: "8" }], holder_segments: [{ height: "5", lower_diameter: "20", upper_diameter: ".2e2" }] };
    expect(form(text)).toEqual(form(num));
    expect(toolDrawing(6, 80, formMeta(text, form(text)) as ToolMeta)).toEqual(toolDrawing(6, 80, formMeta(num, form(num)) as ToolMeta));
    expect(toolDrawing(6, 80, text as unknown as ToolMeta)).toEqual(toolDrawing(6, 80, num as ToolMeta));   // the live tool's raw meta too
    // and what the preview says of it
    const thread = { type: "threadmill", thread_pitch: 1.5, thread_profile_angle: 60, thread_tip_type: "flat", thread_tip_width: 0.1, flute_length: 20 };
    const threadText = { ...thread, thread_pitch: "1.5", thread_profile_angle: "60", thread_tip_width: "0.1", flute_length: "20" };
    expect(toolPreviewNotice(formMeta(threadText, form(threadText)) as ToolMeta)).toBe(toolPreviewNotice(formMeta(thread, form(thread)) as ToolMeta));
    for (const bad of [" 60", "60 ", "0x3C", "60mm", "6,0", "1e", ".", "+", "Infinity", "NaN", "1e999", "-1e400", "6".repeat(65)])
      expect([bad, form({ type: "endmill", oal: bad }).refused?.field]).toEqual([bad, "oal"]);
    expect(form({ type: "endmill", oal: "", flute_length: null }).scalars).toMatchObject({ oal: null, flute_length: null });
    expect(() => toolDrawing(6, 80, { type: "endmill", oal: "60 mm" } as unknown as ToolMeta)).toThrow("shape not usable: oal");
  });
  it("counts every step: a maximum mesh stays within the budget", () => {
    const c = drawCounter();
    const raw = rows({ 1: { native_mesh: { vertices: Array.from({ length: 20_000 }, () => [0, 0, 1]), triangles: Array.from({ length: 40_000 }, () => [0, 1, 2]) } } });
    runToEnd(new FormLibrary(B, raw, 1).normalise(c));
    expect([c.max, c.total]).toEqual([DRAW_BUDGET, 4 * 60_000]);
  });
});
