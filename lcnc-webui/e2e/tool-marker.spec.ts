import { writeFileSync } from "node:fs";
import { test, expect, type Page } from "./test";
import { ctl, MOCK, publishToolTable } from "./ctl";

// The loaded tool's mark beside its T button (operator 2026-11-07: "the green
// dot does not sit centred in the row — beside the T… button the heights do
// not match"). The mark's centre on its button's, in layout and in drawn
// pixels (mark = |drawn − mark hidden|; the button's drawn box from its
// layout, which the browser draws snapped to device pixels), at DPR 1 and 2,
// desktop and touch. TOOL_OUT=<file> writes the rows. Red at 5bdfdde3: the mark 1.5 px
// below the button (inline, `vertical-align: middle` beside it).

const PERMS_ALL = {
  idle: true, jog: true, override: true, ready: true, run: true, pause: false,
  resume: false, step: true, abort: true, spindleStop: true, probe: true, zero: true,
  machineFrame: true, goZero: true, planeFrame: true,
  touchoff: true, touchoffRotary: true, twpCapture: true,
  surfaceComp: true, safety: true, setup: true, sourceWrite: true, toolTableWrite: true, armed: true, always: true,
  programLoad: true, modeManual: true, modeCoord: true, parameterRead: true, g30Write: true, spindleManual: true, armEnable: true, estopReset: true,
};
// one row a line tall, one whose description wraps (a taller row)
const TOOLS = [
  { T: 5, P: 5, Z: -40.12, D: 6, type: "endmill", description: "Test cutter", remark: "" },
  { T: 12, P: 12, Z: -55.5, D: 10, type: "drill",
    description: "HSS drill with a long description that wraps onto a second line in the side pane", remark: "" },
];
// the mark's centre within this of its button's (layout and drawn)
const TOL = 0.5;

async function measure(page: Page, tool: number, dpr: number) {
  const row = page.locator(".toolsTab tbody tr.activeTool");
  await expect(row.locator(".colT")).toContainText(`T${tool}`);
  await row.evaluate(el => el.scrollIntoView({ block: "center" }));
  const geo = await row.evaluate(tr => {
    const btn = tr.querySelector(".colT button")!.getBoundingClientRect();
    const mark = tr.querySelector(".colT .inSpindle svg")!.getBoundingClientRect();
    const r = tr.getBoundingClientRect();
    return { btn: [btn.left, btn.top, btn.width, btn.height], mark: [mark.left, mark.top, mark.width, mark.height],
             row: [r.top, r.height] };
  });
  const [mx, my, mw, mh] = geo.mark as [number, number, number, number];
  const clip = { x: mx - 3, y: my - 3, width: mw + 6, height: mh + 6 };
  const drawn = (await page.screenshot({ clip, animations: "disabled" })).toString("base64");
  const tag = await page.addStyleTag({ content: ".inSpindle { visibility: hidden !important; }" });
  await page.evaluate(() => new Promise(requestAnimationFrame));
  const hidden = (await page.screenshot({ clip, animations: "disabled" })).toString("base64");
  await tag.evaluate(t => (t as Element).remove());
  const tool_ = await page.context().newPage();
  await tool_.setContent("<!doctype html><title>decode</title>");
  const cy = await tool_.evaluate(async ([a, b, dpr]) => {
    async function px(b64: string) {
      const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode();
      const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
      const x = c.getContext("2d")!; x.drawImage(img, 0, 0);
      return x.getImageData(0, 0, c.width, c.height);
    }
    const [d, h] = await Promise.all([px(a), px(b)]);
    let sw = 0, sy = 0;
    for (let i = 0; i < d.width * d.height; i++) {
      const w = Math.abs(d.data[4 * i]! - h.data[4 * i]!) + Math.abs(d.data[4 * i + 1]! - h.data[4 * i + 1]!)
        + Math.abs(d.data[4 * i + 2]! - h.data[4 * i + 2]!);
      sw += w; sy += w * (Math.floor(i / d.width) + 0.5);
    }
    return sw ? sy / sw / dpr - 3 : null;
  }, [drawn, hidden, dpr] as const);
  await tool_.close();
  const [, by, , bh] = geo.btn as number[];
  const btnMid = by! + bh! / 2;
  const r2 = (v: number) => Math.round(v * 100) / 100;
  return { tool, rowH: r2(geo.row[1]!), btnH: r2(bh!), markH: r2(mh),
           layout: r2(my + mh / 2 - btnMid), drawn: cy === null ? null : r2(my + cy - btnMid),
           rowMid: r2(my + mh / 2 - (geo.row[0]! + geo.row[1]! / 2)) };
}

for (const { dpr, touch } of [{ dpr: 1, touch: false }, { dpr: 2, touch: false }, { dpr: 1, touch: true }]) {
  const form = `${touch ? "touch" : "desktop"}, DPR ${dpr}`;
  test.describe(form, () => {
    test.use({ deviceScaleFactor: dpr, viewport: { width: 1600, height: 1000 }, hasTouch: touch });

    test(`the loaded tool's mark sits centred on its T button (${form})`, async ({ page }) => {
      await ctl({ op: "reset" });
      await page.goto(MOCK);
      await expect(page.locator("input.setupInput").first()).toBeVisible();
      if (touch) {
        await page.touchscreen.tap(5, 400);
        await expect(page.locator("html")).toHaveClass(/touch-device/);
      }
      await ctl({ op: "status_delta", data: { permissions: PERMS_ALL, tool_number: 5 } });
      await page.getByRole("tab", { name: "Tools", exact: true }).click();
      await publishToolTable(TOOLS);
      await expect.poll(() => page.locator(".toolsTab tbody tr").count()).toBe(2);
      await page.mouse.move(0, 0);
      const rows = [await measure(page, 5, dpr)];
      await ctl({ op: "status_delta", data: { tool_number: 12 } });
      rows.push(await measure(page, 12, dpr));
      if (process.env.TOOL_OUT) writeFileSync(`${process.env.TOOL_OUT}-${touch ? "touch" : "desktop"}-${dpr}.json`, JSON.stringify(rows, null, 1));
      for (const r of rows) {
        expect(Math.abs(r.layout), `T${r.tool}: the mark's centre − the button's, in layout`).toBeLessThanOrEqual(TOL);
        expect(r.drawn, `T${r.tool}: the mark is drawn`).not.toBeNull();
        expect(Math.abs(r.drawn!), `T${r.tool}: the mark's drawn centre − the button's`).toBeLessThanOrEqual(TOL);
      }
    });
  });
}
