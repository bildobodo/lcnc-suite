// Focus / backdrop audit against the isolated mock only, never LinuxCNC.
// Prerequisites: current lcnc-webui production build; from lcnc-webui run
// MOCK_HOST=127.0.0.1 MOCK_PORT=4186 node e2e/mock-gateway.mjs
// Run this file from the repository root.
import { createRequire } from 'node:module';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const require = createRequire(resolve('lcnc-webui/package.json'));
const { chromium, expect } = require('@playwright/test');
const WebSocket = require('ws');
const ctl = op => new Promise((res, rej) => {
  const ws = new WebSocket('ws://127.0.0.1:4186/ctl');
  ws.once('open', () => ws.send(JSON.stringify(op)));
  ws.once('message', data => { ws.close(); res(JSON.parse(String(data))); });
  ws.once('error', rej);
});
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const report = { productCommit: '691e642', date: '2026-09-22', environment: 'Isolated mock; Chromium desktop 1600x1000', cases: [] };
const neutral = () => page.getByTitle('G-code Reference', { exact: true });
const activeFocus = () => page.evaluate(() => ({
  tag: document.activeElement?.tagName,
  name: document.activeElement?.getAttribute('aria-label') || document.activeElement?.getAttribute('title') || document.activeElement?.textContent?.trim(),
  insideDialog: !!document.activeElement?.closest('.dialog'),
}));
async function backdrop(dialog) {
  const overlay = dialog.locator('xpath=..');
  const point = await overlay.evaluate(el => {
    const r = el.getBoundingClientRect();
    const x = r.left + 8, y = r.top + r.height / 2;
    if (document.elementFromPoint(x, y) !== el) throw new Error('Backdrop point is not exposed');
    return { x, y };
  });
  await page.mouse.click(point.x, point.y);
}
async function checkDialog(name, dialog, closesOnBackdrop) {
  await expect(dialog).toBeVisible();
  await neutral().focus();
  await expect(dialog).toBeVisible();
  const afterFocus = await activeFocus();
  // Header is outside the content-area scrim; no button is activated here.
  const point = await page.locator('header.hdr').evaluate(el => {
    const r = el.getBoundingClientRect();
    const x = r.left + 3, y = r.top + 3;
    if (document.elementFromPoint(x, y)?.closest('button')) throw new Error('Header point hits an action');
    return { x, y };
  });
  await page.mouse.click(point.x, point.y);
  await expect(dialog).toBeVisible();
  await backdrop(dialog);
  if (closesOnBackdrop) await expect(dialog).not.toBeVisible();
  else await expect(dialog).toBeVisible();
  report.cases.push({ name, openAfterOutsideFocus: true, focus: afterFocus,
    openAfterHeaderBackgroundClick: true, openAfterBackdropClick: !closesOnBackdrop });
}
try {
  await ctl({ op: 'reset' });
  await page.goto('http://127.0.0.1:4186/');
  await expect(page.locator('.pill.armed')).toBeVisible();
  await ctl({ op:'raw', frame:{ type:'settings_init', settings:{ display:{ theme:'light' } } } });
  await page.getByTitle('Settings', { exact: true }).click();
  await checkDialog('Settings', page.locator('.dialog').filter({ has: page.getByRole('button', { name:'Close settings', exact:true }) }), true);
  await page.getByTitle(/^Messages \(/).click();
  await checkDialog('Messages', page.locator('.dialog').filter({ has: page.getByRole('button', { name:'Close messages', exact:true }) }), true);
  await neutral().click();
  await checkDialog('G-code reference', page.locator('.dialog').filter({ has: page.getByRole('button', { name:'Close reference', exact:true }) }), true);
  await page.getByTitle('Shut Down LinuxCNC', { exact:true }).click();
  const shutdown = page.locator('.dialog').filter({ hasText:'Shut Down LinuxCNC?' });
  await checkDialog('Shutdown confirmation (never confirmed)', shutdown, false);
  await shutdown.getByRole('button', { name:'Cancel', exact:true }).click();

  await page.getByRole('button', { name:'Tools', exact:true }).click();
  await page.getByRole('button', { name:'+ Add', exact:true }).click();
  const editor = page.locator('.editDialog');
  await expect(editor).toBeVisible();
  const initialFocus = await activeFocus();
  await page.keyboard.press('Tab');
  report.toolEditorTab = { initialFocus, afterTab:await activeFocus(), stillOpen:await editor.isVisible() };
  await checkDialog('Tool editor', editor, false);
  const numberField = editor.locator('input.inputField').first();
  await numberField.click();
  await expect(page.locator('.nkStrip')).toBeVisible();
  await neutral().focus();
  await expect(page.locator('.nkStrip')).not.toBeVisible();
  report.cases.push({ name:'Numpad', openAfterOutsideFocus:false, ownerDialogStillOpen:await editor.isVisible() });
  // Tool description has a dedicated label; use its current field contract.
  await editor.getByRole('textbox', { name:/Description/ }).fill('Unsaved tool draft');
  await page.getByRole('button', { name:'Close tool editor', exact:true }).click();
  const discard = page.locator('.dialog').filter({ hasText:'Discard changes?' });
  await expect(discard).toBeVisible();
  await backdrop(discard);
  await expect(discard).not.toBeVisible();
  await expect(editor).toBeVisible();
  report.toolDirtyClose = { confirmationShown:true, backdropKeepsEditor:true,
    value:await editor.getByRole('textbox', { name:/Description/ }).inputValue() };
  // Reload discards this isolated fixture; do not save anything.
  await page.reload();
  await expect(page.locator('.pill.armed')).toBeVisible();
  await ctl({ op:'raw', frame:{ type:'settings_init', settings:{ display:{ theme:'light' } } } });

  await page.getByRole('button', { name:'MDI', exact:true }).click();
  await page.locator('.mdiInput').click();
  if (!await page.locator('.tkStrip').count()) await page.getByRole('button', { name:'Open keyboard', exact:true }).click();
  await expect(page.locator('.tkStrip')).toBeVisible();
  await neutral().focus();
  await expect(page.locator('.tkStrip')).not.toBeVisible();
  report.cases.push({ name:'Text keyboard', openAfterOutsideFocus:false });

  const help = page.locator('.helpIcon:visible').first();
  await help.click();
  await expect(page.locator('.helpPopover:popover-open')).toHaveCount(1);
  await page.keyboard.press('Tab');
  report.helpAfterTab = { open:await page.locator('.helpPopover:popover-open').count() === 1, focus:await activeFocus() };
  await neutral().focus();
  report.helpAfterOutsideFocus = await page.locator('.helpPopover:popover-open').count() === 1;
  await page.locator('header.hdr').click({ position:{x:3,y:3} });
  await expect(page.locator('.helpPopover:popover-open')).toHaveCount(0);
  report.helpAfterOutsideClick = false;

  // Settings contains an explicit Save/Cancel macro form, unlike auto-saved display controls.
  for (const closeBy of ['backdrop', 'header navigation']) {
    await page.getByTitle('Settings', { exact:true }).click();
    await page.getByRole('button', { name:'Macros', exact:true }).click();
    await page.getByRole('button', { name:'Add Macro', exact:true }).click();
    await page.locator('#macro-edit-name').fill(`Draft via ${closeBy}`);
    await page.locator('#macro-edit-command').fill('G0 X{position}');
    if (closeBy === 'backdrop') await backdrop(page.locator('.dialog').filter({ has:page.getByRole('button', { name:'Close settings', exact:true }) }));
    else await neutral().click();
    await expect(page.getByRole('button', { name:'Close settings', exact:true })).not.toBeVisible();
    const discardQuestionVisible = await page.locator('.dialog').filter({ hasText:/Discard/ }).count() > 0;
    await page.getByTitle('Settings', { exact:true }).click();
    await page.getByRole('button', { name:'Macros', exact:true }).click();
    await expect(page.getByRole('button', { name:'Add Macro', exact:true })).toBeVisible();
    report.cases.push({ name:'Unsaved Settings macro', closeBy, discardQuestionVisible,
      draftFormLost:!await page.locator('#macro-edit-name').count() });
    await page.getByRole('button', { name:'Close settings', exact:true }).click();
  }
  // Keep the mock import response pending: closing a progress dialog must
  // not be confused with cancellation of the request. All HTTP is stubbed.
  const tool = { T:1, P:1, D:6, Z:0, type:'endmill', description:'Mock only' };
  await page.route('**/import-tool-library', route => route.fulfill({ json:{
    tools:[tool], existing_count:1,
    metadata_refresh:{ rows:[], updated:[1], skipped:[], revision:'mock-audit' },
  } }));
  let pendingImport;
  await page.route('**/import-tool-library/refresh', route => { pendingImport = route; });
  await page.getByRole('button', {name:'Tools', exact:true}).click();
  await page.locator('input[type="file"][accept=".json,.zip,.fctb,.fctl"]').setInputFiles({
    name:'mock-library.json', mimeType:'application/json', buffer:Buffer.from('{}'),
  });
  const importDialog = page.locator('.importDialog');
  await expect(importDialog).toBeVisible();
  await importDialog.getByRole('button', {name:'Update metadata', exact:true}).click();
  await expect(importDialog.getByRole('button', {name:'Importing...', exact:true})).toBeVisible();
  await expect.poll(() => !!pendingImport).toBe(true);
  await neutral().focus();
  await expect(importDialog).toBeVisible();
  await backdrop(importDialog);
  await expect(importDialog).not.toBeVisible();
  report.cases.push({ name:'Tool import with HTTP reply pending (stub only)', openAfterOutsideFocus:true,
    openAfterBackdropClick:false, requestFailure:pendingImport.request().failure() });
  await pendingImport.fulfill({json:{updated:1,skipped:0}});
  const {cmds} = await ctl({op:'lastCmds'});
  report.mockCommandCounts = Object.fromEntries([...new Set(cmds.map(c=>c.cmd))].map(cmd=>[cmd,cmds.filter(c=>c.cmd===cmd).length]));
  expect(cmds.some(c=>['mdi','cycle_start','shutdown','delete_tool','set_tool'].includes(c.cmd))).toBe(false);
  await writeFile(resolve('docs/reviews/ui-optimierungen.dialog-close.evidence.json'), JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
} finally { await browser.close(); }
