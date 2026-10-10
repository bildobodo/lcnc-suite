import { describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { decode } from '@msgpack/msgpack';
import { decodePreviewStreams } from '../previewDecode';
import { buildScrubTrack, sampleTrack, sliceTrack } from './scrubTrack';
import { measurementsOf, buildSimRows } from './simRows';
import { parseProbeBands } from './probeStop';
const raw=decode(readFileSync('../r126.m600-band.msgpack')) as any;
describe('Codex R126 native wire to client',()=>{
 it('band survives wire, track and slice; followed row names its measurement',()=>{
  const d=decodePreviewStreams(raw);
  const track=buildScrubTrack(d.feed,d.rapid,d.kinsFrames,d.wcsEvents,d.subNames,d.tloEvents)!;
  const bands=parseProbeBands(raw.probe_bands);
  const ms=measurementsOf(track,bands.map(b=>b.line));
  const p:any[]=[];
  for(let i=0;i<track.count;i++)p.push({i,line:track.lines[i],cum:track.cum[i],p:Array.from(track.pos.slice(i*3,i*3+3)),band:track.band?.[i],cond:track.cond?.[i],brk:track.brk?.[i]});
  const band=p.filter(p=>p.band);
  expect(band.length).toBeGreaterThan(4);
  expect(Math.min(...band.map(p=>p.p[2]))).toBeCloseTo(-102.8444,3);
  expect(p.at(-1).band).toBe(0);expect(p.at(-1).cond).toBe(1);
  const row=buildSimRows({clash:[],limit:[{key:'L4',line:4,cum:track.cum.at(-1)!,cumEnd:track.cum.at(-1)!}],tool:[],violations:[],unit:'mm',timeBased:true,axisEnd:track.cum.at(-1)!,measurements:ms})[0]!;
  expect(row.note).toContain('conditional — after the measurement at L3');
  const sliced=sliceTrack(track,0,track.count);
  expect(Array.from(sliced.band!)).toEqual(Array.from(track.band!));
  const sample:any={};
  for(let s=0;s<=track.cum.at(-1)!;s+=0.02){sampleTrack(track,s,sample);expect(sample.index).toBeLessThan(track.count);}
  writeFileSync('../r126.codex-chain.json',JSON.stringify({bands,ms,points:p,row},null,2));
 });
});
