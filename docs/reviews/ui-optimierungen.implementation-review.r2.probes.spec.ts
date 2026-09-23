// Round-2 review probes for feat/ui-review-wave at 7a1436a (2026-09-20).
// Copy into an isolated checkout's lcnc-webui/e2e/ directory beside ctl.ts.
// Run after npm run build with --project=chromium --no-deps --workers=1.
// Local mock only. All three desired-behavior assertions fail at this
// revision; the focus-gap case records an unexpected cycle_start command.
// The probe observes the actual end of the busy latch before pressing Space.
// No component state or event handler is injected to create that interval.
import { test, expect, type Page } from '@playwright/test';
import { ctl, MOCK } from './ctl';

async function open(page: Page) {
  await ctl({op:'reset'});
  await page.goto(MOCK);
  await expect(page.locator('input.setupInput').first()).toBeVisible();
  await ctl({op:'quiet',on:true});
  await ctl({op:'clearCmds'});
}
test.afterEach(async()=>{await ctl({op:'quiet',on:false}); await ctl({op:'reset'});});

test('Clear remains an unconfirmed zero draft after switching number to text', async ({page})=>{
  await open(page);
  await page.getByRole('button',{name:'MDI',exact:true}).click();
  const x=page.locator('input.setupInput').first();
  const original=await x.inputValue();
  await x.click();
  const nk=page.locator('.nkStrip');
  await nk.getByRole('button',{name:'C',exact:true}).click();
  await expect(nk.locator('.nkExpr')).toHaveText('0');
  await page.locator('.mdiInput').click();
  await page.locator('.tkStrip').getByRole('button',{name:'Close keyboard',exact:true}).click();
  await x.click();
  console.log('EMPTY_DRAFT',JSON.stringify({original,returned:await nk.locator('.nkExpr').innerText(),draft:await nk.locator('[data-draft]').count()}));
  await expect(nk.locator('.nkExpr')).toHaveText('0');
  await expect(nk.locator('[data-draft]')).toHaveText('draft');
});

test('Offset draft ends when its gate closes while another cell owns the keypad', async ({page})=>{
  await open(page);
  await ctl({op:'setAxes',axes:['X','Y','Z']});
  await page.getByRole('button',{name:'Offsets',exact:true}).click();
  const cells=page.locator('.offsetPanel td.editableCell');
  const original=await cells.first().innerText();
  await cells.first().click();
  await page.keyboard.type('17');
  await cells.nth(1).click();
  // Probe gates can close due to a machine-state change; reopen the exact
  // original permissions after the watcher has ended the active session.
  const all={idle:true,jog:true,override:true,ready:true,run:true,pause:false,resume:false,step:true,abort:true,probe:true,zero:true,machineFrame:true,goZero:true,planeFrame:true,touchoff:true,touchoffRotary:true,twpCapture:true,surfaceComp:true,safety:true,setup:true,armed:true,always:true};
  await ctl({op:'status_delta',data:{permissions:{...all,probe:false}}});
  await expect(page.locator('.nkStrip')).toHaveCount(0);
  await ctl({op:'status_delta',data:{permissions:all}});
  await cells.first().click();
  console.log('DRAFT_AFTER_GATE',JSON.stringify({original,returned:await page.locator('.nkExpr').innerText(),draft:await page.locator('[data-draft]').count()}));
  await expect(page.locator('[data-draft]')).toHaveCount(0);
});

test('Space during the delayed numeric focus return cannot start a program', async ({page})=>{
  await open(page);
  await ctl({op:'status_delta',data:{active_file:'/A.ngc'}});
  const x=page.locator('input.setupInput').first();
  await x.click();
  await page.keyboard.type('17');
  await page.locator('.nkStrip').getByRole('button',{name:'OK',exact:true}).click();
  // Observe the actual gap after the command's busy latch has expired and
  // before the additional focus timer runs. No injected input or handlers.
  await page.waitForFunction(()=>{
    const field=document.querySelector<HTMLInputElement>('input.setupInput');
    return field && !field.disabled && document.activeElement===document.body;
  },undefined,{polling:'raf',timeout:1500});
  await page.keyboard.press('Space');
  await page.waitForTimeout(100);
  const sent=await ctl({op:'lastCmds'});
  console.log('FOCUS_GAP_COMMANDS',JSON.stringify(sent.cmds));
  expect((sent.cmds??[]).filter((c:{cmd?:string})=>c.cmd==='cycle_start')).toEqual([]);
});
