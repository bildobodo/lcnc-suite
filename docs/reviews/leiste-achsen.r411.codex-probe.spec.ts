// Codex R411. Prototype CSS and toolIntoSpindle/pinGroup from the supplied
// leiste-achsen.plan.render.spec.ts; unused picture/render cases removed.
import {appendFileSync} from 'node:fs';
import {test,expect,type Page} from './test';
import {PROFILES,openLayout,type Profile} from './layout-fixtures';
const OUT='/tmp/r411';
const XYZ:Profile={name:'XYZ',axes:['X','Y','Z'],kins:null};
const XYZAC:Profile={name:'XYZAC',axes:['X','Y','Z','A','C'],kins:PROFILES[1].kins};
const TWP:Profile={name:'TWP',axes:['X','Y','Z','A','B','C'],kins:PROFILES[2].kins};
const M1_CSS = `
.strip > [data-strip="tool"] { display: none !important; }
.strip:not(:has(.nkStrip, .tkStrip)) > [data-strip="spindle"] { flex-grow: 1; }`;
// The pinned group: each section covers what scrolls under it (background),
// Spindle also the strip's 8 px end padding (the bleed-through Safety avoids
// by carrying its padding itself); the scroll fade moves to the group's
// inner edge.
const M2_CSS = `
.strip > .stripFade { display: none !important; }
.strip > [data-strip="spindle"] { position: sticky; right: 0; z-index: var(--z-raised); background: var(--panel); box-shadow: var(--gap-controls) 0 0 var(--panel); }
.strip > [data-strip="overrides"] { position: sticky; z-index: var(--z-raised); background: var(--panel); box-shadow: var(--gap-controls) 0 0 var(--panel); }
.strip.m2-more > [data-strip="overrides"]::before { content: ""; position: absolute; top: 0; bottom: 0; left: calc(-2 * var(--gap-panel) - 1px); width: calc(2 * var(--gap-panel)); background: var(--panel); pointer-events: none;
  -webkit-mask-image: linear-gradient(to left, black 0%, rgba(0,0,0,0.8) 12%, rgba(0,0,0,0.45) 30%, rgba(0,0,0,0.15) 60%, transparent 100%);
  mask-image: linear-gradient(to left, black 0%, rgba(0,0,0,0.8) 12%, rgba(0,0,0,0.45) 30%, rgba(0,0,0,0.15) 60%, transparent 100%); }`;
// M3: Tool yields, only Overrides pinned at the right edge (Spindle scrolls)
const M3_CSS = `
.strip > .stripFade { display: none !important; }
.strip > [data-strip="overrides"] { position: sticky; right: 0; z-index: var(--z-raised); background: var(--panel); box-shadow: var(--gap-controls) 0 0 var(--panel); }`;
async function toolIntoSpindle(page: Page) {
  await page.evaluate(() => {
    const sec = document.querySelector('[data-strip="spindle"]')!;
    const wrap = document.createElement('div');
    wrap.className = 'stack-tight';
    wrap.innerHTML = '<div class="statusRow"><span class="label-muted md">Tool</span><span class="val-status md mono">T12</span></div>'
      + '<div class="statusRow"><span class="label-muted md">In effect</span><span class="val-status md">G43</span></div>';
    const sep = document.createElement('div'); sep.className = 'sep';
    sec.append(sep, wrap);
  });
}

async function pinGroup(page: Page) {
  await page.addStyleTag({ content: M2_CSS });
  await page.evaluate(() => {
    const strip = document.querySelector('.strip') as HTMLElement;
    const sp = document.querySelector('[data-strip="spindle"]') as HTMLElement;
    const ov = document.querySelector('[data-strip="overrides"]') as HTMLElement;
    const gap = parseFloat(getComputedStyle(strip).columnGap) || 8;
    ov.style.right = `${sp.getBoundingClientRect().width + gap}px`;
    const sync = () => strip.classList.toggle('m2-more', strip.scrollLeft + strip.clientWidth < strip.scrollWidth - 1);
    strip.addEventListener('scroll', sync); sync();
  });
}

// Codex R411: exact base + supplied CSS/DOM, then the proposed mandatory
// snapping and padding. Observation only; no product change, no live server.
async function state(page: Page) {
  return page.evaluate(() => {
    const strip = document.querySelector('.strip') as HTMLElement;
    const safety = document.querySelector('.safetyStrip') as HTMLElement;
    const ov = document.querySelector('[data-strip="overrides"]') as HTMLElement;
    const jog = document.querySelector('[data-strip="jog"]') as HTMLElement;
    const pin = getComputedStyle(ov).position === 'sticky';
    const sr = strip.getBoundingClientRect(), left = safety.getBoundingClientRect().right;
    const right = pin ? ov.getBoundingClientRect().left : sr.right;
    const seen = (e: Element) => {
      const r=e.getBoundingClientRect();
      const point=(x:number,y:number)=>{ const h=document.elementFromPoint(x,y); return !!h && (h===e || e.contains(h)); };
      return { label:e.getAttribute('aria-label') ?? e.textContent?.trim(),
        l:r.left,r:r.right,t:r.top,b:r.bottom,
        whole:r.left>=left-.5 && r.right<=right+.5 && r.top>=sr.top && r.bottom<=sr.bottom &&
          [r.left+2,(r.left+r.right)/2,r.right-2].every(x=>point(x,(r.top+r.bottom)/2)),
        centre:point((r.left+r.right)/2,(r.top+r.bottom)/2) };
    };
    const buttons=[...jog.querySelectorAll('.jogBtn')].map(seen);
    const sp=document.querySelector('[data-strip="spindle"]')!;
    const srButton=[...sp.querySelectorAll('button')].find(b=>b.textContent?.trim()==='Fwd')!;
    const br=srButton.getBoundingClientRect();
    const hit=document.elementFromPoint((br.left+br.right)/2,(br.top+br.bottom)/2);
    const spindleFwd={left:br.left,right:br.right,viewportRight:sr.right,
      whole:br.left>=sr.left && br.right<=sr.right && !!hit && (srButton===hit || srButton.contains(hit))};
    return { spindleFwd, scroll:strip.scrollLeft,max:strip.scrollWidth-strip.clientWidth,
      snap:getComputedStyle(strip).scrollSnapType,
      padding:[getComputedStyle(strip).scrollPaddingLeft,getComputedStyle(strip).scrollPaddingRight],
      left,right,middle:right-left,jogWidth:jog.getBoundingClientRect().width,
      stop:buttons.find(b=>b.label==='Stop'),
      visible:buttons.filter(b=>b.label!=='Stop' && b.whole).map(b=>b.label), buttons };
  });
}
async function settled(page: Page) {
  await page.evaluate(async()=>{
    const s=document.querySelector('.strip')!; let prev=-1,n=0;
    for(let i=0;i<180 && n<8;i++) {await new Promise(requestAnimationFrame);const x=s.scrollLeft;n=Math.abs(x-prev)<.01?n+1:0;prev=x;}
  });
}
const OWN=[
 {name:'TWP1900-F2',profile:TWP,width:1900,form:'F2'},
 {name:'TWP1920-F2',profile:TWP,width:1920,form:'F2'},
 {name:'XYZ1280-F2',profile:XYZ,width:1280,form:'F2'},
 {name:'XYZAC1280-F3',profile:XYZAC,width:1280,form:'F3'},
 {name:'TWP1280-F3',profile:TWP,width:1280,form:'F3'},
 {name:'XYZ1000-F4',profile:XYZ,width:1000,form:'F4'},
];
for (const c of OWN) test(`R411 snap ${c.name}`,async({page,browserName},info)=>{
 test.setTimeout(90_000);
 // Firefox BiDi has no touch, use desktop there; record density explicitly.
 const touch=browserName==='chromium';
 await openLayout(page,c.profile,{name:c.name,width:c.width,height:800,touch});
 await page.addStyleTag({content:M1_CSS.replace('flex-grow: 1;','flex-grow: 0;')});
 await toolIntoSpindle(page);
 if(c.form==='F2') await pinGroup(page);
 if(c.form==='F3') await page.addStyleTag({content:M3_CSS});
 if(c.form!=='F4') {
  await page.addStyleTag({content:`.strip {scroll-snap-type: x mandatory;} .strip > [data-strip="jog"], .strip > [data-strip="setup"] {scroll-snap-align:start;}`});
  await page.evaluate(()=>{
   const s=document.querySelector('.strip') as HTMLElement;
   const saf=document.querySelector('.safetyStrip')!.getBoundingClientRect();
   const ov=document.querySelector('[data-strip="overrides"]')!.getBoundingClientRect();
   s.style.scrollPaddingLeft=`${saf.right-s.getBoundingClientRect().left+8}px`;
   s.style.scrollPaddingRight=`${s.getBoundingClientRect().right-ov.left+8}px`;
  });
 }
 await settled(page);
 const samples:any[]=[];
 for(const [at,f] of [['start',0],['quarter',.25],['mid',.5],['end',1]] as const) {
  await page.locator('.strip').evaluate((el,f)=>{el.scrollLeft=(el.scrollWidth-el.clientWidth)*f;},f);
  await settled(page);
  samples.push({at,...await state(page)});
 }
 // Tab/focus brings last Setup control into view via browser's own scroll.
 const target=page.locator('[data-strip="setup"] button:not([disabled])').last();
 await target.focus(); await settled(page);
 samples.push({at:'setup-focus',...await state(page)});
 await page.locator('[data-strip="spindle"]').getByRole('button',{name:'Fwd',exact:true}).focus();
 await settled(page);
 samples.push({at:'spindle-focus',...await state(page)});
 await page.locator('.strip').screenshot({path:`${OUT}/${info.project.name}-${c.name}.png`});
 appendFileSync(`${OUT}/samples.jsonl`,JSON.stringify({name:c.name,project:info.project.name,touch,samples})+'\n');
 expect(samples.length).toBe(6);
 if(c.form!=='F4') {expect(samples[0].snap).toBe('x mandatory');expect(samples[0].middle).toBeGreaterThanOrEqual(samples[0].jogWidth);}
});
test('R411 focus when Tool yields',async({page},info)=>{
 await openLayout(page,XYZ,{name:'focus',width:1920,height:1080,touch:false});
 const tool=page.getByRole('button',{name:'Tool Table',exact:true});
 await tool.focus();await expect(tool).toBeFocused();
 const before=await page.evaluate(()=>({tag:document.activeElement?.tagName,text:document.activeElement?.textContent}));
 await page.addStyleTag({content:M1_CSS});await toolIntoSpindle(page);await settled(page);
 const after=await page.evaluate(()=>({tag:document.activeElement?.tagName,tabindex:document.activeElement?.getAttribute('tabindex')}));
 appendFileSync(`${OUT}/focus.jsonl`,JSON.stringify({project:info.project.name,before,after})+'\n');
 expect(after.tag).toBe('BODY');
});
