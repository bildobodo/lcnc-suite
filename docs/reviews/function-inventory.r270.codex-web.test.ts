// Review-only counterexamples. Copy beside webAtoms.ts in an isolated tree.
import { expect, it } from 'vitest';
import { controlsAdapter, framesAdapter, probeRoutines, type WebSources } from './webAtoms';
const src = (files: Record<string,string>) => ({ files } as WebSources);

it('R270: one computed routine beside a literal cannot disappear', () => {
  const text = `<script setup>
const ops = [{ macro: 'probe_a' }, { macro: chooseRoutine() }];
function runGridProbe(op) { emit('runProbe', { macro: op.macro }); }
</script>`;
  const a = probeRoutines('ProbePanel.vue', text);
  expect(a.unresolved, JSON.stringify(a)).not.toEqual([]);
});
it('R270: one computed calibration call beside a literal cannot disappear', () => {
  const text = `<template><button @click="runCalProbe('probe_cal_a')"/><button @click="runCalProbe(selected)"/></template>
<script setup>function runCalProbe(macro) { emit('runProbe', { macro }); }</script>`;
  const a = probeRoutines('ProbePanel.vue', text);
  expect(a.unresolved, JSON.stringify(a)).not.toEqual([]);
});
it('R270: a local frame variable is not automatically a relayed WsCommand', () => {
  const a = framesAdapter(src({'wsWorker.ts': `ws.send(JSON.stringify({cmd: 'hello'}));
const own = JSON.stringify({cmd: 'new_frame', value: 1}); ws.send(own);`}));
  expect(a.atoms.some(a=>a.id==='frame:new_frame') || a.unresolved.length>0, JSON.stringify(a)).toBe(true);
});
it('R270: a catalog input in kebab-case is read or explicitly unresolved', () => {
  const a = controlsAdapter(src({'P.vue': `<template><MachineInput gate="mdiText" v-model="a"/>
<machine-input gate="mdiText" v-model="b"/></template>`}));
  expect(a.atoms.length===2 || a.unresolved.length>0, JSON.stringify(a)).toBe(true);
});
