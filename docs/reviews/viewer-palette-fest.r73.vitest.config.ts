import {defineConfig} from 'vitest/config';
export default defineConfig({cacheDir:'../r73-vitest-cache',test:{environment:'node',maxWorkers:1,include:['src/gcodeRefView.test.ts','src/messageView.test.ts','src/*Dialog*.test.ts','src/helpPlacement.test.ts','src/ws/*test.ts','src/permissions.test.ts','src/machineControls.test.ts']}});
