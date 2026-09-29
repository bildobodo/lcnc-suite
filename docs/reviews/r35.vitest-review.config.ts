import {defineConfig} from 'vitest/config';
export default defineConfig({cacheDir:'./.review-cache',test:{environment:'node',include:['review/r35.*.test.ts']}});
