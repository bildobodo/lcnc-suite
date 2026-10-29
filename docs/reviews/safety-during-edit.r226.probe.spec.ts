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

// Own counterprobes, archive 61a9253f only; mock 127.0.0.1:4188.
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
 console.log('R226 '+name+' '+JSON.stringify({...data,events}));
 await page.screenshot({path:info.outputPath(name+'.png')});
}


test.describe('the actual helper place survives queued session changes',()=>{
 test.use({hasTouch:true});
 for(const cancel of [false,true]) {
  test(`queued MDI opening ${cancel ? 'cancelled' : 'kept'} while the mouse holds G55 in a scrolled strip`,async({page},info)=>{
   await openTouch(page,{width:1280,height:800});
   await page.getByRole('tab',{name:'MDI',exact:true}).tap();
   await page.evaluate(()=>document.documentElement.style.zoom='1.5');
   await openHelper(page,'keypad (strip field)',true);
   const strip=page.locator('.strip');
   await strip.evaluate(el=>el.scrollLeft=100);
   await page.waitForTimeout(100);
   const target=await page.getByRole('radio',{name:'G55',exact:true}).elementHandle();
   const before=(await target!.boundingBox())!;
   expect(await target!.evaluate(el=>{const b=el.getBoundingClientRect();return el.contains(document.elementFromPoint(b.x+b.width/2,b.y+b.height/2));})).toBe(true);
   const scroll=()=>strip.evaluate(el=>({left:el.scrollLeft,width:el.scrollWidth,client:el.clientWidth}));
   const scrollBefore=await scroll();
   expect(scrollBefore.left).toBeGreaterThan(0);
   await recordEvents(page);
   await page.mouse.move(before.x+before.width/2,before.y+before.height/2);
   await page.mouse.down();
   await page.locator('.mdiInput').tap();
   await page.waitForTimeout(100);
   const queued={target:await target!.boundingBox(),scroll:await scroll(),place:await page.locator('.stripHelperPlace').count(),text:await page.locator('.tkStrip').count()};
   expect(queued.target).toEqual(before);
   expect(queued.scroll).toEqual(scrollBefore);
   expect(queued.place).toBe(1);
   expect(queued.text).toBe(0);
   if(cancel) await page.touchscreen.tap(2,2);
   await page.waitForTimeout(650);
   const held={target:await target!.boundingBox(),scroll:await scroll(),place:await page.locator('.stripHelperPlace').count(),text:await page.locator('.tkStrip').count()};
   const events=await page.evaluate(()=>(window as any).r224events);
   expect(events.filter((e:any)=>(e.type==='pointerup'||e.type==='pointercancel')&&e.pointerId===1),'the mouse remains held').toHaveLength(0);
   await evidence(page,info,cancel?'queued-close':'queued-kept',{before,scrollBefore,queued,held});
   await page.mouse.up();
   await page.waitForTimeout(700);
   const after={place:await page.locator('.stripHelperPlace').count(),text:await page.locator('.tkStrip').count(),commands:await sent(),events:await page.evaluate(()=>(window as any).r224events)};
   console.log('R226 '+(cancel?'queued-close-after':'queued-kept-after')+' '+JSON.stringify(after));
   expect(held.target,'the pending session closing must not move the still held target').toEqual(before);
   expect(held.scroll,'the displayed helper place remains until the physical press ends').toEqual(scrollBefore);
   expect(after.place).toBe(0);
   expect(after.text).toBe(cancel?0:1);
  });
 }
});
