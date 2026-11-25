// TF-2 (plan v3 §2.2–2.5, Codex R476–R479): the comparison the dialog shows,
// and what the tab says of a load this page requested — row by row of §2.5,
// computed from the read on screen, with its history (already shown / gone
// for good). Pure.
import { describe, expect, it } from "vitest";
import type { ToolLoadBase } from "./lcnc";
import {
  loadCounts, loadRemoveLabel, loadReplaces, loadRows, loadSpindleNote, notRequested, readPreview, showsLoad,
  toolLoadNote, toolLoadResult, toolLoadStep, LOAD_CHECK_AGAIN, LOAD_COMPARING, LOAD_COMPLETE_BASIS, LOAD_CONFIRM_REMOVED,
  LOAD_DISCONNECTED, LOAD_IRREVERSIBLE, LOAD_NOT_COMPARED, LOAD_NOT_READ, LOAD_NOT_SERVED, LOAD_STALE,
  type ToolLoadPreview, type ToolLoadResult, type ToolLoadSeen,
} from "./toolLoad";

const BASE: ToolLoadBase = { path: "/cfg/tool.tbl", instance: "111:1", ini: "/cfg/m.ini", link: "e.1", rev: "a".repeat(64), memory: "b".repeat(64) };
const OWNER = { path: BASE.path, instance: BASE.instance, ini: BASE.ini, link: BASE.link };
const PREVIEW = {
  ok: true, refusal: null, base: BASE, basis: "partial", saved_at: new Date(2026, 10, 25, 14, 2, 11).getTime() / 1000, spindle: 2, removal_refusal: null,
  removed: [{ T: 8, name: "eight", Z: 80, D: 6 }, { T: 9, name: "", Z: -49.123, D: 0 }],
  changed: [{ T: 2, name: "two", fields: [{ f: "Z", now: -49.123, file: -50 }, { f: "D", now: 6, file: 6.35 }] }],
  added: [{ T: 5, name: "five", Z: 1.5, D: 3 }],
};
const read = (over: object = {}) => readPreview({ ...PREVIEW, ...over }, "nothing") as ToolLoadPreview;

describe("the comparison", () => {
  it("is read whole, or is none", () => {
    const p = read();
    expect(p.base).toEqual(BASE);
    expect([p.basis, p.spindle, p.savedAt, p.removalRefusal]).toEqual(["partial", 2, PREVIEW.saved_at * 1000, null]);
    expect(readPreview(null, "no reply")).toEqual({ refusal: "no reply" });
    expect(readPreview({ ok: false, error: "Connection to LinuxCNC changed — try again" }, "")).toEqual({ refusal: "Connection to LinuxCNC changed — try again" });
    expect(readPreview({ ok: true, refusal: "No tools in the file — restore it", base: null }, "")).toEqual({ refusal: "No tools in the file — restore it" });
    // an older gateway ("Unknown cmd") names itself; a reply that is not whole is no comparison
    expect(readPreview({ ok: false }, "")).toEqual({ refusal: LOAD_NOT_SERVED });
    for (const over of [{ base: null }, { base: { ...BASE, rev: "x" } }, { base: { ...BASE, memory: undefined } }, { base: { ...BASE, link: null } },
                        { basis: "unchecked" }, { removed: undefined }, { changed: [{ T: 2, fields: [] }] }, { added: [{ T: 1 }] }, { refusal: undefined },
                        { spindle: null }, { changed: [{ T: 2, fields: [{ f: "Z", now: "1", file: 2 }] }] }]) {
      expect(readPreview({ ...PREVIEW, ...over }, ""), JSON.stringify(over)).toEqual({ refusal: LOAD_NOT_SERVED });
    }
  });
  it("its counts name the file, when it was saved, and all rows", () => {
    expect(loadCounts(read())).toBe("tool.tbl, saved 14:02:11: 2 removed, 1 changed, 1 added.");
    expect(loadCounts(read({ removed: [], changed: [], saved_at: undefined }))).toBe("tool.tbl: 1 added.");
    expect(loadCounts(read({ removed: [], changed: [], added: [], basis: "complete" }))).toBe("tool.tbl, saved 14:02:11: same tools and values as LinuxCNC.");
  });
  it("its rows: removed, changed, added — each value as a person reads it", () => {
    expect(loadRows(read()).map(r => `${r.tool} ${r.name}|${r.text}`)).toEqual([
      "T8 eight|Removed · Z 80 · Ø 6", "T9 |Removed · Z −49.123 · Ø 0",
      "T2 two|Z −49.123 → −50 · Ø 6 → 6.35", "T5 five|Added · Z 1.5 · Ø 3"]);
    // two values that differ never read the same; −0 is 0; every letter is named
    const f = (now: number, file: number, k = "X") => loadRows(read({ removed: [], added: [], changed: [{ T: 1, name: "", fields: [{ f: k, now, file }] }] }))[0]!.text;
    expect(f(1.0000006, 1.0000013)).toBe("X 1.0000006 → 1.0000013");
    expect(f(-1.0000006, -1.0000013)).toBe("X −1.0000006 → −1.0000013");
    expect(f(-0.0000001, 100, "Q")).toBe("Q 0 → 100");
    expect(f(100, 1200.5, "D")).toBe("Ø 100 → 1200.5");
  });
  it("what is replaced, the tool in the spindle, the removed ones", () => {
    expect(loadReplaces(read())).toBe(true);
    expect(loadReplaces(read({ removed: [] }))).toBe(true);
    expect(loadReplaces(read({ changed: [] }))).toBe(true);
    expect(loadReplaces(read({ removed: [], changed: [] })), "added only").toBe(false);
    expect(loadSpindleNote(read())).toBe("T2 is in the spindle — its offset in effect stays until the next G43.");
    expect(loadSpindleNote(read({ spindle: 5 })), "an added one is in no spindle").toBeNull();
    expect(loadSpindleNote(read({ spindle: 0 }))).toBeNull();
    expect(loadRemoveLabel(read())).toBe("Remove 2 tools from LinuxCNC");
    expect(loadRemoveLabel(read({ removed: [PREVIEW.removed[0]] }))).toBe("Remove 1 tool from LinuxCNC");
  });
  it("every reason fits, and no text claims a load", () => {
    for (const w of [LOAD_NOT_SERVED, LOAD_NOT_READ, LOAD_COMPARING, LOAD_STALE, LOAD_DISCONNECTED, LOAD_CONFIRM_REMOVED, LOAD_CHECK_AGAIN])
      expect(w.length, w).toBeLessThanOrEqual(60);
    for (const w of [LOAD_NOT_SERVED, LOAD_NOT_READ, LOAD_COMPARING, LOAD_STALE, LOAD_DISCONNECTED, LOAD_CONFIRM_REMOVED, LOAD_CHECK_AGAIN,
                     LOAD_NOT_COMPARED, LOAD_COMPLETE_BASIS, LOAD_IRREVERSIBLE, notRequested("x")])
      expect(w, w).not.toMatch(/\b(loaded|confirmed)\b/i);
  });
});

// ---- §2.5 ------------------------------------------------------------------------
const requested = (over: object = {}): ToolLoadResult =>
  toolLoadResult({ ok: true, load: "requested", values: "shown", basis: "partial", ...over }, BASE)!;
const seen = (over: Partial<ToolLoadSeen> = {}): ToolLoadSeen => ({ kind: "complete", owner: OWNER, rev: BASE.rev, ...over });
const SHOWS = seen();
const OK = "Load requested. LinuxCNC now shows the file's tool values; pockets and remarks are not compared.";
const AS_BEFORE = "Load requested. LinuxCNC shows the file's tool values, as before; pockets and remarks are not compared.";
const FOREIGN = "Load requested, values not shown — connection to LinuxCNC changed.";
/** reads of the same owner (or of none) that do not show it */
const NOT_SHOWING: [string, ToolLoadSeen][] = [
  ["another revision", seen({ rev: "c".repeat(64) })], ["no revision", seen({ rev: null })],
  ["partial", seen({ kind: "partial" })], ["unchecked", seen({ kind: "unchecked" })],
  ["failed", { kind: "failed", owner: null, rev: null }],
  ["an owner that is not named", seen({ owner: null })],
];
/** another owner, by each part alone */
const FOREIGN_READS = (["path", "instance", "ini", "link"] as const)
  .map(k => [k, seen({ owner: { ...OWNER, [k]: "x" } })] as [string, ToolLoadSeen]);
const note = (r: ToolLoadResult | null, s: ToolLoadSeen | null, lead = true) => toolLoadNote(r, s, lead)?.text ?? null;

describe("what is kept of a request", () => {
  it("only a received ok: true, load: requested", () => {
    for (const r of [null, undefined, { ok: false, error: "x", load: "requested" }, { ok: true }, { ok: true, load: "confirmed" }])
      expect(toolLoadResult(r, BASE), JSON.stringify(r)).toBeNull();
    expect(requested()).toEqual({ base: BASE, basis: "partial", values: "shown", why: null, shown: false, foreign: false });
    expect(requested({ values: "not shown", why: "in time" }).why).toBe("in time");
    // what is not named is unknown, never a success
    expect(requested({ values: "not shown", why: "because" }).why).toBe("unknown");
    expect(requested({ values: "yes" })).toMatchObject({ values: "not shown", why: "unknown" });
    expect(requested({ values: "not awaited", basis: "complete" })).toMatchObject({ values: "not awaited", basis: "complete", why: null });
  });
});

describe("what the tab says of it, from the read on screen (§2.5)", () => {
  it("no read on screen: nothing; what is kept stays kept", () => {
    expect(toolLoadNote(requested(), null)).toBeNull();
    expect(toolLoadNote(null, SHOWS)).toBeNull();
  });
  it("shows it: path, instance, INI, Link, revision and complete", () => {
    expect(showsLoad(SHOWS, BASE)).toBe(true);
    for (const [k, s] of [...NOT_SHOWING, ...FOREIGN_READS]) expect(showsLoad(s, BASE), k).toBe(false);
    for (const r of [requested(), requested({ values: "not shown", why: "in time" }), requested({ values: "not awaited" })])
      expect(toolLoadNote(r, SHOWS)).toEqual({ tone: "ok", text: OK });
    expect(toolLoadNote(requested({ basis: "complete", values: "not awaited" }), SHOWS)).toEqual({ tone: "ok", text: AS_BEFORE });
  });
  it("same owner, does not show it, never shown: the warning, by what the reply observed", () => {
    for (const [why, words] of [["in time", "LinuxCNC did not show them in time"], ["file changed", "the file changed meanwhile"],
                                ["superseded", "a newer table write came"], ["unknown", "its outcome is unknown"],
                                ["controller changed", "connection to LinuxCNC changed"]] as const) {
      for (const [k, s] of NOT_SHOWING) {
        const r = toolLoadStep(requested({ values: "not shown", why }), s);
        expect(toolLoadNote(r, s), `${why}, ${k}`).toEqual({ tone: "warn", text: `Load requested, values not shown — ${words}.` });
      }
    }
    for (const [k, s] of NOT_SHOWING) {
      expect(note(toolLoadStep(requested(), s), s), k).toBe("Load requested, values not shown — the table changed since.");
      expect(note(toolLoadStep(requested({ values: "not awaited" }), s), s), k).toBe("Load requested, not awaited — the table shows the result.");
    }
  });
  it("the reply alone never gives the positive note", () => {
    for (const [k, s] of NOT_SHOWING) expect(toolLoadNote(toolLoadStep(requested(), s), s)?.tone, k).toBe("warn");
  });
  it("another owner, by each part alone: gone for good", () => {
    for (const [k, s] of FOREIGN_READS) {
      for (const r of [requested(), toolLoadStep(requested(), SHOWS)!, requested({ values: "not shown", why: "in time" }),
                       { ...toolLoadStep(requested(), SHOWS)!, why: "controller changed", values: "not shown" as const }]) {
        const gone = toolLoadStep(r, s);
        expect(gone, k).toBeNull();
        expect(note(toolLoadStep(gone, SHOWS), SHOWS), "no later read brings it back").toBeNull();
      }
    }
  });
  it("… only a wait that ended by it, never shown, says so — until dismissed", () => {
    for (const [k, s] of FOREIGN_READS) {
      let r = toolLoadStep(requested({ values: "not shown", why: "controller changed" }), s);
      expect(toolLoadNote(r, s), k).toEqual({ tone: "warn", text: FOREIGN });
      for (const later of [SHOWS, s, ...NOT_SHOWING.map(x => x[1])]) {
        r = toolLoadStep(r, later);
        expect(note(r, later), "until dismissed, never a success").toBe(FOREIGN);
      }
      expect(toolLoadNote(r, null)).toBeNull();
    }
  });
  it("a failed read names no owner: unknown before the first time shown, the end after it", () => {
    const failed: ToolLoadSeen = { kind: "failed", owner: null, rev: null };
    const before = toolLoadStep(requested({ values: "not shown", why: "in time" }), failed);
    expect(note(before, failed)).toBe("Load requested, values not shown — LinuxCNC did not show them in time.");
    expect(note(toolLoadStep(before, SHOWS), SHOWS), "a late load: the read shows it").toBe(OK);
    expect(toolLoadStep(toolLoadStep(requested(), SHOWS), failed)).toBeNull();
  });
  it("a late load turns the warning into the positive note", () => {
    const partial = seen({ kind: "partial" });
    let r = toolLoadStep(requested({ values: "not shown", why: "in time" }), partial);
    expect(toolLoadNote(r, partial)?.tone).toBe("warn");
    r = toolLoadStep(r, SHOWS);
    expect(toolLoadNote(r, SHOWS)).toEqual({ tone: "ok", text: OK });
  });
  it("once shown, a read that does not show it ends it for good", () => {
    for (const [k, s] of NOT_SHOWING) {
      const gone = toolLoadStep(toolLoadStep(requested(), SHOWS), s);
      expect(gone, k).toBeNull();
      expect(note(toolLoadStep(gone, SHOWS), SHOWS), "a read that fits again does not revive it").toBeNull();
    }
    expect(toolLoadStep(toolLoadStep(requested(), SHOWS), SHOWS), "as long as reads show it").toMatchObject({ shown: true });
  });
  it("a pure WebSocket reconnect keeps it only with a read that shows it again", () => {
    // closed: no read on screen, no step; then the reconnect's first read
    const kept = toolLoadStep(requested(), SHOWS);
    expect(toolLoadNote(kept, null)).toBeNull();
    expect(note(toolLoadStep(kept, SHOWS), SHOWS)).toBe(OK);
    const partial = seen({ kind: "partial" });
    expect(toolLoadStep(kept, partial)).toBeNull();
  });
  it("'requested' stands once: without the lead beside the write note's requested head", () => {
    expect(note(requested(), SHOWS, false)).toBe("LinuxCNC now shows the file's tool values; pockets and remarks are not compared.");
    expect(note(requested({ basis: "complete" }), SHOWS, false)).toBe("LinuxCNC shows the file's tool values, as before; pockets and remarks are not compared.");
    const partial = seen({ kind: "partial" });
    expect(note(requested({ values: "not shown", why: "in time" }), partial, false)).toBe("Values not shown — LinuxCNC did not show them in time.");
    expect(note(requested({ values: "not awaited" }), partial, false)).toBe("Not awaited — the table shows the result.");
    const all = [true, false].flatMap(lead => [SHOWS, partial].flatMap(s => ["shown", "not shown", "not awaited"].map(values => note(requested({ values }), s, lead)!)));
    for (const t of all) {
      expect(t).not.toMatch(/\b(loaded|confirmed)\b/i);
      expect(t.match(/requested/gi)?.length ?? 0).toBeLessThanOrEqual(1);
    }
  });
});
