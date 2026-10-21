import fs from 'node:fs';
import {it,expect} from 'vitest';
import {decode} from '@msgpack/msgpack';
import {decodePreviewStreams} from '../previewDecode';
import {buildScrubTrack} from './scrubTrack';
import {limitPlaces} from './limitPlaces';
import {buildSimRows} from './simRows';
it('Codex R179: a row combining two axes does not report one axis\'s cap as its total band count',()=>{
 const raw=decode(fs.readFileSync('/tmp/codex-r179-_0oxg34m/two-axes.msgpack')) as any;
 const d=decodePreviewStreams(raw),t=buildScrubTrack(d.feed,d.rapid,d.kinsFrames,d.wcsEvents,d.subNames,d.tloEvents)!;
 const p=limitPlaces(raw.violations,t,t,!raw.lines_untrusted);
 const rows=buildSimRows({clash:[],limit:p.targets,tool:[],unit:'mm',timeBased:true,axisEnd:t.cum[t.count-1]!});
 const actualBands=new Set(p.bands.map(([a,b])=>`${a}:${b}`)).size;
 fs.writeFileSync('/tmp/codex-r179-_0oxg34m/two-axes-track.json',JSON.stringify({records:raw.violations,actualBands,cut:p.targets[0]?.cut,rows},null,2));
 expect(raw.parse_error).toBeFalsy();expect(raw.violations).toHaveLength(2);expect(p.targets).toHaveLength(1);expect(actualBands).toBe(64);
 // An unqualified numeric claim about the row must describe its own bands.
 const m=/timeline shows the first (\d+) of (\d+) stretches/.exec(rows[0]!.note);
 if(m)expect(Number(m[1]),'64 disjoint bands are drawn for the row, not 32').toBe(actualBands);
 else expect(rows[0]!.note).toMatch(/axis|axes|X|Y|limited|omitted/i);
});
