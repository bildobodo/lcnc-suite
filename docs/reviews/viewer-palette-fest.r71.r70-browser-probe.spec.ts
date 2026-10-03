import { test, expect, type Page } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { ctl, MOCK } from './ctl';
import { Folder, serve, rev, PARK } from './macroFolder';

async function ready(page: Page, folder: Folder) {
  await ctl({op:'reset'});
  await page.setViewportSize({width:1600,height:1000});
  await serve(page,folder);
  await page.goto(MOCK);
  await expect(page.locator('input.setupInput').first()).toBeVisible();
  await ctl({op:'raw',frame:{type:'settings_init',settings:{macros:{macros:[],bar:['park','face_top']}}}});
  await page.getByRole('tab',{name:'Macros',exact:true}).click();
  await expect(page.locator('.macrosTab')).toBeVisible();
}
async function open(page: Page) {
  await page.getByRole('button',{name:'Edit park',exact:true}).click();
  const d=page.getByRole('dialog',{name:'Edit Macro park',exact:true});
  await expect(d.locator('.cm-content')).toBeVisible();
  return d;
}
function saveResult(name: string, value: unknown) {
  writeFileSync(`../evidence/viewer-palette-fest.r71.${name}.json`,JSON.stringify(value,null,2)+'\n');
}
test.afterEach(async()=>{ await ctl({op:'reset'}); });

test('R70: the real PUT conflict response lets Keep editing rebase on the current revision',async({page})=>{
  const folder=new Folder(); await ready(page,folder); const d=await open(page);
  await d.locator('.cm-content').click();
  await page.keyboard.press('Control+End'); await page.keyboard.type('\n; local edit');
  const disk=PARK+'; concurrent save\n'; folder.touch('park',disk);
  const bases:string[]=[];
  await page.route(/\/macro\?/,async r=>{
    if(r.request().method()!=='PUT') return r.fallback();
    const base=new URL(r.request().url()).searchParams.get('base')!; bases.push(base);
    // Exact shape returned by the real gateway's _atomic_stream_write gate;
    // confirmed by the R70 backend counterprobe. The existing mock adds a revision.
    return r.fulfill({status:409,json:{detail:{error:'refused',reason:base==='new'
      ?'A macro of that name exists — reload':'Changed on disk — reload or keep editing'}}});
  });
  await d.getByRole('button',{name:'Save',exact:true}).click();
  await expect(d.locator('[data-macro-conflict]')).toBeVisible();
  await d.getByRole('button',{name:'Keep editing',exact:true}).click();
  await d.getByRole('button',{name:'Save',exact:true}).click();
  await expect.poll(()=>bases.length).toBe(2);
  saveResult('save-conflict',{bases,currentRevision:rev(disk),text:await d.innerText()});
  await page.screenshot({path:'../evidence/viewer-palette-fest.r71.save-conflict.png'});
  expect(bases[1]).toBe(rev(disk));
});

test('R70: a FRAME machine macro is gated the same in the tab as on the bar',async({page})=>{
  const folder=new Folder(); await ready(page,folder);
  await page.locator('[data-macro-row="park"] .rowPick').click();
  await ctl({op:'status_delta',data:{permissions:{machineFrame:false,probe:true}}});
  const bar=page.locator('.macroBar').getByRole('button',{name:'Park',exact:true});
  await expect(bar).toBeDisabled();
  const run=page.locator('.macrosTab .panelHead').getByRole('button',{name:'Run',exact:true});
  saveResult('frame-gate',{barDisabled:await bar.isDisabled(),tabDisabled:await run.isDisabled()});
  await page.screenshot({path:'../evidence/viewer-palette-fest.r71.frame-gate.png'});
  await expect(run).toBeDisabled();
});

test('R70: a catalog update while the text loads cannot leave an old clean editor',async({page})=>{
  const folder=new Folder(); await ready(page,folder);
  let release!:()=>void; const wait=new Promise<void>(r=>{release=r;});
  let got=false, delayed=true;
  await page.route(/\/macro\?/,async r=>{
    if(r.request().method()!=='GET'||new URL(r.request().url()).searchParams.get('name')!=='park'||!delayed) return r.fallback();
    delayed=false; got=true; await wait;
    await r.fulfill({body:PARK,contentType:'text/plain',headers:{'X-Macro-Revision':rev(PARK)}});
  });
  await page.getByRole('button',{name:'Edit park',exact:true}).click();
  await expect.poll(()=>got).toBe(true);
  const latest=PARK.replace('(MACRO Park)','(MACRO Park revised)').replace('G53 G0 Z0','G53 G0 Z-20');
  const list=page.waitForResponse(r=>new URL(r.url()).pathname==='/macros');
  folder.touch('park',latest);
  await ctl({op:'raw',frame:{type:'macros_changed',version:123}});
  await list;
  await expect(page.locator('.macroBar').getByRole('button',{name:'Park revised',exact:true})).toBeDisabled();
  release();
  const d=page.getByRole('dialog',{name:'Edit Macro park',exact:true});
  await expect(d.locator('.cm-content')).toBeVisible();
  await page.waitForTimeout(250);
  const text=await d.locator('.cm-content').innerText();
  const bar=page.locator('.macroBar').getByRole('button',{name:'Park revised',exact:true});
  saveResult('late-editor',{text,barDisabled:await bar.isDisabled(),oldRevision:rev(PARK),currentRevision:rev(latest)});
  await page.screenshot({path:'../evidence/viewer-palette-fest.r71.late-editor.png'});
  expect(text.includes('Z-20') || await bar.isDisabled(), 'old visible text must reload or block the newer run').toBe(true);
});
