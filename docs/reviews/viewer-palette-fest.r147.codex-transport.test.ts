import { afterAll, expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import ts from 'typescript';
import { ContactStore, NONE } from './contactStore';
import { ContactsReceiver } from './contactsReceiver';

// Run the ACTUAL SFC router and side-result handler, parsed from this archive.
// Browser/geometry work is stubbed; neither lifecycle branch is rewritten.
const text = readFileSync(new URL('../ThreeViewer.vue', import.meta.url), 'utf8');
const script = text.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)![1]!;
const ast = ts.createSourceFile('ThreeViewer.ts', script, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
let router = '', sideHandler = '';
function walk(n: ts.Node) {
  if (ts.isFunctionDeclaration(n) && n.name?.text === '_colOnSideMessage') sideHandler = n.getText(ast);
  if (ts.isBinaryExpression(n) && n.left.getText(ast) === '_colWorker.onmessage') router = n.right.getText(ast);
  ts.forEachChild(n, walk);
}
walk(ast);
if (!router || !sideHandler) throw new Error('SFC route/side handler missing');
const program = `
const _contacts = new ContactsReceiver();
const _colReqId = 7;
let _colSide = { id:-1, entry:{name:'entry'}, base:{name:'base'}, shift:10, startedAt:performance.now(), ...(run ? {run:{gen:1}} : {}) };
const sent=[]; const _colWorker={postMessage:m=>sent.push(m)};
const _contactsLog={messages:0,acks:0,maxDeltaRows:0};
const collisionSideFirst={value:null}, collisionRun={value:{gen:1}}, collisionRunSide={value:null}, collisionRunSideState={value:null}, collisionEntry={value:null};
const _colRunLog=[]; const _colEmitMarks=()=>{}, _colRetint=()=>{}, emitTelemetry=()=>{};
${sideHandler}
const deliver=${router};
return {receiver:_contacts, deliver:m=>deliver({data:m}), state:()=>({activeSide:_colSide, entry:collisionEntry.value, beginning:collisionRunSide.value, acks:sent})};
`;
const js = ts.transpileModule(program, {compilerOptions:{target:ts.ScriptTarget.ES2022, module:ts.ModuleKind.None}}).outputText;
const factory = new Function('ContactsReceiver', 'run', js);
const results: Record<string, unknown> = {};
afterAll(()=>writeFileSync(process.env.R147_TRANSPORT_RESULTS!, JSON.stringify(results,null,2)+'\n'));
function store(id:number) {
  const s=new ContactStore(id,0);s.episodes.append({pair:0,ordinal:0,flags:0,onset:1,end:2,closeAt:1,closeDist:0,firstIv:0,ivCount:1});
  s.intervals.append({episode:0,enter:1,exit:2,flags:0,next:NONE,witness:1,freeAt:NaN});return s;
}
for (const run of [false,true]) it(`the completed ${run?'run beginning':'sim entry'} tables remain while their result remains`, ()=>{
  const x=factory(ContactsReceiver,run);
  const side=store(-1), main=store(7);
  const result={hits:[],staticContacts:[],samples:1};
  x.deliver({id:-1,contacts:[side.takeDelta()!],contactPairs:[['tool','work']],result});
  const before={sideRows:x.receiver.current(-1)?.stores[0].intervals.rows??0,activeSide:x.state().activeSide,hasResult:!!(run?x.state().beginning:x.state().entry)};
  expect(before).toEqual({sideRows:1,activeSide:null,hasResult:true});
  x.deliver({id:7,contacts:[main.takeDelta()!],contactPairs:[['tool','work']]});
  const after={sideRows:x.receiver.current(-1)?.stores[0].intervals.rows??0,hasResult:!!(run?x.state().beginning:x.state().entry),mainRows:x.receiver.current(7)?.stores[0].intervals.rows??0,acks:x.state().acks};
  results[run?'runBeginning':'simEntry']={before,after};
  expect(after.mainRows).toBe(1);expect(after.hasResult).toBe(true);expect(after.acks).toHaveLength(2);
  expect(after.sideRows).toBe(1);
});
