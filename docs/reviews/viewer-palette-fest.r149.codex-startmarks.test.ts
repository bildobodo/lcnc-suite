// A stored native payload -> decode -> track -> actual collision sweep ->
// the same lineRuns/lineMark chain ThreeViewer's code-panel callback uses.
import { expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { decode } from '@msgpack/msgpack';
import * as THREE from 'three';
import { decodePreviewStreams } from '../previewDecode';
import { buildScrubTrack } from './scrubTrack';
import { buildCollisionModel, sweepCollisions, type CollisionMachine } from './collision';
import { ContactStore } from './contactStore';
import { buildContactView, lineMark, lineRuns, runsOf, targetAt, trackLineAt } from './contactView';
it('the base check cannot mark an unbound beginning just because its collapsed cum equals the checked endpoint',()=>{
 const raw=decode(readFileSync(new URL('../../../scripts/test_fixtures/start_dep_payloads/e_g53_rdp.msgpack',import.meta.url))) as any;
 const d=decodePreviewStreams(raw);
 const t=buildScrubTrack(d.feed,d.rapid,d.kinsFrames,d.wcsEvents,d.subNames,d.tloEvents,undefined,d.startBelieved,d.startUnbound)!;
 const m:CollisionMachine={groups:[{id:'table',parent:'root'},{id:'head',parent:'root'}],kinematics:[
   {group:'head',joint:0,type:'translate',direction:'x',sign:1},
   {group:'head',joint:1,type:'translate',direction:'y',sign:1},
   {group:'head',joint:2,type:'translate',direction:'z',sign:1}],workGroup:'table',toolGroup:'head',unitScale:1,axes:['X','Y','Z']};
 const cube=()=>{const g=new THREE.BoxGeometry(2,2,2).toNonIndexed();const a=new Float32Array(g.getAttribute('position').array);g.dispose();return a;};
 const model=buildCollisionModel(m,[{id:'obstacle',group:'table',positions:cube(),translate:[0,0,0]},{id:'head',group:'head',positions:cube(),tool:true}]);
 const st=new ContactStore(1,0);
 const r=sweepCollisions(model,{...t,wcs:t.wcsEpoch},{g5x:[],g92:[],rotationDeg:0,tool:raw.tlo_start},{margin:.1,contacts:{store:st}});
 const v=buildContactView({sources:[{stores:[st],at:c=>c}],coverage:t.cum[t.count-1]!,pairName:p=>{const [a,b]=model.pairs[p]!;return{a:model.bodies[a]!.id,b:model.bodies[b]!.id};}});
 const runs=lineRuns(t),at=trackLineAt(t);
 const marks=Array.from(new Set(t.lines)).map(line=>({line,spans:runsOf(runs,line),mark:lineMark(v,line,runsOf(runs,line),at)}));
 const out={payload:'e_g53_rdp.msgpack',depEnd:t.depEnd,cum:Array.from(t.cum),lines:Array.from(t.lines),brk:Array.from(t.brk??[]),hits:r.hits,startDependent:r.startDependent,targets:Array.from({length:v.n},(_,i)=>targetAt(v,i,at)),marks};
 writeFileSync('/tmp/codex-r149-6y7rrmjw/startmarks.json',JSON.stringify(out,null,2)+'\n');
 expect(st.intervals.rows,'the actual sweep confirms contact at the known endpoint').toBeGreaterThan(0);
 expect(out.targets.map(x=>x.line)).toEqual([5]);
 expect(marks.find(x=>x.line===5)?.mark).toEqual({line:5});
 expect(marks.find(x=>x.line===2)?.mark).toBeNull();
 expect(marks.find(x=>x.line===3)?.mark,'L3 is the unbound move ending before K; its motion was never swept').toBeNull();
});
