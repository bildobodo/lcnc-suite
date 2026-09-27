// R15, offline: compile and call the real defaults / variable-map functions.
// No HTTP, WebSocket, LinuxCNC or settings writes. Document lifecycle and Vue's
// unused template-element initialization are stubbed; no UI is mounted.
import {createRequire} from 'node:module';
import {mkdtemp,writeFile,rm,readFile} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
const require=createRequire(new URL('../../lcnc-webui/package.json',import.meta.url));
const {build}=require('esbuild');
const root=fileURLToPath(new URL('../../',import.meta.url));
const tmp=await mkdtemp('/tmp/codex-r15-defaults-');
globalThis.document={addEventListener(){},createElement(){return {content:{}};},visibilityState:'visible'};
globalThis.fetch=()=>{throw Error('Network is forbidden in this probe');};
try {
  await build({stdin:{contents:`export {initServerDefaults} from './src/defaults.ts'; export {buildToolsetterVarMap} from './src/toolsetterVars.ts';`,
    resolveDir:root+'lcnc-webui',sourcefile:'r15-probe.ts',loader:'ts'},bundle:true,platform:'node',format:'esm',outfile:tmp+'/bundle.mjs',logLevel:'silent'});
  const {initServerDefaults,buildToolsetterVarMap}=await import(pathToFileURL(tmp+'/bundle.mjs'));
  const migration=JSON.parse(await readFile(new URL('./xyzac-z0-m600.r15.migration-probe.json',import.meta.url),'utf8'));
  const saved=migration.cases.find(c=>c.case==='saved_toolsetter').first;
  const cases=[];
  for(const [name,data,confirmed] of [
    ['no server confirmation',{},false],
    ['confirmed server settings but missing toolsetter',{},true],
    ['one saved field only',{toolsetter:{touchX:150}},true],
    ['persisted section after datum migration',{toolsetter:saved.persisted_toolsetter},true],
  ]) {
    initServerDefaults(data,confirmed);
    cases.push({name,serverConfirmed:confirmed,input:data,varMap:buildToolsetterVarMap()});
  }
  const result={head:migration.head,cases,migratedFileSetterZ:saved.setter_xyz[2],
    emittedSetterZ:cases.at(-1).varMap['3102'],
    settingsAndVarAgree:saved.setter_xyz[2]===cases.at(-1).varMap['3102']};
  await writeFile(new URL('./xyzac-z0-m600.r15.frontend-probe.json',import.meta.url),JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result,null,2));
} finally {await rm(tmp,{recursive:true,force:true});}
