import { expect, it, vi } from 'vitest';
import { writeFileSync } from 'node:fs';
import { macrotaskSchedule, runSteps } from './steps';

function harness(){
 let time=1000, messages=0, maxMessages=0, maxFrames=0;
 let handler:(()=>void)|null=null;
 let frames:Array<()=>void>=[];
 const g=globalThis as unknown as Record<string,unknown>;
 const saved={mc:g.MessageChannel,raf:g.requestAnimationFrame};
 class Ch {port1={set onmessage(f:()=>void){handler=f;}};port2={postMessage(){maxMessages=Math.max(maxMessages,++messages);}};}
 g.MessageChannel=Ch;
 g.requestAnimationFrame=(f:()=>void)=>{frames.push(f);maxFrames=Math.max(maxFrames,frames.length);return frames.length;};
 const now=vi.spyOn(performance,'now').mockImplementation(()=>time);
 return {schedule:macrotaskSchedule(),message:()=>{if(messages){messages--;handler!();}},frame:(dt=16)=>{time+=dt;const fs=frames;frames=[];for(const f of fs)f();},
  tick:(dt:number)=>{time+=dt;},stats:()=>({messages,frames:frames.length,maxMessages,maxFrames}),restore:()=>{g.MessageChannel=saved.mc;g.requestAnimationFrame=saved.raf;now.mockRestore();}};
}
it('delayed messages and frame takeovers run every recursively queued job exactly once and in order',()=>{
 const records=[];
 for(let seed=1;seed<=200;seed++){
  const h=harness();let rng=seed, issued=0;
  const want:number[]=[],got:number[]=[];
  const add=()=>{const id=issued++;want.push(id);h.schedule(()=>{got.push(id);if(issued<80)add();});};
  try{
   for(let i=0;i<7;i++)add();
   for(let step=0;step<800&&got.length<80;step++){
    rng=(Math.imul(rng,1664525)+1013904223)>>>0;
    if(rng%5===0)h.message();else h.frame(8+(rng%33));
    expect(got,`seed ${seed} step ${step}`).toEqual(want.slice(0,got.length));
    expect(h.stats().maxMessages).toBeLessThanOrEqual(1);expect(h.stats().maxFrames).toBeLessThanOrEqual(1);
   }
   expect(got).toEqual(want);expect(got.length).toBe(80);
   // Flush a stale notification after frames have drained all callbacks,
   // then reuse the same channel without any frames (hidden-tab path).
   h.message();h.frame();let hidden=0;h.schedule(()=>{hidden++;});h.message();h.message();
   expect(hidden).toBe(1);expect(got.length).toBe(80);
   records.push({seed,jobs:got.length,...h.stats()});
  }finally{h.restore();}
 }
 writeFileSync(`${process.env.R164_OUT}/schedule-interleavings.json`,JSON.stringify(records,null,2)+'\n');
});
it('cancelling after a frame took over cannot resume that generator when the held message reaches a new run',async()=>{
 const h=harness();let oldSteps=0,newSteps=0,oldDone=0,newDone=0;
 try{
  const old=runSteps((function*(){while(oldSteps<10){oldSteps++;yield;}return 'old';})(),{schedule:h.schedule,sliceMs:0,onDone:()=>{oldDone++;}});
  h.frame(32);expect(oldSteps).toBe(1);old.cancel();
  const next=runSteps((function*(){while(newSteps<5){newSteps++;yield;}return 'new';})(),{schedule:h.schedule,sliceMs:0,onDone:()=>{newDone++;}});
  for(let k=0;k<20;k++)h.message();
  expect(await next.promise).toBe('new');expect(oldSteps).toBe(1);expect(oldDone).toBe(0);expect(newSteps).toBe(5);expect(newDone).toBe(1);
  h.frame(100);h.message();expect(newDone).toBe(1);expect(oldSteps).toBe(1);
 }finally{h.restore();}
});
it('a callback exception ends its run once and does not strand another run on the same scheduler',async()=>{
 const h=harness();let errors=0,done=0;
 try{
  const bad=runSteps((function*(){yield;throw new Error('probe');})(),{schedule:h.schedule,sliceMs:0,onError:()=>{errors++;}});
  const observed=bad.promise.catch(e=>e.message);
  const good=runSteps((function*(){yield;yield;return 9;})(),{schedule:h.schedule,sliceMs:0,onDone:()=>{done++;}});
  h.frame(40);for(let k=0;k<12;k++){h.message();h.frame(40);}
  expect(await observed).toBe('probe');expect(await good.promise).toBe(9);expect(errors).toBe(1);expect(done).toBe(1);
 }finally{h.restore();}
});
