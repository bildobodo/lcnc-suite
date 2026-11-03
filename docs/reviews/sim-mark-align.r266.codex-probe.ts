
// Codex R266: paired legacy/current CSS measurement, isolated mock only.
for (const vp of ['desktop', 'touch-fullhd', 'touch-portrait']) {
  test(`R266 independent ${vp} at 150 percent: row centres and legacy negative control`, async ({ page, context }, info) => {
    await prepare(page, context, vp);
    await page.evaluate(async () => { document.documentElement.style.zoom = '1.5'; await document.fonts.ready; });
    await settleLayout(page);
    const measure = () => page.locator('.simPanel tbody tr[data-sim-row]').evaluateAll(els => els.map(e => {
      const cell = e.querySelector('.colKind')!.getBoundingClientRect();
      const glyph = e.querySelector('.colKind svg')!.getBoundingClientRect();
      const label = document.createRange(); label.selectNodeContents(e.querySelector('.rowPick')!);
      const text = label.getBoundingClientRect();
      return { key: e.getAttribute('data-sim-row'),
        lineOffset: (glyph.top + glyph.bottom - text.top - text.bottom) / 2,
        cellOffsetY: (glyph.top + glyph.bottom - cell.top - cell.bottom) / 2,
        cellOffsetX: (glyph.left + glyph.right - cell.left - cell.right) / 2,
        display: getComputedStyle(e.querySelector('.colKind svg')!).display };
    }));
    const current = await measure();
    expect(current).toHaveLength(6);
    for (const row of current) {
      expect(row.display).toBe('block');
      expect(Math.abs(row.lineOffset)).toBeLessThanOrEqual(0.75 * 1.5);
      expect(Math.abs(row.cellOffsetY)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(row.cellOffsetX)).toBeLessThanOrEqual(0.5);
    }
    await page.locator('.simPanel').screenshot({ path: info.outputPath(`${vp}-150.png`) });
    await page.addStyleTag({ content: '.simPanel .colKind svg { display: inline !important; margin-inline: 0 !important; }' });
    const legacy = await measure();
    expect(legacy).toHaveLength(6);
    expect(Math.max(...legacy.map(row => Math.abs(row.lineOffset)))).toBeGreaterThan(0.75 * 1.5);
    await info.attach('R266 paired measurements', { body: JSON.stringify({ vp, zoom: 1.5, current, legacy }, null, 2), contentType: 'application/json' });
  });
}
