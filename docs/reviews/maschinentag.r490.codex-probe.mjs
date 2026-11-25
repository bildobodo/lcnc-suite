// Small deterministic checks only: no sweep, worker, browser, NML or timing benchmark.
// Usage: node probe.mjs /tmp/r489/tree /tmp/r490
// The second argument may also be docs/reviews with the frozen r490 filenames.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import assert from 'node:assert/strict';
const [tree, out] = process.argv.slice(2);
const require = createRequire(path.resolve(tree, 'lcnc-webui/package.json'));
const esbuild = require('esbuild');
const input = name => fs.readFileSync(path.join(out, fs.existsSync(path.join(out,name)) ? name : 'maschinentag.r490.codex-'+name), 'utf8');
const source = input('q22.ts');
const expression = source.match(/const digest = ([^\n]+);/)[1];
const digestJs = esbuild.transformSync(`module.exports = ${expression}`, {loader:'ts', format:'cjs'}).code;
function evaluate(code) {
  const box = { module: {exports:{}}, exports:{}, Uint8Array, Uint16Array, Uint32Array, Float32Array, Float64Array, console };
  box.exports = box.module.exports;
  vm.runInNewContext(code, box);
  return box.module.exports;
}
const digest = evaluate(digestJs);
const built = esbuild.buildSync({entryPoints:[path.resolve(tree,'lcnc-webui/src/viewer/contactStore.ts')],bundle:true,write:false,platform:'node',format:'cjs'});
const { ContactStore } = evaluate(built.outputFiles[0].text);
const st = new ContactStore(1, 0);
st.episodes.append({pair:1,onset:2,closeAt:3,closeDist:0,firstIv:0,ivCount:1});
st.intervals.append({episode:0,enter:2,exit:4,flags:128,witness:3});
st.gaps.append({pair:1,start:5,end:6,reason:1});
const cells = t => Array.from({length:t.rows}, (_,r)=>t.schema.map(([name])=>[name,t.get(r,name)]));
const complete = s => JSON.stringify([s.episodes,s.intervals,s.gaps].map(cells));
const before = {q22:digest(st), full:complete(st)};
st.episodes.set(0,'pair',99);
st.intervals.set(0,'enter',123);
st.gaps.set(0,'reason',2);
const after = {q22:digest(st), full:complete(st)};
assert.equal(before.q22, after.q22);
assert.notEqual(before.full, after.full);
assert.equal(st.episodes.cols, undefined);
console.log(JSON.stringify({case:'q22_digest',before,after,three_changed_fields_invisible:true},null,2));

// Same pure H prototype as the author. A lateral feed point below RDP's tolerance
// can disappear even with order and point-time constraints preserved.
const fed = evaluate(esbuild.transformSync(input('fedpath2.ts'),{loader:'ts',format:'cjs'}).code);
function track(points, rapid) {
  return {pos:new Float32Array(points.flat()),abc:new Float32Array(points.length*3),rapid:new Uint8Array(rapid),count:points.length};
}
const points = [[0,0,2],[2**-9,0,-2],[0,0,-6],[0,0,2],[0,0,-5]];
const full = track(points,[1,0,0,1,1]);
const thin = track([points[0],points[2],points[3],points[4]],[1,0,1,1]);
const fullAnswer = fed.fedOver(full,4,0), thinAnswer = fed.fedOver(thin,3,0);
assert.equal(fullAnswer,false); assert.equal(thinAnswer,true);
console.log(JSON.stringify({case:'unthinned_vs_shipped_H',points,fullAnswer,thinAnswer,lateralDeviation:2**-9,claim:'H comparison only; no collision or material-volume result'},null,2));
console.log('PASS: 6 assertions; deterministic microchecks only.');
