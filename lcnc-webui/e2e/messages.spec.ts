// The message center laid out like the G-code reference and the Macros tab
// (operator 2026-10-04, from the renders): a search row with ONE filter for
// the type and the origin, a sortable head (Time, Type, Source), Copy and the
// trash per row, the count in the title; a narrow center (150 % portrait)
// makes each message a card — the old one broke its text letter by letter.
import { test, expect, type Page } from "@playwright/test";
import { ctl } from "./ctl";
import { openLayout, PROFILES, VIEWPORTS, settleLayout } from "./layout-fixtures";
import { sidewaysOverflow } from "./layout-audit";

const T0 = Date.UTC(2026, 9, 4, 7, 40, 0);
const at = (min: number) => T0 + min * 60_000;
// What this suite and LinuxCNC say on the XYZAC sim; id 1 was stored before
// origins were kept.
const LOG = [
  { id: 1, kind: 2, text: "Command: Machine busy", ts: at(0) },
  { id: 2, kind: 6, text: "Auto-disarmed after 30 min of inactivity (Settings → Machine → Idle Auto-Disarm).", ts: at(3), source: "webui" },
  { id: 3, kind: 1, text: "Move on line 42 would exceed joint 2's negative limit", ts: at(11), source: "linuxcnc" },
  { id: 4, kind: 2, text: "Start not sent — Machine off — press Power on", ts: at(12), source: "webui" },
  { id: 5, kind: 6, text: "Probe the stock top first, then press Cycle Start", ts: at(19), source: "linuxcnc" },
  { id: 6, kind: 1, text: "Probe tripped during non-probe move", ts: at(23), source: "linuxcnc" },
  { id: 7, kind: 6, text: "Saved haus.ngc", ts: at(25), source: "webui", quiet: true, uncounted: true },
  { id: 8, kind: 2, text: "Measure Current — no tool loaded", ts: at(31), source: "webui" },
  { id: 9, kind: 3, text: "Tool 13 loaded — length 54.2100 mm", ts: at(34), source: "linuxcnc" },
  { id: 10, kind: 1, text: "Unknown word starting with E", ts: at(40), source: "linuxcnc" },
  { id: 11, kind: 2, text: "Run-from-line pre_measure: probe failed — check the tool setter", ts: at(44), source: "webui" },
  { id: 12, kind: 5, text: "Spindle at speed", ts: at(47), source: "linuxcnc" },
];

const MACHINE_CMDS = ["cycle_start", "cycle_pause", "cycle_resume", "abort", "jog_cont", "jog_incr", "jog_stop",
  "go_to_zero", "touchoff", "set_kins_mode", "home_all", "machine_on", "estop", "estop_reset", "mdi", "run_macro"];

async function setup(page: Page, opts: { vp?: string; zoom?: number; seed?: boolean } = {}) {
  const { vp = "desktop", zoom = 1, seed = true } = opts;
  await page.addInitScript(([log, seedIt]) => {
    if (seedIt) localStorage.setItem("lcnc-messages", JSON.stringify(log));
    const w = window as unknown as { __copied: string[] };
    w.__copied = [];
    Object.defineProperty(navigator, "clipboard", { configurable: true,
      value: { writeText: (t: string) => { w.__copied.push(t); return Promise.resolve(); } } });
  }, [LOG, seed] as const);
  await openLayout(page, PROFILES[1]!, VIEWPORTS.find(v => v.name === vp)!);
  if (zoom !== 1) await page.evaluate(z => { document.documentElement.style.zoom = String(z); }, zoom);
  await settleLayout(page);
}
const center = (page: Page) => page.getByRole("dialog", { name: /^Messages/ });
const open = async (page: Page) => {
  await page.getByTitle(/^Messages \(\d+\)$/).click();
  await expect(center(page)).toBeVisible();
};
const filter = (page: Page) => center(page).getByRole("combobox", { name: "Filter messages" });
const search = (page: Page) => center(page).getByRole("textbox", { name: "Search messages" });
const texts = (page: Page) => center(page).locator("tbody td.msgText").allTextContents();
const column = (page: Page, cls: string) => center(page).locator(`tbody td.${cls}`).allTextContents();
const copied = (page: Page) => page.evaluate(() => (window as unknown as { __copied: string[] }).__copied);

test("one filter for the type and the origin, a search across both, a sortable head — the count in the title, nothing sent", async ({ page }) => {
  await setup(page);
  await ctl({ op: "clearCmds" });
  await open(page);
  const dialog = center(page);
  await expect(dialog).toHaveAccessibleName("Messages (12)");
  await expect(search(page)).toBeFocused();
  await expect(dialog.getByRole("button", { name: "Copy All", exact: true })).toBeVisible();
  // newest first
  expect((await texts(page))[0]).toBe("Spindle at speed");
  await expect(dialog.locator("th.colTime")).toHaveAttribute("aria-sort", "descending");

  await filter(page).selectOption({ label: "Errors" });
  expect(new Set(await column(page, "colType"))).toEqual(new Set(["Error"]));
  expect(await texts(page)).toHaveLength(7);
  await expect(dialog).toHaveAccessibleName("Messages (7 of 12)");
  await expect(dialog.getByRole("button", { name: "Copy Shown", exact: true })).toBeVisible();
  await filter(page).selectOption({ label: "Display" });
  expect(await texts(page)).toEqual(["Spindle at speed", "Saved haus.ngc", "Probe the stock top first, then press Cycle Start",
    "Auto-disarmed after 30 min of inactivity (Settings → Machine → Idle Auto-Disarm)."]);

  // the origin: a message stored before origins were kept is in neither
  await filter(page).selectOption({ label: "From LinuxCNC" });
  expect(new Set(await column(page, "colSource"))).toEqual(new Set(["LinuxCNC"]));
  expect(await texts(page)).toHaveLength(6);
  await filter(page).selectOption({ label: "From the WebUI" });
  expect(new Set(await column(page, "colSource"))).toEqual(new Set(["WebUI"]));
  expect(await texts(page)).toHaveLength(5);
  await filter(page).selectOption({ label: "All messages" });
  expect(await texts(page)).toHaveLength(12);
  expect(await column(page, "colSource")).toContain("—");

  // the search reads the text, any case, together with the filter
  await search(page).fill("PROBE");
  expect(await texts(page)).toEqual(["Run-from-line pre_measure: probe failed — check the tool setter",
    "Probe tripped during non-probe move", "Probe the stock top first, then press Cycle Start"]);
  await filter(page).selectOption({ label: "Errors" });
  expect(await texts(page)).toHaveLength(2);
  await expect(dialog).toHaveAccessibleName("Messages (2 of 12)");
  await search(page).fill("nothing like it");
  await expect(dialog.locator("td.msgEmpty")).toHaveText("No matching messages.");
  await search(page).fill("");
  await filter(page).selectOption({ label: "All messages" });

  // the head sorts: Type (errors first, newest first inside), Time turns
  await dialog.getByRole("button", { name: /^Type/ }).click();
  await expect(dialog.locator("th.colType")).toHaveAttribute("aria-sort", "ascending");
  await expect(dialog.locator("th.colTime")).toHaveAttribute("aria-sort", "none");
  const types = await column(page, "colType");
  expect(types.slice(0, 7)).toEqual(Array(7).fill("Error"));
  expect((await texts(page))[0]).toBe("Run-from-line pre_measure: probe failed — check the tool setter");
  await dialog.getByRole("button", { name: /^Source/ }).click();
  expect((await column(page, "colSource")).at(-1), "an unknown origin sorts last").toBe("—");
  await dialog.getByRole("button", { name: /^Source/ }).click();
  await expect(dialog.locator("th.colSource")).toHaveAttribute("aria-sort", "descending");
  expect((await column(page, "colSource")).at(-1), "… either way round").toBe("—");
  await dialog.getByRole("button", { name: /^Time/ }).click();
  await expect(dialog.locator("th.colTime")).toHaveAttribute("aria-sort", "descending");
  await dialog.getByRole("button", { name: /^Time/ }).click();
  await expect(dialog.locator("th.colTime")).toHaveAttribute("aria-sort", "ascending");
  expect((await texts(page))[0]).toBe("Command: Machine busy");

  expect(await sidewaysOverflow(dialog), "desktop: content past its box sideways").toEqual([]);
  await settleLayout(page);
  const sent = ((await ctl({ op: "lastCmds" }) as { cmds?: { cmd?: string }[] }).cmds ?? []).map(c => c.cmd ?? "");
  expect(sent.filter(c => MACHINE_CMDS.includes(c)), "a message center moves nothing").toEqual([]);
});

test("the trash deletes at once — no dialog; Copy names the type and the origin; Copy Shown copies exactly the rows shown", async ({ page }) => {
  await setup(page);
  await open(page);
  const dialog = center(page);
  const row = (text: string) => dialog.locator("tbody tr").filter({ has: page.locator("td.msgText", { hasText: text }) });

  await row("Unknown word starting with E").getByRole("button", { name: "Copy message", exact: true }).click();
  await expect.poll(() => copied(page)).toHaveLength(1);
  expect((await copied(page))[0]).toMatch(/^\[ERROR · LinuxCNC\] .+ — Unknown word starting with E$/);
  await row("Command: Machine busy").getByRole("button", { name: "Copy message", exact: true }).click();
  await expect.poll(() => copied(page)).toHaveLength(2);
  expect((await copied(page))[1], "no origin, no origin word").toMatch(/^\[ERROR\] .+ — Command: Machine busy$/);

  await filter(page).selectOption({ label: "Errors" });
  await dialog.getByRole("button", { name: "Copy Shown", exact: true }).click();
  await expect.poll(() => copied(page)).toHaveLength(3);
  const lines = (await copied(page))[2]!.split("\n");
  expect(lines).toHaveLength(7);
  expect(lines.every(l => l.startsWith("[ERROR"))).toBe(true);
  expect(lines[0]).toContain("Run-from-line pre_measure");
  await filter(page).selectOption({ label: "All messages" });

  await row("Saved haus.ngc").getByRole("button", { name: "Delete message", exact: true }).click();
  await expect(row("Saved haus.ngc")).toHaveCount(0);
  await expect(dialog).toHaveAccessibleName("Messages (11)");
  await expect(page.getByRole("dialog"), "no confirmation for one message").toHaveCount(1);
  const stored = await page.evaluate(() => (JSON.parse(localStorage.getItem("lcnc-messages") ?? "[]") as { text: string }[]).map(m => m.text));
  expect(stored).not.toContain("Saved haus.ngc");
  expect(stored).toHaveLength(11);
});

test("each message keeps where it came from: LinuxCNC's error channel, or the WebUI", async ({ page }) => {
  await setup(page, { seed: false });
  await ctl({ op: "raw", frame: { type: "status_delta", armed: true, data: {}, errors: [[1, "joint 2 following error"], [6, "Probe the stock first"]] } });
  await ctl({ op: "raw", frame: { type: "reply", cmd: "mdi", ok: false, error: "Machine busy" } });
  await open(page);
  const dialog = center(page);
  await expect.poll(() => texts(page)).toEqual(["Command: Machine busy", "Probe the stock first", "joint 2 following error"]);
  expect(await column(page, "colSource")).toEqual(["WebUI", "LinuxCNC", "LinuxCNC"]);
  expect(await column(page, "colType")).toEqual(["Error", "Display", "Error"]);
  await filter(page).selectOption({ label: "From LinuxCNC" });
  expect(await texts(page)).toEqual(["Probe the stock first", "joint 2 following error"]);
  // and the origin survives a reload (the history is stored per tab)
  await page.reload();
  await settleLayout(page);
  await open(page);
  expect(await column(page, "colSource")).toEqual(["WebUI", "LinuxCNC", "LinuxCNC"]);
  await expect(dialog).toBeVisible();
});

test("a narrow center (150 % portrait) makes each message a card: the text across the card, the actions one over the other, nothing overlapping or sideways", async ({ page }) => {
  await setup(page, { vp: "touch-portrait", zoom: 1.5 });
  await open(page);
  const dialog = center(page);
  await settleLayout(page);
  expect(await sidewaysOverflow(dialog), "150 % portrait: content past its box sideways").toEqual([]);
  await expect(dialog.getByRole("button", { name: /^Time/ })).toBeVisible();
  // the header's Copy / Clear All are symbols here, named as before
  await expect(dialog.getByRole("button", { name: "Copy All", exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Clear All", exact: true })).toBeVisible();
  const cards = await dialog.locator(".msgTable").evaluate(t => {
    const rects = (row: Element) => Object.fromEntries(["colTime", "colType", "colSource", "colText", "colActions"]
      .map(c => [c, row.querySelector(`td.${c}`)!.getBoundingClientRect()]));
    const overlap = (a: DOMRect, b: DOMRect) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5
      && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5;
    return [...t.querySelectorAll("tbody tr")].filter(r => r.querySelector("td.colText")).map(row => {
      const c = rects(row), box = row.getBoundingClientRect();
      const names = Object.keys(c);
      const overlaps = names.flatMap((a, i) => names.slice(i + 1).filter(b => overlap(c[a]!, c[b]!)).map(b => `${a}×${b}`));
      const btns = [...row.querySelectorAll("td.colActions button")].map(b => b.getBoundingClientRect());
      return {
        display: getComputedStyle(row).display,
        overlaps,
        // the text takes the card's width beside the actions — the old
        // dialog left it a few pixels and broke it letter by letter
        textShare: Math.round(c.colText!.width / box.width * 100) / 100,
        textBelowMeta: c.colText!.top >= Math.max(c.colTime!.bottom, c.colType!.bottom, c.colSource!.bottom) - 0.5,
        actionsStacked: btns.length === 2 && btns[1]!.top >= btns[0]!.bottom - 0.5,
      };
    });
  });
  expect(cards).toHaveLength(12);
  for (const [i, card] of cards.entries()) {
    expect(card.display, `card ${i}`).toBe("grid");
    expect(card.overlaps, `card ${i}: cells overlapping`).toEqual([]);
    expect(card.textShare, `card ${i}: text width share`).toBeGreaterThan(0.6);
    expect(card.textBelowMeta, `card ${i}: text under time, type and source`).toBe(true);
    expect(card.actionsStacked, `card ${i}: Copy over the trash`).toBe(true);
  }
});
