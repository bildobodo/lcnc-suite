import { test, expect, type Page, type Locator } from "@playwright/test";
import { ctl, MOCK } from "./ctl";

const PERMS_ALL = {
  idle: true, jog: true, override: true, ready: true, run: true, pause: false,
  resume: false, step: true, abort: true, spindleStop: true, probe: true, zero: true,
  machineFrame: true, goZero: true, planeFrame: true,
  touchoff: true, touchoffRotary: true, twpCapture: true,
  surfaceComp: true, safety: true, setup: true, sourceWrite: true, toolTableWrite: true, armed: true, always: true,
  programLoad: true, modeManual: true, modeCoord: true, parameterRead: true, g30Write: true, spindleManual: true, armEnable: true, estopReset: true,
};

type Sent = { cmd?: string; [k: string]: unknown };
async function sent(): Promise<Sent[]> {
  return ((await ctl({ op: "lastCmds" })) as { cmds?: Sent[] }).cmds ?? [];
}

async function open(page: Page, viewport: { width: number; height: number }) {
  await ctl({ op: "reset" });
  await page.setViewportSize(viewport);
  await page.goto(MOCK);
  await expect(page.locator("input.setupInput").first()).toBeVisible();
  await ctl({ op: "quiet", on: true });
  await ctl({ op: "status_delta", armed: true, data: { active_file: "/A.ngc", permissions: PERMS_ALL } });
  await expect(page.locator(".pill.armed")).toHaveCount(1);
  await ctl({ op: "clearCmds" });
}
/** Touch mode: the session's first touch switches to touch sizes, which
 *  moves the strip — a neutral tap first (as input-session.spec). */
async function openTouch(page: Page, viewport: { width: number; height: number }) {
  await open(page, viewport);
  await page.touchscreen.tap(2, 2);
  await expect(page.locator("html")).toHaveClass(/touch-device/);
}

type Helper = "keyboard" | "keypad (strip field)" | "keypad (side-pane field)";
const HELPERS: Helper[] = ["keyboard", "keypad (strip field)", "keypad (side-pane field)"];

/** Open a helper the way the operator does: a deliberate press on its field. */
async function openHelper(page: Page, helper: Helper, touch: boolean): Promise<Locator> {
  const press = (l: Locator) => (touch ? l.tap() : l.click());
  if (helper === "keyboard") {
    await press(page.getByRole("tab", { name: "MDI", exact: true }));
    await press(page.locator(".mdiInput"));
    await expect(page.locator(".tkStrip")).toBeVisible();
    return page.locator(".tkStrip");
  }
  let field: Locator;
  if (helper === "keypad (strip field)") field = page.locator("input.setupInput").first();
  else {
    await press(page.getByRole("tab", { name: "Probing", exact: true }));
    field = page.locator(".probePanel .formGrid input").first();
  }
  await field.scrollIntoViewIfNeeded();
  await press(field);
  await expect(page.locator(".nkStrip")).toBeVisible();
  return page.locator(".nkStrip");
}

// Own counterprobes, archive 3c24fbea only; mock 127.0.0.1:4188.
async function recordEvents(page: Page) {
  await page.evaluate(() => {
    (window as any).r224events=[];
    for(const type of ['pointerdown','pointerup','pointercancel','click','contextmenu']) {
      document.addEventListener(type, (e: any) => (window as any).r224events.push({type,ms:performance.now(),pointerId:e.pointerId,buttons:e.buttons,isPrimary:e.isPrimary,target:(e.target as Element)?.getAttribute('aria-label')||(e.target as Element)?.textContent?.slice(0,40)}),true);
    }
  });
}
async function evidence(page:Page, info:any, name:string, data:any) {
 const events=await page.evaluate(()=>(window as any).r224events);
 await info.attach(name+'.json',{body:JSON.stringify({...data,events},null,2),contentType:'application/json'});
 console.log('R224 '+name+' '+JSON.stringify({...data,events}));
 await page.screenshot({path:info.outputPath(name+'.png')});
}
for (const hold of [100,2300]) {
 test(`plain Setup help: ${hold} ms press lands before the layout follows`,async({page},info)=>{
  await open(page,{width:1920,height:1080});
  await openHelper(page,'keypad (strip field)',false);
  await recordEvents(page);
  const target=page.getByRole('button',{name:'Help: Go to positions',exact:true});
  const before=(await target.boundingBox())!;
  await page.mouse.move(before.x+before.width/2,before.y+before.height/2);
  await page.mouse.down();
  await page.waitForTimeout(hold);
  const during=await target.boundingBox();
  await page.mouse.up();
  await page.waitForTimeout(100);
  const expanded=await target.getAttribute('aria-expanded');
  await evidence(page,info,'help-'+hold,{before,during,expanded,commands:await sent()});
  expect(during,'same press target before release').toEqual(before);
  await expect(target,'same action for a slow release').toHaveAttribute('aria-expanded','true');
 });
}

test.describe('multiple fingers',()=>{
 test.use({hasTouch:true});
 test('second finger released: first Home X still down after another 650 ms',async({page},info)=>{
  await openTouch(page,{width:1920,height:1080});
  await openHelper(page,'keypad (strip field)',true);
  await recordEvents(page);
  const target=page.locator('[data-strip="setup"]').getByRole('button',{name:/^(Home|Unhome) X$/});
  const before=(await target.boundingBox())!;
  const cdp=await page.context().newCDPSession(page);
  const p1={id:1,x:before.x+before.width/2,y:before.y+before.height/2};
  const p2={id:2,x:1850,y:600};
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[p1]});
  await page.waitForTimeout(80);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[p1,p2]});
  await page.waitForTimeout(50);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[p2]});
  await page.waitForTimeout(650);
  const during=await target.boundingBox();
  const events=await page.evaluate(()=>(window as any).r224events);
  const downs=events.filter((e:any)=>e.type==='pointerdown');
  const ups=events.filter((e:any)=>e.type==='pointerup');
  expect(downs).toHaveLength(2);
  expect(ups).toHaveLength(1);
  expect(ups[0].pointerId,'only the SECOND finger was released').toBe(downs[1].pointerId);
  expect(events.filter((e:any)=>e.type==='pointercancel')).toHaveLength(0);
  await evidence(page,info,'two-fingers',{before,during,commands:await sent()});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  expect(during,'the first pointer is still held, well before its 2s deadline').toEqual(before);
 });
});

for (const hold of [100,2300]) {
 test(`WCS G55: ${hold} ms press sends the chosen offset`,async({page},info)=>{
  await open(page,{width:1920,height:1080});
  await openHelper(page,'keypad (strip field)',false);
  await recordEvents(page);
  const target=page.getByRole('radio',{name:'G55',exact:true});
  await expect(target).toBeEnabled();
  const before=(await target.boundingBox())!;
  await page.mouse.move(before.x+before.width/2,before.y+before.height/2);
  await page.mouse.down();
  await page.waitForTimeout(hold);
  const during=await target.boundingBox();
  await page.mouse.up();
  await page.waitForTimeout(200);
  const commands=await sent();
  await evidence(page,info,'g55-'+hold,{before,during,commands});
  expect(commands,'the same WCS choice arrives for both press lengths').toContainEqual(expect.objectContaining({cmd:'mdi',text:'G55'}));
 });
}

test.describe('portrait fold after a status change',()=>{
 test.use({hasTouch:true});
 test('a folded detail is measured again when its content gets shorter',async({page},info)=>{
  await openTouch(page,{width:900,height:2000});
  await openHelper(page,'keyboard',true);
  await page.evaluate(()=>{document.documentElement.style.zoom='1.5';});
  await ctl({op:'status_delta',data:{gcodes:[0,331,191,900,911,930,210,421,431,593,611,960,980],mcodes:[0,3,8,48]}});
  await expect(page.locator('.tkStrip')).toBeVisible();
  await page.waitForTimeout(200);
  const measure=()=>page.evaluate(()=>{
   const helper=document.querySelector('.tkStrip')!;
   const detail=document.querySelector('.safetyStrip .statusDetail');
   return {info:!!detail,infoHeight:detail?.getBoundingClientRect().height,bottom:helper.getBoundingClientRect().bottom,height:innerHeight,codes:detail?.textContent};
  });
  const before=await measure();
  const height=Math.floor(before.bottom)-5;
  expect(height).toBeGreaterThan(900);
  await page.setViewportSize({width:900,height});
  await expect(page.locator('.safetyStrip .statusDetail')).toHaveCount(0);
  await ctl({op:'status_delta',data:{gcodes:[0,0,170,900,910,940,210,400,490,540,610,970,980],mcodes:[0,5,9,48]}});
  await page.waitForTimeout(500);
  const afterUpdate=await measure();
  await page.mouse.click(2,2);
  await expect(page.locator('.tkStrip')).toHaveCount(0);
  await expect(page.locator('.safetyStrip .statusDetail')).toHaveCount(1);
  await page.locator('.mdiInput').tap();
  await expect(page.locator('.tkStrip')).toBeVisible();
  await page.waitForTimeout(200);
  const afterReopen=await measure();
  await info.attach('fold.json',{body:JSON.stringify({before,afterUpdate,afterReopen},null,2),contentType:'application/json'});
  console.log('R224 fold '+JSON.stringify({before,afterUpdate,afterReopen}));
  expect(afterUpdate.info,'same current content and space should produce the same fold').toBe(afterReopen.info);
 });
});

test('a horizontally scrolled owner keeps its place when the keypad closes',async({page},info)=>{
 await open(page,{width:1280,height:800});
 await page.evaluate(()=>{document.documentElement.style.zoom='1.5';});
 await openHelper(page,'keypad (strip field)',false);
 const strip=page.locator('.strip');
 await strip.evaluate((el)=>{el.scrollLeft=100;});
 await page.waitForTimeout(100);
 const scrollBefore=await strip.evaluate(el=>({left:el.scrollLeft,width:el.scrollWidth,client:el.clientWidth}));
 expect(scrollBefore.left).toBeGreaterThan(0);
 const target=page.getByRole('radio',{name:'G55',exact:true});
 const before=(await target.boundingBox())!;
 expect(await target.evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));})).toBe(true);
 await recordEvents(page);
 await page.mouse.move(before.x+before.width/2,before.y+before.height/2);
 await page.mouse.down();
 await page.waitForTimeout(100);
 const during=await target.boundingBox();
 const scrollDuring=await strip.evaluate(el=>({left:el.scrollLeft,width:el.scrollWidth,client:el.clientWidth}));
 await page.mouse.up();
 await page.waitForTimeout(100);
 const commands=await sent();
 await evidence(page,info,'scroll-clamp',{before,during,scrollBefore,scrollDuring,commands});
 expect(during,'a 100ms press must not scroll-clamp the target away').toEqual(before);
 expect(commands).toContainEqual(expect.objectContaining({cmd:'mdi',text:'G55'}));
});
