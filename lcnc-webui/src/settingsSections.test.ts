// The ONE classification of the settings sections (button gates Q2 /
// BG-19) lives in the gateway's settings_store.py — every save path there
// asks section_needs_arm(). The client mirrors it to know which sections
// act at once (display) and which only once the server holds them
// (protected, defaults.ts). This test ties the two lists together.
import "./testGlobals";
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { CONFIRMED_DEVICE_SECTIONS, DEVICE_SECTIONS, FREE_SECTIONS } from "./defaults";

const store = readFileSync(new URL("../../lcnc-gateway/settings_store.py", import.meta.url), "utf8");
const main = readFileSync(new URL("./main.ts", import.meta.url), "utf8");

function pySet(name: string): string[] {
  const m = store.match(new RegExp(`^${name} = (?:frozenset\\()?\\{([^}]*)\\}`, "m"));
  if (!m) throw new Error(`${name} not found in settings_store.py`);
  return [...m[1]!.matchAll(/"([a-zA-Z]+)"/g)].map(x => x[1]!).sort();
}

describe("the settings sections: client and gateway agree", () => {
  it("a device's sections are the gateway's DEVICE_SECTIONS — and the ones it saves without arm", () => {
    expect([...DEVICE_SECTIONS].sort()).toEqual(pySet("DEVICE_SECTIONS"));
    expect([...FREE_SECTIONS].sort()).toEqual(pySet("DEVICE_SECTIONS"));
    expect(store).toMatch(/^FREE_SECTIONS = DEVICE_SECTIONS$/m);
  });
  it("the device sections that act only once the server holds them agree", () => {
    expect([...CONFIRMED_DEVICE_SECTIONS].sort()).toEqual(pySet("CONFIRMED_DEVICE_SECTIONS"));
  });
  it("every section the client loads from the server is one the gateway knows, and every one it knows", () => {
    const m = main.match(/const SERVER_SECTIONS = \[([^\]]*)\]/);
    const client = [...m![1]!.matchAll(/"([a-zA-Z]+)"/g)].map(x => x[1]!).sort();
    expect(client).toEqual([...pySet("MACHINE_SECTIONS"), ...pySet("DEVICE_SECTIONS")].sort());
  });
});
