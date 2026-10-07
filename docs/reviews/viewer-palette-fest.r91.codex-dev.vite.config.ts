import {defineConfig} from 'vite';
export default defineConfig({cacheDir:'../r91-codex-dev-cache',optimizeDeps:{entries:['public/r91.codex-worker.html']},server:{host:'127.0.0.1',port:4189,strictPort:true},worker:{format:'es'}});
