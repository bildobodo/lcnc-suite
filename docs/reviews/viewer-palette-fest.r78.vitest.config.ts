import {defineConfig} from 'vitest/config';
export default defineConfig({cacheDir:'../r78-vitest-cache',test:{environment:'node',maxWorkers:1,include:['src/viewer/simRows.test.ts','src/viewer/clashTargets.test.ts','src/viewer/findingNav.test.ts','src/viewer/sweepMerge.test.ts','src/viewer/scrubTrack.test.ts']}});
