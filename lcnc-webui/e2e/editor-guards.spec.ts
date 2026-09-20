import { test, expect, type Page, type Route } from "@playwright/test";
import { ctl, MOCK } from "./ctl";

// WP0 / UI-01 — the editor buffer belongs to the file it was opened on.
// An external program change (browse from another tab, an upload landing,
// a macro loading a file) keeps buffer A bound to A: it is never saved into
// B, never reloaded over B, and every async continuation (CodeMirror import,
// save reply) checks that its session is still the current one.
//
// WP0 / UI-09 — an upload never replaces an existing program silently: the
// gateway's 409 opens Cancel / Rename / Replace.

const TEXT: Record<string, string> = {
  "/A.ngc": "(program A)\nG0 X0\nG1 X10 F100\nM2\n",
  "/B.ngc": "(program B)\nG0 Y0\nG1 Y20 F200\nM2\n",
};

async function routeProgramText(page: Page) {
  await page.route("**/gcode?*", route => {
    const path = new URL(route.request().url()).searchParams.get("path") ?? "";
    return route.fulfill({ contentType: "text/plain", body: TEXT[path] ?? `(unknown ${path})\n` });
  });
}

let version = 100;
async function loadProgram(page: Page, path: string) {
  version++;
  await ctl({ op: "status_delta", data: { active_file: path } });
  await ctl({ op: "raw", frame: { type: "viewer_gcode_ready", version, file: path } });
  await expect(page.locator(".fileName")).toHaveText(path.slice(1));
}

async function open(page: Page) {
  await ctl({ op: "reset" });
  await routeProgramText(page);
  await page.goto(MOCK);
  await expect(page.locator("input.setupInput").first()).toBeVisible();
  await ctl({ op: "quiet", on: true });
  await loadProgram(page, "/A.ngc");
  await expect(page.locator(".codeLine").first()).toContainText("(program A)");
  await ctl({ op: "clearCmds" });
}

async function enterEdit(page: Page) {
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(page.locator(".cm-content")).toBeVisible();
}

async function typeIntoEditor(page: Page, text: string) {
  await page.locator(".cm-content").click();
  await page.keyboard.press("End");
  await page.keyboard.type(text);
  await expect(page.locator(".cm-content")).toContainText(text);
}

async function loadFileCmds(): Promise<string[]> {
  const sent = await ctl({ op: "lastCmds" }) as { cmds?: { cmd?: string; path?: string }[] };
  return (sent.cmds ?? []).filter(c => c.cmd === "load_file").map(c => c.path ?? "");
}

test.afterEach(async () => {
  await ctl({ op: "quiet", on: false });
  await ctl({ op: "reset" });
});

test("external program change keeps buffer A, shows the conflict, saves A only", async ({ page }) => {
  const saves: { path: string; body: string }[] = [];
  await page.route("**/save?*", route => {
    saves.push({ path: new URL(route.request().url()).searchParams.get("path") ?? "", body: route.request().postData() ?? "" });
    return route.fulfill({ json: { ok: true, path: saves.at(-1)!.path, size: 1 } });
  });
  await open(page);
  await enterEdit(page);
  await typeIntoEditor(page, "(edited)");
  await loadProgram(page, "/B.ngc");
  const banner = page.locator("[data-edit-conflict]");
  await expect(banner).toContainText("Program changed to B.ngc");
  await expect(banner).toContainText("editing A.ngc");
  await expect(page.locator(".cm-content")).toContainText("(program A)");
  await expect(page.locator(".cm-content")).not.toContainText("(program B)");
  await banner.getByRole("button", { name: "Keep editing", exact: true }).click();
  await expect(banner).toHaveCount(0);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(() => saves.length).toBe(1);
  expect(saves[0]!.path).toBe("/A.ngc");
  expect(saves[0]!.body).toContain("(edited)");
  // The loaded program is B: A is saved, nothing is reloaded, the editor stays.
  await expect(page.locator(".cm-content")).toBeVisible();
  expect(await loadFileCmds()).toEqual([]);
  // Browse/Unload/Upload are disabled for the session's duration.
  await expect(page.getByRole("button", { name: "Browse", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Unload", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Upload", exact: true })).toBeDisabled();
});

test("program change during a delayed save: no reload of the new program from A", async ({ page }) => {
  let release: (() => void) | null = null;
  const saved: string[] = [];
  await page.route("**/save?*", async route => {
    await new Promise<void>(r => { release = r; });
    saved.push(new URL(route.request().url()).searchParams.get("path") ?? "");
    await route.fulfill({ json: { ok: true, path: "/A.ngc", size: 1 } });
  });
  await open(page);
  await enterEdit(page);
  await typeIntoEditor(page, "(edited)");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("button", { name: "Saving...", exact: true })).toBeVisible();
  await loadProgram(page, "/B.ngc");
  await expect(page.locator("[data-edit-conflict]")).toBeVisible();
  await expect.poll(() => release !== null).toBe(true);
  release!();
  await expect.poll(() => saved).toEqual(["/A.ngc"]);
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeVisible();
  await expect(page.locator(".cm-content")).toContainText("(edited)");
  expect(await loadFileCmds()).toEqual([]);
  // The saved text is the new baseline: Discard closes without a question.
  await page.getByRole("button", { name: "Discard", exact: true }).first().click();
  await expect(page.locator(".dialogOverlay")).toHaveCount(0);
  await expect(page.locator(".codeLine").first()).toContainText("(program B)");
});

test("program change while CodeMirror is still loading: the view shows A and is usable", async ({ page }) => {
  let delayNext = false;
  await page.route("**/static/*.js", async (route: Route) => {
    if (delayNext) await new Promise(r => setTimeout(r, 1200));
    await route.continue();
  });
  await open(page);
  delayNext = true;
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await loadProgram(page, "/B.ngc");
  await expect(page.locator(".cm-content")).toBeVisible({ timeout: 15_000 });
  delayNext = false;
  await expect(page.locator(".cm-content")).toContainText("(program A)");
  await expect(page.locator("[data-edit-conflict]")).toBeVisible();
  await page.locator("[data-edit-conflict]").getByRole("button", { name: "Keep editing", exact: true }).click();
  await typeIntoEditor(page, "(still A)");
  // Discard → dirty → confirm → gone; the code viewer shows the loaded B.
  await page.locator(".editActions").getByRole("button", { name: "Discard", exact: true }).click();
  await expect(page.locator(".dialogTitle", { hasText: "Discard changes?" })).toBeVisible();
  await page.locator(".dialogOverlay").getByRole("button", { name: "Discard", exact: true }).click();
  await expect(page.locator(".cm-content")).toHaveCount(0);
  await expect(page.locator(".codeLine").first()).toContainText("(program B)");
});

test("a discarded session's pending import installs nothing", async ({ page }) => {
  let delayNext = false;
  await page.route("**/static/*.js", async (route: Route) => {
    if (delayNext) await new Promise(r => setTimeout(r, 1200));
    await route.continue();
  });
  await open(page);
  delayNext = true;
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(page.locator(".editActions")).toBeVisible();
  await page.locator(".editActions").getByRole("button", { name: "Discard", exact: true }).click();
  await expect(page.locator(".editActions")).toHaveCount(0);
  await page.waitForTimeout(1600);
  delayNext = false;
  await expect(page.locator(".cm-content")).toHaveCount(0);
  await expect(page.locator(".codeLine").first()).toContainText("(program A)");
  // And a fresh session still works.
  await enterEdit(page);
  await expect(page.locator(".cm-content")).toContainText("(program A)");
});

test("an older save reply never touches a newer session", async ({ page }) => {
  let release: (() => void) | null = null;
  await page.route("**/save?*", async route => {
    await new Promise<void>(r => { release = r; });
    await route.fulfill({ json: { ok: true, path: "/A.ngc", size: 1 } });
  });
  await open(page);
  await enterEdit(page);
  await typeIntoEditor(page, "(edited A)");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await loadProgram(page, "/B.ngc");
  // Leave session A through the banner (dirty → confirm), open B.
  await page.locator("[data-edit-conflict]").getByRole("button", { name: "Discard", exact: true }).click();
  await page.locator(".dialogOverlay").getByRole("button", { name: "Discard", exact: true }).click();
  await expect(page.locator(".codeLine").first()).toContainText("(program B)");
  await enterEdit(page);
  await expect(page.locator(".cm-content")).toContainText("(program B)");
  await expect.poll(() => release !== null).toBe(true);
  release!();
  await page.waitForTimeout(300);
  await expect(page.locator(".cm-content")).toBeVisible();
  await expect(page.locator(".cm-content")).toContainText("(program B)");
  expect(await loadFileCmds()).toEqual([]);
});

test("discard: clean closes at once, dirty asks and Cancel keeps the edit", async ({ page }) => {
  await open(page);
  await enterEdit(page);
  await page.locator(".editActions").getByRole("button", { name: "Discard", exact: true }).click();
  await expect(page.locator(".dialogOverlay")).toHaveCount(0);
  await expect(page.locator(".cm-content")).toHaveCount(0);
  await enterEdit(page);
  await typeIntoEditor(page, "(dirty)");
  await page.locator(".editActions").getByRole("button", { name: "Discard", exact: true }).click();
  await expect(page.locator(".dialogTitle", { hasText: "Discard changes?" })).toBeVisible();
  await page.locator(".dialogOverlay").getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.locator(".dialogOverlay")).toHaveCount(0);
  await expect(page.locator(".cm-content")).toContainText("(dirty)");
});

test("an upload finishing after Edit raises the conflict, never loses the buffer", async ({ page }) => {
  let finish: (() => void) | null = null;
  await page.route("**/upload*", async route => {
    await new Promise<void>(r => { finish = r; });
    await route.fulfill({ json: { ok: true, path: "/B.ngc", filename: "B.ngc", size: 10 } });
  });
  await open(page);
  await page.locator('input[type="file"][accept*=".ngc"]').setInputFiles({
    name: "B.ngc", mimeType: "text/plain", buffer: Buffer.from(TEXT["/B.ngc"]!),
  });
  await enterEdit(page);
  await typeIntoEditor(page, "(edited A)");
  await expect.poll(() => finish !== null).toBe(true);
  finish!();
  await expect.poll(loadFileCmds).toEqual(["/B.ngc"]);
  await loadProgram(page, "/B.ngc");
  await expect(page.locator("[data-edit-conflict]")).toBeVisible();
  await expect(page.locator(".cm-content")).toContainText("(edited A)");
});

test.describe("upload name conflict", () => {
  test("Cancel / Rename / Replace", async ({ page }) => {
    const requests: { url: string; name: string | null }[] = [];
    await page.route("**/upload*", async route => {
      const body = route.request().postData() ?? "";
      const name = /filename="([^"]+)"/.exec(body)?.[1] ?? null;
      requests.push({ url: route.request().url(), name });
      if (!/overwrite=1/.test(route.request().url()) && name === "dup.ngc") {
        return route.fulfill({ status: 409, json: { detail: { error: "exists", filename: "dup.ngc" } } });
      }
      return route.fulfill({ json: { ok: true, path: `/${name}`, filename: name, size: 10 } });
    });
    await open(page);
    const pick = () => page.locator('input[type="file"][accept*=".ngc"]').setInputFiles({
      name: "dup.ngc", mimeType: "text/plain", buffer: Buffer.from("G0 X0\nM2\n"),
    });
    // Cancel
    await pick();
    const dialog = page.locator(".dialogOverlay").filter({ hasText: "Program exists" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("dup.ngc");
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(requests).toHaveLength(1);
    expect(await loadFileCmds()).toEqual([]);
    // Rename
    await pick();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Rename", exact: true })).toBeDisabled();
    await dialog.locator("input").fill("dup2.ngc");
    await dialog.getByRole("button", { name: "Rename", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect.poll(() => requests.length).toBe(3);
    expect(requests[2]!.name).toBe("dup2.ngc");
    expect(requests[2]!.url).not.toMatch(/overwrite=1/);
    await expect.poll(loadFileCmds).toEqual(["/dup2.ngc"]);
    // Replace
    await ctl({ op: "clearCmds" });
    await pick();
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Replace", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect.poll(() => requests.length).toBe(5);
    expect(requests[4]!.url).toMatch(/overwrite=1/);
    expect(requests[4]!.name).toBe("dup.ngc");
    await expect.poll(loadFileCmds).toEqual(["/dup.ngc"]);
  });
});
