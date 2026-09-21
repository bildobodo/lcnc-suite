import { beforeEach, describe, expect, it } from "vitest";
import {
  saveStatus, saveStatusText, noteSavePending, noteSaveSent, noteSaveReply, noteSaveBlocked,
  noteSaveFailed, noteSaveConnectionLost, resetSaveStatusForTests,
} from "./settingsSaveStatus";

// UX-08: the Settings header shows what the last save actually did.
describe("settings save status", () => {
  beforeEach(resetSaveStatusForTests);

  it("is silent until a save moves, then says Saving… through the debounce and the wire", () => {
    expect(saveStatusText()).toBe("");
    noteSavePending("viewer");
    expect(saveStatusText()).toBe("Saving…");
    noteSaveSent("viewer", "r1");
    expect(saveStatus.state).toBe("saving");
    expect(saveStatusText()).toBe("Saving…");
  });

  it("the correlated ok reply says Saved; a foreign reply changes nothing", () => {
    noteSaveSent("viewer", "r1");
    expect(noteSaveReply("other-9", true)).toBe(false);
    expect(saveStatus.state).toBe("saving");
    expect(noteSaveReply("r1", true)).toBe(true);
    expect(saveStatusText()).toBe("Saved");
    expect(saveStatus.section).toBe("viewer");
  });

  it("stays Saving… while another section is still on the wire", () => {
    noteSaveSent("viewer", "r1");
    noteSaveSent("machine", "r2");
    noteSaveReply("r1", true);
    expect(saveStatus.state).toBe("saving");
    noteSaveReply("r2", true);
    expect(saveStatus.state).toBe("saved");
  });

  it("an ok:false reply names the gateway's reason", () => {
    noteSaveSent("keyboard", "r1");
    noteSaveReply("r1", false, "disk full");
    expect(saveStatusText()).toBe("Save failed — disk full");
    noteSaveSent("keyboard", "r2");
    noteSaveReply("r2", false);
    expect(saveStatusText()).toBe("Save failed — rejected by the gateway");
  });

  it("blocked before the server settings and a failed hand-off are visible, not silent", () => {
    noteSaveBlocked("display", "waiting for server settings");
    expect(saveStatusText()).toBe("Not saved — waiting for server settings");
    noteSaveFailed("display", "not connected");
    expect(saveStatusText()).toBe("Save failed — not connected");
  });

  it("a lost connection fails what was pending or in flight and leaves a settled status alone", () => {
    noteSaveSent("viewer", "r1");
    noteSaveConnectionLost();
    expect(saveStatusText()).toBe("Save failed — connection lost — not saved");
    expect(noteSaveReply("r1", true)).toBe(false);   // the in-flight map was cleared
    resetSaveStatusForTests();
    noteSaveSent("viewer", "r2");
    noteSaveReply("r2", true);
    noteSaveConnectionLost();
    expect(saveStatusText()).toBe("Saved");
  });
});
