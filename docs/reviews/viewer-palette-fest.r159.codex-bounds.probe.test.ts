import {it,expect} from 'vitest';
import {writeFileSync} from 'node:fs';
import {ContactStore,ColumnTable,IV_ENTER_DECIDED,IV_EXIT_DECIDED,NONE} from './contactStore';
import {buildContactView,buildContactViewSteps,findKey,targetKey,viewWork} from './contactView';
import {STEP_OPS} from './steps';
const D=IV_ENTER_DECIDED|IV_EXIT_DECIDED;
function many(n:number,samePosition:boolean){
 const st=new ContactStore(1,0);
 for(let i=0;i<n;i++) {const a=samePosition?0:4*i;
 const ep=st.episodes.append({pair:i,ordinal:0,flags:0,onset:a,end:a+1,closeAt:a,closeDist:0,firstIv:NONE,ivCount:1});
 st.episodes.set(ep,'firstIv',st.intervals.append({episode:ep,enter:a,exit:a+1,flags:D,next:NONE,witness:a+.5,freeAt:a+2,freeR:.1}));}
 return {sources:[{stores:[st],ownCoverage:4*n,at:(x:number)=>x}],pairName:(p:number)=>({a:`t${p}`,b:`w${p}`}),coverage:4*n};
}
it('a key among simultaneous starts is found without scanning all their targets',()=>{
 const measured=[];
 for(const n of [1024,8192]){
  const v=buildContactView(many(n,true));const key=targetKey(v,v.n-1);
  for (const mode of ['at','moved','anywhere'] as const) {
  const get=ColumnTable.prototype.get;let reads=0;
  ColumnTable.prototype.get=function(...a:Parameters<typeof get>){reads++;return get.apply(this,a);};
  const w0=viewWork.n,t0=performance.now();let found=-1;
  try{found=findKey(v,key,mode === 'at' ? 0 : mode === 'moved' ? 123456 : undefined);}finally{ColumnTable.prototype.get=get;}
  measured.push({n,mode,found,reads:reads+viewWork.n-w0,ms:performance.now()-t0});
  expect(found).toBe(v.n-1);
  }
 }
 writeFileSync(`${process.env.R159_OUT}/keys.json`,JSON.stringify(measured,null,2)+'\n');
 for (const mode of ['at','moved','anywhere']) {
 const m=measured.filter(x=>x.mode===mode);
 expect(m[1]!.reads,mode+': eight times the simultaneous starts; same R159 cost-growth contract').toBeLessThanOrEqual(1.5*m[0]!.reads+256);
 }
});
it('growth copies inside the real view build also stay within a step',()=>{
 const input=many(32769,false); // crosses 32768 capacity in each growing target list
 const proto=Object.getPrototypeOf(Uint8Array).prototype;
 const set=proto.set;let copied=0,most=0,biggestSet=0,steps=0;
 proto.set=function(a:ArrayLike<number>,...rest:unknown[]){copied+=a.length;biggestSet=Math.max(biggestSet,a.length);return set.call(this,a,...rest);};
 let targets=0;
 try {const job=buildContactViewSteps(input);for(;;){copied=0;const r=job.next();most=Math.max(most,copied);steps++;if(r.done){targets=r.value.n;break;}}}
 finally{proto.set=set;}
 writeFileSync(`${process.env.R159_OUT}/copies.json`,JSON.stringify({targets,steps,most,biggestSet,budget:4*STEP_OPS},null,2)+'\n');
 expect(targets).toBe(32769);
 expect(most,'copies counted after Grow.push must still be interruptible within the step').toBeLessThanOrEqual(4*STEP_OPS);
});
