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
    for(const type of ['pointerdown','pointerup','pointercancel','pointermove','click','contextmenu']) {
      document.addEventListener(type, (e: any) => (window as any).r224events.push({type,ms:performance.now(),pointerId:e.pointerId,pointerType:e.pointerType,isTrusted:e.isTrusted,buttons:e.buttons,isPrimary:e.isPrimary,target:e.target instanceof Element ? (e.target.getAttribute('aria-label')||e.target.textContent?.slice(0,40)) : (e.target as Node)?.nodeName}),true);
    }
  });
}
async function evidence(page:Page, info:any, name:string, data:any) {
 const events=await page.evaluate(()=>(window as any).r224events);
 await info.attach(name+'.json',{body:JSON.stringify({...data,events},null,2),contentType:'application/json'});
 console.log('R225 '+name+' '+JSON.stringify({...data,events}));
 await page.screenshot({path:info.outputPath(name+'.png')});
}

const vp = {width:1920,height:1080};
const jogVisible=(page:Page)=>page.locator('[data-strip="jog"]').isVisible();
test('untrusted pointerdown closes the helper but holds no layout',async({page},info)=>{
 await open(page,vp);
 await openHelper(page,'keypad (strip field)',false);
 await recordEvents(page);
 await page.locator('.strip').dispatchEvent('pointerdown',{pointerId:741,pointerType:'mouse',isPrimary:true,buttons:1,bubbles:true});
 await expect(page.locator('.nkStrip')).toHaveCount(0);
 await expect.poll(()=>jogVisible(page)).toBe(true);
 await expect(page.locator('.stripHelperPlace')).toHaveCount(0);
 await evidence(page,info,'synthetic-down',{jog:true});
});

test('untrusted endings cannot release a real held pointer',async({page},info)=>{
 await open(page,vp);
 await openHelper(page,'keypad (strip field)',false);
 await recordEvents(page);
 const target=page.getByRole('radio',{name:'G55',exact:true});
 const before=(await target.boundingBox())!;
 await page.mouse.move(before.x+before.width/2,before.y+before.height/2);
 await page.mouse.down();
 await page.evaluate(()=>{
  const id=(window as any).r224events.find((e:any)=>e.type==='pointerdown').pointerId;
  for(const type of ['pointerup','pointercancel','pointermove'])document.dispatchEvent(new PointerEvent(type,{pointerId:id,pointerType:'mouse',buttons:0,bubbles:true}));
  document.dispatchEvent(new PointerEvent('click',{pointerId:id,pointerType:'mouse',detail:1,bubbles:true}));
 });
 await page.waitForTimeout(650);
 const during=await target.boundingBox();
 await expect(page.locator('.stripHelperPlace')).toHaveAttribute('aria-hidden','true');
 await expect(page.locator('.stripHelperPlace button,.stripHelperPlace input,[tabindex].stripHelperPlace')).toHaveCount(0);
 expect(during).toEqual(before);
 await page.mouse.up();
 await expect.poll(async()=>(await sent()).filter(c=>c.cmd==='mdi'&&c.text==='G55').length).toBe(1);
 await expect.poll(()=>jogVisible(page)).toBe(true);
 await expect(page.locator('.stripHelperPlace')).toHaveCount(0);
 await evidence(page,info,'synthetic-endings',{before,during});
});

test('a buttons=0 movement recovers an actually lost pointerup',async({page},info)=>{
 await page.addInitScript(()=>{
  document.addEventListener('pointerup',(e)=>{
   if((window as any).loseNextUp){(window as any).loseNextUp=false;e.stopImmediatePropagation();}
  },true);
 });
 await open(page,vp);
 await openHelper(page,'keypad (strip field)',false);
 const target=page.getByRole('radio',{name:'G55',exact:true});
 const before=(await target.boundingBox())!;
 await page.mouse.move(before.x+before.width/2,before.y+before.height/2);
 await page.mouse.down();
 await page.evaluate(()=>(window as any).loseNextUp=true);
 await page.mouse.up();
 await page.waitForTimeout(600);
 expect(await jogVisible(page),'the missing release is still held').toBe(false);
 expect(await target.boundingBox()).toEqual(before);
 await page.mouse.move(before.x+before.width/2+1,before.y+before.height/2);
 await expect.poll(()=>jogVisible(page),{timeout:1000}).toBe(true);
 await expect(page.locator('.stripHelperPlace')).toHaveCount(0);
 console.log('R225 lost-release recovered by buttons=0');
});

test.describe('different pointers opening a helper',()=>{
 test.use({hasTouch:true});
 test('a touch opens MDI while the mouse still holds G55',async({page},info)=>{
  await openTouch(page,vp);
  await page.getByRole('tab',{name:'MDI',exact:true}).tap();
  await openHelper(page,'keypad (strip field)',true);
  await recordEvents(page);
  const target=page.getByRole('radio',{name:'G55',exact:true});
  const before=(await target.boundingBox())!;
  await page.mouse.move(before.x+before.width/2,before.y+before.height/2);
  await page.mouse.down();
  const targetHandle=await target.elementHandle();
  await page.locator('.mdiInput').tap();
  await page.waitForTimeout(100);
  const during=await targetHandle!.boundingBox();
  const events=await page.evaluate(()=>(window as any).r224events);
  const mouseDown=events.find((e:any)=>e.type==='pointerdown'&&e.pointerId===1);
  expect(mouseDown).toBeTruthy();
  expect(events.filter((e:any)=>(e.type==='pointerup'||e.type==='pointercancel')&&e.pointerId===1)).toHaveLength(0);
  const state={before,during,placeholder:await page.locator('.stripHelperPlace').count(),text:await page.locator('.tkStrip').count(),commands:await sent()};
  await evidence(page,info,'new-helper-under-mouse',state);
  await page.mouse.up();
  await page.waitForTimeout(150);
  console.log('R225 new-helper-after-release '+JSON.stringify({commands:await sent(),events:await page.evaluate(()=>(window as any).r224events)}));
  expect(during,'the first pointer still owns a visible unmoved target').toEqual(before);
 });
});
