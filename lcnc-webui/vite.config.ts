import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
  build: {
    assetsDir: 'static',  // avoid conflict with gateway /assets mount (machine STLs)
    rollupOptions: {
      output: {
        // Split the heavy 3D vendor code into its own chunk (issue #23). Three.js
        // + troika dominate the bundle and change rarely, so isolating them keeps
        // the main app chunk smaller and lets the viewer code cache across app
        // updates. msgpack likewise.
        manualChunks(id) {
          if (id.includes('node_modules/three') || id.includes('troika')) return 'three'
          if (id.includes('node_modules/@msgpack')) return 'msgpack'
        },
      },
    },
  },
  server: {
    proxy: {
      // NOTE: in dev the app's WebSocket does NOT use this proxy — lcncWs builds
      // ws://<hostname>:8000 directly (the deadman heartbeat must not ride the
      // single-threaded dev server: a transform storm delayed relayed frames
      // > 3 s and false-disarmed the client). Override the gateway port via
      // VITE_GATEWAY_PORT if it isn't 8000. The /ws entry below stays only as
      // a fallback for manual testing.
      '/ws': {
        target: 'http://127.0.0.1:8000',
        ws: true,
      },
      '/files': 'http://127.0.0.1:8000',
      '/gcode': 'http://127.0.0.1:8000',
      '/preview': 'http://127.0.0.1:8000',
      '/surface_points': 'http://127.0.0.1:8000',
      '/comp_grid': 'http://127.0.0.1:8000',
      '/upload': 'http://127.0.0.1:8000',
      '/save': 'http://127.0.0.1:8000',
      '/hal': 'http://127.0.0.1:8000',
      '/g30': 'http://127.0.0.1:8000',
      '/assets': 'http://127.0.0.1:8000',
      '/import-tool-library': 'http://127.0.0.1:8000',
      '/tool-library-file': 'http://127.0.0.1:8000',
      '/telemetry': 'http://127.0.0.1:8000',
    },
  },
})
