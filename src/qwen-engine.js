import { assetURL } from './paths.js';
// Adapted from onnx-community Qwen3-TTS inference.py (Apache-2.0).
// 0.6B CustomVoice; six ONNX graphs, CPU WASM only, two threads.
import { configureCPU, loadSession, fetchJSON, int64, float32 } from './cpu-runtime.js';
import { concatPcm } from './audio.js';

const LANG = { zh:'chinese', en:'english', ja:'japanese', ko:'korean', de:'german', fr:'french', es:'spanish', it:'italian', pt:'portuguese', ru:'russian' };
const cat = (...arrays) => concatPcm(arrays);
const add = (a, b) => Float32Array.from(a, (x, i) => x + b[i % b.length]);
const repeat = (a, n) => Float32Array.from({ length: a.length * n }, (_, i) => a[i % a.length]);

export function sampleQwen(logits, random, previous = []) {
  const values = Float64Array.from(logits);
  for (const id of new Set(previous)) values[id] = values[id] < 0 ? values[id] * 1.05 : values[id] / 1.05;
  const top = Array.from(values, (value, id) => ({ value, id })).sort((a, b) => b.value - a.value).slice(0, 50);
  const max = top[0].value;
  if (!Number.isFinite(max)) throw new Error('Qwen logits 無有效值。');
  const weights = top.map(x => Math.exp((x.value - max) / .9));
  let target = random() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < top.length; i++) { target -= weights[i]; if (target <= 0) return top[i].id; }
  return top.at(-1).id;
}

export class QwenEngine {
  constructor(model, progress) { this.model = model; this.progress = progress; this.sampleRate = 24000; this.sessions = {}; }
  async load() {
    this.ort = configureCPU();
    this.config = await fetchJSON('/models/qwen/config.json');
    for (const name of ['text_embed','codec_embed','talker_cache','code_predictor','residual_embed','tok_decoder']) {
      this.sessions[name] = await loadSession(`/models/qwen/${name}.onnx`, this.progress);
    }
    const { AutoTokenizer, env } = await import('@huggingface/transformers');
    env.allowLocalModels = true; env.allowRemoteModels = false; env.localModelPath = assetURL('/models/');
    this.tokenizer = await AutoTokenizer.from_pretrained('qwen', { local_files_only: true });
  }
  async run(name, inputs) {
    try { return Object.values(await this.sessions[name].run(inputs)); }
    finally { for (const t of Object.values(inputs)) t.dispose(); }
  }
  async embed(name, ids) {
    const key = name === 'text_embed' ? 'text_ids' : 'codec_ids';
    const [out] = await this.run(name, { [key]: int64(ids, [1, ids.length]) });
    const data = Float32Array.from(out.data); out.dispose(); return data;
  }
  async generate(text, { language, voice, onChunk, onStep }) {
    const c = this.config, tc = c.talker_config, h = tc.hidden_size;
    if (!(voice in tc.spk_id)) throw new Error('Qwen 聲音不存在。');
    const ids = this.tokenizer.encode(`<|im_start|>assistant\n${text}<|im_end|>\n<|im_start|>assistant\n`, { add_special_tokens: false });
    const spec = await this.embed('text_embed', [c.tts_bos_token_id, c.tts_eos_token_id, c.tts_pad_token_id]);
    const bos = spec.slice(0, h), eos = spec.slice(h, h * 2), pad = spec.slice(h * 2);
    const languageId = tc.spk_is_dialect?.[voice] ? tc.codec_language_id[tc.spk_is_dialect[voice]] : tc.codec_language_id[LANG[language]];
    const prefill = languageId === undefined ? [tc.codec_nothink_id, tc.codec_think_bos_id, tc.codec_think_eos_id]
      : [tc.codec_think_id, tc.codec_think_bos_id, languageId, tc.codec_think_eos_id];
    const codecIds = [...prefill, tc.spk_id[voice], tc.codec_pad_id, tc.codec_bos_id];
    const codec = await this.embed('codec_embed', codecIds);
    const role = await this.embed('text_embed', ids.slice(0, 3));
    const bodyIds = ids.slice(3, -5);
    const body = await this.embed('text_embed', bodyIds);
    const codecPad = await this.embed('codec_embed', Array(bodyIds.length + 1).fill(tc.codec_pad_id));
    const codecBos = codec.slice(-h);
    let input = cat(role, add(cat(repeat(pad, codecIds.length - 2), bos), codec.slice(0, -h)), add(cat(body, eos), codecPad), add(pad, codecBos));
    const session = this.sessions.talker_cache;
    let cache = session.inputNames.slice(3).map(() => new this.ort.Tensor('float32', new Float32Array(0), [1, tc.num_key_value_heads, 0, tc.head_dim]));
    let total = 0, previous = [], codes = [], ended = false;
    const maxFrames = 500;
    try {
      for (let step = 0; step < maxFrames; step++) {
        const length = input.length / h;
        const positions = Array.from({ length: length * 3 }, (_, i) => total + i % length);
        const feed = { inputs_embeds: float32(input, [1, length, h]), position_ids: int64(positions, [3, 1, length]),
          attention_mask: int64(Array(total + length).fill(1), [1, total + length]) };
        session.inputNames.slice(3).forEach((name, i) => { feed[name] = cache[i]; });
        const [logits, hidden, ...present] = await this.run('talker_cache', feed);
        cache = present; total += length;
        const scores = Float32Array.from(logits.data.slice(-tc.vocab_size));
        logits.dispose();
        for (let i = tc.vocab_size - 1024; i < tc.vocab_size; i++) if (i !== tc.codec_eos_token_id) scores[i] = -Infinity;
        const code0 = sampleQwen(scores, Math.random, previous);
        if (code0 === tc.codec_eos_token_id) { hidden.dispose(); ended = true; break; }
        previous.push(code0);
        const th = Float32Array.from(hidden.data.slice(-h)); hidden.dispose();
        const frame = Array(16).fill(0); frame[0] = code0;
        for (let group = 1; group < 16; group++) {
          const [prediction] = await this.run('code_predictor', { talker_hidden: float32(th, [1, h]), codec_ids: int64(frame, [1, 16]) });
          frame[group] = sampleQwen(prediction.data.subarray((group - 1) * 2048, group * 2048), Math.random);
          prediction.dispose();
        }
        codes.push(frame);
        const [embedding] = await this.run('residual_embed', { codec_ids: int64(frame, [1, 16]) });
        input = add(embedding.data, pad); embedding.dispose();
        onStep?.(step + 1, maxFrames);
      }
    } finally { cache.forEach(t => t.dispose()); }
    if (!ended) throw new Error('Qwen 達到音訊長度上限，未輸出結束標記。請縮短文字再試。');
    if (!codes.length) throw new Error('Qwen 沒有產生音訊 token。');
    const chunks = [];
    for (let start = 0; start < codes.length; start += 25) {
      const count = Math.min(25, codes.length - start);
      const chunk = Array.from({ length: 25 }, (_, i) => codes[start + i % count]).flat();
      const [wave] = await this.run('tok_decoder', { audio_codes: int64(chunk, [1, 25, 16]) });
      chunks.push(Float32Array.from(wave.data.subarray(0, Math.round(wave.data.length * count / 25))));
      wave.dispose(); onChunk?.();
    }
    return cat(...chunks);
  }
}
