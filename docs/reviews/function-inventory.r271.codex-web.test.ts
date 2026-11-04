// R271 review only: copy beside webAtoms.ts in an isolated checkout.
import { expect, it } from 'vitest';
import { framesAdapter, probeRoutines, type WebSources } from './webAtoms';
const src = (files: Record<string,string>) => ({ files } as WebSources);

it('FI-I03 rest: a reassigned frame is not its initializer', () => {
  const a = framesAdapter(src({'wsWorker.ts': `
function sendOwn() {
  let own = JSON.stringify({cmd: 'hello'});
  own = JSON.stringify({cmd: 'new_frame'});
  ws.send(own);
}`}));
  expect(a.atoms.some(x => x.id === 'frame:new_frame') || a.unresolved.length > 0, JSON.stringify(a)).toBe(true);
});

it('FI-I03 rest: a reassigned queue value is no longer a relay', () => {
  const a = framesAdapter(src({'wsWorker.ts': `
ws.send(JSON.stringify({cmd: 'hello'}));
function drain() {
  let p = preOpenQueue.shift();
  p = JSON.stringify({cmd: 'new_frame'});
  ws.send(p);
}`}));
  expect(a.atoms.some(x => x.id === 'frame:new_frame') || a.unresolved.length > 0, JSON.stringify(a)).toBe(true);
});

it('FI-I03 rest: every pushed queue member must have relay provenance', () => {
  const a = framesAdapter(src({'wsWorker.ts': `
ws.send(JSON.stringify({cmd: 'hello'}));
switch(msg.type) {
  case 'send': preOpenQueue.push(msg.payload, JSON.stringify({cmd: 'new_frame'})); break;
}
function drain() { const p = preOpenQueue.shift(); ws.send(p); }
`}));
  expect(a.atoms.some(x => x.id === 'frame:new_frame') || a.unresolved.length > 0, JSON.stringify(a)).toBe(true);
});

it.each([' ', '\n'])('FI-I02 rest: calibration call with separator %j is not lost', (separator) => {
  const text = `<template><button @click="runCalProbe('probe_cal_a')"/>
<button @click="runCalProbe${separator}('probe_cal_b')"/></template>
<script setup>function runCalProbe(macro) { emit('runProbe', { macro }); }</script>`;
  const a = probeRoutines('ProbePanel.vue', text);
  expect(a.names.includes('probe_cal_b') || a.unresolved.length > 0, JSON.stringify(a)).toBe(true);
});

it('FI-I02 rest: a computed call with separator is unresolved too', () => {
  const text = `<template><button @click="runCalProbe('probe_cal_a')"/>
<button @click="runCalProbe (selected)"/></template>
<script setup>function runCalProbe(macro) { emit('runProbe', { macro }); }</script>`;
  const a = probeRoutines('ProbePanel.vue', text);
  expect(a.unresolved.length, JSON.stringify(a)).toBeGreaterThan(0);
});
