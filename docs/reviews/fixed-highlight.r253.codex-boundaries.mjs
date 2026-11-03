// R253: execute the actual scanner; compare with the declared conservative
// contract, without interpreting expressions or issuing any machine command.
import ts from 'typescript';
import {readFileSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const source=readFileSync('src/viewer/toolChangeScan.ts','utf8');
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {toolChangeLinesFromText:scan}=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
const cases=[];
const forms=[['T+7',7],['T7.0',7],['T8.',8],['T1 3',13],['T 0 9',9],['t + 0 7 . 0 0',7],
 ['T+#<next>',0],['T+[#1+1]',0],['TABS[-7]',0],['TATAN[1]/[1]',0],['TTAN[45]',0],
 ['TFIX[7.9]',0],['TFUP[6.1]',0],['TSQRT[49]',0],['T-3',0],['T7.5',0],['T[7]',0],['T##1',0]];
for(const [word,n] of forms) {
 for(const separate of [false,true]) {
  const program=`T5\n${word}${separate?'\n':' '}M600\nM601\n`;
  const expected=separate?[[3,n],[4,n]]:[[2,n],[3,n]];
  const actual=scan(program); cases.push({word,separate,program,expected,actual});
  assert.deepEqual(actual,expected,program);
 }
}
for(const line of ['G0 X[TAN[45]] Y[ATAN[1]/[1]]', '#1=[SQRT[49]GT1]+EXISTS[#<x>]+[2LT3]',
 '#<t99> = 1', 'o<tool_m600_t7> call', '(T9 M600) ; T8 M601', '#<m6> = #<t13>']) {
 const program=`T5\n${line}\nM600\n`,expected=[[3,5]],actual=scan(program);
 cases.push({line,program,expected,actual});assert.deepEqual(actual,expected,program);
}
const result={source:'64e09b9c:src/viewer/toolChangeScan.ts',cases:cases.length,result:'PASS',observations:cases};
writeFileSync('/tmp/codex-r253-wcplhf8p/boundaries.json',JSON.stringify(result,null,2));
console.log(`${cases.length}/${cases.length} scanner boundary probes PASS`);
