const fs = require('node:fs');
const crypto = require('node:crypto');
const vm = require('node:vm');
const assert = require('node:assert/strict');
// Source copy: git archive 6c78780c <the five paths in sourceHashes>.
const repo = process.argv[2] || '/tmp/r464/src';
const ts = require(process.argv[3] || '/home/cnc/lcnc-suite-dev/lcnc-webui/node_modules/typescript');
const skimPath = process.argv[4] || '/home/cnc/lcnc-suite-p6d14/docs/reviews/p6d.skim-6c78780c.json';
const rev = '6c78780c3c2eba279356fb47662695f270b6bd61';
const hash = s => crypto.createHash('sha256').update(s).digest('hex');
const sourceHashes = {};
function source(file) {
  const text = fs.readFileSync(`${repo}/${file}`, 'utf8');
  sourceHashes[file] = hash(text);
  return text;
}
function moduleAt(file) {
  const text = source(file);
  const js = ts.transpileModule(text, {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText;
  const sandbox = {exports:{}};
  vm.runInNewContext(js, sandbox, {filename:file});
  return sandbox.exports;
}
const {parseRunBasis} = moduleAt('lcnc-webui/src/runBasis.ts');
const {admitRunCheck} = moduleAt('lcnc-webui/src/viewer/checkBasis.ts');
const raw = {run_id:7, state:'sent', verified:true, file:'/synthetic.ngc', source:'synthetic-source', version:5,
  program_id:'load-1', ctx_digest:'synthetic-ctx', tool_basis_rev:2};
const origin = {version:6, file:raw.file, programId:raw.program_id, source:raw.source, pinned:true,
  forRun:{runId:7, ctxDigest:raw.ctx_digest, toolBasisRev:2}, toolBasisRev:3, toolBasisRevNow:3};
const cases = [['zero',0],['RFL',13],['missing',undefined],['null',null],['negative',-1],['fractional',1.5],['string-zero','0'],['boolean',false]];
const admission = cases.map(([name, val]) => {
  const wire = {...raw};
  if (val !== undefined) wire.start_line=val;
  const parsed = parseRunBasis(wire);
  const result = admitRunCheck({origin,shownVersion:6,shownFile:raw.file,shownProgramId:raw.program_id,run:parsed,running:true});
  assert.equal(result.ok,true, 'base behavior changed');
  assert.equal(Object.hasOwn(parsed,'startLine'),false);
  return {name, wire_start_line:val === undefined ? '(absent)' : val, base_admission: result};
});
for(const file of ['lcnc-webui/src/ThreeViewer.vue','lcnc-webui/src/ScrubBar.vue','lcnc-gateway/gateway.py']) source(file);
const bytes=fs.readFileSync(skimPath), skim=JSON.parse(bytes);
assert.equal(skim.commit,rev); assert.equal(skim.error,null);
assert.equal(skim.restore,'complete'); assert.equal(skim.restore_post,'complete');
assert.equal(skim.owed,'settled'); assert.equal(skim.crashes.length,0);
function stats(rows) {
 return {count:rows.length, t:rows.length ? [rows[0][0],rows.at(-1)[0]] : null,
  xyz: [0,1,2].map(i => rows.length ? [Math.min(...rows.map(r=>r[1][i])),Math.max(...rows.map(r=>r[1][i]))] : null)};
}
const native = Object.fromEntries(Object.entries(skim.cases).map(([name,c])=>{
  const samples=c.samples_t_joints_motionline_calllevel_taskmode;
  const target=samples.filter(s=>s[2]===c.N && s[4]===2);
  const sub=samples.filter(s=>s[3]===1 && s[4]===2);
  assert.ok(target.length>0);
  assert.equal(c.program.trim().split('\n')[c.N-1], 'G1 X200 F3000');
  assert.deepEqual(c.start_record_joints,[100,100,0]);
  assert.deepEqual(c.program_point_before_N,[100,100,-30]);
  assert.equal(c.run_basis[0][1].state,'sent'); assert.equal(c.run_basis[0][1].verified,true);
  if(name==='A') {
    assert.equal(sub.length,0);
    assert.ok(target.every(s=>s[1][1]===100 && s[1][2]===0));
  } else {
    assert.ok(sub.length>2);
    assert.ok(sub.every(s=>s[0]>=c.run_basis[0][0]));
    assert.ok(sub.at(-1)[1][0]>140 && sub.at(-1)[1][1]<60 && sub.at(-1)[1][2]<-15);
    assert.ok(target.every(s=>s[1][1]===50 && s[1][2]===-20));
  }
  return [name, {N:c.N, program_sha256:hash(c.program), start_record:c.start_record_joints,
    program_point_before_N:c.program_point_before_N, provided_all_frame_aggregate:c.line_N_move,
    independently_read_saved_subset: {target:stats(target),subroutine:stats(sub)},
    first_auto:samples.find(s=>s[4]===2)}];
}));
console.log(JSON.stringify({review:'R464',kind:'offline source and saved-evidence re-evaluation; no controller access',
 rev,sourceHashes,base_admission:admission,skim:{path:skimPath,sha256:hash(bytes),
 restore:skim.restore,restore_post:skim.restore_post,owed:skim.owed,cases:native},
 limits:['No new native run; sampled status cannot prove absence of all unobserved motion.',
 'Stored full-frame aggregates retained separately from independently evaluated 52-row subsets.',
 'No browser execution; old result lifecycle assessed by code reading.'],status:'PASS'},null,2));
