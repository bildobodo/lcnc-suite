// Append to e2e/probe-calibration.spec.ts at 49db74f1 in the isolated tree.
test('Codex R470: an unknown machine value remains unknown when its field becomes a draft', async ({ page }) => {
  const side = await openView(page, DESKTOP, 'Outside');
  const line = side.locator('[data-section-line]');
  await ctl({ op: 'raw', frame: { type: 'settings_init', settings: { probe: { slowFr: 40 } } } });
  const slow = side.getByLabel('Slow Feed', { exact: true });
  const enter = async (value: string) => {
    await slow.click();
    const pad = page.locator('.nkStrip');
    for (const d of value) await pad.getByRole('button', { name: d, exact: true }).click();
    await pad.getByRole('button', { name: 'Apply', exact: true }).click();
  };
  await ctl({ op: 'clearCmds' });
  await enter('40');
  await expect.poll(async () => (await sent()).filter(c => c.cmd === 'set_params').length).toBe(1);
  const vars = ((await sent()).find(c => c.cmd === 'set_params')!.sets as { probe: Record<string, number> }).probe;
  const t = Date.now();
  const keys = Object.fromEntries(Object.entries(vars).map(([k, value]) => [k, { value, outcome: 'applied', t }]));
  await ctl({ op: 'status_delta', data: {}, envelope: { probe_booking: { version: 1, keys } } });
  await expect(line).toHaveText(/^On the machine/); // positive control
  keys['3015'] = { value: null as unknown as number, outcome: 'unknown', t };
  await ctl({ op: 'status_delta', data: {}, envelope: { probe_booking: { version: 2, keys } } });
  await expect(line).toHaveText('Saved · machine value unknown');
  await ctl({ op: 'settingsEcho', on: false });
  await ctl({ op: 'replyFor', cmd: 'save_settings', reply: 'silent' });
  await ctl({ op: 'replyFor', cmd: 'set_params', reply: 'silent' });
  await enter('60');
  await expect(side.locator('.formField', { has: slow })).toHaveClass(/fs-draft/);
  const state = { value: await slow.inputValue(), line: await line.textContent(),
    described: await slow.getAttribute('aria-describedby') };
  console.log('R470_DRAFT_UNKNOWN', JSON.stringify(state));
  await page.screenshot({ path: '/tmp/r470/draft-unknown.png', fullPage: true });
  await expect(line).not.toHaveText(/^On the machine/);
});
