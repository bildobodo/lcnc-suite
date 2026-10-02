import {test,expect} from '@playwright/test';
import {encode} from '@msgpack/msgpack';
import {writeFileSync} from 'node:fs';
import {ctl,MOCK} from './ctl';

test('R67: rendered end marks keep their CSS size during a view preset tween',async({page,context})=>{
 await ctl({op:'reset'});
 await page.setViewportSize({width:1400,height:1000});
 const pts=[[-150,-150,-10],[150,-150,-10],[150,150,100],[-150,150,100]];
 const body=Buffer.from(encode({file:'/r67.ngc',preview_schema:10,feed:pts,feed_lines:[1,2,3,4],feed_outside:new Uint8Array(4),rapid:[],rapid_outside:new Uint8Array(0)}));
 await context.route(/\/preview(\?|$)/,r=>r.fulfill({contentType:'application/octet-stream',body}));
 await context.route(/\/gcode(\?|$)/,r=>r.fulfill({contentType:'text/plain',body:'G1 X-150 Y-150 Z-10\nG1 X150\nG1 Y150 Z100\nG1 X-150\nM2\n'}));
 await page.goto(MOCK);
 await expect.poll(()=>page.evaluate(()=>window.__viewerDiag?.ready)).toBe(true);
 await ctl({op:'raw',frame:{type:'settings_changed',settings:{viewer:{projection:'perspective',layers:{bounds:true,toolpathBounds:true,machine:false,hud:false,groundGrid:false}}}}});
 await ctl({op:'status_delta',data:{active_file:'/r67.ngc'}});
 await ctl({op:'raw',frame:{type:'viewer_gcode_ready',file:'/r67.ngc',version:670}});
 await expect(page.locator('.codeLine').nth(2)).toBeVisible();
 await expect.poll(()=>page.evaluate(()=>window.__viewerDiag!.getBoxTicks!()?.length)).toBe(24);
 await page.waitForTimeout(400);
 // Fixed camera for comparable runs, independent of automatic initial framing.
 await page.evaluate(()=>window.__viewerDiag!.setCameraPose!([600,0,0],[0,0,0]));
 await page.evaluate(()=>window.__viewerDiag!.setView!('front'));
 await page.waitForTimeout(700);
 const runs:any[]=[];
 for(const direction of ['back','top','iso']){
  await page.evaluate(d=>{(window as any).__r67Frames=[];window.__viewerDiag!.setView!(d);},direction);
  await page.waitForTimeout(700);
  const frames=await page.evaluate(()=>{const out=(window as any).__r67Frames;delete(window as any).__r67Frames;return out;});
  runs.push({direction,frames});
 }
 const bars=runs.flatMap(r=>r.frames.flatMap((f:any)=>f.bars));
 const labels=runs.flatMap(r=>r.frames.flatMap((f:any)=>f.labels));
 const min=Math.min(...bars.map((b:any)=>b.length)),max=Math.max(...bars.map((b:any)=>b.length));
 const minFactor=Math.min(...labels.map((l:any)=>l.factor)),maxFactor=Math.max(...labels.map((l:any)=>l.factor));
 writeFileSync('../evidence/viewer-palette-fest.r67.tween.json',JSON.stringify({min,max,minFactor,maxFactor,runs},null,2));
 expect(bars.length).toBeGreaterThan(100);
 expect(min).toBeGreaterThan(9.95);
 expect(max).toBeLessThan(10.05);
 // Labels may be outside the frustum; this assertion covers the FULLY VISIBLE bars only.
 // Same tick assertions as the failing original observer test.
});
