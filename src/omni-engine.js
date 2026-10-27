import { assetURL } from './paths.js';
// Adapted from AnEntrypoint/omnivoice (Apache-2.0); forced WASM CPU.
import { estimateDuration } from './omni-duration.js';
import { getTimeSteps, computeSchedule, logSoftmax1D, topkFlatIndices, gumbelSample, argmax1D } from './omni-math.js';

const AUDIO_VOCAB = 1025;
const AUDIO_MASK_ID = 1024;
const NUM_CODEBOOK = 8;
const DEFAULT_REF_TEXT = 'Nice to meet you.';
const DEFAULT_REF_FRAMES = 25;

export class OmniVoiceEngine {
  constructor() { this.lmSession = this.encSession = this.decSession = this.tokenizer = null; this.device = 'wasm'; }

  async load(modelDir, onProgress) {
    const ort = await import('onnxruntime-web/wasm');
    if (!self.crossOriginIsolated) throw new Error('需要 COOP/COEP HTTP headers 才能使用兩個推論執行緒。請重新整理 HTTPS 網站並允許 Service Worker。');
    ort.env.wasm.wasmPaths = assetURL('/ort/');
    ort.env.wasm.numThreads = 2;
    ort.env.wasm.proxy = false;
    this.ort = ort;
    this.device = 'wasm';
    const opts = { executionProviders: ['wasm'], graphOptimizationLevel: 'all', executionMode: 'sequential' };
    const fetchBuf = async url => {
      onProgress?.(`讀取 ${url.split('/').at(-1)}…`);
      const r = await fetch(url);
      if (!r.ok) throw new Error(`模型資產不存在（HTTP ${r.status}）：${url}，請重新下載此模型。`);
      return new Uint8Array(await r.arrayBuffer());
    };
    const response = await fetch(`${modelDir}/manifest.json`);
    if (!response.ok) throw new Error('OmniVoice 模型尚未準備，請重新下載此模型。');
    const manifest = await response.json();
    for (const [name, member] of [['omnivoice_lm', 'lmSession'], ['audio_decoder', 'decSession']]) {
      const externalData = [];
      for (const file of manifest[name] ?? []) externalData.push({ path: file, data: await fetchBuf(`${modelDir}/${file}`) });
      const graph = await fetchBuf(`${modelDir}/${name}.onnx`);
      onProgress?.(`建立 ${name} · WASM CPU / 2 threads…`);
      this[member] = await ort.InferenceSession.create(graph, { ...opts, externalData });
    }
    const { AutoTokenizer, env } = await import('@huggingface/transformers');
    env.allowLocalModels = true;
    env.allowRemoteModels = false;
    env.localModelPath = assetURL('/models/');
    this.tokenizer = await AutoTokenizer.from_pretrained('omnivoice', { local_files_only: true });
    onProgress?.('OmniVoice 已載入 · WASM CPU / 2 threads');
  }

  async encodeAudio(waveform) {
    const t = new this.ort.Tensor('float32', waveform, [1, 1, waveform.length]);
    const out = await this.encSession.run({ waveform: t });
    t.dispose();
    const codes = out.audio_codes;
    return { data: new Int32Array(codes.data), dims: Array.from(codes.dims) };
  }

  async decodeAudio(codesData, dims) {
    const t = new this.ort.Tensor('int64', BigInt64Array.from(codesData, BigInt), [dims[1], dims[0], dims[2]]);
    const out = await this.decSession.run({ codes: t });
    t.dispose();
    const wav = out.waveform_24k;
    const result = new Float32Array(wav.data);
    wav.dispose?.();
    return result;
  }

  _tok(text) {
    const ids = this.tokenizer.encode(text, { add_special_tokens: false });
    return Array.isArray(ids) ? ids : Array.from(ids);
  }

  _buildCondInput(text, numTarget, refText, refCodes, lang, instruct, denoise) {
    const denoiseT = (denoise && refCodes) ? '<|denoise|>' : '';
    const styleIds = this._tok(`${denoiseT}<|lang_start|>${lang ?? 'None'}<|lang_end|><|instruct_start|>${instruct ?? 'None'}<|instruct_end|>`);
    const fullText = refText ? `${refText.trim()} ${text.trim()}` : text.trim();
    const textIds = this._tok(`<|text_start|>${fullText}<|text_end|>`);
    const refLen = refCodes ? refCodes.dims[2] : 0;
    const seqLen = styleIds.length + textIds.length + refLen + numTarget;
    const inputIds = new Int32Array(NUM_CODEBOOK * seqLen).fill(AUDIO_MASK_ID);
    const audioMask = new Float32Array(seqLen).fill(0);
    for (let c = 0; c < NUM_CODEBOOK; c++) {
      styleIds.forEach((id, i) => { inputIds[c * seqLen + i] = id; });
      textIds.forEach((id, i) => { inputIds[c * seqLen + styleIds.length + i] = id; });
    }
    const audioStart = styleIds.length + textIds.length;
    if (refCodes) {
      for (let c = 0; c < NUM_CODEBOOK; c++)
        for (let t = 0; t < refLen; t++)
          inputIds[c * seqLen + audioStart + t] = refCodes.data[c * refLen + t];
    }
    for (let i = audioStart; i < seqLen; i++) audioMask[i] = 1.0;
    return { inputIds, audioMask, seqLen, targetStart: audioStart + refLen };
  }

  async _forward(batchInputIds, batchAudioMask, batchAttnMask, seqLen, batchSize) {
    const { Tensor } = this.ort;
    const idT = new Tensor('int64', BigInt64Array.from(batchInputIds, BigInt), [batchSize, NUM_CODEBOOK, seqLen]);
    const amT = new Tensor('bool', Uint8Array.from(batchAudioMask), [batchSize, seqLen]);
    const attention = new BigInt64Array(batchSize * seqLen);
    const positions = new BigInt64Array(batchSize * seqLen);
    for (let b = 0; b < batchSize; b++) for (let k = 0; k < seqLen; k++) {
      attention[b * seqLen + k] = BigInt(batchAttnMask[b * seqLen * seqLen + k]);
      positions[b * seqLen + k] = BigInt(k);
    }
    const atT = new Tensor('int64', attention, [batchSize, seqLen]);
    const posT = new Tensor('int64', positions, [batchSize, seqLen]);
    const out = await this.lmSession.run({ input_ids: idT, audio_mask: amT, attention_mask: atT, position_ids: posT });
    idT.dispose(); amT.dispose(); atT.dispose(); posT.dispose();
    const logits = out.logits;
    const data = new Float32Array(logits.data);
    logits.dispose?.();
    return data;
  }

  async generate(text, { lang = null, refAudio = null, refText = null, instruct = null, numStep = 32, guidanceScale = 2.0, tShift = 0.1, layerPenalty = 5.0, posTemp = 5.0, classTemp = 0.0, onStep = null } = {}) {
    if (refAudio) throw new Error('此版本尚未支援 OmniVoice 錄音複製。');
    const refCodes = null;
    const refLen = refCodes ? refCodes.dims[2] : DEFAULT_REF_FRAMES;
    const numTarget = Math.max(1, Math.round(estimateDuration(text, refText ?? DEFAULT_REF_TEXT, refLen)));
    const { inputIds, audioMask, seqLen, targetStart } = this._buildCondInput(text, numTarget, refText, refCodes, lang, instruct, true);

    const bIds = new Int32Array(2 * NUM_CODEBOOK * seqLen).fill(AUDIO_MASK_ID);
    const bMask = new Float32Array(2 * seqLen).fill(0);
    const bAttn = new Float32Array(2 * seqLen * seqLen).fill(0);
    bIds.set(inputIds, 0);
    bMask.set(audioMask, 0);
    for (let c = 0; c < NUM_CODEBOOK; c++)
      for (let t = 0; t < numTarget; t++)
        bIds[NUM_CODEBOOK * seqLen + c * seqLen + t] = inputIds[c * seqLen + targetStart + t];
    for (let t = 0; t < numTarget; t++) bMask[seqLen + t] = 1.0;
    for (let q = 0; q < seqLen; q++) for (let k = 0; k < seqLen; k++) bAttn[q * seqLen + k] = 1.0;
    for (let q = 0; q < numTarget; q++) for (let k = 0; k < numTarget; k++) bAttn[seqLen * seqLen + q * seqLen + k] = 1.0;
    for (let i = numTarget; i < seqLen; i++) bAttn[seqLen * seqLen + i * seqLen + i] = 1.0;

    const tokens = new Int32Array(NUM_CODEBOOK * numTarget).fill(AUDIO_MASK_ID);
    const timesteps = getTimeSteps(0, 1, numStep, tShift);
    const schedule = computeSchedule(numTarget, NUM_CODEBOOK, numStep, timesteps);

    for (let step = 0; step < numStep; step++) {
      if (schedule[step] === 0) { onStep?.(step + 1, numStep); continue; }
      const logits = await this._forward(bIds, bMask, bAttn, seqLen, 2);
      const stride = NUM_CODEBOOK * seqLen * AUDIO_VOCAB;
      const pred = new Int32Array(NUM_CODEBOOK * numTarget);
      const scores = new Float32Array(NUM_CODEBOOK * numTarget).fill(-Infinity);

      for (let c = 0; c < NUM_CODEBOOK; c++) {
        for (let t = 0; t < numTarget; t++) {
          const cBase = c * seqLen * AUDIO_VOCAB + (targetStart + t) * AUDIO_VOCAB;
          const uBase = stride + c * seqLen * AUDIO_VOCAB + t * AUDIO_VOCAB;
          const cLS = logSoftmax1D(logits, cBase, AUDIO_VOCAB);
          const uLS = logSoftmax1D(logits, uBase, AUDIO_VOCAB);
          const cfg = new Float32Array(AUDIO_VOCAB);
          for (let v = 0; v < AUDIO_VOCAB; v++) cfg[v] = cLS[v] + guidanceScale * (cLS[v] - uLS[v]);
          const cfgLS = logSoftmax1D(cfg, 0, AUDIO_VOCAB);
          cfgLS[AUDIO_MASK_ID] = -Infinity;
          const tok = classTemp > 0 ? argmax1D(gumbelSample(cfgLS, classTemp), 0, AUDIO_VOCAB) : argmax1D(cfgLS, 0, AUDIO_VOCAB);
          pred[c * numTarget + t] = tok;
          const baseScore = cfgLS[tok] - c * layerPenalty;
          scores[c * numTarget + t] = posTemp > 0 ? baseScore / posTemp + (-Math.log(-Math.log(Math.random()+1e-10)+1e-10)) : baseScore;
        }
      }

      for (let i = 0; i < scores.length; i++) { if (tokens[i] !== AUDIO_MASK_ID) scores[i] = -Infinity; }
      const topIdx = topkFlatIndices(scores, schedule[step]);
      for (const fi of topIdx) {
        const c = Math.floor(fi / numTarget), t = fi % numTarget;
        tokens[fi] = pred[fi];
        bIds[c * seqLen + targetStart + t] = pred[fi];
        bIds[stride / AUDIO_VOCAB + c * seqLen + t] = pred[fi];
      }
      onStep?.(step + 1, numStep);
    }

    return this.decodeAudio(tokens, [1, NUM_CODEBOOK, numTarget]);
  }
}
