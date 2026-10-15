// R155: run from the archive's lcnc-webui directory; no live server.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const { ColumnTable, ContactStore, EPISODE, INTERVAL, GAP, BLOCK, REQUEST_BUDGET } = await import(pathToFileURL(resolve('src/viewer/contactStore.ts')));
const byRows = (t,d) => {
  if(d.from !== t.rows) throw Error('order');
  for(let i=0;i<d.count;i++) {
    const v={}; for(const [name] of t.schema)v[name]=d.rows[name][i];
    if(t.append(v)<0)throw Error('budget');
  }
  for(let i=0;i<d.updates.length;i++)for(const [name]of t.schema)t.set(d.updates[i],name,d.updated[name][i]);
};
const cells = t => t.schema.map(([name])=>Array.from({length:t.rows},(_,i)=>t.get(i,name)));
const report={commit:'bb2214c0',differential:[],budget:[],timingsMs:{},scope:'Node measurements only; no browser response-time acceptance'};
const specials=[NaN,Infinity,-Infinity,-0,0,1e-12,-1e-12,1e30,-1e30,3.125];
for(const [label,schema] of [['episodes',EPISODE],['intervals',INTERVAL],['gaps',GAP]]) {
 const s=new ColumnTable(schema,3*BLOCK+13),a=new ColumnTable(schema,s.budget),b=new ColumnTable(schema,s.budget);
 let step=0,total=0;
 for(const n of [1,BLOCK-2,3,BLOCK+5,0,BLOCK,0]) {
  for(let i=0;i<n && s.rows<s.budget;i++) {
   const v={};for(const [name,type]of schema)v[name]=type.startsWith('f')?specials[(s.rows+name.length)%specials.length]:s.rows*17+name.length;
   s.append(v);
  }
  for(let r=0;r<s.sent;r+=Math.max(1,Math.floor(s.sent/17)))for(const[name,type]of schema)s.set(r,name,type.startsWith('f')?specials[(r+step)%specials.length]:r+step);
  const d=s.take();a.apply(d);byRows(b,d);total+=d.count;
  assert.deepEqual(cells(a),cells(b));assert.deepEqual([a.rows,a.revision,a.pending()],[b.rows,b.revision,b.pending()]);
  if(step%2===0)assert.deepEqual(a.take(),b.take());step++;
 }
 assert.deepEqual(a.take(),b.take());
 report.differential.push({schema:label,steps:step,rows:total,result:'PASS'});
 const t=new ColumnTable(schema,2),send=new ColumnTable(schema,3);send.append({});t.apply(send.take());t.take();send.append({});send.append({});
 const before={cells:cells(t),rows:t.rows,revision:t.revision,pending:t.pending()};assert.throws(()=>t.apply(send.take()),/over its budget/);
 assert.deepEqual({cells:cells(t),rows:t.rows,revision:t.revision,pending:t.pending()},before);
 report.budget.push({schema:label,result:'PASS: populated table unchanged'});
}
// Full valid deltas: append-only vs updates of every already forwarded row.
const make=()=>new ContactStore(155,0),src=make();
for(const name of ['episodes','intervals','gaps'])for(let i=0;i<REQUEST_BUDGET[name];i++)src[name].append({pair:i%256,onset:i,enter:i,start:i,end:i+1,exit:i+1,firstIv:0xffffffff,next:0xffffffff});
const initial=src.takeDelta(true);src.ack();
const receiv=make(), timing=(f)=>{const t=performance.now();f();return performance.now()-t;};
report.timingsMs.append=timing(()=>receiv.apply(initial));
receiv.takeDelta(true);receiv.ack();
const runs=[];
for(let trial=0;trial<4;trial++) {
 for(const name of ['episodes','intervals','gaps'])for(let i=0;i<src[name].rows;i++)src[name].set(i,name==='intervals'?'exit':'end',i+trial+2);
 const update=src.takeDelta(true);src.ack();
 runs.push(timing(()=>receiv.apply(update)));
 receiv.takeDelta(true);receiv.ack();
}
report.timingsMs.allRowUpdates=runs;
report.timingsMs.tableUpdates=[];
for(let trial=0;trial<3;trial++) {
 for(const name of ['episodes','intervals','gaps'])for(let i=0;i<src[name].rows;i++)src[name].set(i,name==='intervals'?'exit':'end',i+trial+7);
 const d=src.takeDelta(true);src.ack();const perTable={};
 for(const name of ['episodes','intervals','gaps'])perTable[name]=timing(()=>receiv[name].apply(d[name]));
 report.timingsMs.tableUpdates.push(perTable);receiv.takeDelta(true);receiv.ack();
}

report.rows=REQUEST_BUDGET;
writeFileSync(process.env.R155_REPORT ?? '/tmp/codex-r155-r1lqnetr/apply-probe.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
