// Codex R149. Append to e2e/collisions.viewer.spec.ts in the archive only;
// uses its prepare(), slider(), sweepDone(), oneContact()/wireDelta() helpers.
test('Codex R149: a budget-stopped side keeps its actual coverage in the shown band', async ({page,context},testInfo)=>{
  test.setTimeout(120000);
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript({content:FROM_WIRE_INIT});
  await page.addInitScript(()=>{
    const tap:any={side:null,deliver:null};(window as any).__r149=tap;
    const Real=window.Worker;
    const Tap=function(url:string|URL,opts?:WorkerOptions){
      const w=new Real(url,opts);if(!/collisionWorker/.test(String(url)))return w;
      const post=w.postMessage.bind(w);let handler:any=null;
      Object.defineProperty(w,'onmessage',{get:()=>handler,set:f=>{handler=f;}});
      w.addEventListener('message',e=>handler?.(e));
      w.postMessage=((m:any,t?:Transferable[])=>{
        if(m?.side&&m.track){tap.side=m;tap.deliver=(d:any)=>handler?.(new MessageEvent('message',{data:{id:m.id,...d}}));return;}
        post(m,t??[]);
      })as any;return w;
    }as any;Tap.prototype=Real.prototype;window.Worker=Tap;
  });
  await prepare(page,context,{file:'/codex-r149-side.ngc',version:29149,lines:[1,2],joints:[-100,0,-100,0,0],feed:[[0,0,-100],[10,0,-100]]});
  await expect.poll(()=>sweepDone(page),{timeout:60000}).toBe(true);
  await page.locator('.scrubBar').getByRole('checkbox',{name:'Sim'}).check();
  await expect.poll(()=>page.evaluate(()=>(window as any).__r149.side?.id??null)).not.toBeNull();
  const meta=await page.evaluate(()=>{const s=(window as any).__r149.side;return{id:s.id,cum:Array.from(s.track.cum)as number[],lines:Array.from(s.track.lines),n:s.track.count};});
  const end=meta.cum[meta.n-1]!;
  const st=oneContact(meta.id,0,.1*end);
  await page.evaluate(([w,end])=>{
    const t=(window as any).__r149;
    t.first={line:t.side.track.lines[1],cum:.1*end,cumEnd:.2*end,a:'spindle_nose',b:'a_yoke_casting',dist:0,rapid:true};
    t.deliver({progress:.2,first:t.first,contacts:[(window as any).__fromWire(w)],contactPairs:[['spindle_nose','a_yoke_casting']]});
  },[wireDelta(st),end]as const);
  const bands=()=>page.locator('.scrubBand.clash').evaluateAll(els=>els.map(e=>{const track=e.parentElement!.querySelector('.scrubBand.track')!.getBoundingClientRect(), r=e.getBoundingClientRect();return {left:100*(r.left-track.left)/track.width,width:100*r.width/track.width};}));
  await expect.poll(async()=>{const bs=await bands();return bs.length?Math.max(...bs.map(b=>b.left+b.width)):999;}).toBeLessThan(30);
  const early=await bands();
  await page.evaluate(w=>{
    const t=(window as any).__r149;
    t.deliver({contacts:[(window as any).__fromWire(w)],result:{hits:[t.first],staticContacts:[],samples:10,coarsened:false,uncertified:null,pairCount:1,pairsPrescreened:0,bvhMs:0,sweepMs:10,truncated:{covered:.2,reason:'budget'},incompleteFrom:.2*t.side.track.cum[t.side.track.count-1]}});
  },wireDelta(st));
  // Wait for the message to have been applied and the UI to name its limit.
  await expect(page.locator('.simPanel .simSummary .sumItem').first()).not.toHaveAttribute('aria-label',/still checking/);
  await page.screenshot({path:'/tmp/codex-r149-6y7rrmjw/browser-stopped.png',fullPage:true});
  const final=await bands();
  const data={meta,early,final,errors,summary:await page.locator('.simPanel .simSummary').innerText()};
  await testInfo.attach('codex-r149-coverage',{body:JSON.stringify(data,null,2),contentType:'application/json'});
  const {writeFileSync}=await import('node:fs');writeFileSync('/tmp/codex-r149-6y7rrmjw/browser-coverage.json',JSON.stringify(data,null,2)+'\n');
  expect(errors).toEqual([]);
  expect(Math.max(...final.map(b=>b.left+b.width)),'stopping at 20% must not extend the contact band to the end of the side track').toBeLessThan(30);
});
