import {test,expect} from '@playwright/test';
import {writeFileSync} from 'node:fs';
import {ctl} from './ctl';
import {openLayout,PROFILES,VIEWPORTS} from './layout-fixtures';
const out='/tmp/codex-r235-720x5f32';

test('R235: portrait Touch WCS positions remain stable when the frame chip grows',async({page})=>{
  await openLayout(page,PROFILES[2],VIEWPORTS.find(v=>v.name==='touch-portrait')!);
  const cdp=await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:1,x:800,y:450}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await expect(page.locator('html')).toHaveClass(/touch-device/);
  const setup=page.locator('[data-strip="setup"]');
  const g55=setup.getByRole('radio',{name:'G55',exact:true});
  await g55.scrollIntoViewIfNeeded();
  // Leave the entire WCS block comfortably inside the viewport, above the bottom edge.
  await page.evaluate(()=>{document.querySelector('.strip')!.scrollTop+=100;});
  const measure=()=>setup.evaluate(el=>{
    const root=el.getBoundingClientRect();
    const box=(e:Element)=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,relativeY:r.y-root.y};};
    return {section:box(el),head:box(el.querySelector('.wcsTitle')!),
      title:box(el.querySelector('.wcsTitle .sub')!),chip:box(el.querySelector('.kinsChip')!),
      text:el.querySelector('.kinsChip')?.textContent,
      radios:[...el.querySelectorAll('[role=radio]')].map(e=>({text:e.textContent,...box(e)})),
      scrollTop:document.querySelector('.strip')!.scrollTop};
  });
  const before=await measure();
  await page.screenshot({path:`${out}/header-before.png`});
  const b=await g55.boundingBox();
  const press={x:b!.x+b!.width/2,y:b!.y+b!.height/2};
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:2,x:press.x,y:press.y}]});
  await ctl({op:'clearCmds'});
  await ctl({op:'status_delta',data:{kins_type:0,g5x_index:1,wcs_prov_a:[0,0,0,0,0,0,0,0,0],rotary_abc:[20,0,0],twp_defined:true,twp_datum:[0,0,0]}});
  await expect(setup.locator('.kinsChip')).toContainText('off datum · datum moved');
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  const after=await measure();
  const hit=await page.evaluate(p=>{const e=document.elementFromPoint(p.x,p.y);return {tag:e?.tagName,cls:e?.className,text:e?.textContent};},press);
  await page.screenshot({path:`${out}/header-after.png`});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  const cmds=await ctl({op:'lastCmds'});
  writeFileSync(`${out}/header.json`,JSON.stringify({before,after,press,hit,cmds},null,2));
  expect(after.radios.map(r=>r.relativeY),'every WCS row keeps its location beneath the held pointer').toEqual(before.radios.map(r=>r.relativeY));
});
test.afterAll(async()=>{await ctl({op:'reset'});});
