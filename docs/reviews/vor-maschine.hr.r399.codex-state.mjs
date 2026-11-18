import fs from 'node:fs';
import ts from 'typescript';
import vm from 'node:vm';
const code=ts.transpileModule(fs.readFileSync('src/holdGesture.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const exp={};vm.runInNewContext(code,{exports:exp});
const {HoldGesture}=exp;
class Scheduler {
 t=0;seq=0;timers=new Map();trace=[];leak=false;
 now(){return this.t;}
 setTimeout(fn,ms){const id=++this.seq;this.timers.set(id,{at:this.t+ms,fn,ms});return id;}
 clearTimeout(id){if(!this.leak)this.timers.delete(id);}
 oneAt(id,t){const x=this.timers.get(id);this.timers.delete(id);this.t=t;this.trace.push({timer:id,kind:x.ms===500?'due':'watch',at:t});x.fn();}
 until(t){for(;;){const next=[...this.timers].filter(([,x])=>x.at<=t).sort((a,b)=>a[1].at-b[1].at||a[0]-b[0])[0];if(!next)break;this.oneAt(next[0],Math.max(this.t,next[1].at));}this.t=Math.max(this.t,t);}
}
function press(s){const result={fires:[],ends:[]};const g=new HoldGesture(s,500,{fire:()=>result.fires.push(s.t),ended:(why,ms)=>result.ends.push({why,ms})});return {g,result};}
const out={};
// Positive control: input and timer sources both dispatched normally.
{const s=new Scheduler();const {g,result}=press(s);s.until(120);g.end('released');s.until(600);out.release_delivered_120=result;}
// Deliberately selected, spec-permitted schedule, NOT a measured browser:
// a pointerup is queued at 120, but only timer-source tasks are chosen until
// 520. Individual busy pieces may lie between the 100-ms timer observations.
{const s=new Scheduler();const {g,result}=press(s);s.until(100);for(const at of [200,300,400,500]){const id=[...s.timers].filter(([id])=>id!==1)[0]?.[0];if(id)s.oneAt(id,at);if(at===500)s.oneAt(1,at);}s.t=520;g.end('released');out.release_queued_120_delivered_520={...result,physical_release:120,delivered_release:520,timers:s.trace};}
// Old callback delivered while a new 114-ms gesture exists.
{const s=new Scheduler();s.leak=true;const a=press(s);s.until(100);a.g.end('released');s.until(450);const b=press(s);s.until(564);b.g.end('released');s.until(1200);out.new_press_114={first:a.result,second:b.result};}
for(const gap of [150,151]){const s=new Scheduler();const {result}=press(s);s.until(100);s.t=100+gap;s.until(s.t);s.until(800);out[`observation_gap_${gap}`]=result;}
console.log(JSON.stringify(out,null,2));
