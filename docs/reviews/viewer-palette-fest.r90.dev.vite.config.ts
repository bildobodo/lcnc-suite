import {defineConfig} from 'vite';
export default defineConfig({cacheDir:'../r90-dev-cache',server:{host:'127.0.0.1',port:4189,strictPort:true},worker:{format:'es'}});
