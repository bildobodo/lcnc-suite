// A hold in a browser spec runs on the PAGE's clock (e2e/holdClock.ts, hold
// after a stall — Codex R397 / R399 / R401): MachineBtn ends a hold whose
// watch saw a gap past HOLD_STALL_MS, and the loaded gate stalls pages — a
// hold pressed in real time then fails by the runner's load, not the
// control's (the round gate at 893356e1: `safety-during-edit` Home X and the
// mouse guard's abort case). This scan finds every real-time wait of at
// least HOLD_STALL_MS (or a named length) while a pointer is down in a spec,
// outside the stall guards that are real time on purpose; the sites that
// press no hold button are listed with what they press, per file.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { HOLD_STALL_MS } from "./holdGesture";

const DIR = new URL("../e2e/", import.meta.url);

/** Real time on purpose: the stall itself is their subject. */
const STALL_GUARDS = new Set(["hold-stall.spec.ts", "hold-stall-mouse.spec.ts"]);

/** Real-time presses on controls that are NOT holds — file → their count. */
const NOT_A_HOLD: Record<string, { count: number; what: string }> = {
  "choices.spec.ts": { count: 1, what: "the jog step (a ChoiceGroup option) held while the increments change" },
  "safety-during-edit.spec.ts": { count: 4, what: "G55 (a ChoiceGroup radio) held three times, Setup's help held once" },
  "press-release.spec.ts": { count: 3, what: "taps, no holds, touched by CDP: Abort 900 ms (the browser still clicks — acts once), a disabled Flood 700 ms (no click), the pad's Stop 300 ms (acts at the release)" },
};

// a press DELIVERED: Playwright's mouse, a CDP touch, a dispatched pointer
// event — never a listener that names the event
const DOWN = /mouse\.down\(|["']touchStart["']\s*[,}\]]|(?:dispatchEvent|new PointerEvent)\(\s*["']pointerdown["']/;
const UP = /mouse\.up\(|["']touch(?:End|Cancel)["']\s*[,}\]]|(?:dispatchEvent|new PointerEvent)\(\s*["']pointer(?:up|cancel)["']/;
/** A press never outlives its test (a dispatched press may have no release). */
const TEST_START = /^\s*test(?:\.describe)?\(/;
const WAIT = /\b(?:waitForTimeout|sleep)\(\s*([^),]+)/g;
/** A press held by Playwright itself: `click` / `dblclick` / `tap` with a `delay`. */
const DELAYED = /\.(?:click|dblclick|tap)\(\s*\{[^}]*\bdelay:\s*([^,}\s]+)/g;

/** Every real-time wait >= the stall limit (or of a named length) between a
 *  press and its release, in source order: "file:line". */
function realTimeHolds(file: string, text: string): string[] {
  const out: string[] = [];
  let down = false;
  text.split("\n").forEach((line, i) => {
    if (UP.test(line) || TEST_START.test(line)) down = false;
    if (DOWN.test(line) && !UP.test(line)) down = true;
    for (const m of line.matchAll(DELAYED)) {
      const ms = Number(m[1]!.trim());
      if (!Number.isFinite(ms) || ms >= HOLD_STALL_MS) out.push(`${file}:${i + 1}`);
    }
    if (!down) return;
    for (const m of line.matchAll(WAIT)) {
      const ms = Number(m[1]!.trim());
      if (!Number.isFinite(ms) || ms >= HOLD_STALL_MS) out.push(`${file}:${i + 1}`);
    }
  });
  return out;
}

describe("a hold in a browser spec runs on the page's clock", () => {
  it("the scan sees a real-time hold in each of its forms, and none on the page's clock", () => {
    expect(realTimeHolds("a", "await page.mouse.down();\nawait page.waitForTimeout(700);\nawait page.mouse.up();")).toEqual(["a:2"]);
    expect(realTimeHolds("a", 'await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [p] });\nawait sleep(LONG);'))
      .toEqual(["a:2"]);
    expect(realTimeHolds("a", 'await touch(cdp, "touchStart", [p]);\nawait page.waitForTimeout(150);')).toEqual(["a:2"]);
    expect(realTimeHolds("a", 'el.dispatchEvent(new PointerEvent("pointerdown"));\nawait page.waitForTimeout(600);')).toEqual(["a:2"]);
    expect(realTimeHolds("a", 'await btn.dispatchEvent("pointerdown", { button: 0 });\nawait page.waitForTimeout(600);')).toEqual(["a:2"]);
    expect(realTimeHolds("a", "await btn.click({ delay: 700 });")).toEqual(["a:1"]);
    expect(realTimeHolds("a", "await btn.click({ force: true, delay: HOLD });")).toEqual(["a:1"]);
    expect(realTimeHolds("a", "await btn.click({ delay: 50 });\nawait btn.click({ force: true });")).toEqual([]);
    // a tap's short wait, a wait after the release, a press on the page's clock
    expect(realTimeHolds("a", "await page.mouse.down();\nawait page.waitForTimeout(100);\nawait page.mouse.up();\nawait page.waitForTimeout(900);"))
      .toEqual([]);
    expect(realTimeHolds("a", "await page.mouse.down();\nawait page.clock.runFor(700);\nawait page.mouse.up();")).toEqual([]);
    // a listener or a type that names the event is no press; a press ends with its test
    expect(realTimeHolds("a", 'removeEventListener("pointerdown", on, true);\nawait page.waitForTimeout(700);')).toEqual([]);
    expect(realTimeHolds("a", 'await b.dispatchEvent("pointerdown");\n});\n\ntest("next", async () => {\nawait page.waitForTimeout(700);')).toEqual([]);
    expect(realTimeHolds("a", 'type T = "touchStart" | "touchEnd";\nawait page.waitForTimeout(700);')).toEqual([]);
  });

  it("no spec holds in real time but the stall guards; the presses on non-holds are the listed ones", () => {
    const found: Record<string, string[]> = {};
    for (const f of readdirSync(DIR).filter(f => f.endsWith(".ts")).sort()) {
      if (STALL_GUARDS.has(f)) continue;
      const sites = realTimeHolds(f, readFileSync(new URL(f, DIR), "utf8"));
      if (sites.length) found[f] = sites;
    }
    const counts = Object.fromEntries(Object.entries(found).map(([f, s]) => [f, s.length]));
    expect(counts, `real-time presses: ${JSON.stringify(found)} — a hold goes on the page's clock (holdMouse / onPageClock)`)
      .toEqual(Object.fromEntries(Object.entries(NOT_A_HOLD).map(([f, v]) => [f, v.count])));
  });
});
