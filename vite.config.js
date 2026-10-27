import { defineConfig } from 'vite';
import { readdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

export default defineConfig({
  base: process.env.PAGES_BASE || '/',
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['onnxruntime-web'] },
  build: { target: 'es2022' },
  plugins: [{ name:'offline-shell', closeBundle() {
    const root = join(process.cwd(), 'dist');
    const files = [];
    function walk(path) {
      for (const entry of readdirSync(path, { withFileTypes:true })) {
        const full = join(path, entry.name), name = relative(root, full).replaceAll('\\','/');
        if (entry.isDirectory()) walk(full);
        else if (name === 'index.html' || /^assets\/.*\.(js|css)$/.test(name) || name.startsWith('configs/')) files.push(name);
      }
    }
    walk(root);
    writeFileSync(join(root, 'shell.json'), JSON.stringify(files));
    const runtimes = {};
    for (const [name, folder] of Object.entries({ pocket:'pocket', sherpa:'sherpa', onnx:'ort', phonemizer:'phonemizer' })) {
      const list = [];
      function scan(path) {
        for (const entry of readdirSync(path, { withFileTypes:true })) {
          const full = join(path, entry.name);
          if (entry.isDirectory()) scan(full);
          else if (/\.(js|mjs|wasm)$/.test(entry.name)) list.push(relative(root, full).replaceAll('\\','/'));
        }
      }
      scan(join(root, folder)); runtimes[name] = list;
    }
    writeFileSync(join(root, 'runtimes.json'), JSON.stringify(runtimes));
  }}]
});
