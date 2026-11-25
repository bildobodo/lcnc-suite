// Append to e2e/collisions.viewer.spec.ts at 3d14ae27 in an isolated tree.
// Uses that spec's fixture/worker taps, but adds independent transition assertions.

test('Codex R469: an active provisional/full run check loses ownership to a later RFL, including its delayed full answer', async ({ page, context }) => {
  test.setTimeout(120_000);
  await installWorkerTap(page);
  const file = '/codex-r469-active.ngc';
  await runReady(page, context, file, 46901);
  await page.evaluate(() => { (window as any).__colTap.holdFull = true; });
  await ctl({ op: 'quiet', on: true });
  await runOnL7(page, file, 46901);
  await publishInRun(page, file, 46902, pinnedFor(9));
  await expect.poll(() => colTap(page, t => t.held.length), { timeout: 60_000 }).toBe(1);
  await expect(sumClash(page)).toHaveAttribute('aria-label', /provisional from L7/);
  const starts = (await activity(page)).starts;
  await page.getByRole('button', { name: 'Check basis', exact: true }).click();
  const card = page.locator('.helpPopover:popover-open');
  await expect(card).toBeVisible();
  // A status receiver need not have observed the intervening idle frame.
  await enterRun(file, { run_id: 10, start_line: 7, version: 46902 }, 7);
  await expectNotChecked(page, 7, 'another run owns the status');
  await expect(card).toContainText('This run is not checked (run from line 7).');
  await expect(card.locator('.checkCard dt')).toHaveCount(0);
  await releaseFull(page);
  // Barrier: a later status is visibly applied after the held callback ran.
  await ctl({ op: 'status_delta', data: { motion_line: 8, actual_position: [240, 0, -100, 0, 0], joint_pos: [240, 0, -100, 0, 0] } });
  await expect(simLine(page)).toHaveText(/L8/);
  await expectNotChecked(page, 7, 'after the old full result');
  expect((await activity(page)).starts).toBe(starts);
  await ctl({ op: 'quiet', on: false });
  await ctl({ op: 'reset' });
});

test('Codex R469: malformed start lines clear old findings; ending with simulation off starts nothing until enabled', async ({ page, context }) => {
  test.setTimeout(120_000);
  const file = '/codex-r469-unknown.ngc';
  await runReady(page, context, file, 46911);
  const starts = (await activity(page)).starts;
  await ctl({ op: 'quiet', on: true });
  let id = 20;
  for (const value of [false, '0', -1, 0.5]) {
    await enterRun(file, { run_id: id++, start_line: value, version: 46911 }, 7,
      { joint_pos: [120, 0, -380, 0, 0], actual_position: [120, 0, -380, 0, 0] });
    await expectNotChecked(page, null, `invalid wire start ${JSON.stringify(value)}`);
    expect((await activity(page)).starts).toBe(starts);
  }
  await ctl({ op: 'raw', frame: { type: 'settings_changed', settings: { simulation: { enabled: false } } } });
  await expect(page.locator('.scrubBar')).toHaveCount(0);
  await ctl({ op: 'status_delta', data: { interp_state: 1, task_mode: 1, motion_line: 0 } });
  await expect(page.locator('.statusBanner')).not.toContainText(/RUNNING/i);
  expect((await activity(page)).starts).toBe(starts);
  expect(await page.evaluate(() => window.__viewerDiag!.checkTimerPending!())).toBe(false);
  await ctl({ op: 'raw', frame: { type: 'settings_changed', settings: { simulation: { enabled: true } } } });
  await expect(page.getByRole('tab', { name: 'Sim', exact: true })).toBeVisible();
  await simShow(page, 'clash');
  await expect.poll(async () => (await activity(page)).starts, { timeout: 30_000 }).toBe(starts + 1);
  await expect(clashRows(page).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('.scrubBar .checkSlot')).not.toHaveAttribute('aria-label', /not checked/);
  await ctl({ op: 'quiet', on: false });
  await ctl({ op: 'reset' });
});
