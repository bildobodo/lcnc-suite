// The tool table read's client half (P6 tool files read, plan
// maschinentag.r465 v4 §6, Codex R461/R465): which reply applies, what a
// reply shows. Pure — through the store, never through request() (which
// already drops late replies: a test through it would be green for the
// wrong reason).
import { describe, expect, it } from "vitest";
import type { ToolReadOwner } from "./lcnc";
import {
  NOTE_NAMES_MAX, NO_PROOF, TOOL_TABLE_NOT_CHECKED, TOOL_TABLE_NOT_CONFIRMED, TOOL_TABLE_NOT_READ,
  LOAD_FAILED, LOAD_OR_RESTART, LOAD_REQUESTED, LOAD_UNCONFIRMED, LOAD_UNKNOWN, READ_AGAIN, RESTART_LOADS,
  TOOL_TABLE_NO_TOOLS, ToolTableReads, WRITE_NO_METADATA, partialNote, sameToolOwner, toolTableView,
  toolWriteHead, toolWriteLoadShows, toolWriteNote, toolWriteOutcome, toolWriteRequest, toolWriteStands, toolWriteTail,
  type ToolReadKind, type ToolTableProof, type ToolWriteOutcome, type ToolWriteRead,
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
      [{ differs: [{ T: 3, fields: ["Z"] }] }, "T3 differs from LinuxCNC — load the file or restart"],
      [{ ends_newline: false }, "Last line has no line end — add it in an editor"],
      [{ why: "file changed while read" }, "File changed while read — nothing written; read again"],
    ];
    for (const [p, why] of one) {
      expect(partialNote(proof({ state: "partial", proven: [1], ...p }), [], why)).toBe(`Edits refused: ${why}.`);
    }
    // two tools of ONE kind are two facts: the refusal names only their number
    expect(partialNote(proof({ state: "partial", proven: [1], missing: [7, 8] }), [], "2 tools not in the file — restore them, or load the file"))
      .toBe("File incomplete or differs from LinuxCNC — T7, T8 missing in the file. Edits refused: 2 tools not in the file — restore them, or load the file.");
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

describe("what a read is of, and why its file may not be loaded (TF-2)", () => {
  const OWNED = { table: { path: "/cfg/tool.tbl", instance: "111:1" }, owner: { ini: "/cfg/m.ini", link: "e.1" }, rev: { table: "r", library: "l" } };
  it("the owner is all four or nothing; the revision is the bytes'", () => {
    const v = toolTableView<Row>(reply(OWNED));
    expect([v.owner, v.rev]).toEqual([{ path: "/cfg/tool.tbl", instance: "111:1", ini: "/cfg/m.ini", link: "e.1" }, "r"]);
    for (const over of [{ table: undefined }, { table: { path: "/cfg/tool.tbl" } }, { owner: undefined }, { owner: { ini: "/cfg/m.ini", link: null } },
                        { owner: { ini: "", link: "e.1" } }]) {
      expect(toolTableView<Row>(reply({ ...OWNED, ...over })).owner, JSON.stringify(over)).toBeNull();
    }
    expect(toolTableView<Row>({ ...reply(OWNED), ok: false, error: "x" }).owner, "a failed read names none").toBeNull();
    expect(toolTableView<Row>(null).owner).toBeNull();
  });
  it("absent is an older gateway, only null is loadable", () => {
    const of = (over: Record<string, unknown>) => toolTableView<Row>(reply(over)).loadRefusal;
    expect([of({ load_refusal: null }), of({ load_refusal: "why" }), of({}), of({ load_refusal: 7 }), of({ load_refusal: "" })])
      .toEqual([null, "why", undefined, undefined, undefined]);
    for (const state of ["complete", "partial", "unchecked"] as const)
      expect(toolTableView<Row>(reply({ proof: proof({ state, why: state === "complete" ? null : "w" }), load_refusal: null })).loadRefusal).toBeNull();
    expect(toolTableView<Row>({ ok: false, load_refusal: null }).loadRefusal, "a failed read: not known").toBeUndefined();
  });
  it("each part of an owner is compared", () => {
    const a: ToolReadOwner = { path: "p", instance: "i", ini: "c", link: "l" };
    expect(sameToolOwner(a, { ...a })).toBe(true);
    for (const k of ["path", "instance", "ini", "link"] as const) expect(sameToolOwner(a, { ...a, [k]: "x" }), k).toBe(false);
  });
});

describe("a written table's rest (Codex R471 MT-I42)", () => {
  // every outcome the gateway names (_ToolWriteJob.outcome, "not awaited")
  const OUTCOMES = ["confirmed", "unconfirmed", "not checked", "superseded", "controller changed", "reload not sent",
                    "reload failed", "failed", "cancelled", "not awaited"];
  const A = { path: "/cfg/tool.tbl", instance: "111:1" };
  const OWNER: ToolReadOwner = { ...A, ini: "/cfg/m.ini", link: "e.1" };
  const KINDS: (ToolReadKind | null)[] = ["complete", "unchecked", "failed", "partial", null];
  /** a read on screen of that kind whose file may be loaded */
  const at = (kind: ToolReadKind | null): ToolWriteRead | null => kind && { kind, loadRefusal: kind === "failed" ? undefined : null };
  const tail = (kind: ToolReadKind) => (kind === "failed" ? READ_AGAIN : LOAD_OR_RESTART);
  const note = (r: unknown, kind: ToolReadKind | null) => toolWriteNote(toolWriteOutcome(r, A), at(kind));

  it("only a load that was not sent or failed has words of its own, and not beside a partial read", () => {
    for (const reload of OUTCOMES) {
      const own = reload === "reload not sent" || reload === "reload failed";
      for (const kind of KINDS) {
        expect(note({ ok: true, reload }, kind), `${reload} beside ${kind}`)
          .toBe(own && kind !== "partial" && kind !== null ? `Table saved, ${LOAD_FAILED}${tail(kind)}` : null);
      }
    }
  });
  it("metadata that were not saved are said beside every read", () => {
    for (const kind of KINDS) {
      expect(note({ ok: true, reload: "confirmed", metadata: "not saved" }, kind), String(kind)).toBe(`${WRITE_NO_METADATA}.`);
    }
    expect(note({ ok: true, reload: "reload failed", metadata: "not saved" }, "complete"), "the table named once")
      .toBe(`${WRITE_NO_METADATA}; ${LOAD_FAILED}${LOAD_OR_RESTART}`);
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
    for (const [o, words] of [[failed, `Table saved, ${LOAD_UNCONFIRMED}${LOAD_OR_RESTART}`],
                              [both, `${WRITE_NO_METADATA}; ${LOAD_UNCONFIRMED}${LOAD_OR_RESTART}`]] as const) {
      const later = toolWriteStands(o, restarted);
      expect(later).toEqual({ ...o, earlier: true });
      expect(toolWriteNote(later, at("complete"))).toBe(words);
      expect(toolWriteStands(later, { ...A }), "the first one read again: still not confirmed").toBe(later);
      expect(toolWriteStands(later, { ...A, instance: "333:3" })).toBe(later);
      expect(toolWriteNote(later, at("partial")), "a partial read names it").toBe(o.noMetadata ? `${WRITE_NO_METADATA}.` : null);
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
    expect(toolWriteNote(null, at("complete"))).toBeNull();
  });

  // ---- the load part: head × tail (TF-2, plan v3 §3) ----------------------------
  const failed = toolWriteOutcome({ ok: true, reload: "reload failed" }, A);
  const LONG = "Line 12 too long for LinuxCNC — shorten it in an editor";
  const RANDOM = "Random tool changer — not loaded from here";
  const OTHER: ToolReadOwner = { ...OWNER, link: "e.2" };
  /** head -> outcomes that have it, and the last read's owner */
  const HEADS: [string, ToolWriteOutcome, ToolReadOwner | null][] = [
    [LOAD_FAILED, failed, OWNER],
    [LOAD_FAILED, failed, null],
    [LOAD_REQUESTED, toolWriteRequest(failed, OWNER, true)!, OWNER],
    [LOAD_REQUESTED, toolWriteRequest({ ...failed, earlier: true }, OWNER, true)!, OWNER],
    // requested since, then a second request whose reply was lost: the first one's was received
    [LOAD_REQUESTED, toolWriteRequest(toolWriteRequest(failed, OWNER, true), OWNER, false)!, OWNER],
    [LOAD_UNCONFIRMED, { ...failed, earlier: true }, OWNER],
    [LOAD_UNCONFIRMED, toolWriteRequest(failed, OWNER, false)!, OWNER],
    // requested under an owner that is no longer the last read's: no longer counts — never back to "failed"
    [LOAD_UNCONFIRMED, toolWriteRequest(failed, OWNER, true)!, OTHER],
    [LOAD_UNCONFIRMED, { ...toolWriteRequest(failed, OWNER, true)!, earlier: true }, { ...OWNER, instance: "222:2" }],
    [LOAD_UNCONFIRMED, toolWriteRequest(failed, OWNER, true)!, null],
  ];
  const TAILS: [string, ToolWriteRead][] = [
    [`. ${LONG}.`, { kind: "complete", loadRefusal: LONG }],
    [`. ${LONG}.`, { kind: "unchecked", loadRefusal: LONG }],
    [`. ${RANDOM}.`, { kind: "unchecked", loadRefusal: RANDOM }],
    [READ_AGAIN, { kind: "failed", loadRefusal: undefined }],
    ...[...LOAD_UNKNOWN].map(w => [READ_AGAIN, { kind: "complete", loadRefusal: w }] as [string, ToolWriteRead]),
    [READ_AGAIN, { kind: "unchecked", loadRefusal: "LinuxCNC's table not read — try again" }],
    [LOAD_OR_RESTART, { kind: "complete", loadRefusal: null }],
    [LOAD_OR_RESTART, { kind: "unchecked", loadRefusal: null }],
    [RESTART_LOADS, { kind: "complete", loadRefusal: undefined }],
    [RESTART_LOADS, { kind: "unchecked", loadRefusal: undefined }],
  ];
  it("every head with every tail, and the metadata before it", () => {
    for (const [head, o, last] of HEADS) {
      expect(toolWriteHead(o, last)).toBe(head);
      for (const [end, read] of TAILS) {
        expect(toolWriteTail(read), JSON.stringify(read)).toBe(end);
        expect(toolWriteNote(o, read, last)).toBe(`Table saved, ${head}${end}`);
        expect(toolWriteNote({ ...o, noMetadata: true }, read, last)).toBe(`${WRITE_NO_METADATA}; ${head}${end}`);
      }
      // today's hiding, whatever was requested: beside a partial read and with no read
      for (const read of [{ kind: "partial", loadRefusal: null }, { kind: "partial", loadRefusal: LONG }, null] as const) {
        expect(toolWriteLoadShows(o, read)).toBe(false);
        expect(toolWriteNote(o, read, last)).toBeNull();
        expect(toolWriteNote({ ...o, noMetadata: true }, read, last)).toBe(`${WRITE_NO_METADATA}.`);
      }
    }
    expect(new Set(HEADS.map(h => h[0])).size).toBe(3);
    expect(new Set(TAILS.map(t => t[0])).size).toBe(5);
  });
  it("the tail follows the read on screen, whatever was requested or compared before", () => {
    const requested = toolWriteRequest(failed, OWNER, true);
    expect(toolWriteNote(requested, { kind: "complete", loadRefusal: null }, OWNER)).toBe("Table saved, load requested but not confirmed — load table or restart.");
    // … then the file becomes a long line, a read fails, the changer is a random one, the next reads again
    expect(toolWriteNote(requested, { kind: "complete", loadRefusal: LONG }, OWNER))
      .toBe("Table saved, load requested but not confirmed. Line 12 too long for LinuxCNC — shorten it in an editor.");
    expect(toolWriteNote(requested, { kind: "failed", loadRefusal: undefined }, OWNER)).toBe("Table saved, load requested but not confirmed — read again.");
    // random changer + long line: the gateway's order is the priority — its words name the line, no invented way out
    expect(toolWriteNote(failed, { kind: "unchecked", loadRefusal: LONG }, OWNER)).toBe(`Table saved, load into LinuxCNC failed. ${LONG}.`);
    expect(toolWriteNote(failed, { kind: "unchecked", loadRefusal: RANDOM }, OWNER)).not.toContain("restart");
  });
  it("a request is never turned into failed, into a success, or into an end", () => {
    for (const received of [true, false]) {
      const o = toolWriteRequest(failed, OWNER, received)!;
      for (const last of [OWNER, OTHER, null]) expect(toolWriteHead(o, last)).not.toBe(LOAD_FAILED);
      expect(toolWriteStands(o, A), "a read of its table ends nothing").toBe(o);
      expect(toolWriteNote(o, { kind: "complete", loadRefusal: null }, OWNER), "nor do values that match").not.toBeNull();
    }
    for (const w of [LOAD_REQUESTED, LOAD_UNCONFIRMED, LOAD_FAILED]) expect(w).not.toMatch(/(^|[^t] )(confirmed|loaded)$/);
  });
  it("a request counts for its own table only; an unknown table leaves both unknown", () => {
    expect(toolWriteRequest(failed, { ...OWNER, path: "/cfg/other.tbl" }, true)).toBe(failed);
    expect(toolWriteRequest(failed, { ...OWNER, path: "/cfg/other.tbl" }, false)).toBe(failed);
    const unknown = toolWriteOutcome({ ok: true, reload: "reload failed" }, null);
    expect(toolWriteHead(toolWriteRequest(unknown, OWNER, true)!, OWNER)).toBe(LOAD_UNCONFIRMED);
    expect(toolWriteRequest(null, OWNER, true)).toBeNull();
    // the next write starts anew
    expect(toolWriteHead(toolWriteOutcome({ ok: true, reload: "reload failed" }, A), OWNER)).toBe(LOAD_FAILED);
  });
});
