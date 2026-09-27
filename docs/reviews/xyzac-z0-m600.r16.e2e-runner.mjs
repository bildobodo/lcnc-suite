/** Execute the six committed toolsetter-setup tests on our own mock :4196.
 * Copies live only in /tmp; product sources and earlier evidence stay unchanged.
 * The ONLY spec adaptation is ctl.ts's port 4174 -> 4196.
 */
import { mkdtemp, readFile, writeFile, symlink, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const WEB = fileURLToPath(new URL('../../lcnc-webui/', import.meta.url));
const tmp=await mkdtemp('/tmp/codex-r16-e2e-');
try {
  await symlink(WEB+'node_modules',tmp+'/node_modules','dir');
  await writeFile(tmp+'/toolsetter-setup.spec.ts',await readFile(WEB+'e2e/toolsetter-setup.spec.ts'));
  await writeFile(tmp+'/ctl.ts',(await readFile(WEB+'e2e/ctl.ts','utf8')).replaceAll('4174','4196'));
  await writeFile(tmp+'/playwright.config.mjs',`export default { testDir: '.', testMatch: /toolsetter-setup.spec.ts/, workers: 1, fullyParallel: false, timeout:30000, expect:{timeout:10000}, reporter:'list', use:{headless:true,browserName:'chromium'} };\n`);
  execFileSync(process.execPath,[WEB+'node_modules/@playwright/test/cli.js','test','--config',tmp+'/playwright.config.mjs'],{cwd:tmp,stdio:'inherit'});
} finally {await rm(tmp,{recursive:true,force:true});}
