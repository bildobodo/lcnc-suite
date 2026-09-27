import { test, expect, type Page } from "@playwright/test";
import { ctl, MOCK } from "./ctl";

// Design wave D1 — feedback channels (plan WP-D1, UI-K18, UI-D04, UI-D08).
//  - A dimmed control's reason is told AT the control (the transient hint,
//    placed inside the window, closed by the next touch or key) and nowhere
//    else: never the status line, never the message log (reserved for
//    machine information — operator, D1 live look), never the machine.
//  - The hint and the "?" help popover are ONE card, and it wraps.
//  - The status banner has two tiers (error / warn); its "why" is reachable by
//    a tap (the message center opens with the condition on top), and every way
//    out of the message center marks it read.
//  - A failed read explains itself where it happened; only a retryable failure
//    offers Retry, a permanent refusal keeps the last valid listing.
// Mock-global state (status deltas, recorded commands): runs under
// `serial-guards`, one file at a time.

const PERMS_ALL = {
  idle: true, jog: true, override: true, ready: true, run: true, pause: false,
  resume: false, step: true, abort: true, probe: true, zero: true,
  machineFrame: true, goZero: true, planeFrame: true,
  touchoff: true, touchoffRotary: true, twpCapture: true,
  surfaceComp: true, safety: true, setup: true, armed: true, always: true,
};

// Every machine gate closed with ONE long reason (it wraps to several lines):
// only `armed` and `always` stay open, so navigation still works.
const LONG = "Unavailable in this test state — every machine gate is closed on purpose so the reason bubble is placed next to controls at all four edges of the window, and it must stay inside it";
const CLOSED = Object.fromEntries(Object.keys(PERMS_ALL).map(k => [k, k === "armed" || k === "always"]));
const REASONS = Object.fromEntries(Object.keys(PERMS_ALL).filter(k => !CLOSED[k]).map(k => [k, LONG]));

const READ_ONLY_CMDS = ["hello", "heartbeat", "get_tool_table", "halshow_live", "timing_log",
                        "tab_visibility", "save_settings", "load_file"];

async function recordedCmds(): Promise<string[]> {
  const sent = await ctl({ op: "lastCmds" }) as { cmds?: { cmd?: string }[] };
  return (sent.cmds ?? []).map(c => c.cmd ?? "");
}

function expectNoMachineAction(cmds: string[]) {
  expect(cmds.filter(c => !READ_ONLY_CMDS.includes(c))).toEqual([]);
}

async function openReady(page: Page) {
  await ctl({ op: "reset" });
  await page.goto(MOCK);
  await expect(page.locator("input.setupInput").first()).toBeVisible();
  await ctl({ op: "quiet", on: true });
  await ctl({ op: "status_delta", data: { active_file: "/A.ngc", permissions: PERMS_ALL } });
  await ctl({ op: "raw", frame: { type: "settings_init", settings: {} } });
  await expect(page.locator(".safetyStrip")).toBeVisible();
  await ctl({ op: "clearCmds" });
}

async function closeEverything(page: Page) {
  // homed: false → the banner offers Home All (top edge), itself dimmed.
  await ctl({ op: "status_delta", data: { homed: false, permissions: CLOSED, permission_reasons: REASONS } });
  await expect(page.locator(".btnTip").first()).toBeVisible();
  // These sweeps outlast the client's status-stall timeout: the mock answers
  // heartbeats again (its full frames carry the deltas above), so the page
  // stays connected and the status line stays the machine state.
  await ctl({ op: "quiet", on: false });
  await expect(page.locator(".bannerContent")).toHaveText("NOT HOMED");
}

/** Message-log entries holding `text` (the log is for machine information:
 *  a dimmed control's reason must never land there). */
async function logEntries(page: Page, text: string): Promise<number> {
  return page.evaluate(t => {
    const all = JSON.parse(localStorage.getItem("lcnc-messages") ?? "[]") as { text: string }[];
    return all.filter(m => m.text === t).length;
  }, text);
}

type Box = { x: number; y: number; width: number; height: number };

/** The hint is shown for `anchor`, lies wholly inside the window and sits
 *  directly above or below the control, overlapping it horizontally. */
async function expectHintAt(page: Page, anchor: Box) {
  const vp = page.viewportSize()!;
  const hint = page.locator("[data-btn-hint]");
  await expect(hint).toHaveText(LONG);
  let box: Box | null = null;
  await expect.poll(async () => {
    box = await hint.boundingBox();
    if (!box) return "no box";
    if (box.x < 0 || box.y < 0 || box.x + box.width > vp.width + 0.5 || box.y + box.height > vp.height + 0.5) return "outside the window";
    const above = box.y + box.height <= anchor.y + 0.5;
    const below = box.y >= anchor.y + anchor.height - 0.5;
    if (!above && !below) return "covers its control";
    if (box.x > anchor.x + anchor.width || box.x + box.width < anchor.x) return "not at its control";
    return "ok";
  }, { message: `hint for the control at ${JSON.stringify(anchor)}` }).toBe("ok");
  return box! as Box;
}

/** Every dimmed button the pointer can reach right now, by position. */
async function reachableTips(page: Page): Promise<Box[]> {
  return page.evaluate(() => {
    const out: { x: number; y: number; width: number; height: number }[] = [];
    for (const el of document.querySelectorAll<HTMLElement>(".btnTip")) {
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      if (r.width === 0 || cx < 0 || cy < 0 || cx > innerWidth || cy > innerHeight) continue;
      const hit = document.elementFromPoint(cx, cy);
      if (!hit || !el.contains(hit)) continue;
      out.push({ x: r.left, y: r.top, width: r.width, height: r.height });
    }
    return out;
  });
}

test.afterEach(async ({ page }) => {
  await page.evaluate(() => { document.documentElement.style.zoom = ""; }).catch(() => {});
  await ctl({ op: "quiet", on: false });
  await ctl({ op: "reset" });
});

test("a dimmed control's reason is told at the control, inside the window, at every edge — nothing logged, the status line stays", async ({ page }) => {
  await openReady(page);
  await closeEverything(page);
  const statusLine = page.locator(".bannerContent");
  const messagesBtn = page.getByRole("button", { name: /^Messages \(/ });
  const unreadBefore = await messagesBtn.getAttribute("title");
  let told = 0;
  const edges = { top: 0, bottom: 0, left: 0, right: 0 };

  for (const layout of [
    { name: "landscape 1280×800", width: 1280, height: 800, zoom: "1" },
    { name: "portrait 900×1200 at 150 %", width: 900, height: 1200, zoom: "1.5" },
  ]) {
    await page.setViewportSize({ width: layout.width, height: layout.height });
    await page.evaluate(z => { document.documentElement.style.zoom = z; }, layout.zoom);
    await expect.poll(async () => (await reachableTips(page)).length, { message: layout.name }).toBeGreaterThan(5);
    const lineBefore = (await statusLine.textContent()) ?? "";
    for (const anchor of await reachableTips(page)) {
      await page.mouse.click(anchor.x + anchor.width / 2, anchor.y + anchor.height / 2);
      told++;
      const hint = await expectHintAt(page, anchor);
      const cx = anchor.x + anchor.width / 2;
      if (anchor.y - hint.height < 6) edges.top++;
      if (anchor.y + anchor.height + hint.height > layout.height - 6) edges.bottom++;
      if (cx - hint.width / 2 < 0) edges.left++;
      if (cx + hint.width / 2 > layout.width) edges.right++;
      await expect(statusLine, `${layout.name}: the status line keeps the machine state`).toHaveText(lineBefore);
    }
  }
  // The sweep reached controls at all four edges (Home All in the banner,
  // the safety strip's power button, the strips, the side panel).
  for (const [edge, n] of Object.entries(edges)) expect(n, `controls at the ${edge} edge: ${JSON.stringify(edges)}`).toBeGreaterThan(0);
  expect(told).toBeGreaterThan(10);
  // Nothing logged, nothing counted.
  expect(await logEntries(page, LONG)).toBe(0);
  await expect(messagesBtn).toHaveAttribute("title", unreadBefore ?? "");
  expectNoMachineAction(await recordedCmds());
});

test("the hint closes on the next touch or key anywhere, and it is the same card as the help popover", async ({ page }) => {
  await openReady(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await closeEverything(page);
  const hint = page.locator("[data-btn-hint]");
  const tip = page.locator(".btnTip", { has: page.getByRole("button", { name: "Go to WCS 0", exact: true }) });
  // A press anywhere else closes it at once (it never lingers over buttons).
  await tip.click();
  await expect(hint).toBeVisible();
  await page.mouse.click(5, 790);
  await expect(hint).toHaveCount(0);
  // So does any key.
  await tip.click();
  await expect(hint).toBeVisible();
  await page.keyboard.press("Shift");
  await expect(hint).toHaveCount(0);
  // One look: the hint and the "?" popover share their card.
  await tip.click();
  const card = (sel: string) => page.locator(sel).first().evaluate(el => {
    const cs = getComputedStyle(el);
    return [cs.backgroundColor, cs.borderTopColor, cs.borderTopWidth, cs.borderRadius, cs.boxShadow,
      cs.fontSize, cs.lineHeight, cs.paddingTop, cs.paddingLeft, cs.whiteSpace, cs.textTransform].join(" | ");
  });
  const hintCard = await card("[data-btn-hint]");
  await page.getByRole("button", { name: "Help: Go to positions", exact: true }).click();
  const popover = page.locator(".helpPopover").filter({ hasText: "tool-change position" });
  await expect(popover).toBeVisible();
  expect(await card(".helpPopover:popover-open")).toBe(hintCard);
  expectNoMachineAction(await recordedCmds());
});

test("the reason also answers the keyboard, a dimmed input and a control inside a dialog", async ({ page }) => {
  await openReady(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await closeEverything(page);

  // Keyboard: Enter and Space on the focused wrapper tell it; Space never
  // reaches the Cycle Start shortcut (a program is loaded).
  const goZero = page.getByRole("button", { name: "Go to WCS 0", exact: true });
  const tip = page.locator(".btnTip", { has: goZero });
  const tipBox = (await tip.boundingBox())!;
  await tip.focus();
  await page.keyboard.press("Enter");
  await expectHintAt(page, tipBox);
  await page.keyboard.press(" ");
  await expectHintAt(page, tipBox);

  // A dimmed INPUT is the anchor too (it explains on pointerdown).
  await page.getByRole("tab", { name: "MDI", exact: true }).click();
  const mdi = page.locator(".mdiInput");
  await expect(mdi).toBeDisabled();
  await mdi.click({ force: true });
  await expectHintAt(page, (await mdi.boundingBox())!);

  // Inside a dialog: the hint rides above the dialog layer.
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const dialog = page.locator(".dialogOverlay").last();
  const reset = dialog.locator(".btnTip").first();
  await reset.scrollIntoViewIfNeeded();
  await reset.click();
  await expectHintAt(page, (await reset.boundingBox())!);
  const [hintZ, overlayZ] = await page.evaluate(() => [
    Number(getComputedStyle(document.querySelector("[data-btn-hint]")!).zIndex),
    Number(getComputedStyle(document.querySelector(".dialogOverlay")!).zIndex),
  ]);
  expect(hintZ).toBeGreaterThan(overlayZ);

  expect(await logEntries(page, LONG)).toBe(0);
  expectNoMachineAction(await recordedCmds());
});

test("the banner has two tiers, its why opens with a tap, and every way out of the message center marks it read", async ({ page }) => {
  await openReady(page);
  const banner = page.locator(".bannerContent");
  const delta = (extra: Record<string, unknown>) =>
    ctl({ op: "raw", frame: { type: "status_delta", armed: true, data: {}, ...extra } });

  // A machine message still takes over the status line and counts (N22 keeps
  // machine messages; only quiet entries stay off it).
  await delta({ errors: [[2, "Probe tripped before contact"]] });
  await expect(banner).toContainText("Probe tripped before contact");
  const count = page.locator(".bannerActions").getByRole("button", { name: /^1 message$/ });
  await expect(count).toBeVisible();
  // The count opens the message center; the BACKDROP closes it and marks read.
  await count.click();
  const overlay = page.locator(".dialogOverlay").last();
  await expect(overlay.locator(".msgText").first()).toContainText("Probe tripped before contact");
  await overlay.click({ position: { x: 4, y: 4 } });
  await expect(overlay).toHaveCount(0);
  await expect(count).toHaveCount(0);

  // Error tier: safety, machine, connection.
  await delta({ reader_stale: true });
  await expect(banner.locator(".bannerError")).toContainText("HAL reader stale");
  await expect(banner.locator(".bannerWarn")).toHaveCount(0);

  // Warn tier: program, preview, configuration.
  await delta({ config_warning: { reason: "no [DISPLAY] LINEAR_UNITS" } });
  await expect(banner.locator(".bannerWarn")).toContainText("Config fallback");
  await expect(banner.locator(".bannerError")).toHaveCount(0);

  // A tap on the banner opens the message center with the condition and its
  // why on top — nothing essential lives only in a hover title.
  await banner.click();
  const note = page.locator(".dialogOverlay").last().locator(".statusNote.warn");
  await expect(note).toContainText("Config fallback");
  await expect(note).toContainText("The gateway runs on a fallback");
  await page.getByRole("button", { name: "Close messages", exact: true }).click();
  await expect(page.locator(".dialogOverlay")).toHaveCount(0);

  // The trip acknowledgement is a banner action (bannerAck), error tier.
  await delta({ config_warning: null, safety_trip: { reason: "hb_timeout" } });
  await expect(banner.locator(".bannerError")).toContainText("SAFETY TRIPPED");
  await expect(page.locator(".bannerActions").getByRole("button", { name: "Acknowledge", exact: true })).toBeVisible();
  await delta({ safety_trip: null });
  expectNoMachineAction((await recordedCmds()).filter(c => c !== "safety_trip_ack"));
});

test("a program the gateway cannot confirm after a restart is named, not loaded — Load resolves it (Codex R16 XZ-08)", async ({ page }) => {
  await openReady(page);
  const banner = page.locator(".bannerContent");
  await ctl({ op: "raw", frame: { type: "status_delta", armed: true,
    data: { active_file: null, program_unconfirmed: "/nc/shared/probe.ngc" } } });
  await expect(banner.locator(".bannerWarn")).toContainText("Program not confirmed — probe.ngc");
  await page.locator(".bannerActions").getByRole("button", { name: "Load program", exact: true }).click();
  await expect.poll(async () => ((await ctl({ op: "lastCmds" })).cmds as { cmd?: string; path?: string }[])
    .filter(c => c.cmd === "load_file").map(c => c.path)).toEqual(["/nc/shared/probe.ngc"]);
  await ctl({ op: "raw", frame: { type: "status_delta", armed: true,
    data: { active_file: "/nc/shared/probe.ngc", program_unconfirmed: null } } });
  await expect(banner.locator(".bannerWarn")).toHaveCount(0);
});

test("a refused folder keeps the last listing and offers no Retry; a transient failure retries", async ({ page }) => {
  let mode: "ok" | "refuse" | "down" = "ok";
  await page.route(url => url.pathname === "/files", route => {
    const sub = new URL(route.request().url()).searchParams.get("subdir") ?? "";
    if (mode === "refuse" && sub) return route.fulfill({ status: 400, json: { detail: "Invalid directory" } });
    if (mode === "down") return route.fulfill({ status: 503, json: { detail: "Program folder temporarily unavailable" } });
    return route.fulfill({ json: { ok: true, nc_dir: "/nc_files", subdir: sub, entries: sub
      ? [{ name: "b.ngc", type: "file", path: "sub/b.ngc", size: 10 }]
      : [{ name: "sub", type: "directory", path: "sub" }, { name: "a.ngc", type: "file", path: "a.ngc", size: 20 }] } });
  });
  await openReady(page);
  await page.getByRole("button", { name: "Files", exact: true }).click();
  const browser = page.getByRole("region", { name: "Server programs" });
  await expect(browser.getByRole("button", { name: "a.ngc", exact: true })).toBeVisible();

  // 400: a permanent refusal — explained in place, no Retry, the listing stays.
  mode = "refuse";
  await browser.getByRole("button", { name: "sub", exact: true }).click();
  const note = browser.locator(".statusNote.error");
  await expect(note).toContainText("cannot be opened");
  await expect(note).toHaveAttribute("role", "alert");
  await expect(browser.getByRole("button", { name: "Retry", exact: true })).toHaveCount(0);
  await expect(browser.getByRole("button", { name: "a.ngc", exact: true })).toBeVisible();

  // 503: may change — Retry, and a Retry that succeeds clears the note.
  mode = "down";
  await browser.getByRole("button", { name: "sub", exact: true }).click();
  await expect(note).toContainText("temporarily unavailable");
  const retry = browser.getByRole("button", { name: "Retry", exact: true });
  await expect(retry).toBeVisible();
  mode = "ok";
  await retry.click();
  await expect(browser.getByRole("button", { name: "b.ngc", exact: true })).toBeVisible();
  await expect(note).toHaveCount(0);
});

// Every "?" help, opened where it lives: its card lies inside the window and
// WRAPS — never one endless line with a sideways scroll (D1 live look: a
// popover inherits `white-space: nowrap` from a HUD row or a stats label
// through the DOM, even in the top layer).
test("every help popover wraps and stays inside the window, in every tab", async ({ page }) => {
  test.setTimeout(180_000);
  await openReady(page);
  await ctl({ op: "quiet", on: false });
  const vp = page.viewportSize()!;
  const opened: string[] = [];
  async function sweep(view: string, root = page.locator("body")) {
    const icons = root.locator(".helpIcon:visible");
    const n = await icons.count();
    for (let i = 0; i < n; i++) {
      const icon = icons.nth(i);
      const name = `${view} · ${await icon.getAttribute("aria-label")}`;
      // centred: a scroller's sticky head (the Settings tab row) covers
      // whatever is scrolled to its top edge
      await icon.evaluate(el => el.scrollIntoView({ block: "center" }));
      await icon.click();
      const pop = page.locator(".helpPopover:popover-open");
      await expect(pop, name).toHaveCount(1);
      await expect.poll(async () => pop.evaluate((el, vp) => {
        const r = el.getBoundingClientRect();
        if (el.scrollWidth > el.clientWidth + 1) return `scrolls sideways (${el.scrollWidth} > ${el.clientWidth})`;
        // short and precise, rendered (interpolations included): the audit's
        // LONG_HELP holds the authored text to 120
        const n = (el.textContent ?? "").replace(/\s+/g, " ").trim().length;
        if (n > 140) return `${n} characters — an abstract, not a help`;
        if (r.left < 0 || r.top < 0 || r.right > vp.width + 0.5 || r.bottom > vp.height + 0.5) return "outside the window";
        return "ok";
      }, vp), { message: name }).toBe("ok");
      await icon.click();   // toggles it closed (Escape would be E-Stop)
      await expect(pop).toHaveCount(0);
      opened.push(name);
    }
  }
  const side = page.locator(".sidePane");
  await sweep("strips", page.locator(".strip"));
  for (const tab of ["Program", "MDI", "Offsets", "Tools"]) {
    await side.getByRole("tab", { name: tab, exact: true }).click();
    await sweep(tab, side);
  }
  await side.getByRole("tab", { name: "Probing", exact: true }).click();
  for (const sub of ["Outside", "Inside", "Angle", "Boss/Pocket", "Ridge/Valley", "Surface", "Calibrate", "Toolsetter"]) {
    await side.getByRole("tab", { name: sub, exact: true }).click();
    await sweep(`Probing/${sub}`, side);
  }
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const settings = page.locator(".dialogOverlay").last();
  for (const tab of ["3D Viewer", "Machine", "Display", "Macros", "Gamepad", "Keyboard"]) {
    await settings.getByRole("tab", { name: tab, exact: true }).click();
    await sweep(`Settings/${tab}`, settings);
  }
  expect(opened.length, opened.join("\n")).toBeGreaterThan(40);

  // The CSS contract itself, where no fixture state renders one: a card
  // inside a non-wrapping, uppercase parent (a HUD row, a strip title).
  const wraps = await page.evaluate(() => {
    const host = document.createElement("div");
    host.style.cssText = "white-space: nowrap; text-transform: uppercase; width: 200px";
    const card = document.createElement("div");
    card.className = "helpPopover";
    card.style.position = "static";
    card.textContent = "A long explanation that must wrap inside its card instead of running off as one line ".repeat(3);
    host.append(card);
    document.body.append(host);
    const r = { sw: card.scrollWidth, cw: card.clientWidth, ws: getComputedStyle(card).whiteSpace, tt: getComputedStyle(card).textTransform };
    host.remove();
    return r;
  });
  expect(wraps).toMatchObject({ ws: "normal", tt: "none" });
  expect(wraps.sw).toBeLessThanOrEqual(wraps.cw + 1);
});

// Operator (D1 live look): some "?" looked muted, some not, all of them
// clickable — and some sat flush against their label. ONE look: the icon's
// EFFECTIVE opacity (an ancestor's opacity multiplies into a child and no
// child rule can undo it) and colour are the same everywhere, the icon is
// never disabled by a gate (reading help is not a machine action), and it
// keeps the same gap after the text it explains.
test("every help icon has one look: full opacity, one colour, enabled, the same gap after its label", async ({ page }) => {
  test.setTimeout(180_000);
  await openReady(page);
  await ctl({ op: "quiet", on: false });
  type Look = { name: string; opacity: number; color: string; background: string; border: string; disabled: boolean; gap: number | null; lift: number | null };
  const looks: Look[] = [];
  async function sweep(view: string, root = page.locator("body")) {
    const icons = root.locator(".helpIcon:visible");
    const n = await icons.count();
    for (let i = 0; i < n; i++) {
      const icon = icons.nth(i);
      const name = `${view} · ${await icon.getAttribute("aria-label")}`;
      const look = await icon.evaluate(el => {
        let opacity = 1;
        for (let e: Element | null = el; e; e = e.parentElement) opacity *= parseFloat(getComputedStyle(e).opacity);
        const cs = getComputedStyle(el);
        // The text it explains: the nearest preceding non-blank text node on
        // the same line (a label's own text, or a sibling span's).
        let gap: number | null = null, lift: number | null = null;
        const box = el.getBoundingClientRect();
        const walker = document.createTreeWalker(el.parentElement!.parentElement ?? document.body, NodeFilter.SHOW_TEXT);
        let last: DOMRect | null = null;
        for (let t = walker.nextNode(); t; t = walker.nextNode()) {
          if (el.contains(t)) break;
          if (!(t.textContent ?? "").trim()) continue;
          if (!(el.compareDocumentPosition(t) & Node.DOCUMENT_POSITION_PRECEDING)) break;
          // up to its last VISIBLE character: a trailing space in the
          // template is part of the gap the eye sees
          const text = t.textContent ?? "";
          const end = text.replace(/\s+$/, "").length;
          const r = document.createRange(); r.setStart(t, Math.max(0, end - 1)); r.setEnd(t, end);
          const rects = [...r.getClientRects()];
          const rr = rects[rects.length - 1];
          if (rr && rr.bottom > box.top && rr.top < box.bottom && rr.right <= box.left + 0.5) last = rr;
        }
        // a strip title pins its icon to the right edge on purpose
        const pinned = ["absolute", "fixed"].includes(getComputedStyle(el).position);
        if (last && !pinned) {
          gap = Math.round((box.left - last.right) * 10) / 10;
          // centred on the text's line, not hanging below it
          lift = Math.round(((last.top + last.bottom) / 2 - (box.top + box.bottom) / 2) * 10) / 10;
        }
        return { opacity: Math.round(opacity * 100) / 100, color: cs.color, background: cs.backgroundColor,
                 border: cs.borderTopColor, disabled: (el as HTMLButtonElement).disabled || el.matches(":disabled"), gap, lift };
      });
      looks.push({ name, ...look });
    }
  }
  const side = page.locator(".sidePane");
  await sweep("strips", page.locator(".strip"));
  for (const tab of ["Program", "MDI", "Offsets", "Tools"]) {
    await side.getByRole("tab", { name: tab, exact: true }).click();
    await sweep(tab, side);
  }
  await side.getByRole("tab", { name: "Probing", exact: true }).click();
  for (const sub of ["Outside", "Inside", "Angle", "Boss/Pocket", "Ridge/Valley", "Surface", "Calibrate", "Toolsetter"]) {
    await side.getByRole("tab", { name: sub, exact: true }).click();
    await sweep(`Probing/${sub}`, side);
  }
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const settings = page.locator(".dialogOverlay").last();
  for (const tab of ["3D Viewer", "Machine", "Display", "Macros", "Gamepad", "Keyboard"]) {
    await settings.getByRole("tab", { name: tab, exact: true }).click();
    await sweep(`Settings/${tab}`, settings);
  }
  await settings.getByRole("button", { name: "Close settings", exact: true }).click();
  // Gated: disarmed, the whole content sits in a disabled fieldset. Help is
  // no machine action — the same "?" looks the same and still opens.
  // (The sub-tabs are gated too: switch while armed, measure disarmed.)
  for (const sub of ["Outside", "Calibrate", "Toolsetter"]) {
    await side.getByRole("tab", { name: sub, exact: true }).click();
    await ctl({ op: "status_delta", armed: false, data: {} });
    await expect(page.locator(".pill.disarmed")).toHaveCount(1);
    await sweep(`disarmed Probing/${sub}`, side);
    const gated = side.locator(".helpIcon:visible").first();
    await gated.click();
    await expect(page.locator(".helpPopover:popover-open"), `${sub}: a gated section's help still opens`).toHaveCount(1);
    await gated.click();
    await expect(page.locator(".helpPopover:popover-open")).toHaveCount(0);
    await ctl({ op: "status_delta", armed: true, data: {} });
    await expect(page.locator(".pill.armed")).toHaveCount(1);
  }
  // The kinematics chip in its warning states (Setup strip + HUD): only a
  // switchable-kins machine shows it — the table off the touch-off angle.
  await ctl({ op: "setAxes", axes: ["X", "Y", "Z", "A", "C"] });
  await ctl({ op: "setKins", kins: { module: "xyzac-trt-kins", type: "xyzac-trt", identity_first: true, params: {} } });
  await ctl({ op: "status_delta", data: { kins_type: 0, g5x_index: 1, wcs_prov_a: [0, 0, 0, 0, 0, 0, 0, 0, 0], rotary_abc: [20, 0, 0] } });
  await expect(page.locator(".kinsChip")).toContainText("off datum");
  await sweep("kins chip", page.locator(".kinsChip"));
  await sweep("HUD", page.locator(".hudMode"));
  expect(looks.some(l => l.name.startsWith("HUD")), "the HUD chip carries its help").toBe(true);
  expect(looks.length).toBeGreaterThan(40);
  const ref = looks[0]!;
  const bad = looks.filter(l =>
    l.opacity !== 1 || l.disabled || l.color !== ref.color || l.background !== ref.background || l.border !== ref.border
    || (l.gap !== null && (l.gap < 3 || l.gap > 6)) || (l.lift !== null && Math.abs(l.lift) > 1.5));
  const report = bad.map(l => `${l.name}: opacity ${l.opacity}${l.disabled ? ", DISABLED" : ""}, gap ${l.gap}, off-centre ${l.lift}, ${l.color}`).join("\n");
  expect(bad.length, `help icons off the one look:\n${report}`).toBe(0);
});
