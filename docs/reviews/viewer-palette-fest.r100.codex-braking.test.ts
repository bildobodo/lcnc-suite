import {it,expect} from 'vitest';
import {readFileSync,writeFileSync} from 'node:fs';
import {decode} from '@msgpack/msgpack';
import {decodePreviewStreams} from '../previewDecode';
import {buildScrubTrack,lineFirstMoveCum} from './scrubTrack';
import {buildSimRows,limitStopOf} from './simRows';
it('a limit-crossing sample is not a certificate of standstill before later points',()=>{
 const raw=decode(readFileSync('../evidence/viewer-palette-fest.r100.codex-r97_arc_braking.msgpack')) as Record<string,any>;
 const d=decodePreviewStreams(raw),t=buildScrubTrack(d.feed,d.rapid,d.kinsFrames,d.wcsEvents,d.subNames,d.tloEvents)!;
 const stop=limitStopOf(t)!; const span=lineFirstMoveCum(t,3)!;
 const at=stop.cum+.01;
 let j=1;while(j<t.count-1 && t.cum[j]!<at) j++;
 const u=(at-t.cum[j-1]!)/(t.cum[j]!-t.cum[j-1]!);
 const p=[0,1,2].map(k=>t.pos[(j-1)*3+k]!+u*(t.pos[j*3+k]!-t.pos[(j-1)*3+k]!));
 // An admissible motion state for this radius-10/F300 arc: vZ=5 mm/s
 // at its Z50 crossing (X velocity=0; centripetal acceleration=2.5).
 // With |aZ|<=10, even immediate maximum braking needs >=1.25 mm in Z.
 // This is an analytic lower bound, NOT a run of the motion controller.
 const speedAtCrossing=5,maxAxisDeceleration=10;
 const minimumStopZ=50+speedAtCrossing**2/(2*maxAxisDeceleration);
 expect(p[2]).toBeGreaterThan(50);expect(p[2]).toBeLessThan(minimumStopZ);
 const rows=buildSimRows({clash:[{key:'C3|head|fixed',line:3,cum:at,cumEnd:at+.001,a:'head',b:'fixed',rapid:false}],
 limit:[{key:'L3',line:3,cum:span[0],cumEnd:span[1]}],tool:[],violations:raw.violations,unit:'mm',timeBased:true,axisEnd:t.cum.at(-1)!,stop});
 writeFileSync('../evidence/viewer-palette-fest.r100.codex-braking.json',JSON.stringify({proof:'native geometry plus analytic stopping-distance lower bound; no controller run',speedAtCrossing,maxAxisDeceleration,minimumStopZ,stop,at,positionAtClash:p,rows},null,2)+'\n');
 expect(rows.find(r=>r.kind==='clash')!.note).not.toContain('after the limit stop');
});
