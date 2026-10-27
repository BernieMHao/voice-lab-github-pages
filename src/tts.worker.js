import { MODELS } from './models.js';
import { CompactEngine } from './compact-engines.js';
import { SupertonicEngine } from './supertonic-engine.js';
import { QwenEngine } from './qwen-engine.js';

let engine, busy = false;
self.onmessage = async ({ data }) => {
  if (busy) return;
  busy = true;
  try {
    if (data.type === 'load') {
      const model = MODELS.find(m => m.id === data.model);
      if (!model || !['kokoro','kitten','piper','supertonic','qwen'].includes(model.family)) throw new Error('未知模型。');
      const progress = message => self.postMessage({ type: 'progress', message });
      engine = model.family === 'qwen' ? new QwenEngine(model, progress) : model.family === 'supertonic' ? new SupertonicEngine(model, progress) : new CompactEngine(model, progress);
      await engine.load();
      self.postMessage({ type: 'ready', device: 'wasm', threads: 2 });
    } else if (data.type === 'generate') {
      if (!engine) throw new Error('請先載入模型。');
      let state = data.seed >>> 0;
      Math.random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return (state + .5) / 4294967296; };
      const start = performance.now(); let firstMs = null;
      const pcm = await engine.generate(data.text, { ...data,
        onChunk: () => { firstMs ??= performance.now() - start; },
        onStep: (step, total) => self.postMessage({ type: 'step', step, total }) });
      self.postMessage({ type: 'audio', pcm, sampleRate: engine.sampleRate, firstMs, totalMs: performance.now() - start }, [pcm.buffer]);
    }
  } catch (error) { self.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) }); }
  finally { busy = false; }
};
