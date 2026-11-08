import {test,expect} from './test';
import {ctl,MOCK} from './ctl';
import {encode} from '@msgpack/msgpack';

test('a retained disabled timeline cannot re-enter simulation via keyboard while a pointer is held',async({page})=>{
  await page.route(/\/preview(\?|$)/, r => r.fulfill({contentType:'application/octet-stream',body:Buffer.from(encode({
    file:'/leak.ngc',preview_schema:11,feed:[[0,0,0],[10,0,0],[10,10,0]],feed_lines:[1,2,3],
    feed_seq:[1,2,3],feed_outside:new Uint8Array(3),rapid:[],violations:[],violations_total:0
  }))}));
  await page.route(/\/gcode(\?|$)/, r => r.fulfill({contentType:'text/plain',body:'G0 X0\nG1 X10 F100\nG1 Y10\nM2\n'}));
  await page.goto(MOCK);
  await expect(page.locator('input.setupInput').first()).toBeVisible();
  const keyboard={jogEnabled:true,buttonsEnabled:true};
  await ctl({op:'raw',frame:{type:'settings_init',settings:{simulation:{enabled:true},keyboard}}});
  await ctl({op:'status_delta',data:{active_file:'/leak.ngc'}});
  await ctl({op:'raw',frame:{type:'viewer_gcode_ready',version:8901,file:'/leak.ngc'}});

  await ctl({op:'status_delta',data:{is_enabled:false,enabled:false,interp_state:1,joint_pos:[0,0,0]}});
  const link=page.getByRole('button',{name:'Open the Sim tab',exact:true});
  const play=page.getByRole('button',{name:'Play the program through the machine model',exact:true});
  await expect(link).toBeVisible(); await expect(play).toBeEnabled();
  const b=(await link.boundingBox())!;
  await page.mouse.move(b.x+b.width/2,b.y+b.height/2); await page.mouse.down();
  let observed:any;
  try {
    await ctl({op:'raw',frame:{type:'settings_changed',settings:{simulation:{enabled:false},keyboard}}});
    await expect(page.locator('.scrubBar')).toBeVisible();
    await expect(page.locator('.simBanner')).toHaveCount(0);
    // The held pointer keeps the layout. Another input can still use the controls.
    await play.focus(); await play.press('Enter');
    await page.waitForTimeout(150);
    const shown=await page.locator('.simBanner').count();
    const pose=await page.evaluate(()=>window.__viewerDiag?.getScrubPose?.());
    const work=await page.evaluate(()=>window.__viewerDiag?.getSimulationWork?.());
    observed={banner:shown,pose,bar:await page.locator('.scrubBar').count(),work};
    console.log('REENTRY_WHILE_OFF',JSON.stringify(observed));
  } finally {await page.mouse.up();}
  await expect(page.locator('.scrubBar')).toHaveCount(0);
  console.log('AFTER_RELEASE',JSON.stringify({banner:await page.locator('.simBanner').count(),pose:await page.evaluate(()=>window.__viewerDiag?.getScrubPose?.())}));
  expect(observed.banner).toBe(0);
  expect(observed.pose).toBeNull();
});
