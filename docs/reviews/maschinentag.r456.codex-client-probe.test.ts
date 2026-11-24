// Codex R456: the offline worker payload through the actual decode/entry path.
import { readFileSync, writeFileSync } from "node:fs";
import { decode } from "@msgpack/msgpack";
import { expect, it } from "vitest";
import { decodePreviewStreams } from "../previewDecode";
import { buildEntryTrack, buildScrubTrack } from "./scrubTrack";
import { epochTermsFor } from "./wcsEpochs";
import { programToMachine } from "./partFrame";
const rows: unknown[] = [];
function observe(name: string, expected: number[], believed?: number[]) {
 const raw = decode(readFileSync(`/tmp/r456/${name}.msgpack`)) as any;
 if (believed) raw.start_believed = believed;
 const d = decodePreviewStreams(raw);
 const base = buildScrubTrack(d.feed, d.rapid, d.kinsFrames, d.wcsEvents, d.subNames, d.tloEvents,
                              undefined, d.startBelieved, d.startUnbound)!;
 const wcs = { g5x:[100,200,-30], g92:[0,0,0], rotationDeg:0, tool:[0,0,0] };
 const terms = epochTermsFor(d.wcsEvents!, wcs, undefined);
 const entry = buildEntryTrack(base, [100,200,-30], ["X","Y","Z"], wcs, undefined, terms, 0,
   {linear:raw.rapid_rate,rotary:raw.rot_rapid_rate,axisVmax:raw.axis_vmax,trajVmax:raw.traj_vmax})!;
 const first:number[]=[];
 programToMachine(...Array.from(entry.pos.slice(3,6)) as [number,number,number],0,0,0,
                  terms[entry.wcsEpoch![1]!]!,first);
 const result = {name, startBelieved:raw.start_believed, patched:!!believed, first:first.slice(0,3)};
 rows.push(result); writeFileSync('/tmp/r456/client-observations.json',JSON.stringify(rows,null,2));
 console.log(JSON.stringify(result));
 expect(first.slice(0,3)).toEqual(expected);
}
it('plain old: reproduces F9',()=>observe('plain-old',[200,400,0]));
it('plain proposal: correct first motion',()=>observe('plain-fix',[100,200,0]));
it('G55 first: proposal still shifts untouched Y/Z',()=>observe('g55_first-fix',[310,400,-60]));
it('G55 first: corrected physical start gives the commanded X-only move',()=>observe('g55_first-fix',[310,200,-30],[-200,-200,30]));
it('rotary G55 first: baseline is correct',()=>observe('g55_rotary-old',[310,200,-30]));
it('rotary G55 first: proposal regresses the baseline',()=>observe('g55_rotary-fix',[310,400,-60]));
