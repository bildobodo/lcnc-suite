// R503: actual pure comparison at dbd14cab + literal plan models.
// No product implementation of startAttempt/consent exists yet.
import fs from 'node:fs';
import ts from '/home/cnc/lcnc-suite-start/lcnc-webui/node_modules/typescript/lib/typescript.js';
const root='/tmp/r502/tree/lcnc-webui/src';
const src=fs.readFileSync(root+'/viewer/checkBasis.ts','utf8');
const js=ts.transpileModule(src,{compilerOptions:{module:ts.ModuleKind.ES2022}}).outputText;
const {sameCheckInputs}=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
const a={kind:'idle',runId:null,g5x:[0,0,0],g92:[0,0,0],rotationXy:0,toolOffset:[0,0,0],wcsTable:[],toolNum:1,toolDiam:6,toolLen:20,startJoints:null,eoffsetZ:0,eoffsetEnabled:false};
const b={...a,kind:'run',runId:1,eoffsetEnabled:true};
// Exact pure text-producing block from collision.ts, with inBand=true.
const collision=fs.readFileSync(root+'/viewer/collision.ts','utf8');
const marker='    const eo = opts.externalOffsetZ;';
const lo=collision.indexOf(marker),hi=collision.indexOf('\n  }\n  if (opts.startWritesUntracked)',lo);
if(lo<0||hi<0) throw Error('source extraction failed');
const emitNote=new Function('opts','inBand','inCond',`const noteParts=[];\n${collision.slice(lo,hi)}\nreturn noteParts;`);
const noteA=emitNote({externalOffsetZ:{enabled:false,z:0}},true,false);
const noteB=emitNote({externalOffsetZ:{enabled:true,z:0}},true,false);
if(!sameCheckInputs(a,b)||noteA.length!==0||noteB.length!==1) throw Error('comparison control failed');

// Section 3.4 literally requires open/unconsumed at EACH checkpoint,
// while a consent consumes the ask. Even granting an exception for the
// confirmation to the "new start voids" rule, entry consumption blocks record.
const ask={id:1,conn:'c',program:'p',version:10,action:'start',line:0,offer:'continue',consumed:false};
const entryMatches=!ask.consumed;
ask.consumed=true;
const recordMatches=!ask.consumed;

// Section 3.2 plus the explicit ended/restricted row of section 4.4.
const needs=(verified,claim,askRestricted)=>!verified||['running','not_checked'].includes(claim.calc)||
 (claim.calc==='ended'&&claim.version!==10)||(claim.result==='restricted'&&askRestricted);
const restricted={calc:'ended',result:'restricted',version:10};
const endedClear={calc:'ended',result:'full-clear',version:10};
const contradictions={
  restrictedWithOperatorAsking:{claim:restricted,verified:true,needsConsent:needs(true,restricted,true),actionTableSendsConsent:false},
  endedClearButGatewayUnverified:{claim:endedClear,verified:false,needsConsent:needs(false,endedClear,false),actionTableRows:['unchecked (unverified): sends unchecked','ended/full-clear: no consent (no precedence defined)']}
};
console.log(JSON.stringify({base:'dbd14cab',
  actualReuseComparison:{sameCheckInputs:sameCheckInputs(a,b),idleExternalOffset:{enabled:false,z:0},runExternalOffset:{enabled:true,z:0},idleNotes:noteA,runNotes:noteB},
  planConsentLifecycle:{entryMatches,consumedAfterEntry:ask.consumed,recordMatches},
  planActionCases:contradictions,
  limitations:['Actual pure comparison and exact note-producing block executed, not a full sweep.','Lifecycle and action cases are explicitly modeled from plan v2, not product execution.','No browser, gateway, simulation, suite or gate run.']},null,2));
