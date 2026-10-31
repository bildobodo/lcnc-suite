import {test,expect} from '@playwright/test';
import {writeFileSync} from 'node:fs';
import {ctl} from './ctl';
import {openLayout,PROFILES,VIEWPORTS} from './layout-fixtures';
const OUT='/tmp/codex-r236-lcibep7n';
const SURFACES=[
  {name:'desktop',zoom:1},{name:'compact',zoom:1},
  {name:'touch-landscape',zoom:1},{name:'touch-landscape',zoom:1.5},
  {name:'touch-portrait',zoom:1},{name:'touch-portrait',zoom:1.5},
];
for (const s of SURFACES) test(`R236 independent note and help: ${s.name} ${s.zoom}`,async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(String(e)));
  await openLayout(page,PROFILES[2],VIEWPORTS.find(v=>v.name===s.name)!);
  await page.evaluate(z=>document.documentElement.style.zoom=String(z),s.zoom);
  const g55=page.locator('[data-strip="setup"]').getByRole('radio',{name:'G55',exact:true});
  await g55.scrollIntoViewIfNeeded();
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  const snap=()=>page.evaluate(()=>{
    const rect=(e:Element)=>{const b=e.getBoundingClientRect();return {x:b.x,y:b.y,w:b.width,h:b.height};};
    const jog=document.querySelector('[data-strip="jog"]')!,setup=document.querySelector('[data-strip="setup"]')!;
    const note=jog.querySelector('.choiceNote')!;
    const textRange=document.createRange();textRange.selectNodeContents(note);
    const nr=note.getBoundingClientRect(),jr=jog.getBoundingClientRect();
    const text=[...textRange.getClientRects()].filter(r=>r.width>1).map(r=>({x:r.x,y:r.y,w:r.width,h:r.height}));
    const controls=[...document.querySelectorAll('[data-strip="jog"] input,[data-strip="jog"] select,[data-strip="jog"] [role=radio],[data-strip="setup"] input,[data-strip="setup"] .setupActions button,[data-strip="setup"] [role=radio]')]
      .filter(e=>(e as HTMLElement).offsetParent!==null).map(e=>({name:e.getAttribute('aria-label')||e.textContent?.trim(),...rect(e)}));
    return {jog:rect(jog),setup:rect(setup),controls,note:{text:note.textContent,...rect(note),textRects:text,inside:nr.left>=jr.left-1&&nr.right<=jr.right+1&&nr.bottom<=jr.bottom+1},
      step:!!jog.querySelector('.stepBlock select')?'select':jog.querySelector('.stepBlock .grid')?'grid':'row'};
  });
  const start=await snap();const records:unknown[]=[start];
  const cases=[
    {name:'not aligned',text:'Plane: head not aligned — Orient',data:{twp_defined:true,twp_pose_a:null,twp_pose_b:null,twp_pose_c:null,rotary_abc:[0,0,0]}},
    {name:'oriented',text:'\u00a0',data:{twp_defined:true,twp_pose_a:0,twp_pose_b:0,twp_pose_c:0,rotary_abc:[0,0,0]}},
    {name:'stale',text:'Plane stale — press Orient',data:{twp_defined:true,twp_pose_a:0,twp_pose_b:0,twp_pose_c:0,rotary_abc:[20,0,0]}},
    {name:'none',text:'Plane: none defined',data:{twp_defined:false,rotary_abc:[0,0,0]}}
  ];
  for(const c of cases){
    await ctl({op:'status_delta',data:c.data});
    await expect(page.locator('[data-strip="jog"] .choiceNote')).toHaveText(c.text);
    await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
    const now=await snap();records.push({state:c.name,...now});
    expect(now.controls,`${c.name}: all stable controls keep their viewport positions`).toEqual(start.controls);
    expect(now.step,`${c.name}: same step selector form`).toBe(start.step);
    expect(now.note.inside,`${c.name}: note remains within Jog`).toBe(true);
    for(const r of now.note.textRects){
      expect(r.x+r.w).toBeLessThanOrEqual(now.note.x+now.note.w+1);
      expect(r.y+r.h).toBeLessThanOrEqual(now.note.y+now.note.h+1);
    }
  }
  const helpData=await page.locator('.strip .sectionHelp').evaluateAll(els=>els.filter(e=>(e as HTMLElement).offsetParent!==null).map(e=>{
    const b=e.getBoundingClientRect(),i=e.querySelector(':scope > .helpIcon')!.getBoundingClientRect();
    return {name:e.firstChild?.textContent,delta:i.y+i.height/2-(b.y+b.height/2)};
  }));
  for(const h of helpData)expect(Math.abs(h.delta),`${h.name}: centred at CSS zoom ${s.zoom}`).toBeLessThanOrEqual(0.6*s.zoom);
  const help=page.getByRole('button',{name:'Help: Go to positions',exact:true});
  await help.focus();await page.keyboard.press('Enter');
  const pop=page.locator('.helpPopover:popover-open');
  await expect(pop).toContainText('Z always goes up first');
  const popBox=(await pop.boundingBox())!;const vp=page.viewportSize()!;
  expect(popBox.x).toBeGreaterThanOrEqual(0);expect(popBox.y).toBeGreaterThanOrEqual(0);
  expect(popBox.x+popBox.width).toBeLessThanOrEqual(vp.width+1);expect(popBox.y+popBox.height).toBeLessThanOrEqual(vp.height+1);
  await page.keyboard.press('Enter');await expect(pop).toHaveCount(0);
  expect(errors).toEqual([]);
  writeFileSync(`${OUT}/independent-${s.name}-${s.zoom}.json`,JSON.stringify({surface:s,records,helpData,popBox},null,2));
});
test.afterAll(async()=>{await ctl({op:'reset'});});
