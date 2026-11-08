// A connection's device binding ends WITH the connection (settings split,
// Codex R339 SS-I02 rest): a plain close — no token change — drops what was
// not saved yet, and nothing acts or saves on the device's settings again
// until the NEXT connection's settings_init, the same profile or another
// one. Driven through the real orchestrator (lcncWs) with the worker
// transport replaced.
import "./testGlobals";
import { beforeEach, expect, it, vi } from "vitest";

const sent: Array<Record<string, any>> = [];
let onEvent: ((m: any) => void) | null = null;
vi.mock("./ws/wsTransport", async (orig) => ({
  ...(await orig<typeof import("./ws/wsTransport")>()),
  buildWsUrl: () => "ws://x/ws",
  connectTransport: (_url: string, cb: (m: any) => void) => { onEvent = cb; },
  sendCommand: (payload: string) => { sent.push(JSON.parse(payload)); return true; },
  captureArmedForResume: () => {},
}));

import { connectWs } from "./lcncWs";
import { loadDisplayDefaults, resetSettingsForTests, saveDisplayDefaults, serverSettingsReady, simulationOn, deviceInfo } from "./defaults";

const frame = (o: Record<string, any>) => onEvent!({ type: "message", data: JSON.stringify(o) });
const init = (id: string, simulation: boolean, revs: Record<string, number>) =>
  frame({ type: "settings_init", settings: { simulation: { enabled: simulation } }, revs, device: { id, name: "" }, armed: false });
const saves = () => sent.filter(c => c.cmd === "save_settings");

beforeEach(() => {
  vi.useFakeTimers();
  sent.length = 0;
  resetSettingsForTests();
  connectWs();
  onEvent!({ type: "spawned" });
  onEvent!({ type: "open", attempt: 0, dtMs: 1 });
  init("dev-a", true, { display: 3, simulation: 1 });
});

it("a plain close ends the binding: the unsent change is dropped, nothing acts until the next settings_init", () => {
  expect(serverSettingsReady.value).toBe(true);
  expect(simulationOn.value).toBe(true);
  saveDisplayDefaults({ ...loadDisplayDefaults(), theme: "dark" });   // in its debounce
  onEvent!({ type: "close", code: 1006, reason: "", wasClean: false });
  expect(serverSettingsReady.value).toBe(false);
  expect(simulationOn.value, "no simulation work without a bound profile").toBe(false);
  expect(deviceInfo.value.id).toBeNull();
  vi.advanceTimersByTime(400);
  expect(saves(), "the old binding's change never reaches the next connection").toEqual([]);
  // the socket is open again, its settings not yet in: a change is not admitted
  onEvent!({ type: "open", attempt: 1, dtMs: 1 });
  saveDisplayDefaults({ ...loadDisplayDefaults(), theme: "light" });
  vi.advanceTimersByTime(400);
  expect(saves()).toEqual([]);
  // the next connection's settings (another machine configuration: another profile)
  init("dev-b", false, { display: 0, simulation: 0 });
  expect(simulationOn.value).toBe(false);
  saveDisplayDefaults({ ...loadDisplayDefaults(), theme: "light" });
  vi.advanceTimersByTime(400);
  expect(saves()).toEqual([expect.objectContaining({ section: "display", base_rev: 0 })]);
  vi.useRealTimers();
});
