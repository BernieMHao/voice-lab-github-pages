import { defineConfig } from 'vite';

export default defineConfig({
  base: '/omnivoice/',
  optimizeDeps: {
    exclude: ['onnxruntime-web'],
  },
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  build: {
    target: 'esnext',
    rollupOptions: {
      external: [],
    },
  },
  worker: {
    format: 'es',
  },
});
