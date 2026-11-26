"""P6-c bell 1 red proofs (plan v8 §5.1, Codex R477 / R480 / R482 / R485-H1):
each mutation breaks ONE rule; its named guards must fail AT that rule (`at`: a
text the failing output must carry — the failing test's name or its assertion
message). Run from the tree's root; every file is restored byte-identical. Page
guards (pw) rebuild the page with the mutation and run their spec — under the
heavy lock (the page is rebuilt from the restored tree afterwards).

  python3 scripts/test_support/heavy_lock.py --who p6c -- python3 -I docs/reviews/p6c1.mutations.py [--kind py|vt|pw] [name ...]

With LCNC_STOP_FLAG naming a file, the run ends between two mutations once that
file exists (another run needs the machine): exit 75, the tree restored, the
lock free; `--after <name>` resumes behind the last one recorded.
"""
import json
import os
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
# the binaries themselves, never npx: it writes ~/.npm/_logs, and another tree's
# gate compares the home in its install probe ("home:.npm changed")
BIN = str(ROOT / "lcnc-webui/node_modules/.bin") + "/"
ENV = {**os.environ, "PATH": BIN[:-1] + os.pathsep + os.environ.get("PATH", "")}
G, S = "lcnc-gateway/", "lcnc-webui/src/"
GW, TSTORE, TTABLE = G + "gateway.py", G + "tool_store.py", G + "tool_table.py"
STORE, TABLE, LIB, FORM, DRAW, REC, CACHE = (S + f"{n}.ts" for n in (
    "toolTableStore", "toolTable", "toolLibrary", "toolForm", "toolDrawing", "toolShapeRecord", "toolShapeCache"))
GEO, PANEL, VIEWER, PREVIEW = S + "toolGeometry.ts", S + "ToolTablePanel.vue", S + "ThreeViewer.vue", S + "ToolPreview.vue"
HL = "test_tool_have_library.py::TestHaveLibrary::"
RV = "test_tool_store.py::TestOneRevisionPerFileState::"


def py(node):
    return ("pytest", [node, node.rsplit("::", 1)[1]])


def vt(module, name, at=None):
    return ("vitest", [f"src/{module}.test.ts", re.escape(name), at or name])


def pw(spec, grep, at):
    return ("pw", [f"e2e/{spec}.spec.ts", grep, at])


def st(n): return vt("toolTableStore", n)
def fo(n): return vt("toolForm", n)
def dr(n): return vt("toolDrawing", n)
def re_(n): return vt("toolShapeRecord", n)
def ca(n): return vt("toolShapeCache", n)


MUTS = {
    # ---- step 0: the revision once per file state (gateway) -------------------
    "the_revision_per_read": (TSTORE, [("            if memo is None or memo[0] is not section:", "            if True:")],
        [py(RV + "test_many_reads_of_one_state_compute_it_once"), py(HL + "test_one_revision_per_file_state_through_the_command")]),
    "the_revision_of_the_first_state_kept": (TSTORE, [("            if memo is None or memo[0] is not section:", "            if memo is None:")],
        [py(RV + "test_a_same_size_rewrite_is_a_new_state"), py(RV + "test_another_ini_is_another_section"),
         py(HL + "test_another_revision_is_full")]),
    # ---- have_library (gateway) -------------------------------------------------
    "same_leaves_out_every_list": (GW, [("            for name in FORM_PAYLOAD_FIELDS:\n                row.pop(name, None)",
                                         "            for name in [k for k, v in row.items() if isinstance(v, list)]:\n                row.pop(name, None)")],
        [py(HL + "test_same_leaves_out_exactly_the_payload")]),
    "same_leaves_out_the_description": (TTABLE, [('                       "source_metadata")\n\n\ndef tool_visual', '                       "source_metadata", "description")\n\n\ndef tool_visual')],
        [py(HL + "test_the_names_are_the_form_payload"), py(HL + "test_a_changed_remark_still_changes_the_description"),
         fo("are the gateway's form payload")]),
    "same_for_any_revision_named": (GW, [("    same = have_library == lib_rev\n", "    same = bool(have_library)\n")],
        [py(HL + "test_another_revision_is_full"), py(HL + "test_what_is_no_revision_is_full")]),
    "the_field_is_not_read": (GW, [('_read_tool_files(tbl_path, msg.get("have_library"))', "_read_tool_files(tbl_path)")],
        [py(HL + "test_same_leaves_out_exactly_the_payload")]),
    "the_library_itself_is_stripped": (GW, [("    merged = _merge_tool_data(rows, library)\n    same = have_library == lib_rev\n    if same:\n        for row in merged:",
                                             "    merged = _merge_tool_data(rows, library)\n    same = have_library == lib_rev\n    if same:\n        for row in [*merged, *library.values()]:")],
        [py(HL + "test_the_library_itself_is_untouched")]),
    # ---- one reader, two outputs (toolTableStore.ts) ------------------------------
    "the_last_good_view_kept_as_current": (STORE, [("    this.set({ reading: false, view, table, error:", "    this.set({ reading: false, view: view.kind === \"failed\" ? this.cur.view ?? view : view, table, error:")],
        [st("a good read shows its rows and is the evidence; a failed one after it shows none and leaves the evidence")]),
    "a_failed_read_names_its_table": (STORE, [('view.kind !== "failed" && isIdentity(reply.table)', "isIdentity(reply?.table ?? this.cur.table)"),
                                              ("{ path: reply.table.path, instance: reply.table.instance }", "{ ...(reply?.table ?? this.cur.table) }")],
        [st("a good read shows its rows and is the evidence; a failed one after it shows none and leaves the evidence")]),
    "the_evidence_written_by_a_failed_read": (STORE, [('    if (view.kind !== "failed") {', "    {"), ("        missing: Array.isArray(reply.proof?.missing) ? reply.proof.missing : [],", "        missing: [],"),
                                                      ("      if (reply.library?.state !== \"same\")", "      if (reply?.library?.state !== \"same\")"),
                                                      ("    const rev = reply.library?.rev ?? reply.rev?.library,", "    const rev = reply?.library?.rev ?? reply?.rev?.library,")],
        [st("a good read shows its rows and is the evidence; a failed one after it shows none and leaves the evidence")]),
    "a_superseded_reply_applies": (STORE, [("        if (!this.reads.applies(ticket)) return;\n", "")],
        [st("a superseded read changes neither; an old connection's reply neither")]),
    "a_close_keeps_the_evidence": (STORE, [("    this.endJob();\n    this.record.clear();\n    this.set({ open: false,", "    this.endJob();\n    this.set({ open: false,")],
        [st("a closed connection clears the read and the evidence, and keeps the forms of a settled library")]),
    "a_close_drops_the_library": (STORE, [("    this.endJob();\n    this.record.clear();\n    this.set({ open: false,", "    this.endJob();\n    this.library = null;\n    this.record.clear();\n    this.set({ open: false,")],
        [st("a closed connection clears the read and the evidence, and keeps the forms of a settled library"),
         st("a reconnect keeps the library and asks with it; the evidence is proven anew")]),
    "a_panel_imports_the_evidence": (PANEL, [('import { formMeta, formNotice,', 'import { PAIR_EPS } from "./toolShapeRecord";\nvoid PAIR_EPS;\nimport { formMeta, formNotice,')],
        [st("the Tools tab, the strip and the dialogs never import the evidence")]),
    "an_unchecked_read_proves_its_rows": (STORE, [('proven: view.kind === "complete" || view.kind === "partial" ? view.proven : null,', 'proven: new Set(rows.map(r => r.T)),')],
        [st("a `partial` or `unchecked` read shows its rows with its note, and proves what rule R proved")]),
    # ---- have_library (page) ----------------------------------------------------------
    "an_unresolved_same_is_delivered": (STORE, [('        const unresolved = reply?.ok && reply.library?.state === "same" && !this.resolves(reply);', "        const unresolved = false;")],
        [st("a same of another table: nothing of it is delivered"), st("a same of a tool the full reply had not: nothing of it is delivered"),
         st("a same nobody asked for is a failed read")]),
    "same_over_another_table": (STORE, [("t.path === b.path && ", "")], [st("a same of another table: nothing of it is delivered")]),
    "same_over_another_linuxcnc": (STORE, [("t.instance === b.instance && ", "")], [st("a same of another LinuxCNC: nothing of it is delivered")]),
    "same_over_another_revision": (STORE, [("reply.library.rev === b.rev && ", "")], [st("a same of another revision: nothing of it is delivered")]),
    "same_with_two_revisions": (STORE, [("&& reply.rev?.library === b.rev\n", "\n")], [st("a same of two revisions in one reply: nothing of it is delivered")]),
    "same_over_another_unit": (STORE, [("&& this.deps.units() === b.units\n", "\n")], [st("another unit while the read is out: the same is not used")]),
    "a_missing_tool_filled_from_nothing": (STORE, [("reply.tools.every((r: any) => this.library!.has(r?.T))", "true")],
        [st("a same of a tool the full reply had not: nothing of it is delivered")]),
    "an_omitted_library_read_as_empty": (STORE, [("if (!have) { this.apply({ ok: false, error: NO_FORMS }); return; }", "if (!have) { this.apply(reply); return; }")],
        [st("a same nobody asked for is a failed read")]),
    "an_unsettled_library_is_named": (STORE, [("l?.binding && l.settled && l.binding.units", "l?.binding && l.binding.units")],
        [st("is named once the library is settled, in the units it was made in")]),
    "named_in_other_units": (STORE, [("l.settled && l.binding.units === this.deps.units() ? l.binding.rev", "l.settled ? l.binding.rev")],
        [st("is named once the library is settled, in the units it was made in")]),
    "the_same_content_made_again": (STORE, [("        && raw.every(r => this.library!.has(r.T as number))) return;", "        && false) return;")],
        [st("the same revision sent in full again keeps its records")]),
    "nothing_made_at_the_reply": (STORE, [("this.deps.inlineMs ?? FORM_SLICE_MS);\n    try", "0);\n    try")],
        [st("an ordinary library is made with its rows: no consumer sees a pending form, no second draw for it")]),
    "an_older_job_runs_on": (STORE, [("    this.job.cancel();\n", "")],
        [st("several libraries while one is being normalised: the older ones are dropped, one is reachable"),
         st("a close ends the normaliser and drops what it had not made")]),
    "a_fault_keeps_its_library": (STORE, [("      if (this.library === lib) this.dropLibrary();\n", "")],
        [st("a fault of the page in the job is traced and drops the library")]),
    # ---- the form library (toolLibrary.ts) ------------------------------------------------
    "the_payload_stays_in_the_rows": (LIB, [("      for (const k of FORM_PAYLOAD_FIELDS) delete row[k];\n", "")],
        [fo("takes the payload out of the rows it is given and keeps none of it")]),
    "a_made_tool_keeps_its_lists": (LIB, [("      this.todo[i] = null;\n", "")],
        [fo("makes them in ascending T, releasing each tool's lists with its record")]),
    "made_in_the_reply_s_order": (LIB, [("[...byT.values()].sort((a, b) => a.T - b.T)", "[...byT.values()]")],
        [fo("makes them in ascending T, releasing each tool's lists with its record")]),
    "the_library_is_not_summed": (LIB, [("      this.taken += rec.bytes;\n", "")], [fo("Codex's library: a mesh that fits by its payload but not with its record"), fo("at the edge: a record that fills the library exactly is kept")]),
    "a_dropped_library_keeps_its_lists": (LIB, [("  drop(): void { this.todo = []; }", "  drop(): void { }")],
        [fo("drops what is not made yet, and is then not settled")]),
    # ---- a form, and its refusal (toolForm.ts) ----------------------------------------------
    "a_refusal_read_as_none": (FORM, [('record({ kind: "refused", refused:', 'record({ kind: "none", refused:')],
        [fo("a native profile of 4096 points"), fo("a text that is no decimal number")]),
    "a_refused_form_draws_the_other_fields": (FORM, [('  if (form === "pending" || r?.kind === "refused") {', '  if (form === "pending") {')],
        [fo("a native profile of 4096 points")]),
    "mesh_vertices_unbounded": (FORM, [('      if (nv > MESH_VERTICES_MAX) return refuse(TOO_DETAILED, "native_mesh vertices", nv);\n', "")],
        [fo("sizes are judged by their lengths: no element of an oversized list is read")]),
    "mesh_triangles_unbounded": (FORM, [('      if (nt > MESH_TRIANGLES_MAX) return refuse(TOO_DETAILED, "native_mesh triangles", nt);\n', "")],
        [fo("sizes are judged by their lengths: no element of an oversized list is read")]),
    "profile_points_unbounded": (FORM, [('      if (n > PROFILE_POINTS_MAX) return refuse(TOO_DETAILED, "native_profile", n);\n', "")],
        [fo("one point past its bound"), fo("sizes are judged by their lengths: no element of an oversized list is read")]),
    "a_profile_s_columns_unbounded": (FORM, [('      if (v > LATHE_VERTICES_MAX) return refuse(TOO_DETAILED, "native_profile vertices", v);\n', "")],
        [fo("a profile whose columns pass the vertices")]),
    "a_form_mill_s_points_unbounded": (FORM, [('      if (points > PROFILE_POINTS_MAX) return refuse(TOO_DETAILED, "profile points", points);\n', "")],
        [fo("a form mill's arc points")]),
    # ---- Codex R492 MT-I48: every record whole, the rows to come reserved ----------------------
    "the_room_is_not_asked": (FORM, [('      if (!fits(12 * nv + 12 * nt)) return refuse(TOO_DETAILED, "library", nt);\n', "")],
        [fo("Codex's library: a mesh that fits by its payload but not with its record")]),
    "the_payload_alone_is_budgeted": (FORM, [("  const fits = (shape: number) => { if (base + shape > room) return false;", "  const fits = (shape: number) => { if (shape > room) return false;")],
        [fo("at the edge: a record that fills the library exactly is kept")]),
    "the_rows_to_come_not_reserved": (LIB, [("      const room = LIBRARY_BYTES_MAX - this.taken - t.rest;", "      const room = LIBRARY_BYTES_MAX - this.taken;")],
        [fo("at the edge: a record that fills the library exactly is kept"), fo("a shank, a holder or a plain form after a full library")]),
    "the_holder_not_budgeted": (FORM, [("    if (holder && base + shape + holder.byteLength > room) { holder = null; holderWhy = HOLDER_TOO_DETAILED; }", "    void shape;")],
        [fo("at the edge: a record that fills the library exactly is kept"), fo("a shank, a holder or a plain form after a full library")]),
    "a_shank_never_asks": (FORM, [('      if (!fits(24 * n)) return refuse(TOO_DETAILED, "library", n);\n', "")],
        [fo("a shank, a holder or a plain form after a full library")]),
    "no_shared_refusal": (LIB, [("    if (bases.reduce((n, b) => n + b, 0) > LIBRARY_BYTES_MAX) {", "    if (false) {")],
        [fo("more rows than any table: the bases that fit, the rest ONE shared refusal counted once")]),
    "the_shared_refusal_counted_per_row": (LIB, [("    if (own < all.length) this.taken = RECORD_BYTES;", "    this.taken = (all.length - own) * RECORD_BYTES;")],
        [fo("more rows than any table: the bases that fit, the rest ONE shared refusal counted once")]),
    "the_shared_record_booked_twice": (LIB, [("    let rest = 0;\n", "    let rest = own < all.length ? RECORD_BYTES : 0;\n")],
        [fo("65 537 rows without a note: the library holds exactly 64 MiB"), fo("21 846 rows with notes of 1 024 characters"),
         st("settles: no fault, the shared refusal shown")]),
    # ---- Codex R494 MT-I51: every nested number a raw drawing path reads ------------------------
    "a_shank_s_text_coerced": (GEO, [("  if (Array.isArray(m.shaft_segments) && m.shaft_segments.some(texts))", "  if (false)")],
        [dr("a nested number as text: the strict decimal draws as its number")]),
    "a_form_mill_s_text_coerced": (GEO, [("  if (Array.isArray(m.profile) && m.profile.some(texts)) {", "  if (false) {")],
        [dr("a nested number as text: the strict decimal draws as its number")]),
    "a_holder_s_text_refuses_the_shape": (GEO, [('      set("holder_segments", null);                                      // the holder alone', "      throw e;")],
        [dr("a nested number as text: the strict decimal draws as its number")]),
    "a_native_point_coerced": (GEO, [('    if (typeof r !== "number" || typeof z !== "number") throw new ShapeNotUsable("a profile point");\n', "")],
        [dr("a nested number as text: the strict decimal draws as its number")]),
    # ---- Codex R492 Q1: a number as strict decimal text ------------------------------------------
    "parse_float": (DRAW, [('  if (typeof v === "string" && v.length <= DECIMAL_TEXT_MAX && DECIMAL.test(v)) return Number(v);', '  if (typeof v === "string") return parseFloat(v);')],
        [fo("a number given as decimal text is that number")]),
    "text_is_no_number": (DRAW, [('  if (typeof v === "string" && v.length <= DECIMAL_TEXT_MAX && DECIMAL.test(v)) return Number(v);\n', "")],
        [fo("a number given as decimal text is that number")]),
    "any_length": (DRAW, [("v.length <= DECIMAL_TEXT_MAX && DECIMAL.test(v)", "DECIMAL.test(v)")], [fo("a number given as decimal text is that number")]),
    "the_live_meta_coerced": (GEO, [("  const meta = rawMeta && numericMeta(rawMeta);", "  const meta = rawMeta;")], [fo("a number given as decimal text is that number")]),
    "the_preview_s_words_from_text": (FORM, [("  return { ...fields, ...numbers, native_mesh", "  return { ...fields, native_mesh")], [fo("a number given as decimal text is that number")]),
    "segments_numbers_only": (FORM, [("    const t = [s?.[a], s?.[b], s?.[c]].map(libraryNumber);", '    const t = [s?.[a], s?.[b], s?.[c]].map(x => (typeof x === "number" ? x : NaN));')],
        [fo("a number given as decimal text is that number")]),
    "a_holder_float32_cannot_hold": (FORM, [("every(x => Number.isFinite(Math.fround(x)))", "every(x => Number.isFinite(x))")],
        [fo("the holder is refused on its own, with its own words")]),
    "an_oversized_holder_kept": (FORM, [("    if (n !== null && n > HOLDER_SEGMENTS_MAX) holderWhy = HOLDER_TOO_DETAILED;\n    else if", "    if")],
        [fo("the holder is refused on its own, with its own words")]),
    "a_word_is_no_form": (FORM, [("SHAPE_WORDS.some(k => s[k] !== null) || ", "")], [fo("a row that names no shape is a proven none; a word or a number is a form")]),
    "a_record_can_be_written": (FORM, [("    return Object.freeze({ mesh: null,", "    return ({ mesh: null,")], [fo("is frozen, and counts its arrays")]),
    "the_note_is_not_counted": (FORM, [('  return RECORD_BYTES + (typeof note === "string" ? 2 * Math.min(note.length, GEOMETRY_NOTE_MAX + 1) : 0);', "  return RECORD_BYTES;")],
        [fo("is frozen, and counts its arrays")]),
    "a_note_in_full": (FORM, [('out.geometry_note = note.slice(0, GEOMETRY_NOTE_MAX) + "…";', "out.geometry_note = note;")],
        [fo("a row keeps every other field of the reply, in a new object; the note is cut")]),
    "fewer_points_predicted_than_made": (FORM, [('    case "ball": return 8 + shaft + 14;', '    case "ball": return 8;')],
        [fo("predicted is never less than made")]),
    "a_null_coordinate_is_0": (DRAW, [('x = typeof raw === "number" ? Math.fround(raw) : NaN;', "x = Math.fround(raw as number);")], [fo("a null coordinate")]),
    # ---- the canonical drawing (toolDrawing.ts) -----------------------------------------------
    "a_rotation_matrix": (DRAW, [("      positions[o + 1] = -(r * cos);\n", "      positions[o + 1] = prof[2 * j + 1]! * Math.cos(Math.PI / 2) - r * cos;\n")],
        [dr("equals LatheGeometry + the swap, value for value"), dr("draws the profile's own z and a radius within the f32 of x and y")]),
    "the_last_normal_normalised": (DRAW, [("mn[2 * j] = px; mn[2 * j + 1] = py; break;", "const l = 1 / (Math.sqrt(px * px + py * py) || 1); mn[2 * j] = px * l; mn[2 * j + 1] = py * l; break;")],
        [dr("equals LatheGeometry + the swap, value for value")]),
    "the_normals_not_turned": (DRAW, [("      normals[o + 1] = -(nx * cos);\n", "      normals[o + 1] = nx * cos;\n")], [dr("equals LatheGeometry + the swap, value for value")]),
    "a_second_path_for_the_holder": (GEO, [("  return pts && buildToolGeometry(pts, latheSegments);", "  return pts && new THREE.LatheGeometry(pts, latheSegments).rotateX(Math.PI / 2);")],
        [dr("a holder and a plain outline take the same path")]),
    "the_budget_asked_after": (DRAW, [("  if (c.n + k <= DRAW_BUDGET) {", "  if (c.n <= DRAW_BUDGET) {")],
        [dr("a mesh: at most the budget between two yields"), dr("600 points at 512: the arrays themselves fill")]),
    "a_vertex_not_counted": (DRAW, [("      if (spent(c, 1)) yield;                // a vertex; a column goes over steps\n", "")],
        [dr("600 points at 512: the arrays themselves fill"), dr("4097 points at 24: the arrays themselves fill")]),
    "the_index_not_counted": (DRAW, [("      if (spent(c, 6)) yield;                // six index entries\n", "")],
        [dr("600 points at 512: the arrays themselves fill"), dr("2000 points at 199: the arrays themselves fill")]),
    "a_column_at_once": (DRAW, [("      if (spent(c, 1)) yield;                // a vertex; a column goes over steps\n", "      if (j === 0 && spent(c, np)) yield;\n")],
        [dr("4097 points at 24: the arrays themselves fill")]),
    "a_quad_costs_one": (DRAW, [("      if (spent(c, 6)) yield; ", "      if (spent(c, 1)) yield; ")], [dr("600 points at 512: the arrays themselves fill")]),
    "a_triangle_costs_one": (DRAW, [("    if (spent(c, 24)) yield;", "    if (spent(c, 1)) yield;")], [dr("a mesh: at most the budget between two yields")]),
    "parts_judged_one_by_one": (DRAW, [(": drawingVertices(d) <= LATHE_VERTICES_MAX;", ": d.parts.every(p => latheSize(p.prof.length / 2, p.segments).v <= LATHE_VERTICES_MAX);")],
        [dr("is admitted up to 400 000 vertices over ALL parts, at most 19.2 MB")]),
    "a_seam_not_counted": (DRAW, [("({ v: (segments + 1) * points,", "({ v: segments * points,")],
        [dr("cutter and shaft count together, each with its seam column")]),
    "the_bound_of_14_4_MB": (DRAW, [("export const LATHE_VERTICES_MAX = 400_000;", "export const LATHE_VERTICES_MAX = 300_000;")],
        [dr("Codex's admissible lathe: 14 747 712 bytes"), dr("is admitted up to 400 000 vertices over ALL parts, at most 19.2 MB")]),
    "always_a_32_bit_index": (DRAW, [("made(v > 65535 ? new Uint32Array(i) : new Uint16Array(i))", "made(new Uint32Array(i))")],
        [dr("cutter and shaft count together, each with its seam column")]),
    "uvs_back": (GEO, [("export function partGeometry(", "const uvs = (p: DrawnPart, g: THREE.BufferGeometry) => { g.setAttribute(\"uv\", new THREE.BufferAttribute(new Float32Array(p.positions.length / 3 * 2), 2)); return g; };\nexport function partGeometry(p: DrawnPart) { return uvs(p, _partGeometry(p)); }\nfunction _partGeometry(")],
        [ca("is built once a key, shared, and its geometry is the drawing's own"), dr("the bytes a drawing is said to take are the bytes it has")]),
    "a_buffer_kept_beside_the_target": (DRAW, [("  const positions = made(new Float32Array(3 * v));\n  yield;\n", "  const positions = made(new Float32Array(3 * v)), beside = made(new Float32Array(3 * v));\n  void beside;\n  yield;\n")],
        [dr("Codex's admissible lathe: 14 747 712 bytes")]),
    "a_negative_radius_is_drawn": (DRAW, [("    if (!(Number.isFinite(r) && Number.isFinite(z) && r >= 0)) throw new ShapeNotUsable(\"a profile point\");\n    out[2 * i] = r;", "    if (!(Number.isFinite(r) && Number.isFinite(z))) throw new ShapeNotUsable(\"a profile point\");\n    out[2 * i] = r;")],
        [dr("what float32 cannot hold is a named fault, when it is built")]),
    "a_bad_index_is_drawn": (DRAW, [("      if (!(Number.isInteger(k) && k >= 0 && k < nV)) throw new ShapeNotUsable(\"a mesh index\");\n", "")],
        [dr("what float32 cannot hold is a named fault, when it is built")]),
    "an_infinite_coordinate_is_drawn": (DRAW, [("      if (!Number.isFinite(x)) throw new ShapeNotUsable(\"a mesh coordinate\");\n", "")],
        [dr("what float32 cannot hold is a named fault, when it is built"), dr("what is shown of it is the table's cylinder, named")]),
    "no_cylinder_for_a_faulty_shape": (GEO, [("  for (const m of meta ? [meta, null] : [null]) {", "  for (const m of [meta]) {")],
        [dr("what is shown of it is the table's cylinder, named")]),
    # ---- what pairs (toolShapeRecord.ts) -------------------------------------------------------
    "paired_by_the_diameter_alone": (REC, [(" && Math.abs(x.Z - row.Z) <= PAIR_EPS", "")], [re_("D and Z both, within the drift's 1e-4")]),
    "paired_exactly": (REC, [("export const PAIR_EPS = 1e-4;", "export const PAIR_EPS = 0;")], [re_("D and Z both, within the drift's 1e-4")]),
    "paired_by_magnitude": (REC, [("Math.abs(x.Z - row.Z)", "Math.abs(Math.abs(x.Z) - Math.abs(row.Z))")], [re_("Z with its sign: no magnitude, no stub diameter")]),
    "an_unproven_row_is_evidence": (REC, [("!(row.T > 0) || !r.proven.has(row.T) ||", "!(row.T > 0) ||")], [re_("an unproven row is no evidence")]),
    "T0_is_a_tool": (REC, [("    if (!(row.T > 0)) return null;\n", "")], [re_("T 0 and none are no tool; a row with no finite value is no evidence")]),
    "no_library_shape_before_a_read": (REC, [("    if (!this.bound || !this.lib) return table(SHAPE_NOT_READ);", "    if (!this.bound || !this.lib) return table(NO_LIBRARY_SHAPE, false);")],
        [re_("before the first read, and while a form is being made: not read, and it warns"), re_("a reply without a library (or a table, or a revision) leaves nothing to pair by")]),
    "no_record_is_not_confirmed": (REC, [('    if (form === "pending" || form === null) return table(SHAPE_NOT_READ);', '    if (form === "pending") return table(SHAPE_NOT_READ);\n    if (form === null) return table(ROW_NOT_CONFIRMED);')],
        [re_("a tool with no record of the library: not read")]),
    "a_pending_form_is_no_shape": (REC, [('    if (form === "pending" || form === null) return table(SHAPE_NOT_READ);', '    if (form === "pending") return table(NO_LIBRARY_SHAPE, false);\n    if (form === null) return table(SHAPE_NOT_READ);')],
        [re_("before the first read, and while a form is being made: not read, and it warns")]),
    "a_proven_absence_warns": (REC, [("return table(NO_LIBRARY_SHAPE, false);", "return table(NO_LIBRARY_SHAPE);")], [re_("no library shape only when the absence is proven")]),
    "a_refused_form_is_no_shape": (REC, [("    if (form.refused) return table(form.refused.why);", "    if (form.refused) return table(NO_LIBRARY_SHAPE, false);")],
        [re_("a refused form is what it is, never 'no library shape'")]),
    "another_binding_keeps_the_rows": (REC, [("    if (!r.binding || !sameBinding(this.bound, r.binding)) this.clear();\n", "    if (!r.binding) this.clear();\n")],
        [re_("instance"), re_("units")]),
    "keys_are_never_freed": (REC, [("if (!keep.has(T)) this.seen.delete(T);", "void keep;")], [re_("five tables with other tools")]),
    "a_missing_tool_is_freed": (REC, [("...r.rows.map(x => x.T), ...r.missing, ...needed", "...r.rows.map(x => x.T), ...needed")], [re_("five tables with other tools")]),
    "a_needed_tool_is_freed": (REC, [("...r.missing, ...needed]", "...r.missing]")], [re_("five tables with other tools")]),
    "a_ninth_row": (REC, [("export const SEEN_MAX = 8;", "export const SEEN_MAX = 9;")], [re_("the newest eight, exact values, newest proof first")]),
    "near_rows_merged": (REC, [("was.filter(x => x.D !== row.D || x.Z !== row.Z)", "was.filter(x => Math.abs(x.D - row.D) > PAIR_EPS || Math.abs(x.Z - row.Z) > PAIR_EPS)")],
        [re_("near values are not merged: a chain never drifts")]),
    "an_unchecked_reply_frees": (REC, [("    if (!r.binding || r.proven === null) return;\n", "    if (!r.binding) return;\n    r = { ...r, proven: r.proven ?? new Set() };\n"),
                                       ("this.lastProven = new Set(r.proven);", "this.lastProven = new Set(r.proven!);"), ("!r.proven.has(row.T)", "!r.proven!.has(row.T)")],
        [re_("partial frees by the same rule; an unchecked reply neither adds nor frees")]),
    "the_publication_s_decision_is_shown": (REC, [("  return shown ? of(shown) : of(prospective);", "  return of(prospective) ?? of(shown);")],
        [re_("the visible decision is the shown check's; without one the publication's own")]),
    "a_shown_check_s_gap_filled_from_the_publication": (REC, [("  return shown ? of(shown) : of(prospective);", "  return of(shown) ?? of(prospective);")],
        [re_("the visible decision is the shown check's; without one the publication's own")]),
    "a_lost_connection_un_pairs": (REC, [("return now.binding === null && was ? was : now;", "return now;")], [re_("a publication's own decisions are refined")]),
    "a_thinner_read_un_pairs": (REC, [("    a && a.body !== \"table\" && b?.body === \"table\" ? a : b;", "    (void a, b);")], [re_("a publication's own decisions are refined")]),
    "not_read_is_a_change": (REC, [('  if (now.state === "not-read") return true; ', '  if (now.state === "not-read") return false; ')], [re_("not read is no statement: nothing changed")]),
    "a_known_unit_change_ignored": (REC, [("    if (now.units != null && now.units !== b.units) return false;\n", "")], [re_("a KNOWN change of units, table or instance ends it without any read")]),
    "a_known_instance_change_ignored": (REC, [("    if (now.instance != null && now.instance !== b.instance) return false;\n", "")], [re_("a KNOWN change of units, table or instance ends it without any read")]),
    "an_evicted_row_is_a_change": (REC, [('return !(a.body === "table" && l.body !== "table");', "return a.body === l.body;")], [re_("the same library: only a tool that could not be paired and now can")]),
    "another_library_by_its_kind": (REC, [("return a.body === l.body && sameBody(a, l);", "return a.body === l.body;")], [re_("another library: by the bodies' exact numbers")]),
    # ---- the cache (toolShapeCache.ts) ------------------------------------------------------------
    "membership_as_the_condition": (CACHE, [("    if (!e.alive || e.token !== token) {", "    if (!e.inMap) {")],
        [ca("is a private entry: it COMPLETES, is disposed at its release, and evicts no owner")]),
    "a_released_private_entry_lives": (CACHE, [("        if (!e.inMap) this.end(e); else this.trim();", "        if (e.inMap) this.trim();")],
        [ca("released before it is done: its late result is published nowhere")]),
    "a_late_result_is_inserted": (CACHE, [("    if (!e.alive || e.token !== token) { this.drop(shape); return; }\n", "    if (e.token !== token) { this.drop(shape); return; }\n")],
        [ca("of an ended scene is not published"), ca("of another binding is not published")]),
    "an_owned_entry_evicted": (CACHE, [('if (!e.owners && e.state !== "building" && (!best', 'if (e.state !== "building" && (!best')],
        [ca("is never evicted while owned; released it is the first to go, disposed once")]),
    "released_twice": (CACHE, [("        if (!held) return;\n        held = false;\n", "")], [ca("is never evicted while owned; released it is the first to go, disposed once")]),
    "an_estimate_for_the_buffers": (CACHE, [("    e.bytes = shape ? buffersOf([shape.cutter, shape.shaft]) : 0;", "    e.bytes = shape ? 1_000_000 : 0;")],
        [ca("what idle entries hold, exactly"), ca("Codex's 600-point lathe is drawn: 14 747 712 bytes counted")]),
    "a_shared_buffer_twice": (CACHE, [("      if (seen.has(a.array.buffer)) continue;\n", "")], [ca("counts every attribute and the index, a shared ArrayBuffer once")]),
    "the_index_not_in_the_bytes": (CACHE, [("...(g.index ? [g.index] : [])", "")], [ca("counts every attribute and the index, a shared ArrayBuffer once")]),
    "dispose_taken_for_freeing": (CACHE, [("    e.shape = null;\n    e.source = null;\n    e.bytes = 0;", "    e.source = null;\n    e.bytes = 0;")],
        [ca("a finished drawing that is let go: its arrays go too, with the handle still held")]),
    "an_ended_entry_s_job_runs_on": (CACHE, [("      r.run?.cancel();\n", "      void r;\n")],
        [ca("a build in hand when the scene ended: its arrays are collected"), ca("a build in hand when its last owner released it (a private one): its arrays are collected")]),
    "idle_drawings_unbounded": (CACHE, [("    while (this.idleBytes > IDLE_BYTES_MAX) {", "    while (false) {")], [ca("keeps 64 MB of idle drawings, the least recently used out first")]),
    "the_points_asked_after": (CACHE, [('  if (s.form.kind !== "mesh" && predictedProfilePoints(s.form, s.diam, s.len, s.units) > PROFILE_POINTS_MAX) return { why: TOO_DETAILED };\n', "")],
        [ca("the points are asked before the profile is built")]),
    "the_vertices_not_asked": (CACHE, [("    if (!drawingAdmitted(d)) return { why: TOO_DETAILED };\n", "")], [ca("a refused form, more points or more vertices than the bounds, a coordinate float32 cannot hold")]),
    "a_warm_one_before_the_one_asked_for": (CACHE, [("    if (front) this.queue.unshift(e); else this.queue.push(e);", "    this.queue.push(e);")], [ca("one job at a time, the one just asked for before the warm ones")]),
    # ---- Codex R492 MT-I49: every live entry at a binding change -----------------------------------
    "retain_walks_the_map_only": (CACHE, [("    for (const [e, k] of [...this.keys]) {", "    for (const [e, k] of [...this.keys].filter(([x]) => x.inMap)) {")],
        [ca("a private build running when the binding changes ends"), ca("a private build waiting behind another when the binding changes ends"),
         ca("a build in hand when the binding changed (a private one")]),
    "a_finished_private_drawing_ends_at_once": (CACHE, [('      if (!e.owners || e.state === "building") this.end(e);', "      this.end(e);")],
        [ca("a private drawing still visible is kept and finishes; a finished one not visible lives until its release")]),
    "a_held_drawing_ends_with_the_binding": (CACHE, [('      if (!e.owners || e.state === "building") this.end(e);', "      this.end(e);")], [ca("what no visible decision names goes at once, a held drawing with its last owner")]),
    # ---- the page -------------------------------------------------------------------------------------
    "two_reads_a_ping": (TABLE, [("    watch(toolTableVersion, () => { void toolTableStore.read(); });", "    watch(toolTableVersion, () => { void toolTableStore.read(); void toolTableStore.read(); });")],
        [pw("tool-forms", "one read a ping", "one read a ping")]),
    "the_page_names_no_revision": (TABLE, [("...(have ? { have_library: have } : {})", "...(have && false ? { have_library: have } : {})")], [pw("tool-forms", "one read a ping", "one read a ping")]),
    "a_refused_row_says_nothing": (PANEL, [("  const short = formNotice(form) ?? (toolPreviewNotice(", "  const short = (toolPreviewNotice(")], [pw("tool-forms", "a shape above the bounds", "a shape above the bounds")]),
    "a_holder_s_refusal_is_not_said": (PANEL, [("holder = holderNotice(form);", "holder = null;")], [pw("tool-forms", "a shape above the bounds", "a shape above the bounds")]),
    "an_undrawn_shape_is_not_said": (PREVIEW, [('  emit("drawn", why === null);\n', "")], [pw("tool-forms", "a shape that cannot be drawn", "a shape that cannot be drawn")]),
    "a_library_shape_shown_before_its_check": (VIEWER, [("      ? (getToolMeta(scrubTool) ?? null) : (st.tool_meta ?? null);", "      ? (getToolMeta(scrubTool) ?? libraryMeta(scrubTool)) : (st.tool_meta ?? null);"),
                                                        ('import { drawableToolGeometries, type ToolMeta } from "./toolGeometry";', 'import { drawableToolGeometries, type ToolMeta } from "./toolGeometry";\nimport { toolForm } from "./toolTable";\nimport { formMeta } from "./toolForm";\nconst libraryMeta = (T: number): ToolMeta | null => { const f = toolForm(T); return f && f !== "pending" ? formMeta(f.scalars, f) as ToolMeta : null; };')],
        [pw("tool-shape-sim.viewer", "a tool never loaded", "a tool never loaded")]),
    "a_body_beside_the_pin": (VIEWER, [("    if (d.known) out[ev.tool] = _toolVisual(d.diam, d.len);", "    if (d.known) out[ev.tool] = { ..._toolVisual(d.diam, d.len), hull: [1] } as any;")],
        [pw("tool-shape-sim.viewer", "a tool never loaded", "a tool never loaded")]),
    "the_session_s_shape_is_gone": (VIEWER, [("      ? (getToolMeta(scrubTool) ?? null) : (st.tool_meta ?? null);", "      ? null : (st.tool_meta ?? null);"),
                                             ("        _lastToolMeta = getToolMeta(toolNum) ?? null;", "        _lastToolMeta = null;")],
        [pw("tool-shape-sim.viewer", "control: the same tool loaded once", "control: the same tool loaded once")]),
}


def failures(text):
    lines = text.splitlines()
    return [" | ".join(x.strip() for x in lines[i:i + 3] if x.strip())[:300]
            for i, ln in enumerate(lines) if "AssertionError" in ln or "FAIL" in ln or "Error:" in ln]


def build():
    """`npm run build`'s second step, by the binary (a mutation need not type-check)."""
    r = subprocess.run([BIN + "vite", "build"], cwd=ROOT / "lcnc-webui", capture_output=True, text=True, timeout=900, env=ENV)
    return r


def run_guard(kind, args):
    if kind == "pytest":
        r = subprocess.run([str(ROOT / "lcnc-gateway/.venv/bin/python3"), "-m", "pytest", "-q", "-p", "no:cacheprovider",
                            "-o", "addopts=", args[0]], cwd=ROOT / "lcnc-gateway", capture_output=True, text=True,
                           # no bytecode: a .pyc is valid by mtime SECOND and size (2026-11-25)
                           timeout=900, env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"})
        return r.returncode != 0, r.stdout + r.stderr, args[1]
    if kind == "vitest":
        r = subprocess.run([BIN + "vitest", "run", args[0], "-t", args[1]], cwd=ROOT / "lcnc-webui",
                           capture_output=True, text=True, timeout=900, env=ENV)
        out = r.stdout + r.stderr
        # a guard that ran nothing proves nothing
        return r.returncode != 0 and " failed" in out, out, args[2]
    if kind == "pw":
        b = build()
        if b.returncode != 0:
            return False, b.stdout + b.stderr, args[2]
        # never under a timeout: a killed runner orphans its web server (4173)
        r = subprocess.run([BIN + "playwright", "test", args[0], "-g", args[1], "--workers=1", "--reporter=list"],
                           cwd=ROOT / "lcnc-webui", capture_output=True, text=True, env=ENV)
        return r.returncode != 0, r.stdout + r.stderr, args[2]
    raise SystemExit(f"unknown guard kind {kind}")


def passed(kind, out):
    """A guard that ran nothing proves nothing: its control says how many ran."""
    out = re.sub(r"\x1b\[[0-9;]*m", "", out)
    return re.search(r"Tests\s.*[1-9]\d* passed" if kind == "vitest" else r"\b[1-9]\d* passed", out) is not None


def stop_asked():
    flag = os.environ.get("LCNC_STOP_FLAG")
    return bool(flag) and os.path.exists(flag)


def control(names, only):
    """Every guard of `names` once on the tree as it is: green, and it ran."""
    guards = {(k, *a): (k, a) for n in names for k, a in MUTS[n][2] if only is None or k == only}
    bad = []
    for k, a in guards.values():
        if stop_asked():
            print(json.dumps({"stopped_before": "the control's end", "done": 0, "why": "stop flag"}), flush=True)
            raise SystemExit(75)
        red, out, _at = run_guard(k, a)
        if red or not passed(k, out):
            bad.append([k, *a, failures(out)[:2]])
    print(json.dumps({"control": "every guard green on the unmutated tree, and it ran", "guards": len(guards), "not": bad}), flush=True)
    if bad:
        raise SystemExit("a guard is not green on the unmutated tree")


KINDS = {"py": "pytest", "vt": "vitest", "pw": "pw"}


def main(argv):
    only = KINDS[argv[argv.index("--kind") + 1]] if "--kind" in argv else None
    after = argv[argv.index("--after") + 1] if "--after" in argv else None
    names = [a for a in argv if a in MUTS and a != after] or list(MUTS)
    if after:
        names = names[names.index(after) + 1:]
    if only:
        names = [n for n in names if any(k == only for k, _a in MUTS[n][2])]
    # every anchor first: a mutation that does not apply proves nothing
    for n, (path, reps, _g) in MUTS.items():
        text = (ROOT / path).read_text()
        for old, new in reps:
            if text.count(old) != 1:
                raise SystemExit(f"{n}: anchor {text.count(old)} x in {path}: {old[:90]!r}")
            text = text.replace(old, new)
    head = subprocess.run(["git", "rev-parse", "HEAD"], cwd=ROOT, capture_output=True, text=True).stdout.strip()
    dirty = subprocess.run(["git", "status", "--porcelain"], cwd=ROOT, capture_output=True, text=True).stdout.strip()
    print(json.dumps({"head": head, "clean": not dirty, "kind": only or "all", "mutations": len(names)}), flush=True)
    control(names, only)
    out = {}
    for name in names:
        if stop_asked():
            print(json.dumps({"stopped_before": name, "done": len(out), "why": "stop flag"}), flush=True)
            return 75
        path, reps, guards = MUTS[name]
        f = ROOT / path
        orig = f.read_bytes()
        text = orig.decode()
        try:
            for old, new in reps:
                text = text.replace(old, new)
            f.write_text(text)
            results = [run_guard(k, a) for k, a in guards if only is None or k == only]
        finally:
            f.write_bytes(orig)
            if any(k == "pw" for k, _a in guards) and only in (None, "pw"):
                build().check_returncode()
        red = all(r for r, _o, _a in results)
        at_rule = red and all(at in o for _r, o, at in results)
        out[name] = {"red": red, "at_rule": at_rule}
        print(json.dumps({"mutation": name, "red": red, "at_rule": at_rule, "guards": len(results),
                          "failures": [failures(o)[:2] for _r, o, _a in results]}), flush=True)
    print(json.dumps({"total": len(out), "red": sum(v["red"] for v in out.values()),
                      "red_at_rule": sum(v["at_rule"] for v in out.values()),
                      "not": [n for n, v in out.items() if not v["at_rule"]]}))
    return 0 if all(v["at_rule"] for v in out.values()) else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
