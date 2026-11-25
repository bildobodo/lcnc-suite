// The tool table read's client half (P6 tool files read, plan
// maschinentag.r465 v4 §6, Codex R461/R465): which reply applies, what a
// reply shows. Pure — through the store, never through request() (which
// already drops late replies: a test through it would be green for the
// wrong reason).
import { describe, expect, it } from "vitest";
import {
  NOTE_NAMES_MAX, NO_PROOF, TOOL_TABLE_NOT_CHECKED, TOOL_TABLE_NOT_CONFIRMED, TOOL_TABLE_NOT_READ,
  LOAD_FAILED, LOAD_UNCONFIRMED, TOOL_TABLE_NO_TOOLS, ToolTableReads, WRITE_NO_METADATA, WRITE_NOT_LOADED,
  WRITE_UNCONFIRMED, partialNote, toolTableView,
  toolWriteNote, toolWriteOutcome, toolWriteStands, type ToolReadKind, type ToolTableProof,
} from "./toolTableRead";

interface Row { T: number; Z: number }
const ROWS: Row[] = [{ T: 1, Z: 50 }, { T: 3, Z: 22 }];
const proof = (over: Partial<ToolTableProof> = {}): ToolTableProof => ({
  state: "complete", proven: [1, 3], differs: [], missing: [], extra: [], duplicates: [], why: null, ...over,
});
const reply = (over: Record<string, unknown> = {}) => ({ ok: true, tools: ROWS, proof: proof(), unread: [], ...over });

describe("store point 1: an old connection's reply never applies", () => {
  it("is dropped after a sequence restart (same seq, old epoch)", () => {
    const r = new ToolTableReads();
    r.opened();
    const old = r.begin();                 // epoch 1, seq 1
    r.closed();
    r.opened();
    const now = r.begin();                 // epoch 2, seq 1 again
    expect(now.seq).toBe(old.seq);
    expect(r.applies(old)).toBe(false);
    expect(r.applies(now)).toBe(true);
  });
  it("only the newest read of the current epoch applies", () => {
    const r = new ToolTableReads();
    r.opened();
    const a = r.begin();
    const b = r.begin();
    expect([r.applies(a), r.applies(b)]).toEqual([false, true]);
  });
  it("nothing applies once the connection closed, not even its newest read", () => {
    const r = new ToolTableReads();
    r.opened();
    const a = r.begin();
    r.closed();
    expect(r.applies(a)).toBe(false);
    expect(r.isOpen).toBe(false);
  });
  it("an epoch is never reused in the page's life", () => {
    const r = new ToolTableReads();
    const epochs = new Set<number>();
    for (let i = 0; i < 5; i++) { r.opened(); epochs.add(r.begin().epoch); r.closed(); }
    expect(epochs.size).toBe(5);
  });
});

describe("store point 2: an error or a missing reply never shows as an empty table", () => {
  it("a failed read shows no rows and says it was not read", () => {
    for (const [r, why] of [[null, "No reply from the gateway — retry"], [{ ok: false, error: "Tool library not JSON" }, "Tool library not JSON"],
                            [{ ok: false }, "Tool table unavailable"], [{ ok: true }, "Tool table unavailable"]] as const) {
      const v = toolTableView<Row>(r);
      expect(v.kind).toBe("failed");
      expect(v.rows).toEqual([]);
      expect(v.error).toBe(why);
      expect(v.empty).toBe(TOOL_TABLE_NOT_READ);
      expect(v.empty).not.toBe(TOOL_TABLE_NO_TOOLS);
    }
  });
  it("the no-reply words are the caller's (not connected)", () => {
    expect(toolTableView<Row>(null, "Not connected").error).toBe("Not connected");
  });
  it("each state against rows and zero rows: 'No tools' only for complete", () => {
    const cases: [Record<string, unknown>, string, string][] = [
      [{ proof: proof() }, "complete", TOOL_TABLE_NO_TOOLS],
      [{ proof: proof({ state: "partial", proven: [], missing: [1, 3], why: "file incomplete or differs from LinuxCNC" }) },
        "partial", TOOL_TABLE_NOT_CONFIRMED],
      [{ proof: proof({ state: "unchecked", proven: [], why: "random tool changer" }) }, "unchecked", TOOL_TABLE_NOT_CHECKED],
      [{ proof: proof({ state: "unchecked", proven: [], why: "controller not read" }) }, "unchecked", TOOL_TABLE_NOT_CHECKED],
      [{ proof: undefined }, "unchecked", TOOL_TABLE_NOT_CHECKED],
    ];
    for (const [over, kind, empty] of cases) {
      for (const tools of [ROWS, []]) {
        const v = toolTableView<Row>(reply({ ...over, tools }));
        expect(v.kind).toBe(kind);
        expect(v.rows).toEqual(tools);
        expect(v.empty).toBe(empty);
        expect(v.error).toBeNull();
      }
    }
  });
  it("a partial note is neutral and names the tools — never 'is being written'", () => {
    const v = toolTableView<Row>(reply({ tools: [], proof: proof({ state: "partial", proven: [], missing: [1, 3] }) }));
    expect(v.note).toBe("File incomplete or differs from LinuxCNC — T1, T3 missing in the file.");
    expect(v.note).not.toMatch(/being written|writing/i);
    const d = toolTableView<Row>(reply({ proof: proof({ state: "partial", proven: [1], differs: [{ T: 3, fields: ["Z"] }] }) }));
    expect(d.note).toBe("File incomplete or differs from LinuxCNC — T3 differs.");
    expect([...d.proven]).toEqual([1]);
  });
  it("an unchecked note names the reason; a reply without a proof is never complete", () => {
    expect(toolTableView<Row>(reply({ proof: proof({ state: "unchecked", proven: [], why: "tool database" }) })).note)
      .toBe("Not checked against LinuxCNC — tool database.");
    const v = toolTableView<Row>({ ok: true, tools: ROWS });
    expect(v.kind).toBe("unchecked");
    expect(v.note).toContain(NO_PROOF);
    expect(v.proven.size).toBe(0);
  });
  it("a malformed proof is no proof", () => {
    for (const bad of [{ state: "complete" }, { state: "done", proven: [], missing: [], extra: [] }, "complete", 1]) {
      expect(toolTableView<Row>(reply({ proof: bad })).kind).toBe("unchecked");
    }
  });
  it("a missing line end at the file's end is named (it alone keeps a read partial)", () => {
    expect(partialNote(proof({ state: "partial", proven: [1, 3], ends_newline: false }), []))
      .toBe("File incomplete or differs from LinuxCNC — the last line has no line end.");
  });
  it("a partial note ends with the gateway's own refusal — cause and way out (Codex R468 TF-1)", () => {
    const why = "T3 twice in the file — remove one, restart LinuxCNC";
    const p = proof({ state: "partial", proven: [1], duplicates: [3], missing: [7] });
    expect(toolTableView<Row>(reply({ proof: p, edit_refusal: why })).note)
      .toBe(`File incomplete or differs from LinuxCNC — T7 missing in the file; T3 twice. Edits refused: ${why}.`);
    for (const none of [null, undefined, "", 7]) {
      expect(toolTableView<Row>(reply({ proof: p, edit_refusal: none })).note, String(none))
        .toBe("File incomplete or differs from LinuxCNC — T7 missing in the file; T3 twice.");
    }
  });
  it("one fact is said once: the refusal names it with its way out", () => {
    const one: [Partial<ToolTableProof>, string][] = [
      [{ duplicates: [3] }, "T3 twice in the file — remove one, restart LinuxCNC"],
      [{ differs: [{ T: 3, fields: ["Z"] }] }, "T3 differs from LinuxCNC — a restart loads the file"],
      [{ ends_newline: false }, "Last line has no line end — add it in an editor"],
      [{ why: "file changed while read" }, "File changed while read — nothing written; read again"],
    ];
    for (const [p, why] of one) {
      expect(partialNote(proof({ state: "partial", proven: [1], ...p }), [], why)).toBe(`Edits refused: ${why}.`);
    }
    // two tools of ONE kind are two facts: the refusal names only their number
    expect(partialNote(proof({ state: "partial", proven: [1], missing: [7, 8] }), [], "2 tools not in the file — restore it; restart drops them"))
      .toBe("File incomplete or differs from LinuxCNC — T7, T8 missing in the file. Edits refused: 2 tools not in the file — restore it; restart drops them.");
  });
  it("a complete or unchecked read shows no edit refusal of its own", () => {
    expect(toolTableView<Row>(reply({ edit_refusal: "x" })).note).toBeNull();
    expect(toolTableView<Row>(reply({ proof: proof({ state: "unchecked", proven: [], why: "tool database" }),
                                      edit_refusal: "Table not checked (tool database) — nothing written" })).note)
      .toBe("Not checked against LinuxCNC — tool database.");
  });
  it("a note caps the names it lists", () => {
    const missing = Array.from({ length: NOTE_NAMES_MAX + 3 }, (_v, i) => i + 10);
    const note = partialNote(proof({ state: "partial", proven: [], missing }), []);
    expect(note).toContain(`T${10 + NOTE_NAMES_MAX - 1} +3 missing`);
    expect(note).not.toContain(`T${10 + NOTE_NAMES_MAX},`);
  });
});

describe("store point 3: an unread line without a readable T is attached to nothing", () => {
  it("only a readable T names its tool; the rest are lines", () => {
    const v = toolTableView<Row>(reply({
      proof: proof({ state: "partial", proven: [1, 3] }),
      unread: [{ line: 4, T: 3 }, { line: 7, T: null }, { line: 9, T: null }, { line: 12, T: 3 }],
    }));
    expect([...v.unreadByTool.entries()]).toEqual([[3, [4, 12]]]);
    expect(v.unreadLoose).toEqual([7, 9]);
    for (const row of v.rows) expect(v.unreadByTool.get(row.T) ?? []).not.toContain(7);
    expect(v.note).toBe("File incomplete or differs from LinuxCNC — lines 4, 7, 9, 12 not read.");
  });
  it("a T that is not a whole number is no T", () => {
    const v = toolTableView<Row>(reply({ unread: [{ line: 2, T: 1.5 }, { line: 3, T: "1" }] }));
    expect(v.unreadByTool.size).toBe(0);
    expect(v.unreadLoose).toEqual([2, 3]);
  });
});

describe("a written table's rest (Codex R471 MT-I42)", () => {
  // every outcome the gateway names (_ToolWriteJob.outcome, "not awaited")
  const OUTCOMES = ["confirmed", "unconfirmed", "not checked", "superseded", "controller changed", "reload not sent",
                    "reload failed", "failed", "cancelled", "not awaited"];
  const A = { path: "/cfg/tool.tbl", instance: "111:1" };
  const note = (reply: unknown, kind: ToolReadKind | null) => toolWriteNote(toolWriteOutcome(reply, A), kind);

  it("only a load that was not sent or failed has words of its own, and not beside a partial read", () => {
    for (const reload of OUTCOMES) {
      const own = reload === "reload not sent" || reload === "reload failed";
      for (const kind of ["complete", "unchecked", "failed", "partial", null] as const) {
        expect(note({ ok: true, reload }, kind), `${reload} beside ${kind}`)
          .toBe(own && kind !== "partial" && kind !== null ? `${WRITE_NOT_LOADED}.` : null);
      }
    }
  });
  it("metadata that were not saved are said beside every read", () => {
    for (const kind of ["complete", "unchecked", "failed", "partial", null] as const) {
      expect(note({ ok: true, reload: "confirmed", metadata: "not saved" }, kind), String(kind)).toBe(`${WRITE_NO_METADATA}.`);
    }
    expect(note({ ok: true, reload: "reload failed", metadata: "not saved" }, "complete"), "the table named once").toBe(`${WRITE_NO_METADATA}; ${LOAD_FAILED}.`);
    expect(note({ ok: true, reload: "reload failed", metadata: "not saved" }, "partial")).toBe(`${WRITE_NO_METADATA}.`);
  });
  it("a lost socket ends nothing: it stands for its table, whichever LinuxCNC runs (Codex R472 / R474 MT-I43)", () => {
    const failed = toolWriteOutcome({ ok: true, reload: "reload failed" }, A);
    const both = toolWriteOutcome({ ok: true, reload: "reload not sent", metadata: "not saved" }, A);
    for (const o of [failed, both]) {
      expect(toolWriteStands(o, { ...A }), "the same table read again").toBe(o);
      expect(toolWriteStands(o, null), "a failed read, an older gateway").toBe(o);
      expect(toolWriteStands(o, { ...A, instance: "unbound" }), "no LinuxCNC bound").toBe(o);
    }
    // another LinuxCNC on the same file: it may have read the file before the
    // write published it (Codex R474) — kept, no longer as a failed load
    const restarted = { ...A, instance: "222:2" };
    for (const [o, words] of [[failed, `${WRITE_UNCONFIRMED}.`], [both, `${WRITE_NO_METADATA}; ${LOAD_UNCONFIRMED}.`]] as const) {
      const later = toolWriteStands(o, restarted);
      expect(later).toEqual({ ...o, earlier: true });
      expect(toolWriteNote(later, "complete")).toBe(words);
      expect(toolWriteStands(later, { ...A }), "the first one read again: still not confirmed").toBe(later);
      expect(toolWriteStands(later, { ...A, instance: "333:3" })).toBe(later);
      expect(toolWriteNote(later, "partial"), "a partial read names it").toBe(o.noMetadata ? `${WRITE_NO_METADATA}.` : null);
    }
    // another table file: not its outcome, never shown beside it
    for (const o of [failed, both]) expect(toolWriteStands(o, { ...A, path: "/cfg/other.tbl" })).toBeNull();
    // a write whose table was not known, or under no LinuxCNC: nothing is proven of it
    for (const of of [null, { ...A, instance: "unbound" }]) {
      const o = toolWriteOutcome({ ok: true, reload: "reload failed" }, of);
      expect(toolWriteStands(o, restarted)).toBe(o);
    }
    expect(toolWriteStands(null, A)).toBeNull();
  });
  it("an older gateway's reply leaves nothing open", () => {
    for (const r of [{ ok: true }, { ok: true, added: 3 }, null, undefined]) expect(note(r, "complete")).toBeNull();
    expect(toolWriteNote(null, "complete")).toBeNull();
  });
  it("its words say the table IS saved, why and what to do — at most 60 characters", () => {
    for (const w of [WRITE_NOT_LOADED, WRITE_UNCONFIRMED, WRITE_NO_METADATA]) {
      expect(w.length).toBeLessThanOrEqual(60);
      expect(w).toMatch(/^Table saved, .* — /);
    }
  });
});
