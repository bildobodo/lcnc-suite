// No select is written while the machine talks (operator 2026-10-04, after
// the G-code reference's group list): Firefox rebuilds an OPEN dropdown on
// ANY change inside a <select> — on macOS the choice was lost, on Linux the
// list flickered back — and Vue re-assigns a bound <option value> on every
// render of a component whose slot is dynamic. So every select of the app,
// in the state that shows it, must see NO mutation inside it while status
// packets flow (idle position, a run's G0 ↔ G1, a tool change, the feed) and
// a gamepad is polled. Counted with a MutationObserver — browser-neutral;
// Firefox is what reacts.
import { test, expect, type Page } from "@playwright/test";
import { ctl, publishToolTable } from "./ctl";
import { openLayout, PROFILES, VIEWPORTS, settleLayout } from "./layout-fixtures";

const G = [9, 800, -1, 170, 400, 210, 900, 940, 540, 490, 980, 640, -1, 970, 911, 80, -1];
const M = [9, -1, 5, -1, 9, -1, 48, -1, 53, 0];

/** Watch every visible select; returns a reader of the writes per select. */
async function watchSelects(page: Page): Promise<() => Promise<Record<string, string[]>>> {
  const names = await page.evaluate(() => {
    const w = window as unknown as { __writes: Map<string, string[]> };
    w.__writes = new Map();
    const seen: string[] = [];
    document.querySelectorAll("select").forEach((s, i) => {
      if (!s.getClientRects().length) return;
      const key = s.getAttribute("aria-label") ?? s.getAttribute("name") ?? `select ${i}`;
      seen.push(key);
      w.__writes.set(key, []);
      new MutationObserver(ms => ms.forEach(m => w.__writes.get(key)!.push(
        `${m.type} ${(m.target as Element).tagName ?? "#text"} ${m.attributeName ?? ""}`)))
        .observe(s, { subtree: true, childList: true, attributes: true, characterData: true });
    });
    return seen;
  });
  expect(names.length, "a select to watch").toBeGreaterThan(0);
  return () => page.evaluate(() => Object.fromEntries((window as unknown as { __writes: Map<string, string[]> }).__writes));
}

/** 20 packets of what a machine sends: position (idle), the motion mode
 *  flipping G0 ↔ G1 (a run), the spindle tool, the feed — and the pad. */
async function talk(page: Page) {
  for (let i = 0; i < 20; i++) {
    await ctl({ op: "status_delta", data: {
      position: [i, -i, 0, 0, 0, 0, 0, 0, 0], gcodes: G.map((c, j) => j === 1 ? (i % 2 ? 10 : 0) : c), mcodes: M,
      tool_in_spindle: i % 3, current_vel: i % 2 ? 12.5 : 0, motion_line: i,
    } });
    await page.evaluate(n => {
      const pad = (window as unknown as { __pad?: { axes: number[]; timestamp: number } }).__pad;
      if (pad) { pad.axes = [n % 2 ? 0.6 : -0.6, 0, 0, 0]; pad.timestamp = n; }
    }, i);
  }
}

async function expectNoWrites(page: Page, where: string) {
  const writes = await watchSelects(page);
  await talk(page);
  const got = await writes();
  for (const [name, list] of Object.entries(got)) expect(list, `${where} · ${name}: written while the machine talks`).toEqual([]);
  return Object.keys(got);
}

test("desktop: the Tools type filter, the tool editor's type, the Macros bar filter, the reference's group", async ({ page }) => {
  await openLayout(page, PROFILES[1]!, VIEWPORTS[0]!);
  await ctl({ op: "status_delta", data: { gcodes: G, mcodes: M } });
  const seen: string[] = [];
  await publishToolTable([{ T: 5, P: 5, D: 6, Z: -40, type: "endmill", description: "Five mill" }]);
  await page.getByRole("tab", { name: "Tools", exact: true }).click();
  await settleLayout(page);
  seen.push(...await expectNoWrites(page, "Tools"));
  await page.getByRole("button", { name: "Edit T5", exact: true }).click();
  await expect(page.getByRole("dialog").last()).toBeVisible();
  seen.push(...await expectNoWrites(page, "tool editor"));
  await page.getByRole("button", { name: "Close tool editor", exact: true }).click();
  await page.getByRole("tab", { name: "Macros", exact: true }).click();
  await settleLayout(page);
  seen.push(...await expectNoWrites(page, "Macros"));
  await page.getByTitle("G-code Reference", { exact: true }).click();
  seen.push(...await expectNoWrites(page, "reference"));
  expect(seen).toEqual(expect.arrayContaining(["Filter by type", "Filter by the bar", "Filter by group"]));
});

test("portrait 150 %: the side panel and the probing procedure selects", async ({ page }) => {
  await openLayout(page, PROFILES[1]!, VIEWPORTS.find(v => v.name === "touch-portrait")!);
  await page.evaluate(() => { document.documentElement.style.zoom = "1.5"; });
  await settleLayout(page);
  await page.getByRole("combobox", { name: "Side panel" }).selectOption({ label: "Probing" });
  await settleLayout(page);
  const seen = await expectNoWrites(page, "portrait 150 %");
  expect(seen).toEqual(expect.arrayContaining(["Side panel", "Probing procedure"]));
});

test("TWP on touch landscape: the jog step select", async ({ page }) => {
  await openLayout(page, PROFILES[2]!, VIEWPORTS.find(v => v.name === "touch-landscape")!);
  await settleLayout(page);
  expect(await expectNoWrites(page, "jog")).toContain("Jog step");
});

test("Settings › Gamepad with a pad polled: the mapping selects", async ({ page }) => {
  await page.addInitScript(() => {
    const pad = { id: "Xbox 360 Controller (STANDARD GAMEPAD Vendor: 045e Product: 028e)", index: 0, connected: true,
      mapping: "standard", timestamp: 0, axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })) };
    (window as unknown as { __pad: typeof pad }).__pad = pad;
    Object.defineProperty(navigator, "getGamepads", { value: () => [pad, null, null, null] });
  });
  await openLayout(page, PROFILES[1]!, VIEWPORTS[0]!);
  // the mapping table shows with the pad's buttons on (and the jog section with its jog)
  await ctl({ op: "raw", frame: { type: "settings_init", settings: { gamepad: { jogEnabled: true, buttonsEnabled: true } } } });
  await page.getByTitle("Settings", { exact: true }).click();
  await page.getByRole("dialog", { name: "Settings", exact: true }).getByRole("tab", { name: "Gamepad", exact: true }).click();
  await settleLayout(page);
  const seen = await expectNoWrites(page, "Gamepad");
  expect(seen.some(n => n.endsWith(" action")), `mapping selects watched: ${seen.join(", ")}`).toBe(true);
});

test("the tool library import's mode select", async ({ page }) => {
  const row = { T: 1, type: "endmill", D: 6, current_diameter: 6, Z: -42.3, description: "Updated", current_description: "Measured", reason: null, match: "number" };
  await page.route("**/import-tool-library", r => r.fulfill({ json: {
    ok: true, tools: [row], total: 1, existing_count: 3, skipped_duplicates: [],
    metadata_refresh: { rows: [row], updated: [1], skipped: [], revision: "r" } } }));
  await openLayout(page, PROFILES[1]!, VIEWPORTS[0]!);
  await page.getByRole("tab", { name: "Tools", exact: true }).click();
  await page.locator('input[type="file"][accept*=".fctb"]').setInputFiles({ name: "tools.json", mimeType: "application/json", buffer: Buffer.from('{"data":[]}') });
  await expect(page.getByText("Import Fusion 360 Tool Library", { exact: true })).toBeVisible();
  const seen = await expectNoWrites(page, "import");
  expect(seen.length, `import selects watched: ${seen.join(", ")}`).toBeGreaterThan(1);
});
