// The words for a program whose own preview or text is not on screen
// (P2b-F1-2/3, Codex R449 MT449-03, R450 MT450-02, R451): ONE decider, per
// kind of data; "after the run" only while the program runs from an
// unverified start; an open writer named; no promise from a deadline.
import { describe, expect, it } from "vitest";
import { previewWaitWords, type PreviewWaitInputs } from "./previewWait";

const base: PreviewWaitInputs = {
  activeFile: "/c.ngc", activeId: "E.2", previewShown: false, refresh: null, wait: null,
  running: false, runVerified: false, textState: "none",
};
const w = (reasons: string[], lastEnd: { job: number; why: string } | null = null) =>
  ({ programId: "E.2", reasons, lastEnd });

describe("the words per state (P2b-F1-3)", () => {
  it("case (c): a run started before its preview — after the run, in the HUD, the code panel and the banner", () => {
    const r = previewWaitWords({ ...base, wait: w(["running"]), running: true });
    expect(r).toMatchObject({ hud: "Preview after the run", panel: "Text and preview after the run",
                              banner: "PREVIEW AFTER THE RUN", sim: "Preview after the run" });
    expect(r.help!.length).toBeLessThanOrEqual(120);
    // an open writer is named with it (it holds after the run too)
    expect(previewWaitWords({ ...base, wait: w(["observed:program_file", "overdue:program_file", "running"]), running: true }).hud)
      .toBe("Preview after the run and the program write");
    // never "after the run" at idle, nor for a verified start
    expect(previewWaitWords({ ...base, wait: w(["running"]), running: false }).banner).toBeNull();
    expect(previewWaitWords({ ...base, wait: w(["running"]), running: true, runVerified: true }).banner).toBeNull();
  });

  it("at idle the open action or writer is named; moving, the quiet window and the rotary rest without a promise", () => {
    const hud = (reasons: string[]) => previewWaitWords({ ...base, wait: w(reasons) }).hud;
    expect(hud(["observed:mdi"])).toBe("Preview waits for the MDI command");
    expect(hud(["held:probe_run"])).toBe("Preview waits for probing");
    expect(hud(["observed:program_file", "overdue:program_file"])).toBe("Preview waits for the program write — still open");
    expect(hud(["held:some_new_command"]), "a name without a label shows as it is").toBe("Preview waits for some_new_command");
    expect(hud(["moving"])).toBe("Preview waits for standstill");
    expect(hud(["debounce"])).toBe("Preview waits for the machine to settle");
    expect(hud(["settle:rotary"])).toBe("Preview waits for the rotary axes to rest");
    expect(previewWaitWords({ ...base, wait: w(["observed:mdi"]) }).panel).toBe("Text and preview wait for the MDI command");
    for (const r of [["observed:mdi"], ["moving"], ["debounce"], ["settle:rotary"]]) {
      expect(previewWaitWords({ ...base, wait: w(r) }).help!.length).toBeLessThanOrEqual(120);
    }
  });

  it("a parse of the program names itself; a failed one says so; no record says not ready — never silence", () => {
    expect(previewWaitWords({ ...base, refresh: { programId: "E.2", first: true } }))
      .toMatchObject({ hud: null, panel: "Text and preview loading", sim: "Preview loading" });
    expect(previewWaitWords({ ...base, wait: w([], { job: 4, why: "refused:running" }) }).hud)
      .toBe("Preview not ready — last parse failed");
    expect(previewWaitWords({ ...base }).hud, "no record, no matching data").toBe("Preview not ready");
    // a record or a parse of ANOTHER program counts for nothing
    expect(previewWaitWords({ ...base, wait: { ...w(["running"]), programId: "E.1" }, running: true }).banner).toBeNull();
    expect(previewWaitWords({ ...base, refresh: { programId: "E.1", first: true } }).hud).toBe("Preview not ready");
  });

  it("per kind of data: the preview's words end with its payload, the code panel's with its text", () => {
    const shown = previewWaitWords({ ...base, previewShown: true, wait: w(["running"]), running: true, textState: "loading" });
    expect([shown.hud, shown.banner, shown.sim, shown.panel]).toEqual([null, null, null, "Program text loading"]);
    expect(previewWaitWords({ ...base, previewShown: true, textState: "failed" }).panel)
      .toBe("Program text not loaded — reload the program");
    expect(previewWaitWords({ ...base, previewShown: true, textState: "differs" }).panel)
      .toBe("Program text differs from its preview — reload the program");
    const text = previewWaitWords({ ...base, textState: "ok", wait: w(["debounce"]) });
    expect([text.panel, text.hud]).toEqual([null, "Preview waits for the machine to settle"]);
  });

  it("no program: nothing; a program not proven yet: loading", () => {
    expect(previewWaitWords({ ...base, activeFile: null, activeId: null }))
      .toEqual({ hud: null, help: null, panel: null, banner: null, sim: null });
    expect(previewWaitWords({ ...base, activeId: null }).panel).toBe("Loading program");
  });
});
