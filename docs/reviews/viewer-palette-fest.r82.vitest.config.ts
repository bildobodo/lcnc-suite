import {defineConfig} from 'vitest/config';
export default defineConfig({cacheDir:'../r82-vitest-cache',test:{environment:'node',maxWorkers:1,include:['src/codeGlide.test.ts','src/simPanelStore.test.ts','src/viewer/simRows.test.ts','src/viewer/clashTargets.test.ts','src/viewer/findingNav.test.ts','src/viewer/sweepMerge.test.ts','src/viewer/scrubTrack.test.ts']}});
