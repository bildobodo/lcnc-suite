import { test, expect } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { ctl } from './ctl';
import { PROFILES, VIEWPORTS, openLayout, setLayoutState, settleLayout } from './layout-fixtures';

const WCS = ['G54','G55','G56','G57','G58','G59','G59.1','G59.2','G59.3'].map(name => ({ name,x:10,y:20,z:30,a:45,c:90,r:0 }));
const cases = [
  { name:'desktop', viewport:'desktop', zoom:1, estop:false },
  { name:'compact', viewport:'compact', zoom:1, estop:false },
  { name:'portrait', viewport:'touch-portrait', zoom:1, estop:false },
  { name:'portrait-150', viewport:'touch-portrait', zoom:1.5, estop:false },
  { name:'landscape-estop', viewport:'touch-landscape', zoom:1, estop:true },
] as const;
for (const scenario of cases) test(`R36 own: ${scenario.name} header help and input isolation`, async ({ browser }) => {
  const viewport = VIEWPORTS.find(v => v.name === scenario.viewport)!;
  const profile = PROFILES[1];
  const context = await browser.newContext({ hasTouch:viewport.touch, deviceScaleFactor:1, viewport });
  const page = await context.newPage();
  await openLayout(page, profile, viewport);
  if (scenario.estop) await setLayoutState(page, profile, 'estop');
  await ctl({ op:'status_delta', data:{ wcs_table:WCS, g5x_index:1, g92_offset:[1,0,0,0,0,6,0,0,0], tool_offset:[0,0,45.7,0,0,8,0,0,0], eoffset_enabled:false,eoffset_z:0 }});
  await page.getByRole('tab',{name:'Offsets',exact:true}).click();
  if (scenario.zoom !== 1) await page.evaluate(z => { document.documentElement.style.zoom = String(z); }, scenario.zoom);
  await settleLayout(page);
  const wrap=page.locator('.offsetPanel .tableWrap');
  const help=page.locator('.offsetPanel thead').getByRole('button',{name:'Help: Offsets in effect',exact:true});
  const pop=page.locator('.helpPopover:popover-open');
  const headBefore = await help.boundingBox();
  await wrap.evaluate(el => { el.scrollTop=el.scrollHeight; });
  await settleLayout(page);
  const headAfter = await help.boundingBox();
  expect(headAfter).not.toBeNull();
  expect(Math.abs(headAfter!.y-headBefore!.y), 'header remains fixed while rows scroll').toBeLessThan(1);
  const dimensions=await wrap.evaluate(el => ({ clientWidth:el.clientWidth,scrollWidth:el.scrollWidth,clientHeight:el.clientHeight,scrollHeight:el.scrollHeight,scrollTop:el.scrollTop }));
  if (scenario.zoom === 1) expect(dimensions.scrollWidth-dimensions.clientWidth,'no new sliver horizontal scroll').toBeLessThanOrEqual(1);
  await ctl({ op:'raw', frame:{ type:'settings_init', settings:{keyboard:{jogEnabled:true,buttonsEnabled:true}} }});
  await ctl({ op:'clearCmds' });
  { const r=(await help.boundingBox())!; if (viewport.touch) await page.touchscreen.tap(r.x+r.width/2,r.y+r.height/2); else await page.mouse.click(r.x+r.width/2,r.y+r.height/2); }
  await expect(pop).toHaveCount(1);
  await expect(help).toHaveAttribute('aria-expanded','true');
  await expect(pop).toContainText('G52/G92');
  await expect(pop).toContainText('G43 — in effect, not the tool table');
  await settleLayout(page);
  const scrollAfterOpen = await wrap.evaluate(el => el.scrollTop);
  const measured = await pop.evaluate(el => {
    const r=el.getBoundingClientRect(); const s=getComputedStyle(el);
    return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height,clientWidth:el.clientWidth,scrollWidth:el.scrollWidth,text:el.textContent,whiteSpace:s.whiteSpace,viewportWidth:innerWidth,viewportHeight:innerHeight};
  });
  expect(measured.x).toBeGreaterThanOrEqual(0);
  expect(measured.y).toBeGreaterThanOrEqual(0);
  expect(measured.right).toBeLessThanOrEqual(measured.viewportWidth+1);
  expect(measured.bottom).toBeLessThanOrEqual(measured.viewportHeight+1);
  expect(measured.scrollWidth-measured.clientWidth).toBeLessThanOrEqual(1);
  await page.screenshot({ path:`../evidence/operator-punkte.r36.${scenario.name}.png` });
  { const r=(await help.boundingBox())!; if (viewport.touch) await page.touchscreen.tap(r.x+r.width/2,r.y+r.height/2); else await page.mouse.click(r.x+r.width/2,r.y+r.height/2); }
  await expect(pop).toHaveCount(0);
  // Keyboard Enter/Space must be local even with machine shortcuts enabled.
  await help.focus();
  await page.keyboard.press('Enter');
  await expect(pop).toHaveCount(1);
  await page.keyboard.press('Space');
  await expect(pop).toHaveCount(0);
  await expect(help).toBeFocused();
  // Tap outside dismisses without any command or offset edit.
  { const r=(await help.boundingBox())!; if (viewport.touch) await page.touchscreen.tap(r.x+r.width/2,r.y+r.height/2); else await page.mouse.click(r.x+r.width/2,r.y+r.height/2); }
  await expect(pop).toHaveCount(1);
  const heading=page.locator('.offsetPanel thead th').nth(1);
  if (viewport.touch) await heading.tap(); else await heading.click();
  await expect(pop).toHaveCount(0);
  const commands=(await ctl({ op:'lastCmds' })).cmds.filter((c:any) => !['hello','arm','client_diag','tab_visibility','get_tool_table','heartbeat'].includes(c.cmd));
  expect(commands,'help sends no machine commands').toEqual([]);
  const target=await help.evaluate(el => { const s=getComputedStyle(el,'::before');return {width:s.width,height:s.height,rect:el.getBoundingClientRect().toJSON()}; });
  expect(parseFloat(target.width)).toBeGreaterThanOrEqual(24);
  expect(parseFloat(target.height)).toBeGreaterThanOrEqual(24);
  writeFileSync(`../evidence/operator-punkte.r36.${scenario.name}.json`, JSON.stringify({scenario,dimensions,scrollAfterOpen,headBefore,headAfter,measured,target,commands},null,2)+'\n');
  expect.soft(scrollAfterOpen,'opening visible sticky help preserves the viewed rows').toBe(dimensions.scrollTop);
  await context.close();
});
