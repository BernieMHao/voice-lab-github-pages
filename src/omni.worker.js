import { assetURL } from './paths.js';
import { OmniVoiceEngine } from './omni-engine.js';

let engine;
let busy = false;
self.onmessage = async ({ data }) => {
  if (busy) return;
  busy = true;
  try {
    if (data.type === 'load') {
      engine = new OmniVoiceEngine();
      await engine.load(assetURL('/models/omnivoice'), message => self.postMessage({ type: 'progress', message }));
      self.postMessage({ type: 'ready', device: 'wasm', threads: 2 });
    } else if (data.type === 'generate') {
      if (!engine) throw new Error('請先載入模型。');
      // Position sampling is seeded independently per utterance.
      let state = data.seed >>> 0;
      Math.random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return (state + 0.5) / 4294967296; };
      const start = performance.now();
      const pcm = await engine.generate(data.text, {
        lang: data.language, instruct: data.instruct || null, numStep: data.steps,
        onStep: (step, total) => self.postMessage({ type: 'step', step, total })
      });
      self.postMessage({ type: 'audio', pcm, sampleRate: 24000, totalMs: performance.now() - start }, [pcm.buffer]);
    }
  } catch (error) {
    self.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  } finally { busy = false; }
};
