import { beforeEach, describe, expect, it } from "vitest";
import {
  saveStatus, saveStatusText, sectionSaveState, noteSavePending, noteSaveSent, noteSaveReply,
  noteSaveBlocked, noteSaveFailed, noteSaveConnectionLost, noteSaveBeaconed, noteSaveServerState,
  stableJson, resetSaveStatusForTests,
} from "./settingsSaveStatus";

// UX-08: the Settings header shows what the last save actually did — per
// section and per revision (review round 5, UI-I12).
describe("settings save status", () => {
  beforeEach(resetSaveStatusForTests);

  it("is silent until a save moves, then says Saving… through the debounce and the wire", () => {
    expect(saveStatusText()).toBe("");
    noteSavePending("viewer");
    expect(saveStatusText()).toBe("Saving…");
    expect(saveStatus.state).toBe("pending");
    noteSaveSent("viewer", "r1");
    expect(saveStatus.state).toBe("saving");
    expect(saveStatusText()).toBe("Saving…");
  });

  it("the correlated ok reply says Saved; a foreign reply changes nothing", () => {
    noteSavePending("viewer");
    noteSaveSent("viewer", "r1");
    expect(noteSaveReply("other-9", true)).toBe(false);
    expect(saveStatus.state).toBe("saving");
    expect(noteSaveReply("r1", true)).toBe(true);
    expect(saveStatusText()).toBe("Saved");
    expect(saveStatus.section).toBe("viewer");
  });

  it("stays Saving… while another section is still on the wire", () => {
    noteSavePending("viewer"); noteSaveSent("viewer", "r1");
    noteSavePending("machine"); noteSaveSent("machine", "r2");
    noteSaveReply("r1", true);
    expect(saveStatus.state).toBe("saving");
    expect(saveStatus.section).toBe("machine");
    noteSaveReply("r2", true);
    expect(saveStatus.state).toBe("saved");
  });

  it("an ok:false reply names the section and the gateway's reason", () => {
    noteSavePending("keyboard"); noteSaveSent("keyboard", "r1");
    noteSaveReply("r1", false, "disk full");
    expect(saveStatusText()).toBe("Save failed — keyboard: disk full");
    noteSavePending("keyboard"); noteSaveSent("keyboard", "r2");
    noteSaveReply("r2", false);
    expect(saveStatusText()).toBe("Save failed — keyboard: rejected by the gateway");
  });

  it("blocked before the server settings and a failed hand-off are visible, not silent", () => {
    noteSaveBlocked("display", "waiting for server settings");
    expect(saveStatusText()).toBe("Not saved — display: waiting for server settings");
    noteSavePending("display");
    noteSaveFailed("display", "not connected");
    expect(saveStatusText()).toBe("Save failed — display: not connected");
  });

  // UI-I12 (1): another section's success must not erase a failed section.
  it("a failed section stays visible behind another section's ok until its own retry succeeds", () => {
    noteSavePending("keyboard"); noteSaveSent("keyboard", "k1");
    noteSavePending("display"); noteSaveSent("display", "d1");
    noteSaveReply("k1", false, "keyboard save rejected");
    expect(saveStatusText()).toBe("Save failed — keyboard: keyboard save rejected");
    noteSaveReply("d1", true);
    expect(saveStatusText()).toBe("Save failed — keyboard: keyboard save rejected");
    expect(sectionSaveState("display")).toBe("saved");
    expect(sectionSaveState("keyboard")).toBe("error");
    // The retry: the section moves again, then its own ok resolves the failure.
    noteSavePending("keyboard");
    expect(saveStatusText()).toBe("Saving…");
    noteSaveSent("keyboard", "k2");
    noteSaveReply("k2", true);
    expect(saveStatusText()).toBe("Saved");
    expect(saveStatus.section).toBe("keyboard, display");
  });

  // UI-I12 (2): a reply confirms only the revision it was sent for.
  it("an old reply never says Saved while a newer change of the section is still pending or in flight", () => {
    noteSavePending("keyboard"); noteSaveSent("keyboard", "k1");   // F9 on the wire
    noteSavePending("keyboard");                                    // F10 in the debounce
    noteSaveReply("k1", true);
    expect(saveStatusText()).toBe("Saving…");
    expect(sectionSaveState("keyboard")).toBe("pending");
    noteSaveSent("keyboard", "k2");
    expect(sectionSaveState("keyboard")).toBe("saving");
    noteSaveReply("k2", true);
    expect(saveStatusText()).toBe("Saved");
  });

  it("a failure of an older revision is superseded by the newer one's outcome, an old failure after a newer ok changes nothing", () => {
    noteSavePending("keyboard"); noteSaveSent("keyboard", "k1");
    noteSavePending("keyboard"); noteSaveSent("keyboard", "k2");
    noteSaveReply("k1", false, "stale");
    expect(saveStatusText()).toBe("Saving…");        // k2 decides
    noteSaveReply("k2", true);
    expect(saveStatusText()).toBe("Saved");
    resetSaveStatusForTests();
    noteSavePending("keyboard"); noteSaveSent("keyboard", "k1");
    noteSavePending("keyboard"); noteSaveSent("keyboard", "k2");
    noteSaveReply("k2", true);
    noteSaveReply("k1", false, "stale");
    expect(saveStatusText()).toBe("Saved");
    noteSaveReply("k2", false, "late duplicate");    // already consumed — nothing
    expect(saveStatusText()).toBe("Saved");
  });

  it("two failed sections are both named", () => {
    noteSavePending("keyboard"); noteSaveSent("keyboard", "k1");
    noteSavePending("display"); noteSaveSent("display", "d1");
    noteSaveReply("k1", false, "a");
    noteSaveReply("d1", false, "b");
    expect(saveStatusText()).toBe("Save failed — keyboard: a; display: b");
    expect(saveStatus.section).toBe("keyboard, display");
  });

  it("a lost connection fails what was pending or in flight and leaves a settled section alone", () => {
    noteSavePending("viewer"); noteSaveSent("viewer", "r1");
    noteSavePending("display");                       // still in the debounce
    noteSavePending("machine"); noteSaveSent("machine", "m1"); noteSaveReply("m1", true);
    noteSaveConnectionLost();
    expect(saveStatusText()).toBe("Save failed — viewer: connection lost — not saved; display: connection lost — not saved");
    expect(sectionSaveState("machine")).toBe("saved");
    expect(noteSaveReply("r1", true)).toBe(false);   // the in-flight map was cleared
    resetSaveStatusForTests();
    noteSavePending("viewer"); noteSaveSent("viewer", "r2");
    noteSaveReply("r2", true);
    noteSaveConnectionLost();
    expect(saveStatusText()).toBe("Saved");
  });

  // Round 6 (UI-I12 rest): the page-hide path — sendBeacon, no reply.
  const kb = { jogEnabled: false, mapping: { abort: "F9", cycle: " " } };

  it("a page-hide beacon is unconfirmed until the server's blob shows it; an equal blob (any key order) confirms it", () => {
    noteSavePending("keyboard");
    noteSaveBeaconed("keyboard", kb, true);
    expect(sectionSaveState("keyboard")).toBe("unconfirmed");
    expect(saveStatusText()).toBe("Sent on page hide — not yet confirmed (keyboard)");
    noteSaveServerState({ display: { theme: "auto" } });          // no keyboard in it: nothing
    expect(sectionSaveState("keyboard")).toBe("unconfirmed");
    noteSaveServerState({ keyboard: { mapping: { cycle: " ", abort: "F9" }, jogEnabled: false } });
    expect(saveStatusText()).toBe("Saved");
  });

  it("a differing server blob is a failure that a later matching blob corrects", () => {
    noteSavePending("keyboard");
    noteSaveBeaconed("keyboard", kb, true);
    noteSaveServerState({ keyboard: { ...kb, mapping: { ...kb.mapping, abort: "F8" } } });
    expect(saveStatusText()).toBe("Save failed — keyboard: page-hide save not on the server — change it again");
    noteSaveServerState({ keyboard: kb });
    expect(saveStatusText()).toBe("Saved");
  });

  it("a refused hand-off is a failure; a lost connection leaves a beaconed revision unconfirmed for the reconnect's settings_init", () => {
    noteSavePending("display");
    noteSaveBeaconed("display", { theme: "dark" }, false);
    expect(saveStatusText()).toBe("Save failed — display: not sent on page hide");
    resetSaveStatusForTests();
    noteSavePending("keyboard");
    noteSaveBeaconed("keyboard", kb, true);
    noteSaveConnectionLost();
    expect(sectionSaveState("keyboard")).toBe("unconfirmed");
    noteSaveServerState({ keyboard: kb });
    expect(saveStatusText()).toBe("Saved");
  });

  it("a newer change supersedes the beacon; an old blob then confirms nothing", () => {
    noteSavePending("keyboard");
    noteSaveBeaconed("keyboard", kb, true);
    noteSavePending("keyboard");                                   // the operator is back and changes again
    expect(sectionSaveState("keyboard")).toBe("pending");
    noteSaveSent("keyboard", "k2");
    noteSaveReply("k2", true);
    expect(saveStatusText()).toBe("Saved");
    noteSaveServerState({ keyboard: kb });                          // the beacon's (older) state: nothing
    expect(saveStatusText()).toBe("Saved");
  });

  it("unconfirmed ranks below a save in progress and above Saved", () => {
    noteSavePending("keyboard"); noteSaveBeaconed("keyboard", kb, true);
    noteSavePending("display"); noteSaveSent("display", "d1");
    expect(saveStatusText()).toBe("Saving…");
    noteSaveReply("d1", true);
    expect(saveStatusText()).toBe("Sent on page hide — not yet confirmed (keyboard)");
    noteSaveServerState({ keyboard: kb, display: {} });
    expect(saveStatusText()).toBe("Saved");
  });

  it("stableJson is key-order independent and exact for nested values", () => {
    expect(stableJson({ b: [1, { d: 2, c: "x" }], a: null })).toBe('{"a":null,"b":[1,{"c":"x","d":2}]}');
    expect(stableJson({ a: 1, b: 2 })).toBe(stableJson({ b: 2, a: 1 }));
    expect(stableJson({ a: 1 })).not.toBe(stableJson({ a: 1.5 }));
  });
});
