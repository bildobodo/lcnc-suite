// The gateway's parse in flight as the page SAW it (Codex R183 VP183-01,
// R185): one "on" at a parse's first status frame, one "off" at the first
// frame without it or with another parse — the parse named by its job — each
// with that frame's socket receipt on the page clock.
import "../testGlobals";
import { beforeEach, expect, it, vi } from "vitest";

const emitted: Array<{ kind: string; fields: Record<string, any> }> = [];
vi.mock("./telemetry", () => ({ emitTelemetry: (kind: string, fields: Record<string, any>) => emitted.push({ kind, fields }) }));

import { handleStatusMessage, resetOnClose } from "./statusStore";

const T0 = performance.timeOrigin;
const seen = () => emitted.filter(e => e.kind === "preview.parse_seen").map(e => e.fields);
const frame = (pr: unknown, t: number) =>
  handleStatusMessage({ type: "status", data: {}, ...(pr ? { preview_refresh: pr } : {}) }, T0 + t);
const pr = (started: number, reason = "wcsoff:G55:z", job: number | undefined = started / 1000) =>
  ({ reason, file: "p.ngc", expected_ms: 9000, started_ms: started, ...(job !== undefined ? { job } : {}),
     queued: false, superseded: 0 });

beforeEach(() => { emitted.length = 0; resetOnClose(); frame(null, 1); emitted.length = 0; });

it("says a parse's first and last frame once each, by the frame's receipt", () => {
  frame(pr(1000), 100);
  frame(pr(1000), 133);                    // the same parse: nothing new
  frame(pr(2000, "wcsoff:G54:z"), 166);    // superseded: the old one off, the new one on
  frame(null, 9000);
  expect(seen()).toEqual([
    { state: "on", job: 1, started_ms: 1000, reason: "wcsoff:G55:z", rx_ms: 100 },
    { state: "off", job: 1, started_ms: 1000, rx_ms: 166 },
    { state: "on", job: 2, started_ms: 2000, reason: "wcsoff:G54:z", rx_ms: 166 },
    { state: "off", job: 2, started_ms: 2000, rx_ms: 9000 },
  ]);
});

it("names a parse by its job, never by its start time", () => {
  frame(pr(1000, "file", 5), 100);
  frame(pr(1000, "file", 6), 133);          // the same wall-clock start, another job: another parse
  frame(pr(1500, "file", 6), 166);          // the same job: the same parse
  expect(seen().map(e => [e.state, e.job])).toEqual([["on", 5], ["off", 5], ["on", 6]]);
});

it("a closed socket ends the parse it saw, without a receipt", () => {
  frame(pr(1000, "file", 1), 100);
  resetOnClose();
  frame(pr(1000, "file", 1), 300);          // a restarted gateway's job 1 is a new parse
  expect(seen()).toEqual([
    { state: "on", job: 1, started_ms: 1000, reason: "file", rx_ms: 100 },
    { state: "off", job: 1, started_ms: 1000, rx_ms: null, why: "closed" },
    { state: "on", job: 1, started_ms: 1000, reason: "file", rx_ms: 300 },
  ]);
});

it("a frame without a receipt still says the change, without its time", () => {
  handleStatusMessage({ type: "status", data: {}, preview_refresh: pr(3000) });
  expect(seen()).toEqual([{ state: "on", job: 3, started_ms: 3000, reason: "wcsoff:G55:z", rx_ms: null }]);
});
