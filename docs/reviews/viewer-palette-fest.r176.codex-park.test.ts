import fs from 'node:fs';
import {it,expect} from 'vitest';
import {buildCollisionModel,sweepCollisions,sweepCollisionsIter,type CollisionMachine,type CollisionTrack} from './collision';
import {ContactStore, type ColumnTable} from './contactStore';
import {boxPositions} from './collisionFixtures';
const WCS0:any={g5x:[0,0,0,0,0,0],g92:[],rotationDeg:0};
  const stepped = () => {
    const spun: CollisionMachine = { groups: [{ id: "fixed", parent: "root" }, { id: "moving", parent: "root" }, { id: "spinner", parent: "root" }],
      kinematics: [{ group: "moving", joint: 0, type: "translate", direction: "x", sign: 1 },
                   { group: "spinner", joint: 3, type: "rotate", direction: "z", sign: 1 }],
      workGroup: "fixed", toolGroup: "moving", unitScale: 1, axes: ["X", "Y", "Z", "A"] };
    const model = buildCollisionModel(spun, [
      { id: "fixed", group: "fixed", positions: new Float32Array([...boxPositions(20, 20, 20, -10, 0), ...boxPositions(40, 20 - 0.1005, 20, 20, -0.1005 / 2)]) },
      { id: "moving", group: "moving", positions: boxPositions(2, 20, 20, 0, 21.9) }]);
    const xs = [-30, -10, 30], as = [0, 0, 8000];
    const n = 3, pos = new Float32Array(n * 3), abc = new Float32Array(n * 3), cum = new Float32Array(n);
    for (let k = 0; k < n; k++) { pos[k * 3] = xs[k]!; abc[k * 3] = as[k]!; if (k) cum[k] = cum[k - 1]! + Math.max(Math.abs(xs[k]! - xs[k - 1]!), as[k]! - as[k - 1]!); }
    return { model, track: { pos, abc, cum, count: n, lines: Uint32Array.from([10, 11, 12]), rapid: new Uint8Array(n) } as CollisionTrack };
  };

const rows=(t:ColumnTable)=>Array.from({length:t.rows},(_,k)=>Object.fromEntries(t.schema.map(([n])=>[n,t.get(k,n)])));
const all=(s:ContactStore)=>({episodes:rows(s.episodes),intervals:rows(s.intervals),gaps:rows(s.gaps)});
it('Codex R175: a parked reverse search survives real interleaved sweeps and snapshots',{timeout:60000},()=>{
 const {model,track}=stepped(); const baseline=new ContactStore(1,0);sweepCollisions(model,track,WCS0,{margin:2,contacts:{store:baseline}});
 const profile:any={},snapshot:any={},store=new ContactStore(1,0);let ticks=0,lastProbes=0,interleaved=0;
 const run=sweepCollisionsIter(model,track,WCS0,{margin:2,contacts:{store},profile,snapshot,clock:()=>ticks++,yieldMs:3});
 const events:any[]=[];let n=run.next();
 while(!n.done){
  const probes=Array.from(profile.probes??[]).reduce((a:number,b:any)=>a+b,0);
  if(probes>lastProbes){
   const before=all(store),meta=snapshot.meta();
   const side:CollisionTrack={count:2,pos:Float32Array.from([60,0,0,-40,0,0]),abc:new Float32Array(6),cum:Float32Array.from([0,100]),rapid:new Uint8Array(2),lines:Uint32Array.from([80,81])};
   sweepCollisions(model,side,WCS0,{margin:2,contacts:{store:new ContactStore(2,0)}});
   expect(all(store)).toEqual(before);
   events.push({progress:n.value,probes,coverage:meta.truncated?.covered});interleaved++;
  }
  lastProbes=probes;n=run.next();
 }
 expect(interleaved).toBeGreaterThan(2);expect(all(store)).toEqual(all(baseline));expect(n.value.truncated).toBeNull();
 fs.writeFileSync('/tmp/codex-r176-f1ztm26r/park.json',JSON.stringify({interleaved,events,final:all(store)},null,2));
});
