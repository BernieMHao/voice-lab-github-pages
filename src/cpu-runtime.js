import { assetURL } from './paths.js';
import * as ort from 'onnxruntime-web/wasm';

/** All ONNX model families share the CPU-only runtime and its two-thread pool. */
export function configureCPU() {
  if (!self.crossOriginIsolated) throw new Error('需要 COOP／COEP headers 才能使用兩個推論執行緒。');
  ort.env.wasm.wasmPaths = assetURL('/ort/');
  ort.env.wasm.numThreads = 2;
  ort.env.wasm.proxy = false;
  return ort;
}
// ONNX Runtime adds internal fields to session options during initialization.
export const CPU_OPTIONS = { executionProviders: ['wasm'], executionMode: 'sequential', graphOptimizationLevel: 'all' };

export async function fetchJSON(url) {
  url = assetURL(url);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`找不到模型設定：${url}（HTTP ${response.status}）。請重新下載此模型。`);
  return response.json();
}
export async function fetchBytes(url, progress) {
  url = assetURL(url);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`找不到模型資產：${url}（HTTP ${response.status}）。請重新下載此模型。`);
  const total = Number(response.headers.get('Content-Length'));
  const reader = response.body.getReader();
  const chunks = []; let length = 0, lastUpdate = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); length += value.length;
    const now = performance.now();
    if (now - lastUpdate >= 100 || length === total) { progress?.({ loaded: length, total }); lastUpdate = now; }
  }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}
export async function loadSession(url, progress) {
  progress?.(`讀取 ${url.split('/').at(-1)}…`);
  const bytes = await fetchBytes(url, p => progress?.(`載入 ${url.split('/').at(-1)} · ${(p.loaded/1048576).toFixed(1)} MB`));
  return ort.InferenceSession.create(bytes, { ...CPU_OPTIONS });
}
export function int64(values, dims) { return new ort.Tensor('int64', BigInt64Array.from(values, BigInt), dims); }
export function float32(values, dims) { return new ort.Tensor('float32', Float32Array.from(values), dims); }
export function splitText(text, limit = 140) {
  const chunks = []; let current = '';
  for (const word of text.trim().split(/\s+/)) {
    if (current.length + word.length + 1 > limit && current) { chunks.push(current); current = ''; }
    if (word.length > limit) {
      for (let i = 0; i < word.length; i += limit) chunks.push(word.slice(i, i + limit));
    } else current += (current ? ' ' : '') + word;
  }
  if (current) chunks.push(current);
  return chunks;
}
