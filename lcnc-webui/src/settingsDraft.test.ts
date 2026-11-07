// Draft ≠ active for the protected settings (button gates BG-19, Codex
// R203/R204): a change of a protected section acts only once the SERVER
// holds it. A refused save (the writer is not armed) leaves the active
// configuration as it was and the draft visible in the form; a later Arm
// sends nothing on its own; an older confirmation never activates a newer
// draft. A display section acts at once.
import "./testGlobals";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  initServerDefaults, updateServerCache, registerSettingsSaver, resetSettingsForTests,
  saveKeyboardDefaults, loadKeyboardDefaults, loadKeyboardDraft, DEFAULT_KB_MAPPING,
  saveMachineDefaults, loadMachineDefaults, loadMachineDraft,
  saveDisplayDefaults, loadDisplayDefaults, savedSection, isProtectedSection, FREE_SECTIONS,
  saveSimulationDefaults, loadSimulationDefaults, loadSimulationDraft, noteOwnSaveReply,
  dropPendingSaves, actsWhenConfirmed, deviceInfo, invalidateServerSettings, simulationOn, serverSettingsReady,
  type KeyboardDefaults,
} from "./defaults";
import { noteSaveReply, resetSaveStatusForTests, sectionSaveState } from "./settingsSaveStatus";

const sent: { section: string; data: any; base: number; reqId: string }[] = [];
registerSettingsSaver((section, data, base) => {
  const reqId = `r${sent.length + 1}`;
  sent.push({ section, data: structuredClone(data), base, reqId });
  return reqId;
});

const KB = (key: string): KeyboardDefaults => ({ jogEnabled: true, buttonsEnabled: true, mapping: { ...DEFAULT_KB_MAPPING, "jog_x+": key } });
const SERVER_KB = KB("ArrowRight");

beforeEach(() => {
  vi.useFakeTimers();
  resetSettingsForTests();
  resetSaveStatusForTests();
  sent.length = 0;
  initServerDefaults({ keyboard: structuredClone(SERVER_KB) }, true, { keyboard: 4, display: 2, simulation: 0 },
                     { id: "dev-test", name: "" });
});
afterEach(() => { vi.useRealTimers(); });

/** The debounced save goes out; returns what was sent. */
function flush() {
  vi.advanceTimersByTime(300);
  return sent[sent.length - 1]!;
}

describe("a protected section acts only once the server holds it (BG-19)", () => {
  it("a refused save changes no key; the form keeps the draft", () => {
    saveKeyboardDefaults(KB("KeyD"));
    // before any reply: the draft shows, the server's map acts
    expect(loadKeyboardDraft().mapping["jog_x+"]).toBe("KeyD");
    expect(loadKeyboardDefaults().mapping["jog_x+"]).toBe("ArrowRight");
    const s = flush();
    expect(s.section).toBe("keyboard");
    noteSaveReply(s.reqId, false, "Not armed — press Arm");
    expect(sectionSaveState("keyboard")).toBe("error");
    expect(loadKeyboardDefaults().mapping["jog_x+"]).toBe("ArrowRight");
    expect(loadKeyboardDraft().mapping["jog_x+"]).toBe("KeyD");
  });

  it("a foreign blob keeps the draft and the server's map; nothing is resent later", () => {
    saveKeyboardDefaults(KB("KeyD"));
    noteSaveReply(flush().reqId, false, "Not armed — press Arm");
    // another client saved the display: the full blob arrives
    updateServerCache({ keyboard: structuredClone(SERVER_KB), display: { theme: "dark" } });
    expect(loadKeyboardDefaults().mapping["jog_x+"]).toBe("ArrowRight");
    expect(loadKeyboardDraft().mapping["jog_x+"]).toBe("KeyD");
    expect((savedSection("keyboard") as KeyboardDefaults).mapping["jog_x+"]).toBe("KeyD");
    // a reconnect (settings_init), time passing — the operator arms: no save on its own
    updateServerCache({ keyboard: structuredClone(SERVER_KB) });
    vi.advanceTimersByTime(60_000);
    expect(sent).toHaveLength(1);
    expect(loadKeyboardDefaults().mapping["jog_x+"]).toBe("ArrowRight");
  });

  it("the server holding the draft makes it act, and the draft ends", () => {
    saveKeyboardDefaults(KB("KeyD"));
    const s = flush();
    noteSaveReply(s.reqId, true);
    // the reply alone does not change what acts: the server's blob does
    expect(loadKeyboardDefaults().mapping["jog_x+"]).toBe("ArrowRight");
    updateServerCache({ keyboard: s.data });
    expect(loadKeyboardDefaults().mapping["jog_x+"]).toBe("KeyD");
    // another client changes it later: the form follows (no stale draft)
    updateServerCache({ keyboard: KB("KeyQ") });
    expect(loadKeyboardDraft().mapping["jog_x+"]).toBe("KeyQ");
    expect(loadKeyboardDefaults().mapping["jog_x+"]).toBe("KeyQ");
  });

  it("a refused draft ends when another writer changes the section: the form follows the server", () => {
    saveKeyboardDefaults(KB("KeyD"));
    noteSaveReply(flush().reqId, false, "Not armed — press Arm");
    updateServerCache({ keyboard: KB("KeyQ") });
    expect(loadKeyboardDraft().mapping["jog_x+"]).toBe("KeyQ");
    expect(loadKeyboardDefaults().mapping["jog_x+"]).toBe("KeyQ");
    expect(sectionSaveState("keyboard")).toBe("error");   // the failure stays said
  });

  it("a draft on its way rides along with another writer's change", () => {
    saveKeyboardDefaults(KB("KeyD"));                     // in the debounce
    updateServerCache({ keyboard: KB("KeyQ") });
    expect(loadKeyboardDraft().mapping["jog_x+"]).toBe("KeyD");
    expect(loadKeyboardDefaults().mapping["jog_x+"]).toBe("KeyQ");
    // refused now; the next blob of the same server state keeps it
    noteSaveReply(flush().reqId, false, "Not armed — press Arm");
    updateServerCache({ keyboard: KB("KeyQ") });
    expect(loadKeyboardDraft().mapping["jog_x+"]).toBe("KeyD");
  });

  it("an older confirmation never activates a newer draft", () => {
    saveKeyboardDefaults(KB("KeyA"));
    const first = flush();
    saveKeyboardDefaults(KB("KeyB"));            // still in the debounce
    noteSaveReply(first.reqId, true);
    updateServerCache({ keyboard: first.data });  // the server holds A
    expect(loadKeyboardDefaults().mapping["jog_x+"]).toBe("KeyA");
    expect(loadKeyboardDraft().mapping["jog_x+"]).toBe("KeyB");
    // B refused: A acts, B stays the draft
    noteSaveReply(flush().reqId, false, "Not armed — press Arm");
    updateServerCache({ keyboard: first.data });
    expect(loadKeyboardDefaults().mapping["jog_x+"]).toBe("KeyA");
    expect(loadKeyboardDraft().mapping["jog_x+"]).toBe("KeyB");
  });

  it("a second change is saved onto the first (the draft is the base)", () => {
    saveMachineDefaults({ ...loadMachineDraft(), toolChangeMode: "m600" });
    saveMachineDefaults({ ...loadMachineDraft(), runFromLine: true });
    const s = flush();
    expect(s.data.toolChangeMode).toBe("m600");
    expect(s.data.runFromLine).toBe(true);
    noteSaveReply(s.reqId, false, "Not armed — press Arm");
    // the next tool change still uses the server's mode
    expect(loadMachineDefaults().toolChangeMode).toBe("m6g43");
    expect(loadMachineDefaults().runFromLine).toBe(false);
  });
});

describe("a display section acts at once (Q2)", () => {
  it("no server answer needed", () => {
    saveDisplayDefaults({ ...loadDisplayDefaults(), theme: "dark" });
    expect(loadDisplayDefaults().theme).toBe("dark");
  });
  it("the classification", () => {
    expect(isProtectedSection("display")).toBe(false);
    expect(isProtectedSection("keyboard")).toBe(true);
    expect([...FREE_SECTIONS].sort()).toEqual(["camera", "display", "macroBar", "panels", "simulation", "viewer"]);
  });
});

describe("device profiles (settings split, R335–R337)", () => {
  it("the simulation switch acts only once the server holds it", () => {
    expect(actsWhenConfirmed("simulation")).toBe(true);
    expect(actsWhenConfirmed("display")).toBe(false);
    expect(actsWhenConfirmed("macroBar")).toBe(false);
    saveSimulationDefaults({ enabled: true });
    expect(loadSimulationDraft().enabled).toBe(true);
    expect(loadSimulationDefaults().enabled).toBe(false);     // nothing runs on a draft
    const s = flush();
    noteSaveReply(s.reqId, false, "Device not bound — reload the page");
    expect(loadSimulationDefaults().enabled).toBe(false);
    updateServerCache({ keyboard: SERVER_KB, simulation: { enabled: true } }, { simulation: 1 }, { id: "dev-test", name: "" });
    expect(loadSimulationDefaults().enabled).toBe(true);
  });

  it("a save names the revision its change was made on; its reply's becomes the next base", () => {
    saveDisplayDefaults({ ...loadDisplayDefaults(), theme: "dark" });
    const a = flush();
    expect(a).toMatchObject({ section: "display", base: 2 });
    expect(noteOwnSaveReply(a.reqId, { ok: true, rev: 3 })).toBe(true);
    saveDisplayDefaults({ ...loadDisplayDefaults(), theme: "light" });
    const b = flush();
    expect(b.base).toBe(3);
    noteOwnSaveReply(b.reqId, { ok: true, rev: 1 });   // an older revision never goes back
    saveDisplayDefaults({ ...loadDisplayDefaults(), theme: "dark" });
    expect(flush().base).toBe(3);
  });

  it("a stale refusal shows the server's state at once and drops the change", () => {
    saveSimulationDefaults({ enabled: true });
    const a = flush();
    noteOwnSaveReply(a.reqId, { ok: false, stale: true, data: { enabled: false }, rev: 5 });
    expect(loadSimulationDraft().enabled).toBe(false);
    expect(loadSimulationDefaults().enabled).toBe(false);
    saveSimulationDefaults({ enabled: true });
    expect(flush().base).toBe(5);
    // a section the server holds none of: gone from the tab as well
    saveDisplayDefaults({ ...loadDisplayDefaults(), theme: "dark" });
    const d = flush();
    noteOwnSaveReply(d.reqId, { ok: false, stale: true, data: null, rev: 7 });
    expect(savedSection("display")).toBeUndefined();
  });

  // Codex R338 SS-I01: a save into ANOTHER device's profile (Settings ›
  // Devices, through request()) is not this tab's: its reply moves nothing here.
  it("another device's reply — ok or stale — never moves this tab's own settings", () => {
    expect(noteOwnSaveReply("foreign-1", { ok: true, rev: 5 })).toBe(false);
    expect(noteOwnSaveReply("foreign-2", { ok: false, stale: true, data: { enabled: true }, rev: 9 })).toBe(false);
    expect(loadSimulationDefaults().enabled).toBe(false);
    expect(simulationOn.value).toBe(false);
    saveSimulationDefaults({ enabled: false });
    expect(flush().base, "the own revision, unchanged").toBe(0);
  });

  // SS-I03: an OLDER refusal never overwrites what the tab knows newer.
  it("an older stale reply after a newer snapshot changes nothing; a newer draft stays", () => {
    saveSimulationDefaults({ enabled: true });
    const first = flush();
    // the newer snapshot: off at revision 2
    updateServerCache({ keyboard: SERVER_KB, simulation: { enabled: false } }, { keyboard: 4, display: 2, simulation: 2 },
                      { id: "dev-test", name: "" });
    noteOwnSaveReply(first.reqId, { ok: false, stale: true, data: { enabled: true }, rev: 1 });
    expect(loadSimulationDefaults().enabled, "content and revision stay one state").toBe(false);
    saveSimulationDefaults({ enabled: false });
    expect(flush().base).toBe(2);
    // a second draft made after the newer state; the first save's late refusal keeps it
    saveDisplayDefaults({ ...loadDisplayDefaults(), theme: "dark" });
    const d1 = flush();
    saveDisplayDefaults({ ...loadDisplayDefaults(), theme: "light" });
    noteOwnSaveReply(d1.reqId, { ok: false, stale: true, data: { theme: "auto" }, rev: 3 });
    expect(loadDisplayDefaults().theme, "the newer draft stays shown — its own save answers for it").toBe("light");
    expect(flush()).toMatchObject({ section: "display", data: expect.objectContaining({ theme: "light" }) });
  });

  // SS-I02: a renewed binding ends the old one AT ONCE.
  it("a renewed binding: nothing acts, nothing saves, an old reply moves nothing", () => {
    updateServerCache({ keyboard: SERVER_KB, simulation: { enabled: true } }, { simulation: 1 }, { id: "dev-test", name: "" });
    expect(simulationOn.value).toBe(true);
    saveDisplayDefaults({ ...loadDisplayDefaults(), theme: "dark" });
    const old = flush();
    invalidateServerSettings();
    expect(serverSettingsReady.value).toBe(false);
    expect(simulationOn.value, "no simulation work before the new binding's settings").toBe(false);
    expect(deviceInfo.value.id).toBeNull();
    expect(noteOwnSaveReply(old.reqId, { ok: true, rev: 9 })).toBe(false);
    sent.length = 0;
    saveDisplayDefaults({ ...loadDisplayDefaults(), theme: "light" });
    vi.advanceTimersByTime(300);
    expect(sent, "no save with the old binding's values").toEqual([]);
    updateServerCache({ keyboard: SERVER_KB, simulation: { enabled: false } }, { simulation: 0 }, { id: "dev-b", name: "" });
    expect(simulationOn.value).toBe(false);
    expect(deviceInfo.value.id).toBe("dev-b");
  });

  it("a tab not bound to a device saves no device section — a machine section still goes", () => {
    deviceInfo.value = { id: null, name: "" };
    saveDisplayDefaults({ ...loadDisplayDefaults(), theme: "dark" });
    vi.advanceTimersByTime(300);
    expect(sent).toEqual([]);
    expect(sectionSaveState("display")).toBe("blocked");
    expect(loadDisplayDefaults().theme).not.toBe("dark");
    saveKeyboardDefaults(KB("KeyD"));
    expect(flush().section).toBe("keyboard");
  });

  it("binding anew drops what was not saved yet, and says so", () => {
    saveDisplayDefaults({ ...loadDisplayDefaults(), theme: "dark" });
    saveKeyboardDefaults(KB("KeyD"));
    dropPendingSaves("device binding renewed — not saved");
    vi.advanceTimersByTime(1000);
    expect(sent).toEqual([]);
    expect(sectionSaveState("display")).toBe("error");
    expect(sectionSaveState("keyboard")).toBe("error");
    expect(loadKeyboardDraft().mapping["jog_x+"]).toBe("KeyD");   // the form's value until the next blob
    updateServerCache({ keyboard: SERVER_KB }, { keyboard: 4 }, { id: "dev-other", name: "" });
    expect(loadKeyboardDraft().mapping["jog_x+"]).toBe("ArrowRight");
  });
});
