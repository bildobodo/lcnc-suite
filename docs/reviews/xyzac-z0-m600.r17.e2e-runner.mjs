/** Execute the committed toolsetter, Run-from-line and feedback tests on our own mock :4197.
 * Copies live only in /tmp; product sources and earlier evidence stay unchanged.
 * The ONLY spec adaptation is ctl.ts's port 4174 -> 4197.
 */
import { mkdtemp, readFile, writeFile, symlink, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const WEB = fileURLToPath(new URL('../../lcnc-webui/', import.meta.url));
const tmp=await mkdtemp('/tmp/codex-r17-e2e-');
try {
  await symlink(WEB+'node_modules',tmp+'/node_modules','dir');
  for (const spec of ['toolsetter-setup','run-hold','feedback-channels']) {
    await writeFile(tmp+'/'+spec+'.spec.ts',await readFile(WEB+'e2e/'+spec+'.spec.ts'));
  }
  await writeFile(tmp+'/ctl.ts',(await readFile(WEB+'e2e/ctl.ts','utf8')).replaceAll('4174','4197'));
  await writeFile(tmp+'/playwright.config.mjs',`export default { testDir: '.', testMatch: /.*.spec.ts/, workers: 1, fullyParallel: false, timeout:30000, expect:{timeout:10000}, reporter:'list', use:{headless:true,browserName:'chromium'} };\n`);
  execFileSync(process.execPath,[WEB+'node_modules/@playwright/test/cli.js','test','--config',tmp+'/playwright.config.mjs'],{cwd:tmp,stdio:'inherit'});
} finally {await rm(tmp,{recursive:true,force:true});}
