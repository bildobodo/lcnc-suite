import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
await build({entryPoints:['r151.codex-cache-probe.ts'],outfile:'/tmp/codex-r151-p05bfdb8/cache-probe.cjs',bundle:true,platform:'node',format:'cjs',plugins:[{name:'read-only-cache-inspection',setup(b){
 b.onLoad({filter:/\/contactView\.ts$/},async args=>({loader:'ts',contents:await readFile(args.path,'utf8')+`\nexport function codexInspectLastGroup(v: ContactView) { const g=lastGroup.get(v); return g?{sides:g.memo.map(a=>({length:a.length,objects:a.reduce((n,f)=>n+(f?1:0),0),nulls:a.reduce((n,f)=>n+(f===null?1:0),0)}))}:null; }\n`}));
}}]});
