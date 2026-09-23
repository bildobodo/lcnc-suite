// Implementation review of feat/ui-review-wave at c0da512 (2026-09-20).
// Copy into lcnc-webui/e2e/ui-implementation-review.probes.spec.ts in an
// isolated review checkout; run with Playwright --project=chromium --no-deps
// --workers=1 after a successful build. These use ONLY the local mock.
// The original review used a separate Vite diagnosis bundle because the
// regular typechecked build failed. Eight desired-behavior assertions fail
// at the reviewed revision; the real-touch reference-search control passes.
// See ui-optimierungen.implementation-review.md for scope and exact results.
import { test, expect, type Page } from '@playwright/test';
import { ctl, MOCK } from './ctl';

async function open(page: Page) {
  await ctl({op:'reset'});
  await page.goto(MOCK);
  await expect(page.locator('input.setupInput').first()).toBeVisible();
  await ctl({op:'quiet', on:true});
  await ctl({op:'clearCmds'});
}
test.afterEach(async () => { await ctl({op:'quiet',on:false}); await ctl({op:'reset'}); });

test('number closes on outside pointer', async ({page}) => {
  await open(page);
  await page.locator('input.setupInput').first().click();
  await page.keyboard.type('123');
  await page.locator('header.hdr').dispatchEvent('pointerdown', {button:0, pointerType:'touch'});
  console.log('NUMBER_OUTSIDE', await page.locator('.nkStrip').count());
  await expect(page.locator('.nkStrip')).toHaveCount(0, {timeout:1000});
});

test('number draft survives number to text and back', async ({page}) => {
  await open(page);
  await page.getByRole('button',{name:'MDI',exact:true}).click();
  const x = page.locator('input.setupInput').first();
  await x.click();
  await page.keyboard.type('123');
  await page.locator('.mdiInput').click();
  await expect(page.locator('.tkStrip')).toBeVisible();
  await page.locator('.tkStrip').getByRole('button',{name:'Close keyboard',exact:true}).click();
  await x.click();
  console.log('RETURNED_DRAFT', await page.locator('.nkExpr').innerText());
  await expect(page.locator('.nkExpr')).toHaveText('123', {timeout:1000});
});

test('number confirm returns focus to its original field', async ({page}) => {
  await open(page);
  const x=page.locator('input.setupInput').first();
  await x.click();
  await page.keyboard.type('123');
  await page.locator('.nkStrip').getByRole('button',{name:'OK',exact:true}).click();
  console.log('NUMBER_FOCUS', await page.evaluate(()=>document.activeElement?.outerHTML.slice(0,160)));
  await expect(x).toBeFocused({timeout:1000});
});

test('hidden offset owner cannot confirm a write', async ({page}) => {
  await open(page);
  await ctl({op:'setAxes',axes:['X','Y','Z']});
  await page.getByRole('button',{name:'Offsets',exact:true}).click();
  await page.locator('.offsetPanel td.editableCell').first().click();
  await page.keyboard.type('17');
  await page.getByRole('button',{name:'MDI',exact:true}).click();
  const openN=await page.locator('.nkStrip').count();
  if(openN) await page.locator('.nkStrip').getByRole('button',{name:'OK',exact:true}).click();
  const cmds=await ctl({op:'lastCmds'});
  console.log('HIDDEN_OFFSET', JSON.stringify({openN,cmds}));
  expect((cmds.cmds??[]).filter((c: {cmd?:string})=>c.cmd==='set_wcs')).toEqual([]);
});

test('save response preserves edits typed after the request', async ({page}) => {
  let release: (() => void) | undefined; let body=''; let requested=false;
  await page.route('**/gcode?*',r=>r.fulfill({contentType:'text/plain',body:'G0 X0\nM2\n'}));
  await page.route('**/save?*',async r=>{
    body=r.request().postData()??''; requested=true;
    await new Promise<void>(resolve=>{release=resolve});
    await r.fulfill({json:{ok:true,path:'/A.ngc',size:body.length}});
  });
  await open(page);
  await ctl({op:'status_delta',data:{active_file:'/A.ngc'}});
  await ctl({op:'raw',frame:{type:'viewer_gcode_ready',version:77,file:'/A.ngc'}});
  await expect(page.locator('.codeLine').first()).toBeVisible();
  await page.getByRole('button',{name:'Edit',exact:true}).click();
  const editor=page.locator('.cm-content');
  await expect(editor).toBeVisible();
  await page.locator('.editActions').getByRole('button',{name:'Save',exact:true}).click();
  await expect.poll(()=>requested).toBe(true);
  await editor.click(); await page.keyboard.press('End'); await page.keyboard.type('(AFTER_SAVE_REQUEST)');
  await expect(editor).toContainText('AFTER_SAVE_REQUEST');
  if (!release) throw new Error('Save request was not intercepted');
  release();
  await page.waitForTimeout(250);
  console.log('SAVE_AFTER_TYPING', JSON.stringify({body,editors:await editor.count()}));
  await expect(editor).toContainText('AFTER_SAVE_REQUEST',{timeout:1000});
});

test('Tab out from a keyboard button closes the text helper', async ({page}) => {
  await open(page);
  await page.getByRole('button',{name:'MDI',exact:true}).click();
  await page.locator('.mdiInput').click();
  const close=page.locator('.tkStrip').getByRole('button',{name:'Close keyboard',exact:true});
  await close.focus();
  for (let i = 0; i < 10; i++) {
    await page.keyboard.press('Tab');
    if (await page.evaluate(() => document.activeElement !== document.body && !document.activeElement?.closest('[data-input-area="mdi-input"]'))) break;
  }
  expect(await page.evaluate(() => document.activeElement === document.body)).toBe(false);
  expect(await page.evaluate(() => !!document.activeElement?.closest('[data-input-area="mdi-input"]'))).toBe(false);
  console.log('TEXT_BUTTON_TAB_OUT', await page.evaluate(()=>({active:document.activeElement?.outerHTML.slice(0,150),keyboard:!!document.querySelector('.tkStrip')})));
  await expect(page.locator('.tkStrip')).toHaveCount(0,{timeout:1000});
});

test('keyboard button keeps its parent scoped sizing rules', async ({page}) => {
  await open(page);
  await page.getByRole('button',{name:'MDI',exact:true}).click();
  await page.locator('.mdiInput').click();
  const actual=await page.locator('.tkEnter').evaluate(el=>{
    const root=el.closest('.tkStrip');
    const scopes=root!.getAttributeNames().filter(x=>x.startsWith('data-v-'));
    const style=getComputedStyle(el);
    return {scopes,buttonAttrs:el.getAttributeNames(),paddingLeft:style.paddingLeft,gridRow:style.gridRow};
  });
  console.log('KEY_SCOPED_STYLES',actual);
  expect(actual.paddingLeft).toBe('0px');
  expect(actual.gridRow).toBe('3 / 5');
});

test.describe('real touch', () => {
  test.use({hasTouch:true});
  test('reference search can receive a real keyboard tap', async ({page}) => {
    await open(page);
    await page.getByTitle('G-code Reference',{exact:true}).tap();
    const search=page.locator('.dialogOverlay input.inputField').first();
    await search.tap();
    const key=page.locator('.tkStrip').getByRole('button',{name:'g',exact:true});
    const box=await key.boundingBox();
    if (!box) throw new Error('Keyboard key has no box');
    console.log('SEARCH_KEY_HIT',await page.evaluate(b => {
      const hit=document.elementFromPoint(b.x+b.width/2,b.y+b.height/2);
      return {hit:hit?.outerHTML.slice(0,200),keyboard:!!hit?.closest('.tkStrip')};
    },box));
    await key.tap({timeout:2000});
    await expect(search).toHaveValue('g');
  });

  test('portrait at 150 percent keeps the full helper within the viewport', async ({page}) => {
    await page.setViewportSize({width:900,height:1200});
    await open(page);
    await page.getByRole('button',{name:'MDI',exact:true}).tap();
    await page.locator('.mdiInput').tap();
    await page.evaluate(()=>document.documentElement.style.zoom='1.5');
    const bounds=await page.locator('.tkStrip').evaluate(el=>{
      const r=el.getBoundingClientRect();
      return {bottom:r.bottom,top:r.top,inner:innerHeight};
    });
    console.log('PORTRAIT_ACTUAL_BOUNDS',bounds);
    expect(bounds.bottom).toBeLessThanOrEqual(bounds.inner+1);
  });
});
