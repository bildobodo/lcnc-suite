import { describe, it, expect } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { m600Events, m600ToolNotes, m600StatsText, parseProbeNotes } from "./probeStop";
import { decode } from '@msgpack/msgpack';
const notes:any[]=[];
const save=()=>writeFileSync('../r126.codex-notes.json',JSON.stringify(notes,null,2));
describe('Codex R126 model boundary notes',()=>{
 it('an unbound braking warning survives the fallback to Program Stats',()=>{
  const ev=m600Events([],[[30,2,80,0]],'mm',parseProbeNotes([[14,2,'brake_unknown',0]]));
  const bound=m600ToolNotes(ev);
  const text=m600StatsText(ev,'mm');
  notes.push({kind:'unbound_warning',events:ev,unbound:bound.unbound,byLine:[...bound.byLine],stats:text});save();
  expect(bound.unbound).toHaveLength(1);
  expect(text).toContain('not checked below the trip point');
 });
 it('a native repeated call with different notes preserves its unbound warning',()=>{
  const raw=decode(readFileSync('../r126.loop.msgpack')) as any;
  expect(raw.parse_error ?? null).toBeNull();
  expect(raw.toollen_table).toHaveLength(2);
  const events=m600Events([],raw.toollen_table,'mm',parseProbeNotes(raw.probe_notes));
  const mapped=m600ToolNotes(events);
  const stats=m600StatsText(events,'mm');
  notes.push({kind:'native_loop_warning',wire:{notes:raw.probe_notes,lengths:raw.toollen_table},events,byLine:[...mapped.byLine],unbound:mapped.unbound,stats});save();
  expect(mapped.byLine.size).toBe(0);
  expect(mapped.unbound).toHaveLength(2);
  expect(stats).toContain('the retract may not clear');
 });
});
