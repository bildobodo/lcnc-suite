import {test, expect} from '@playwright/test';
import {encode} from '@msgpack/msgpack';
import {writeFileSync} from 'node:fs';
import {ctl} from './ctl';
import {openLayout, PROFILES, VIEWPORTS} from './layout-fixtures';

for (const scenario of ['r58-cases', 'return-to-start'] as const) test(`R60 ${scenario}: worker reply ordering`, async ({page, context}) => {
  const file='/basis.ngc';
  let previews=0;
  await page.addInitScript(() => {
    const NativeWorker=window.Worker;
    window.Worker=class extends NativeWorker {
      set onmessage(fn:any) {
        super.onmessage = (event:MessageEvent) => {
          if (event.data?.basisKey === '/basis.ngc#4501:0,0,20' && !(window as any).__r60Released) {
            (window as any).__r60Held=true;
            (window as any).__r60Release=()=>{
              (window as any).__r60Released=true;
              fn.call(this,event);
            };
          } else fn.call(this,event);
        };
      }
      get onmessage() { return super.onmessage; }
    } as any;
  });
  await context.route(/\/preview(\?|$)/, r => {
    previews++;
    return r.fulfill({contentType:'application/octet-stream',body:Buffer.from(encode({
      file,preview_schema:9,rapid:[[0,0,-10],[20,0,-10]],rapid_seq:[1,2],rapid_lines:[1,2],
      feed:[[20,0,-30],[40,0,-40]],feed_seq:[3,4],feed_lines:[4,5],
      feed_outside:new Uint8Array(2),rapid_outside:new Uint8Array(2),
      violations:[],violations_total:0,tlo_events:[[2,0,0,0,-1]],start_known:true,tlo_start:[0,0,10]
    }))});
  });
  await context.route(/\/gcode(\?|$)/,r=>r.fulfill({contentType:'text/plain',
    body:'G53 G0 Z0\nG0 X20\nG49\nG1 Z-30 F100\nG1 X40 Z-40\n'}));
  await openLayout(page,PROFILES[0],VIEWPORTS[0]);
  await ctl({op:'quiet',on:true});
  await ctl({op:'status_delta',data:{active_file:file,tool_offset:[0,0,10,0,0,0,0,0,0]}});
  await ctl({op:'raw',frame:{type:'viewer_gcode_ready',version:4501,file}});
  const topZ=()=>page.evaluate(()=>window.__viewerDiag?.getPathBox?.()?.max[2] ?? null);
  await expect.poll(topZ).toBe(-10);
  const snapshot=async(label:string)=>({label,previews,...await page.evaluate(()=>({
    pathBox:window.__viewerDiag?.getPathBox?.(),palette:window.__viewerDiag?.getPalette?.(),
    warnings:[...document.querySelectorAll('.hudNotes .hudWarn')].map(e=>e.textContent),
    held:(window as any).__r60Held??false,released:(window as any).__r60Released??false
  }))});
  const records=[await snapshot('loaded')];
  await ctl({op:'status_delta',data:{tool_offset:[0,0,20,0,0,0,0,0,0]}});
  await ctl({op:'raw',frame:{type:'status_delta',data:{},preview_refresh:{reason:'tool_offset',file,
    expected_ms:4000,started_ms:2000,queued:false,superseded:0}}});
  const line=page.locator('.hudNotes .hudWarn').first();
  expect(await line.evaluate(e=>e.firstChild?.textContent?.trim())).toBe('Preview re-parsing');
  const help=line.getByRole('button',{name:'Help: Preview re-parsing',exact:true});
  await help.click();
  await expect(line.locator('.helpPopover')).toBeVisible();
  await expect(line.locator('.helpPopover')).toContainText('Why: tool offset changed — checking.');
  await page.screenshot({path:'../evidence/viewer-palette-fest.r60.reason-help.png'});
  await help.click();
  await expect(line.locator('.helpPopover')).not.toBeVisible();
  records.push(await snapshot('gateway checking'));
  await ctl({op:'raw',frame:{type:'status_delta',data:{},
    preview_tool_basis:{file,version:4501,xyz:[0,0,20],mode:430}}});
  await expect.poll(()=>page.evaluate(()=>(window as any).__r60Held)).toBe(true);
  await page.evaluate(()=>new Promise<void>(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r()))));
  records.push(await snapshot('worker reply held: still the old basis'));
  // Retain the R58 pending-state acceptance checks.
  expect(await topZ()).toBe(-10);
  expect(records[2].warnings.join(' ')).toContain('checking');
  expect(records[2].palette?.drawn.feed).toBe(records[1].palette?.drawn.feed);
  expect(records[1].palette?.drawn.feed).not.toBe(records[0].palette?.drawn.feed);
  await page.screenshot({path:'../evidence/viewer-palette-fest.r60.pending-basis.png'});
  if (scenario === 'return-to-start') {
    // The current gateway basis returns to the published payload start
    // while the old normalization request is still outstanding.
    await ctl({op:'raw',frame:{type:'status_delta',data:{tool_offset:[0,0,10,0,0,0,0,0,0]}}});
    await expect(page.locator('.hudNotes .hudWarn').filter({hasText:'checking'})).toHaveCount(0);
    expect(await topZ()).toBe(-10);
    records.push(await snapshot('gateway requires start again; pending ended'));
    await page.evaluate(()=>(window as any).__r60Release());
    // Deliver the old reply and render it (if accepted) before asserting.
    await page.evaluate(()=>new Promise<void>(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r()))));
    expect(await topZ()).toBe(-10);
    records.push(await snapshot('outdated 20 response is ignored; start 10 remains'));
    await ctl({op:'raw',frame:{type:'status_delta',data:{tool_offset:[0,0,10,0,0,0,0,0,0]}}});
    await page.evaluate(()=>new Promise<void>(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r()))));
    expect(await topZ()).toBe(-10);
    expect(await page.locator('.hudNotes .hudWarn').count()).toBe(0);
    records.push(await snapshot('next unchanged gateway frame preserves start 10'));
    await page.screenshot({path:'../evidence/viewer-palette-fest.r60.ignored-reply.png'});
    writeFileSync('../evidence/viewer-palette-fest.r60.return-browser.json',JSON.stringify({commit:'b70b068',
      method:'Unmodified product; delay only worker message delivery; return desired basis to start',records},null,2)+'\n');
    await ctl({op:'quiet',on:false});
    await ctl({op:'reset'});
    return;
  }
  await page.evaluate(()=>(window as any).__r60Release());
  await expect.poll(topZ).toBe(-20);
  records.push(await snapshot('normalized reply released'));
  expect(previews).toBe(1);
  // Independent contract check: same revision, wrong program identity.
  await ctl({op:'raw',frame:{type:'status_delta',data:{},
    preview_tool_basis:{file:'/different-program.ngc',version:4501,xyz:[0,0,30],mode:430}}});
  await expect.poll(topZ).toBe(-10);
  records.push(await snapshot('basis from another file rejected; payload start restored'));
  writeFileSync('../evidence/viewer-palette-fest.r60.browser.json',JSON.stringify({commit:'b70b068',
    method:'Delay only delivery of one real preview worker reply; own mock 127.0.0.1:4188',records},null,2)+'\n');
  await ctl({op:'quiet',on:false});
  await ctl({op:'reset'});
});
