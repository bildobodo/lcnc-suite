import * as fs from 'node:fs';
import { decode } from '@msgpack/msgpack';
import * as THREE from 'three';
import { expect, it } from 'vitest';
import { decodePreviewStreams } from '../previewDecode';
import { buildScrubTrack, sampleTrack, type ScrubSample, type ScrubTrack } from './scrubTrack';
import { buildCollisionModel, sweepCollisions, toolCylinderPositions, type CollisionMachine } from './collision';
import { ContactStore } from './contactStore';

function load(name: string) {
  const d = decodePreviewStreams(decode(fs.readFileSync(`/tmp/r487/${name}.msgpack`)) as Record<string, any>);
  return buildScrubTrack(d.feed, d.rapid, d.kinsFrames, d.wcsEvents, d.subNames, d.tloEvents, d.rotaryCmd,
    d.startBelieved, d.startUnbound)!;
}

const machine: CollisionMachine = {
  groups: [{id:'table',parent:'root'},{id:'gx',parent:'root'},{id:'gy',parent:'gx'},{id:'head',parent:'gy'}],
  kinematics: [{group:'gx',joint:0,type:'translate',direction:'x',sign:1},
    {group:'gy',joint:1,type:'translate',direction:'y',sign:1},
    {group:'head',joint:2,type:'translate',direction:'z',sign:1}],
  workGroup:'table',toolGroup:'head',unitScale:1,axes:['X','Y','Z'],
};
function contacts(track: ScrubTrack) {
  const g = new THREE.BoxGeometry(20,20,1).translate(50,30,-0.5).toNonIndexed();
  const positions = new Float32Array(g.getAttribute('position').array as Float32Array);
  g.dispose();
  const model = buildCollisionModel(machine,[{id:'part',group:'table',positions},
    {id:'tool',group:'head',positions:toolCylinderPositions(2,1),tool:true}]);
  const store = new ContactStore(1,0);
  sweepCollisions(model,track,{g5x:[],g92:[],rotationDeg:0,tool:[0,0,0]},
    {margin:0.1,contacts:{store}});
  return {episodes:store.episodes.rows, intervals:Array.from({length:store.intervals.rows},(_,i)=>({
    enter:store.intervals.get(i,'enter'),exit:store.intervals.get(i,'exit'),
  }))};
}

it('records the same-kind counterexample independently of the runs-of-kind comparison',()=>{
  const results = ['one_reversal','two_reversals','three_reversals'].map(name=>{
    const thin=load(name), full=load(`${name}.full`);
    expect(thin.timeBased && full.timeBased).toBe(true);
    const samples=Array.from({length:full.count},(_,i)=>{
      const t=full.cum[i]!;
      const a=sampleTrack(thin,t,{} as ScrubSample), b=sampleTrack(full,t,{} as ScrubSample);
      return {time:t,fullZ:b.pz,thinZ:a.pz,fullLine:b.line,thinLine:a.line};
    });
    return {name,thinPoints:thin.count,fullPoints:full.count,
      thinEnd:thin.cum[thin.count-1],fullEnd:full.cum[full.count-1],samples,
      thinContacts:contacts(thin),fullContacts:contacts(full)};
  });
  fs.writeFileSync('/tmp/r487/client-own.json',JSON.stringify(results,null,2)+'\n');
  const r=results.find(x=>x.name==='three_reversals')!;
  expect(Math.max(...r.samples.map(x=>Math.abs(x.thinZ-x.fullZ)))).toBeGreaterThan(5);
  expect(r.thinEnd).toBe(r.fullEnd);
  expect(r.thinContacts.episodes).toBe(2);
  expect(r.fullContacts.episodes).toBe(4);
});
