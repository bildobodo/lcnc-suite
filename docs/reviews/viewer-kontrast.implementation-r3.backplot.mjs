// Independent CPU reproduction: hidden lines receive motion but no GPU uploads.
// Run with Node 22+: node --experimental-strip-types docs/reviews/viewer-kontrast.implementation-r3.backplot.mjs
import * as THREE from '../../lcnc-webui/node_modules/three/build/three.module.js';
import { createBackplotController } from '../../lcnc-webui/src/viewer/backplotController.ts';
import { writeFile } from 'node:fs/promises';

const group = new THREE.Group();
const c = createBackplotController(() => {});
c.build(group, '#be0692', true);
c.setVisible(false);
const line = group.children[0], geometry = line.geometry;
const buffer = geometry.attributes.instanceStart.data;
const result = { reviewedHead: 'd7e7544f53d2f99c9b1950e90dca3589793bfa95',
  method: 'Real controller, no renderer: a hidden WebGL object is not uploaded; inspect the queued updates independently of its bounded vertex storage.',
  samples: [] };
const sample = phase => ({ phase, visible: line.visible, points: c.count,
  segments: geometry.instanceCount, bufferBytes: buffer.array.byteLength,
  pendingRanges: buffer.updateRanges.length });
for (let i = 0; i < 100000; i++) {
  c.push(i, 0, 0);
  if ([9999, 19999, 49999, 99999].includes(i)) result.samples.push(sample(`after ${i+1} points`));
}
c.reset(); result.afterClear = sample('after Clear/reset');
// Control: after an acknowledged upload Three.js clears ranges. A subsequent
// update is small again. This manually models that acknowledgement, not a GPU test.
buffer.clearUpdateRanges();
c.push(0, 0, 0); c.push(1, 0, 0);
result.afterAcknowledgedUpload = sample('fresh segment after an acknowledged upload');
result.boundedWhileHidden = result.samples.every(s => s.pendingRanges <= 19999);
result.clearDiscardsPendingUpdates = result.afterClear.pendingRanges === 0;
c.dispose();
await writeFile(new URL('./viewer-kontrast.implementation-r3.backplot.json', import.meta.url), JSON.stringify(result, null, 2)+'\n');
console.log(JSON.stringify(result, null, 2));
