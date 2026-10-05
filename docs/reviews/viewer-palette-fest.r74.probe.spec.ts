import {test,expect} from '@playwright/test';
import {writeFileSync} from 'node:fs';
import {ctl} from './ctl';
import {openLayout,PROFILES,VIEWPORTS,setLayoutState,settleLayout} from './layout-fixtures';
const save=(name:string,v:unknown)=>writeFileSync(`../evidence/viewer-palette-fest.r74.${name}.json`,JSON.stringify(v,null,2)+'\n');

test('R74: all visible cube arrow letters stay inside their canvas while orbiting near a face',async({page})=>{
  await openLayout(page,PROFILES[1]!,VIEWPORTS[0]!);
  await expect.poll(()=>page.evaluate(()=>window.__viewerDiag?.getViewCube?.())).toBeTruthy();
  const samples=await page.evaluate(async()=>{
    const rows=[];
    const rad=(x:number)=>x*Math.PI/180;
    for(const tilt of [5,10,15,17])for(let az=0;az<360;az+=15){
      const dir=[Math.sin(rad(tilt))*Math.cos(rad(az)),Math.sin(rad(tilt))*Math.sin(rad(az)),Math.cos(rad(tilt))];
      window.__viewerDiag!.setViewDirection!(dir);
      await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));
      const cube=window.__viewerDiag!.getViewCube!()!;
      const face=cube.faces.find(f=>f.label==='Z+')!;
      rows.push({tilt,az,opacity:face.opacity,canvas:cube.canvas,letters:face.arrows.map(a=>({axis:a.axis,at:a.letter})),dir});
    }
    return rows;
  });
  save('cube-orbit',samples);
  const bad=samples.filter(s=>s.opacity>0.3 && s.letters.some(a=>a.at[0]!<0 || a.at[1]!<0 || a.at[0]!>s.canvas[0]! || a.at[1]!>s.canvas[1]!));
  save('cube-clipped-centres',bad);
  const shot=samples.find(s=>s.tilt===5 && s.az===150)!;
  await page.evaluate(d=>window.__viewerDiag!.setViewDirection!(d),shot.dir);
  await page.waitForTimeout(150);
  await page.locator('.viewerPane .viewCube').screenshot({path:'../evidence/viewer-palette-fest.r74.cube-5deg.png'});
  if(bad[0]){
    await page.evaluate(d=>window.__viewerDiag!.setViewDirection!(d),bad[0].dir);
    await page.waitForTimeout(150);
    await page.locator('.viewerPane .viewCube').screenshot({path:'../evidence/viewer-palette-fest.r74.cube-clipped.png'});
  }
  expect(bad,'letter centres already outside the canvas (even before glyph extents)').toEqual([]);
});

test('R74: narrow Step and Resume still require a hold, Pause remains a tap and names track state',async({page})=>{
  await page.route('**/gcode?*',r=>r.fulfill({contentType:'text/plain',body:'G21 G90\nG1 X10 F100\nM2\n',headers:{'X-Program-Source':'a'.repeat(64)}}));
  await openLayout(page,PROFILES[1]!,VIEWPORTS.find(v=>v.name==='touch-portrait')!);
  await ctl({op:'raw',frame:{type:'viewer_gcode_ready',version:740,file:'/layout-example.ngc'}});
  await expect(page.locator('.codeLine').first()).toContainText('G21');
  await page.evaluate(()=>document.documentElement.style.zoom='1.5');
  await settleLayout(page);
  const row=page.locator('.sidePane .ctrlRow');
  const sent=async(cmd:string)=>((await ctl({op:'lastCmds'})).cmds as {cmd:string}[]).filter(x=>x.cmd===cmd).length;
  const hold=async(name:string,ms:number)=>{
    const b=(await row.getByRole('button',{name,exact:true}).boundingBox())!;
    await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();await page.waitForTimeout(ms);await page.mouse.up();
  };
  await ctl({op:'clearCmds'});
  await hold('Step',100);expect(await sent('auto_step')).toBe(0);
  await hold('Step',700);await expect.poll(()=>sent('auto_step')).toBe(1);
  await setLayoutState(page,PROFILES[1]!,'running');
  await row.getByRole('button',{name:'Pause',exact:true}).click();await expect.poll(()=>sent('cycle_pause')).toBe(1);
  await setLayoutState(page,PROFILES[1]!,'paused');
  await expect(row.getByRole('button',{name:'Resume',exact:true})).toBeVisible();
  await hold('Resume',100);expect(await sent('cycle_resume')).toBe(0);
  await hold('Resume',700);await expect.poll(()=>sent('cycle_resume')).toBe(1);
  await row.screenshot({path:'../evidence/viewer-palette-fest.r74.program-head-paused.png'});
  save('narrow-commands',{step:await sent('auto_step'),pause:await sent('cycle_pause'),resume:await sent('cycle_resume')});
});

test('R74: the visible axis glyph must not be cut by the cube canvas edge at ten degrees from Z+',async({page})=>{
  await openLayout(page,PROFILES[1]!,VIEWPORTS[0]!);
  await expect.poll(()=>page.evaluate(()=>window.__viewerDiag?.getViewCube?.())).toBeTruthy();
  const records=[];
  for(const tilt of [0,5,10]){
    const rad=(x:number)=>x*Math.PI/180;
    const dir=tilt===0?[0,0,1]:[Math.sin(rad(tilt))*Math.cos(rad(150)),Math.sin(rad(tilt))*Math.sin(rad(150)),Math.cos(rad(tilt))];
    await page.evaluate(d=>window.__viewerDiag!.setViewDirection!(d),dir);
    await page.waitForTimeout(150);
    const diag=await page.evaluate(()=>window.__viewerDiag!.getViewCube!()!);
    const face=diag.faces.find(f=>f.label==='Z+')!;
    const png=await page.locator('.viewerPane .viewCube').screenshot({path:`../evidence/viewer-palette-fest.r74.glyph-${tilt}deg.png`});
    const redAtTop=await page.evaluate(async b64=>{
      const bmp=await createImageBitmap(await(await fetch(`data:image/png;base64,${b64}`)).blob());
      const canvas=new OffscreenCanvas(bmp.width,bmp.height),ctx=canvas.getContext('2d')!;
      ctx.drawImage(bmp,0,0);
      const row=ctx.getImageData(0,0,bmp.width,1).data;
      const xs=[];
      for(let x=0;x<bmp.width;x++){
        const i=x*4;
        if(row[i]!-Math.max(row[i+1]!,row[i+2]!)>30)xs.push(x);
      }
      return xs;
    },png.toString('base64'));
    records.push({tilt,dir,opacity:face.opacity,xLetter:face.arrows.find(a=>a.axis==='X')!.letter,redGlyphPixelsOnTopBorder:redAtTop});
  }
  save('glyph-clipping',records);
  expect(records[0]!.redGlyphPixelsOnTopBorder).toEqual([]);
  expect(records[2]!.opacity).toBeGreaterThan(.7);
  expect(records[2]!.redGlyphPixelsOnTopBorder,'the X is visibly truncated by the drawing-buffer edge').toEqual([]);
});
