// The ViewCube named by axis (operator 2026-10-04/05, from renders): FRONT /
// LEFT were fixed to the world frame — on the 5-axis sim, whose front is −Y,
// "LEFT" was the front. The faces read X+ … Z−, tinted by their axis; a
// STRAIGHT view shows the face's two in-plane axes as plain arrows on the
// displayed square's border, the whole side long, the letter outside past the
// tip; an oblique view shows none. The corner gizmo — under the scrub bar
// most of the time — is gone.
import { test, expect, type Page } from "@playwright/test";
import { openLayout, PROFILES, VIEWPORTS } from "./layout-fixtures";

type Face = { label: string; opacity: number; border: number[][]; arrows: { axis: string; start: number[]; tip: number[]; letter: number[] }[] };
const cube = (page: Page) => page.evaluate(() => window.__viewerDiag?.getViewCube?.() ?? null);
const faces = async (page: Page) => (await cube(page))!.faces as Face[];
const near = (a: number[], b: number[]) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!);

/** The face a straight view of `preset` looks at. */
const FACE_OF: Record<string, string> = { "x+": "X+", "x-": "X−", "y+": "Y+", "y-": "Y−", "z+": "Z+", "z-": "Z−" };

async function view(page: Page, preset: string) {
  await page.evaluate(p => window.__viewerDiag!.setView!(p), preset);
}

/** The RGB of the cube canvas at a CSS-px point, read from a screenshot the
 *  page decodes (the WebGL canvas keeps no drawing buffer to read back). */
async function pixel(page: Page, at: number[]): Promise<number[]> {
  const shot = await page.locator(".viewerPane .viewCube").screenshot();
  return page.evaluate(async ([b64, x, y]) => {
    const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
    const c = new OffscreenCanvas(bmp.width, bmp.height), ctx = c.getContext("2d")!;
    ctx.drawImage(bmp, 0, 0);
    const k = bmp.width / (document.querySelector(".viewerPane .viewCube") as HTMLElement).clientWidth;
    return [...ctx.getImageData(Math.round((x as number) * k), Math.round((y as number) * k), 1, 1).data].slice(0, 3);
  }, [shot.toString("base64"), at[0], at[1]] as const);
}

test.beforeEach(async ({ page }) => {
  await openLayout(page, PROFILES[1]!, VIEWPORTS.find(v => v.name === "desktop")!);
  await expect.poll(() => cube(page), { message: "the ViewCube is up", timeout: 20_000 }).not.toBeNull();
});

test("the faces are named by axis, and an oblique view shows no arrows", async ({ page }) => {
  expect((await faces(page)).map(f => f.label).sort()).toEqual(["X+", "X−", "Y+", "Y−", "Z+", "Z−"].sort());
  for (const preset of ["iso", "dimetric"]) {
    await view(page, preset);
    await expect.poll(async () => (await faces(page)).filter(f => f.opacity > 0).map(f => f.label), { message: preset }).toEqual([]);
  }
});

test("a straight view shows its face's arrows on the displayed border, the whole side, the letter outside past the tip", async ({ page }) => {
  for (const preset of ["z+", "y-", "x+", "x-", "y+", "z-"]) {
    await view(page, preset);
    const want = FACE_OF[preset]!;
    await expect.poll(async () => (await faces(page)).filter(f => f.opacity > 0).map(f => `${f.label} ${f.opacity}`),
      { message: `${preset}: only ${want}, whole` }).toEqual([`${want} 1`]);
    const f = (await faces(page)).find(x => x.label === want)!;
    const xs = f.border.map(p => p[0]!), ys = f.border.map(p => p[1]!);
    const box = { l: Math.min(...xs), r: Math.max(...xs), t: Math.min(...ys), b: Math.max(...ys) };
    const side = box.r - box.l;
    expect(side, `${preset}: a straight square`).toBeGreaterThan(40);
    expect(Math.abs((box.b - box.t) - side), `${preset}: square`).toBeLessThan(1);
    expect(f.arrows).toHaveLength(2);
    expect(near(f.arrows[0]!.start, f.arrows[1]!.start), `${preset}: one corner`).toBeLessThan(0.01);
    for (const a of f.arrows) {
      const corner = (p: number[]) => Math.min(...f.border.map(c => near(c, p)));
      expect(corner(a.start), `${preset} ${a.axis}: starts on a border corner`).toBeLessThan(0.5);
      expect(corner(a.tip), `${preset} ${a.axis}: ends on a border corner`).toBeLessThan(0.5);
      expect(Math.abs(near(a.start, a.tip) - side), `${preset} ${a.axis}: the whole side`).toBeLessThan(0.5);
      const dx = a.tip[0]! - a.start[0]!, dy = a.tip[1]! - a.start[1]!;
      const outside = Math.abs(dx) > Math.abs(dy)
        ? (dx > 0 ? a.letter[0]! - box.r : box.l - a.letter[0]!)
        : (dy > 0 ? a.letter[1]! - box.b : box.t - a.letter[1]!);
      expect(outside, `${preset} ${a.axis}: the letter outside, past the tip`).toBeGreaterThan(4);
    }
    // the side views: up is +Z; the horizontal arrow runs right from X+ and
    // Y−, left from X− and Y+ (its corner moves with it)
    if (preset[0] !== "z") {
      const h = f.arrows.find(a => Math.abs(a.tip[0]! - a.start[0]!) > 1)!;
      const v = f.arrows.find(a => a !== h)!;
      expect(v.axis, preset).toBe("Z");
      expect(v.tip[1]!, `${preset}: Z up`).toBeLessThan(v.start[1]!);
      expect(h.tip[0]! > h.start[0]! ? "right" : "left", `${preset}: ${h.axis}`).toBe(preset === "x-" || preset === "y+" ? "left" : "right");
    }
  }
});

test("the arrows are drawn in their axis colour on the border (pixels, top view)", async ({ page }) => {
  await view(page, "z+");
  await expect.poll(async () => (await faces(page)).find(f => f.label === "Z+")!.opacity).toBe(1);
  const f = (await faces(page)).find(x => x.label === "Z+")!;
  for (const a of f.arrows) {
    const mid = [(a.start[0]! + a.tip[0]!) / 2, (a.start[1]! + a.tip[1]!) / 2];
    const [r, g, b] = await pixel(page, mid);
    const hue = a.axis === "X" ? r! - Math.max(g!, b!) : g! - Math.max(r!, b!);
    expect(hue, `${a.axis} arrow at ${mid.map(Math.round)}: rgb ${[r, g, b]}`).toBeGreaterThan(60);
  }
});
