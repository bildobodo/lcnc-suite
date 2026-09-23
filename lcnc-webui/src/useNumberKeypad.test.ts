import { describe, it, expect, beforeEach } from "vitest";
import {
  keypadState, openKeypad, closeKeypad, closeKeypadIf,
  saveDraft, takeDraft, dropDraft, dropDrafts, clearDrafts, draftOwners,
} from "./useNumberKeypad";

// Draft lifecycle (UI-15, implementation review round 2 UI-I05): a draft is
// the owner's unconfirmed expression — '' included (the entry after "C" is
// the value 0, not "no draft") — and it ends with its OWNER's context, not
// with whichever session happens to be open.
describe("number drafts", () => {
  beforeEach(() => { clearDrafts(); closeKeypad(); });

  it("files an empty expression as a draft ('' is the value 0 after Clear)", () => {
    saveDraft("a", "");
    expect(takeDraft("a")).toBe("");
    expect(draftOwners()).toEqual(["a"]);
    saveDraft("a", "12");
    expect(takeDraft("a")).toBe("12");
    dropDraft("a");
    expect(takeDraft("a")).toBeNull();
  });

  it("closeKeypadIf drops the owner's draft even when another owner holds the keypad, and closes only its own session", () => {
    saveDraft("a", "17");
    let cancelled = 0;
    openKeypad({ value: 0, ownerId: "b", onConfirm: () => {}, onCancel: () => { cancelled++; } });
    expect(closeKeypadIf("a", "gate closed")).toBe(false);   // not b's session
    expect(keypadState.open).toBe(true);                     // b keeps the keypad
    expect(keypadState.ownerId).toBe("b");
    expect(takeDraft("a")).toBeNull();                       // a's context ended
    expect(cancelled).toBe(0);
    saveDraft("b", "5");
    expect(closeKeypadIf("b")).toBe(true);
    expect(keypadState.open).toBe(false);
    expect(takeDraft("b")).toBeNull();
    expect(cancelled).toBe(1);
  });

  it("dropDrafts ends every matching owner (a panel's cells) and no other", () => {
    saveDraft("wcs-1:G54:x", "17");
    saveDraft("wcs-1:G55:y", "");
    saveDraft("input-7", "3");
    dropDrafts(id => id.startsWith("wcs-1:"));
    expect(draftOwners()).toEqual(["input-7"]);
  });

  it("closeKeypad(keepDraft) marks the close for the strip; a plain close does not", () => {
    openKeypad({ value: 1, ownerId: "a", onConfirm: () => {} });
    closeKeypad(true);
    expect(keypadState.keepDraft).toBe(true);
    openKeypad({ value: 1, ownerId: "a", onConfirm: () => {} });
    expect(keypadState.keepDraft).toBe(false);
    closeKeypad();
    expect(keypadState.keepDraft).toBe(false);
  });
});
