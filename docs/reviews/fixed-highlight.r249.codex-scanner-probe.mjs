// R249: execute the unmodified scanner, no Vue or LinuxCNC state.
import ts from 'typescript';
import {readFileSync,writeFileSync} from 'node:fs';
const src=readFileSync('src/viewer/toolChangeScan.ts','utf8');
const js=ts.transpileModule(src,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {toolChangeLinesFromText:scan}=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
const forms=['T#<next>','T[#1+1]','T+#<next>','T+[#1+1]','TABS[-7]','T+7','T7.0','T1 3'];
const result=forms.map(form=>({form,program:`T5\n${form} M600\nG1 X10 F100\nM2\n`,actual:scan(`T5\n${form} M600\nG1 X10 F100\nM2\n`)}));
writeFileSync('/tmp/codex-r249-rq1yv81l/scanner-results.json',JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2));
