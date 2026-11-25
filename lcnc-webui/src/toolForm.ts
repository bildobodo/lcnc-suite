// A tool library entry's FORM, normalised once (P6-c plan v8 §1.5, Codex R477
// MT477-04, R480): the decoded geometry of a get_tool_table reply — nested
// arrays, in any size a library file holds — becomes ONE bounded, immutable
// record per tool, or a small record that says why not. Nothing of the decoded
// lists is kept after that: not in a row, not in a record, not in a job. Pure,
// three-free, in counted steps.
import type { ProfileSegment, ShaftSegment, ToolMeta } from "./toolGeometry";
import {
  LATHE_VERTICES_MAX, MESH_TRIANGLES_MAX, MESH_VERTICES_MAX, ShapeNotUsable, canonMeshSteps, drawCounter, latheSize, settle, spent,
  type CanonMesh, type DrawCounter, type NestedMesh,
} from "./toolDrawing";
import { validHolderSegments } from "./toolHolder";
import type { Steps } from "./viewer/steps";

/** The form payload fields of a get_tool_table row, by NAME (the gateway's
 *  tool_table.FORM_PAYLOAD_FIELDS — toolForm.test.ts holds the two equal):
 *  left out of a `same` reply, taken out of every row here. */
export const FORM_PAYLOAD_FIELDS = ["native_mesh", "native_profile", "profile", "shaft_segments", "holder_segments",
  "source_metadata"] as const;
/** Fields nothing on the page reads: not kept. */
export const ROW_FIELDS_DROPPED = ["source_id", "fusion_guid"] as const;

export const PROFILE_POINTS_MAX = 2048;
export const FORM_SEGMENTS_MAX = 512;
export const SHAFT_SEGMENTS_MAX = 64;
export const HOLDER_SEGMENTS_MAX = 64;
export const SHAPE_WORD_MAX = 64;
/** A note is no edit field: cut, with its sign. */
export const GEOMETRY_NOTE_MAX = 1024;
/** What every record counts beside its arrays. */
export const RECORD_BYTES = 1024;

/** The numbers and words of a row the drawing reads. */
export const SHAPE_NUMBERS = ["oal", "flute_length", "shoulder_length", "shoulder_diameter", "corner_radius", "shaft_diameter",
  "maximum_cutting_diameter", "upper_radius", "chamfer_width", "chamfer_angle", "taper_angle", "point_angle", "tip_diameter",
  "tip_length", "thread_pitch", "number_of_teeth", "thread_profile_angle", "thread_tip_width", "thread_tip_radius"] as const;
export const SHAPE_WORDS = ["type", "tapered_type", "thread_tip_type", "fusion_type", "source_format"] as const;
export type ShapeScalars = Readonly<{ [k in typeof SHAPE_NUMBERS[number]]: number | null } & { [k in typeof SHAPE_WORDS[number]]: string | null }>;

export const TOO_DETAILED = "shape too detailed";
export const NOT_USABLE = "shape not usable";
export const HOLDER_TOO_DETAILED = "Holder too detailed to draw";
export const HOLDER_NOT_USABLE = "Holder not usable";
export type FormRefusal = typeof TOO_DETAILED | typeof NOT_USABLE;

/** One tool's form. `refused` is content like any other: a shape the library
 *  HAS and the page does not draw — never "no library shape". */
export interface FormRecord {
  readonly kind: "none" | "param" | "mesh" | "profile" | "segments" | "refused";
  readonly scalars: ShapeScalars;
  /** native mesh, canonical */
  readonly mesh: CanonMesh | null;
  /** native profile: f32 [r, z] */
  readonly profile: Float32Array | null;
  /** form mill: f64 [end x, end y, arc, ccw, center x, center y] a segment (no center: NaN) */
  readonly segments: Float64Array | null;
  /** shaft: f64 [height, lower Ø, upper Ø] a segment */
  readonly shaft: Float64Array | null;
  /** holder, the same; refused on its own (`holderWhy`), never with the tool's shape */
  readonly holder: Float64Array | null;
  readonly holderWhy: string | null;
  readonly refused: Readonly<{ why: FormRefusal; field: string; size: number | null }> | null;
  /** what it counts in its library (its arrays and RECORD_BYTES) */
  readonly bytes: number;
}
/** A tool's form as known: not normalised yet, or no row of this library. */
export type FormState = FormRecord | "pending" | null;

/** The decoded geometry of one row — the normaliser's alone, until done. */
export interface RawForm {
  native_mesh?: unknown; native_profile?: unknown; profile?: unknown; shaft_segments?: unknown; holder_segments?: unknown;
}
type Scalars = Record<string, unknown>;

/** A row without its form payload and what nothing reads: the fields of the
 *  reply itself, never of a cache. The row object is new; the decoded one is
 *  not handed on. */
export function rowFields(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...raw };
  for (const k of FORM_PAYLOAD_FIELDS) delete out[k];
  for (const k of ROW_FIELDS_DROPPED) delete out[k];
  const note = out.geometry_note;
  if (typeof note === "string" && note.length > GEOMETRY_NOTE_MAX) out.geometry_note = note.slice(0, GEOMETRY_NOTE_MAX) + "…";
  return out;
}
/** The form payload of a decoded row, apart from its fields. */
export function rawForm(raw: Record<string, unknown>): RawForm {
  return { native_mesh: raw.native_mesh, native_profile: raw.native_profile, profile: raw.profile,
           shaft_segments: raw.shaft_segments, holder_segments: raw.holder_segments };
}

function scalarsOf(row: Scalars): { scalars: ShapeScalars; bad: string | null } {
  const out: Record<string, number | string | null> = {};
  let bad: string | null = null;
  for (const k of SHAPE_NUMBERS) {
    const v = row[k];
    if (v == null || v === "") out[k] = null;
    else if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
    else { out[k] = null; bad ??= k; }
  }
  for (const k of SHAPE_WORDS) {
    const v = row[k];
    if (v == null || v === "") out[k] = null;
    else if (typeof v === "string" && v.length <= SHAPE_WORD_MAX) out[k] = v;
    else { out[k] = null; bad ??= k; }
  }
  return { scalars: Object.freeze(out) as ShapeScalars, bad };
}

/** Does anything in the row name a shape? */
const namesShape = (s: ShapeScalars) => SHAPE_WORDS.some(k => s[k] !== null) || SHAPE_NUMBERS.some(k => s[k] !== null);

const listLength = (v: unknown): number | null => (Array.isArray(v) ? v.length : null);
const present = (v: unknown) => v != null && !(Array.isArray(v) && v.length === 0);

/** The arcs' steps of toolGeometry's profiles (the drawn chord tolerance). */
export function arcSteps(radius: number, sweep: number, u: number): number {
  const step = 4 * Math.asin(Math.sqrt(Math.min(1, 0.001 * u / (2 * radius))));
  return Math.min(4096, Math.max(6, Math.ceil(Math.abs(sweep) / step)));
}

/** At least the points buildToolProfile makes of this form with diameter
 *  `diam` (a second copy of its arc steps: a guard holds predicted ≥ made) —
 *  the bound is asked BEFORE the profile is built. */
export function predictedProfilePoints(form: Pick<FormRecord, "scalars" | "profile" | "segments" | "shaft">, diam: number, len: number, u: number): number {
  const s = form.scalars, r = Math.max(0, diam / 2);
  if (form.profile) return form.profile.length / 2;
  const shaft = 8 + 2 * ((form.shaft?.length ?? 0) / 3);
  const q = Math.PI / 2, cr = Math.max(0, s.corner_radius ?? 0);
  const arc = (radius: number, sweep: number) => (radius > 0 ? arcSteps(radius, sweep, u) + 2 : 0);
  switch (s.type) {
    case "threadmill": {
      const pitch = s.thread_pitch ?? 0, a = (s.thread_profile_angle ?? 0) * Math.PI / 360;
      if (!(pitch > 0)) return 8 + shaft;
      const flute = s.flute_length ?? len * 0.6;
      const count = Math.max(0, Math.min(Math.trunc(s.number_of_teeth ?? 1), Math.floor(flute / pitch + 1e-10)));
      const tip = s.thread_tip_radius ?? 0;
      return 8 + shaft + count * (4 + (s.thread_tip_type === "round" && tip > 0 ? 2 * arc(tip, Math.PI + 2 * Math.abs(a)) : 0));
    }
    case "slotmill": return 8 + shaft + 2 * arc(Math.min(cr, r), q);
    case "bullnose": return 8 + shaft + arc(Math.min(Math.max(0, s.corner_radius ?? r * 0.2), r), q);
    case "radiusmill": return 8 + shaft + arc(Math.max(0, s.corner_radius ?? r * 0.2), q);
    case "ball": return 8 + shaft + 14;
    case "tapered": return 8 + shaft + 28;
    case "lollipop": return 8 + shaft + 68;
    case "dovetail": return 8 + shaft + arc(Math.min(r, cr), q + Math.abs((s.taper_angle ?? 45) * Math.PI / 180));
    case "facemill": return 8 + shaft + arc(cr, Math.PI) + arc(Math.max(0, s.upper_radius ?? 0), q);
    case "probe": return 8 + arc(r, Math.PI);
    case "formmill": return form.segments ? segmentPoints(form.segments, u) : 8;
    default: return 12 + shaft;
  }
}
/** At least the points of a form mill's outline (its arcs at the 1 µm chord). */
function segmentPoints(f: Float64Array, u: number): number {
  let n = 4;
  for (let i = 0; i < f.length; i += 6) {
    n++;
    if (i === 0 || !f[i + 2]) continue;
    const R = Math.hypot(f[i - 6]! - f[i + 4]!, f[i - 5]! - f[i + 5]!);
    if (R > 0) n += Math.min(4096, Math.ceil(2 * Math.PI / Math.min(Math.PI / 12, 4 * Math.asin(Math.sqrt(Math.min(1, 0.001 * u / (2 * R)))))));
  }
  return n;
}

/** Columns a native profile is drawn with (toolGeometry.toolDrawing's). */
export function nativeSegments(profile: Float32Array, u: number): number {
  let radius = -Infinity;
  for (let i = 0; i < profile.length; i += 2) if (profile[i]! > radius) radius = profile[i]!;
  return Math.min(512, Math.max(48, Math.ceil(2 * Math.PI / (2 * Math.acos(Math.max(-1, 1 - .01 * u / radius))))));
}

/** Three numbers a segment, finite. */
function triples(v: unknown, a: string, b: string, c: string): Float64Array {
  const list = v as Record<string, unknown>[], out = new Float64Array(3 * list.length);
  list.forEach((s, i) => {
    const t = [s?.[a], s?.[b], s?.[c]];
    if (!t.every(x => typeof x === "number" && Number.isFinite(x))) throw new ShapeNotUsable("a segment");
    out.set(t as number[], 3 * i);
  });
  return out;
}

/** The arrays a row's payload would take, from its lengths alone. */
export function payloadBytes(raw: RawForm): number {
  const mesh = raw.native_mesh as Partial<NestedMesh> | null | undefined;
  let n = 0;
  if (present(raw.native_mesh)) n += 12 * (listLength(mesh?.vertices) ?? 0) + 12 * (listLength(mesh?.triangles) ?? 0);
  else if (present(raw.native_profile)) n += 8 * (listLength(raw.native_profile) ?? 0);
  else n += 48 * (listLength(raw.profile) ?? 0) + 24 * (listLength(raw.shaft_segments) ?? 0);
  return n + 24 * (listLength(raw.holder_segments) ?? 0);
}

/**
 * One tool's form from its decoded row (`row` its fields, `raw` its payload).
 * Sizes are judged by their lengths before an element is read; `room` is what
 * its library may still take. The branch that is drawn is the one kept
 * (toolGeometry.toolDrawing's order); the other lists go with the raw ones.
 */
export function* formSteps(row: Scalars, raw: RawForm, u: number, room: number, c: DrawCounter = drawCounter()): Steps<FormRecord> {
  const { scalars, bad } = scalarsOf(row);
  const note = typeof row.geometry_note === "string" ? 2 * Math.min(row.geometry_note.length, GEOMETRY_NOTE_MAX + 1) : 0;
  let holder: Float64Array | null = null, holderWhy: string | null = null;
  if (present(raw.holder_segments)) {
    const n = listLength(raw.holder_segments);
    if (n !== null && n > HOLDER_SEGMENTS_MAX) holderWhy = HOLDER_TOO_DETAILED;
    else if (n === null || !(raw.holder_segments as unknown[]).every(x => x && typeof x === "object")
             || !validHolderSegments(raw.holder_segments as ShaftSegment[])) holderWhy = HOLDER_NOT_USABLE;
    else holder = triples(raw.holder_segments, "height", "lower_diameter", "upper_diameter");
  }
  const record = (r: Partial<FormRecord> & { kind: FormRecord["kind"] }): FormRecord => {
    const arrays = [r.mesh?.pos, r.mesh?.idx, r.profile, r.segments, r.shaft, holder];
    return Object.freeze({ mesh: null, profile: null, segments: null, shaft: null, refused: null, scalars, holder, holderWhy, ...r,
                           bytes: RECORD_BYTES + note + arrays.reduce((n, a) => n + (a?.byteLength ?? 0), 0) });
  };
  const refuse = (why: FormRefusal, field: string, size: number | null = null): FormRecord =>
    record({ kind: "refused", refused: Object.freeze({ why, field, size }) });
  if (bad !== null) return refuse(NOT_USABLE, bad);
  try {
    if (present(raw.native_mesh)) {
      const m = raw.native_mesh as Partial<NestedMesh>, nv = listLength(m.vertices), nt = listLength(m.triangles);
      if (nv === null || nt === null || nt === 0) return refuse(NOT_USABLE, "native_mesh");
      if (nv > MESH_VERTICES_MAX) return refuse(TOO_DETAILED, "native_mesh vertices", nv);
      if (nt > MESH_TRIANGLES_MAX) return refuse(TOO_DETAILED, "native_mesh triangles", nt);
      if (payloadBytes(raw) > room) return refuse(TOO_DETAILED, "library", nt);
      return record({ kind: "mesh", mesh: yield* canonMeshSteps(m as NestedMesh, c) });
    }
    if (present(raw.native_profile)) {
      const list = raw.native_profile as unknown[], n = listLength(list);
      if (n === null || n < 2) return refuse(NOT_USABLE, "native_profile", n);
      if (n > PROFILE_POINTS_MAX) return refuse(TOO_DETAILED, "native_profile", n);
      if (payloadBytes(raw) > room) return refuse(TOO_DETAILED, "library", n);
      const profile = new Float32Array(2 * n);
      for (let i = 0; i < n; i++) {
        if (spent(c, 4)) yield;
        const p = list[i] as ArrayLike<unknown> | null, x = p?.[0], y = p?.[1];
        const r = typeof x === "number" ? Math.fround(x) : NaN, z = typeof y === "number" ? Math.fround(y) : NaN;
        if (!(Number.isFinite(r) && Number.isFinite(z) && r >= 0)) throw new ShapeNotUsable("a profile point");
        profile[2 * i] = r;
        profile[2 * i + 1] = z;
      }
      const v = latheSize(n, nativeSegments(profile, u)).v;
      if (v > LATHE_VERTICES_MAX) return refuse(TOO_DETAILED, "native_profile vertices", v);
      return record({ kind: "profile", profile });
    }
    const nSeg = listLength(raw.profile);
    if (scalars.type === "formmill" && nSeg !== null && nSeg >= 2) {
      if (nSeg > FORM_SEGMENTS_MAX) return refuse(TOO_DETAILED, "profile", nSeg);
      if (payloadBytes(raw) > room) return refuse(TOO_DETAILED, "library", nSeg);
      if (spent(c, 8 * nSeg)) yield;
      const segments = new Float64Array(6 * nSeg);
      (raw.profile as Record<string, any>[]).forEach((s, i) => {
        const e = s?.end, ctr = s?.center ?? null, num = (x: unknown) => typeof x === "number" && Number.isFinite(x);
        if (!Array.isArray(e) || !num(e[0]) || !num(e[1]) || (ctr !== null && (!Array.isArray(ctr) || !num(ctr[0]) || !num(ctr[1]))))
          throw new ShapeNotUsable("a profile segment");
        // an arc without a center (2) is drawn straight, and still an arc to the notice
        segments.set([e[0], e[1], s.arc ? (ctr ? 1 : 2) : 0, s.ccw ? 1 : 0, ctr ? ctr[0] : NaN, ctr ? ctr[1] : NaN], 6 * i);
      });
      const points = segmentPoints(segments, u);
      if (points > PROFILE_POINTS_MAX) return refuse(TOO_DETAILED, "profile points", points);
      return record({ kind: "segments", segments });
    }
    let shaft: Float64Array | null = null;
    if (present(raw.shaft_segments)) {
      const n = listLength(raw.shaft_segments);
      if (n === null) return refuse(NOT_USABLE, "shaft_segments");
      if (n > SHAFT_SEGMENTS_MAX) return refuse(TOO_DETAILED, "shaft_segments", n);
      shaft = triples(raw.shaft_segments, "height", "lower_diameter", "upper_diameter");
    }
    return record(namesShape(scalars) || shaft ? { kind: "param", shaft } : { kind: "none" });
  } catch (e) {
    if (!(e instanceof ShapeNotUsable)) throw e;
    return refuse(NOT_USABLE, e.message.replace(/^shape not usable: /, ""));
  } finally { settle(c); }
}

// ---- what a form draws -------------------------------------------------------

const unpack3 = (f: Float64Array): ShaftSegment[] =>
  Array.from({ length: f.length / 3 }, (_, i) => ({ height: f[3 * i]!, lower_diameter: f[3 * i + 1]!, upper_diameter: f[3 * i + 2]! }));
const unpackProfile = (f: Float64Array): ProfileSegment[] => Array.from({ length: f.length / 6 }, (_, i) => ({
  end: [f[6 * i]!, f[6 * i + 1]!] as [number, number],
  ...(f[6 * i + 2] ? { arc: true, ccw: f[6 * i + 3] === 1 } : {}),
  ...(Number.isNaN(f[6 * i + 4]!) ? {} : { center: [f[6 * i + 4]!, f[6 * i + 5]!] as [number, number] }),
}));

/** The metadata a tool's preview is drawn from: the row's own fields and its
 *  form. A refused form, and one not normalised yet, draw the table's cylinder
 *  — never a guess from the other fields; the holder stands on its own. `null`
 *  (a tool of no read, a new one in the dialog): the fields alone. */
export function formMeta<F extends object>(fields: F, form: FormState): F & ToolMeta {
  const r = form === "pending" ? null : form;
  const holder = r?.holder ? unpack3(r.holder) : null;
  if (form === "pending" || r?.kind === "refused") {
    const blank: Record<string, null> = {};
    for (const k of [...SHAPE_NUMBERS, ...SHAPE_WORDS]) blank[k] = null;
    return { ...fields, ...blank, native_mesh: null, native_profile: null, profile: null, shaft_segments: null, holder_segments: holder } as F & ToolMeta;
  }
  return { ...fields, native_mesh: r?.mesh ?? null, native_profile: r?.profile ?? null, profile: r?.segments ? unpackProfile(r.segments) : null,
           shaft_segments: r?.shaft ? unpack3(r.shaft) : null, holder_segments: holder } as F & ToolMeta;
}

/** What the preview says about the form itself; null: the shape's own notice
 *  (toolPreviewNotice) stands. */
export function formNotice(form: FormState): string | null {
  if (form === "pending") return "Loading shape";
  const why = form?.refused?.why;
  return why === TOO_DETAILED ? "Shape too detailed to draw" : why === NOT_USABLE ? "Shape not usable" : null;
}
/** The holder's own note (it is never part of the collision body). */
export const holderNotice = (form: FormState): string | null => (form === "pending" ? null : form?.holderWhy ?? null);
