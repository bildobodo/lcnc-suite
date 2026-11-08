import {test,expect} from './test';
import {ctl,MOCK} from './ctl';
import {encode} from '@msgpack/msgpack';

test('the central entry guard refuses a held toggle event independent of the DOM disabled flag',async({page})=>{
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
  try {
    await ctl({op:'raw',frame:{type:'settings_changed',settings:{simulation:{enabled:false},keyboard}}});
    const toggle=page.locator('.scrubBar input[type=checkbox]');
    await expect(toggle).toBeDisabled();
    // Deliberate test seam: deliver the change callback even though the UI is locked.
    await toggle.evaluate((el:HTMLInputElement)=>{el.checked=true;el.dispatchEvent(new Event('change',{bubbles:true}));});
    await page.waitForTimeout(100);
    const pose=await page.evaluate(()=>window.__viewerDiag?.getScrubPose?.());
    console.log('CENTRAL_GUARD',JSON.stringify({pose,banner:await page.locator('.simBanner').count()}));
    expect(pose).toBeNull();
    await expect(page.locator('.simBanner')).toHaveCount(0);
  } finally {await page.mouse.up();}
});

test('disabling held Play keeps its position and hands its focus back when the bar leaves',async({page})=>{
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

  const b=(await play.boundingBox())!;
  await page.mouse.move(b.x+b.width/2,b.y+b.height/2); await page.mouse.down();
  await expect(play).toBeFocused();
  await ctl({op:'raw',frame:{type:'settings_changed',settings:{simulation:{enabled:false},keyboard}}});
  await expect(play).toBeDisabled();
  const held=await play.boundingBox();
  const midFocus=await page.evaluate(()=>({tag:document.activeElement?.tagName,role:document.activeElement?.getAttribute('role')}));
  await page.mouse.up();
  await expect(page.locator('.scrubBar')).toHaveCount(0);
  const endFocus=await page.evaluate(()=>({tag:document.activeElement?.tagName,role:document.activeElement?.getAttribute('role')}));
  console.log('HELD_PLAY',JSON.stringify({before:b,held,midFocus,endFocus}));
  expect(held).toEqual(b);
  await expect(page.getByRole('tab',{name:'Program',exact:true})).toBeFocused();
  await expect(page.locator('.simBanner')).toHaveCount(0);
});
