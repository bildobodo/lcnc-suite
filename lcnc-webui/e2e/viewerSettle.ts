// When a viewer picture may be read (the parallel measurement, 2026-11-03):
// a fixed wait after a view preset or a scene change was read mid-turn or
// before the frame under load. These wait for what the reading needs.
import { expect, type Page } from "./test";

/** The top view (z+) stands: X to the right, Y up on the page, the map the
 *  same in two reads a frame apart — the preset turns over 300 ms of frames,
 *  and a map read 400 ms after it began was taken mid-turn under load: the
 *  soup laid off screen, "measured 0" (the parallel measurement, 2026-11-03). */
export async function topViewStands(page: Page) {
  let last = "";
  await expect.poll(async () => {
    const [o, ex, ey] = (await page.evaluate(() => window.__viewerDiag!.projectPoints!([[0, 0, 0], [100, 0, 0], [0, 100, 0]])))!;
    await framesDrawn(page, 1);
    const now = JSON.stringify([o, ex, ey]);
    const top = Math.abs(ex!.y - o!.y) < 0.5 && Math.abs(ey!.x - o!.x) < 0.5 && ex!.x > o!.x && ey!.y < o!.y;
    const still = top && now === last;
    last = now;
    return still;
  }, { message: "the top view stands", intervals: [50] }).toBe(true);
}
/** `n` frames drawn after this point (the viewer draws in its own frame). */
export const framesDrawn = (page: Page, n = 2) => page.evaluate(n => new Promise<void>(done => {
  const step = (k: number) => (k ? requestAnimationFrame(() => step(k - 1)) : done());
  step(n);
}), n);
