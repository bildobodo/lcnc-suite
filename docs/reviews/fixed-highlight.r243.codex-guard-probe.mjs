import {readFileSync,writeFileSync,readdirSync} from 'node:fs';
import ts from 'typescript';
import {babelParse,parse,compileScript} from 'vue/compiler-sfc';
const out='/tmp/codex-r243-jzy7bm44/guard-probe.json';
const guard=readFileSync('src/propShadow.test.ts','utf8');
// Use the submitted scanner's functions, not a rewritten detector. Only
// compile in-memory sources; do not change any product component.
const begin=guard.indexOf('function isPropAlias('),end=guard.indexOf('describe("setup bindings');
const js=ts.transpileModule(guard.slice(begin,end),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
const helpers=new Function('babelParse',js+';return {isPropAlias,collectNames,propNames};')(babelParse);
const fs={fileExists:p=>{try{readFileSync(p);return true;}catch{return false;}},readFile:p=>readFileSync(p,'utf8')};
function inspect(source,filename='Probe.vue'){
 const {descriptor}=parse(source,{filename}); const c=compileScript(descriptor,{id:filename,fs});
 const declared=helpers.propNames(c.content),hidden=[];
 for(const s of c.scriptSetupAst??[]){
  const names=[];
  if(s.type==='VariableDeclaration')for(const d of s.declarations){if(!helpers.isPropAlias(d.init))helpers.collectNames(d.id,names);}
  else if((s.type==='FunctionDeclaration'||s.type==='ClassDeclaration')&&s.id)names.push(s.id.name);
  else if(s.type==='ImportDeclaration')for(const sp of s.specifiers)names.push(sp.local.name);
  for(const n of names)if(declared.has(n))hidden.push(n);
 }
 return {declared:[...declared],hidden,subNameBinding:c.bindings.subName};
}
const current=readFileSync('src/GcodePanel.vue','utf8');
const previous=current.replace('const subViewName = computed','const subName = computed').replace('const name = subViewName.value','const name = subName.value');
const cases={
 current:inspect(current,'GcodePanel.vue'),
 reintroducedFH04:inspect(previous,'GcodePanel.vue'),
 computed:inspect(`<script setup lang="ts">import {computed} from 'vue'; const props=defineProps<{subName:string;other:string}>(); const subName=computed(()=>props.other);</script>`),
 runtimeObject:inspect(`<script setup>const props=defineProps({subName:String}); const subName='draft';</script>`),
 directDestructure:inspect(`<script setup lang="ts">const {subName}=defineProps<{subName:string}>();</script>`),
 runtimeArrayLimit:inspect(`<script setup>const props=defineProps(['subName']); const subName='draft';</script>`),
 renamedAliasLimit:inspect(`<script setup lang="ts">import {toRefs} from 'vue'; const props=defineProps<{subName:string;other:string}>(); const {other:subName}=toRefs(props);</script>`)
};
const pass=cases.current.subNameBinding==='props'&&!cases.current.hidden.length&&cases.reintroducedFH04.hidden.includes('subName')&&cases.computed.hidden.includes('subName')&&cases.runtimeObject.hidden.includes('subName')&&!cases.directDestructure.hidden.length;
const files=readdirSync('src').filter(f=>f.endsWith('.vue'));let components=0,props=0;
for(const file of files){const source=readFileSync('src/'+file,'utf8');if(!parse(source).descriptor.scriptSetup)continue;const r=inspect(source,file);if(r.declared.length){components++;props+=r.declared.length;}}
const coverage={rootComponents:files.length,componentsWithProps:components,props};
writeFileSync(out,JSON.stringify({pass,coverage,cases},null,2)+'\n');
console.log(JSON.stringify({pass,cases},null,2));if(!pass)process.exitCode=1;
