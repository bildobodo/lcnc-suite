import { describe, it, expect } from "vitest";
import type { LcncMessage } from "./ws/statusStore";
import { messageRows, messageType, messageLine, MESSAGE_FILTERS } from "./messageView";

const M = (id: number, kind: number, text: string, source?: "linuxcnc" | "webui"): LcncMessage =>
  ({ id, kind, text, ts: 1_000 * id, ...(source ? { source } : {}) });
const LOG = [
  M(1, 1, "joint 2 following error", "linuxcnc"),
  M(2, 6, "Probe the stock first", "linuxcnc"),          // a program's (MSG, …)
  M(3, 2, "Start not sent — Machine off", "webui"),
  M(4, 4, "Tool 3 loaded", "linuxcnc"),
  M(5, 6, "Saved haus.ngc", "webui"),
  M(6, 3, "stored before origins were kept"),
];
const q = (over = {}) => ({ search: "", filter: "", sortKey: "time" as const, asc: false, ...over });
const ids = (rows: LcncMessage[]) => rows.map(m => m.id);

describe("the message center's rows", () => {
  it("LinuxCNC's six kinds are three types", () => {
    expect([1, 2, 3, 4, 5, 6].map(messageType)).toEqual(["error", "error", "info", "info", "display", "display"]);
  });
  it("newest first by default; a time click turns it", () => {
    expect(ids(messageRows(LOG, q()))).toEqual([6, 5, 4, 3, 2, 1]);
    expect(ids(messageRows(LOG, q({ asc: true })))).toEqual([1, 2, 3, 4, 5, 6]);
  });
  it("by type and by source, newest first inside each; an unknown source last", () => {
    expect(ids(messageRows(LOG, q({ sortKey: "type", asc: true })))).toEqual([3, 1, 6, 4, 5, 2]);
    expect(ids(messageRows(LOG, q({ sortKey: "source", asc: true })))).toEqual([4, 2, 1, 5, 3, 6]);
  });
  it("one filter: a type or an origin", () => {
    expect(ids(messageRows(LOG, q({ filter: "type:error" })))).toEqual([3, 1]);
    expect(ids(messageRows(LOG, q({ filter: "type:display" })))).toEqual([5, 2]);
    expect(ids(messageRows(LOG, q({ filter: "source:webui" })))).toEqual([5, 3]);
    expect(ids(messageRows(LOG, q({ filter: "source:linuxcnc" })))).toEqual([4, 2, 1]);
    expect(MESSAGE_FILTERS.map(f => f.value)).toContain("");
  });
  it("the search reads the text, any case, with the filter", () => {
    expect(ids(messageRows(LOG, q({ search: "SAVED" })))).toEqual([5]);
    expect(ids(messageRows(LOG, q({ search: "o", filter: "type:error" })))).toEqual([3, 1]);
    expect(messageRows(LOG, q({ search: "nothing like it" }))).toEqual([]);
  });
  it("a clipboard line names type and origin", () => {
    expect(messageLine(LOG[2]!, "Oct 4 10:00:00")).toBe("[ERROR · WebUI] Oct 4 10:00:00 — Start not sent — Machine off");
    expect(messageLine(LOG[5]!, "t")).toBe("[INFO] t — stored before origins were kept");
  });
});
