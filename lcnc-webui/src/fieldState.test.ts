// A field against the server (P5-2 a, plan v6): the identity is the CHANGE.
// Codex' counter-cases (R440) on the real save path: saveSection → the saver →
// its reply → the server's blob.
import "./testGlobals";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { initServerDefaults, loadProbeDefaults, loadProbeDraft, noteOwnSaveReply, registerSettingsSaver, resetSettingsForTests,
         saveProbeDefaults, serverSettingsReady, updateServerCache } from "./defaults";
import { ARM_REFUSAL, fieldStates, noteFieldsConnectionLost, resetFieldStatesForTests, sectionRefusal } from "./fieldState";
import { noteSaveReply, resetSaveStatusForTests } from "./settingsSaveStatus";
import { PROBE_FALLBACK } from "./probeVars";

const BASE = { ...PROBE_FALLBACK, slowFr: 25, xyClearance: 2 };
let sent: { reqId: string; data: Record<string, unknown> }[] = [];
let n = 0;

const states = () => fieldStates("probe", loadProbeDraft(), loadProbeDefaults());
const edit = (field: string, value: number) => saveProbeDefaults({ ...loadProbeDraft(), [field]: value }, [field]);
/** The debounce ends: what went out. */
const flush = () => { vi.advanceTimersByTime(300); return sent[sent.length - 1]!; };
const answer = (reqId: string, reply: Record<string, unknown>) => {
  noteOwnSaveReply(reqId, reply);
  noteSaveReply(reqId, reply.ok !== false, reply.error as string | undefined);
};
const refuse = (reqId: string, error = "settings.json not written") => answer(reqId, { ok: false, error });
const blob = (data: Record<string, unknown>, rev = 2) => updateServerCache({ probe: data }, { probe: rev }, { id: "d", name: "" });

beforeEach(() => {
  vi.useFakeTimers();
  resetSettingsForTests();
  resetSaveStatusForTests();
  resetFieldStatesForTests();
  sent = [];
  n = 0;
  registerSettingsSaver((_s, data) => { const reqId = `r${++n}`; sent.push({ reqId, data }); return reqId; });
  initServerDefaults({ probe: { ...BASE } }, true, { probe: 1 }, { id: "d", name: "" });
});
afterEach(() => { vi.useRealTimers(); });

describe("a field's state", () => {
  it("an untouched form is neutral, with or without a stored section", () => {
    expect(Object.values(states()).every(s => s === null)).toBe(true);
    resetSettingsForTests();
    initServerDefaults({}, true, {}, { id: "d", name: "" });
    expect(Object.values(states()).every(s => s === null)).toBe(true);
  });

  it("a change is a draft until the server's blob holds it — never by the ack alone", () => {
    edit("slowFr", 50);
    expect(states().slowFr).toBe("draft");
    expect(states().xyClearance).toBeNull();
    const s = flush();
    answer(s.reqId, { ok: true, rev: 2 });
    expect(states().slowFr).toBe("draft");
    blob(s.data);
    expect(states().slowFr).toBeNull();
  });

  it("the first blob of two saves neutralises only what it holds", () => {
    edit("slowFr", 50);
    const a = flush();
    edit("xyClearance", 3);
    answer(a.reqId, { ok: true, rev: 2 });
    blob(a.data);
    expect([states().slowFr, states().xyClearance]).toEqual([null, "draft"]);
  });

  it("back to the held value is neutral; a foreign client setting the same value too", () => {
    edit("slowFr", 50);
    edit("slowFr", 25);
    expect(states().slowFr).toBeNull();
    edit("slowFr", 60);
    expect(states().slowFr).toBe("draft");
    blob({ ...BASE, slowFr: 60 });
    expect(states().slowFr).toBeNull();
  });

  it("a refusal marks the refused change; the next edit is a draft — the same value too", () => {
    edit("slowFr", 50);
    refuse(flush().reqId);
    expect(states().slowFr).toBe("refused");
    expect(sectionRefusal("probe", states())).toBe("settings.json not written");
    // server 25; 50 refused → 60 → 50 unsent: a draft, not the old refusal
    edit("slowFr", 60);
    expect(states().slowFr).toBe("draft");
    edit("slowFr", 50);
    expect(states().slowFr).toBe("draft");
    expect(sectionRefusal("probe", states())).toBeNull();
    // the same value entered again is a change of its own
    refuse(flush().reqId);
    expect(states().slowFr).toBe("refused");
    edit("slowFr", 50);
    expect(states().slowFr).toBe("draft");
  });

  it("a late refusal of the first 50 belongs to change 1, not to the second 50", () => {
    edit("slowFr", 50);
    const first = flush();
    edit("slowFr", 60);
    edit("slowFr", 50);
    const second = flush();
    refuse(first.reqId);
    expect(states().slowFr).toBe("draft");
    refuse(second.reqId);
    expect(states().slowFr).toBe("refused");
  });

  it("another field's refused save leaves an unchanged field neutral", () => {
    edit("xyClearance", 3);
    refuse(flush().reqId);
    expect([states().slowFr, states().xyClearance]).toEqual([null, "refused"]);
  });

  it("a refused field stays refused when another field is edited", () => {
    edit("slowFr", 50);
    refuse(flush().reqId);
    edit("xyClearance", 3);
    expect([states().slowFr, states().xyClearance]).toEqual(["refused", "draft"]);
  });

  it("an old answer after a newer save changes nothing of it", () => {
    edit("slowFr", 50);
    const a = flush();
    edit("slowFr", 60);
    const b = flush();
    refuse(b.reqId);
    answer(a.reqId, { ok: true, rev: 2 });
    expect(states().slowFr).toBe("refused");
  });

  it("a writer without arm is no refused field — the change stays a draft (operator 2026-11-24)", () => {
    edit("slowFr", 50);
    refuse(flush().reqId, ARM_REFUSAL);
    expect(states().slowFr).toBe("draft");
    expect(sectionRefusal("probe", states())).toBeNull();
    // the gateway's own words
    const policy = readFileSync(new URL("../../lcnc-gateway/command_policy.py", import.meta.url), "utf8");
    expect(policy).toContain(`"${ARM_REFUSAL}"`);
  });

  it("a lost connection refuses nothing", () => {
    edit("slowFr", 50);
    const a = flush();
    noteFieldsConnectionLost();
    refuse(a.reqId);
    expect(states().slowFr).toBe("draft");
  });

  it("a stale refusal: the form shows the server's state, the line why, until the next edit", () => {
    edit("slowFr", 50);
    const a = flush();
    answer(a.reqId, { ok: false, stale: true, error: "probe changed elsewhere — reloaded", data: { ...BASE, slowFr: 70 }, rev: 5 });
    expect(loadProbeDraft().slowFr).toBe(70);
    expect(states().slowFr).toBeNull();
    expect(sectionRefusal("probe", states())).toBe("probe changed elsewhere — reloaded");
    edit("slowFr", 80);
    expect(sectionRefusal("probe", states())).toBeNull();
  });

  it("a save blocked before the wire marks its own edit", () => {
    serverSettingsReady.value = false;
    const form = { ...BASE, slowFr: 50 };
    saveProbeDefaults(form, ["slowFr"]);
    const st = fieldStates("probe", form, loadProbeDefaults());
    expect([st.slowFr, st.xyClearance]).toEqual(["refused", null]);
    expect(sectionRefusal("probe", st)).toBe("waiting for server settings");
  });

  it("a save without an edit (a probe start saves the form) keeps the changes' identity", () => {
    edit("slowFr", 50);
    refuse(flush().reqId);
    saveProbeDefaults({ ...loadProbeDraft() });
    expect(states().slowFr, "no new change").toBe("refused");
    const again = flush();
    answer(again.reqId, { ok: true, rev: 3 });
    expect(states().slowFr, "the retry was taken, the blob is on its way").toBe("draft");
    blob(again.data, 3);
    expect(states().slowFr).toBeNull();
  });

  it("a section still carrying the old calOffset is read without it and makes no draft", () => {
    blob({ ...BASE, calOffset: 0.2 } as Record<string, unknown>);
    expect("calOffset" in loadProbeDraft()).toBe(false);
    expect(Object.values(states()).every(s => s === null)).toBe(true);
  });
});
