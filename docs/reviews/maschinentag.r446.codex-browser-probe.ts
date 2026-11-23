
// R446 independent probe: a later idle round at unchanged input generation.
test('R446 a fresh pending decision after none waits its own three seconds', async ({ page, context }) => {
  test.setTimeout(120_000);
  const tel = await colTelemetry(page);
  await prepare(page, context, { file: '/r446-same-gen.ngc', version: 4501, ...DD_FEED,
    before: () => decision({ state: 'none' }) });
  await viewerUp(page);
  await expect.poll(() => tel.filter(e => e.kind === 'collision.sweep_done').length, { timeout: 90_000 }).toBe(1);
  await expect.poll(async () => {
    const w = await driftWaitOf(page);
    return !!w && w.since !== null && w.now - w.since > 3500;
  }).toBe(true);
  const before = await page.evaluate(() => window.__viewerDiag!.getDebounceFired!().check);
  const oldWait = await driftWaitOf(page);
  await decision({ state: 'pending' });
  // A rotary change at idle creates neither an input write nor an interpreter
  // transition; this explicit tool status just triggers the page's recheck.
  await ctl({ op: 'status_delta', data: { tool_number: 5, tool_diameter: 20, tool_length: 90 } });
  await expect.poll(() => page.evaluate(() => window.__viewerDiag!.getDebounceFired!().check), { timeout: 15000 }).toBeGreaterThan(before);
  const nextWait = await driftWaitOf(page);
  await test.info().attach('r446-same-gen-wait', { body: JSON.stringify({ oldWait, nextWait, tel }, null, 2), contentType: 'application/json' });
  const { writeFileSync } = await import('node:fs');
  writeFileSync('/tmp/r446/browser-same-gen.json', JSON.stringify({ oldWait, nextWait, tel }, null, 2));
  expect(nextWait?.waiting, 'the new pending decision must wait from this round, not the old none').toBe(true);
  await ctl({ op: 'reset' });
});
