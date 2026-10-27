import { configureCPU, fetchJSON, fetchBytes, loadSession, int64, float32, splitText } from './cpu-runtime.js';
import { phonemize, rawPhonemize } from './kokoro-phonemize.js';
import { concatPcm } from './audio.js';

/** Official ONNX contracts; voice matrices are never replaced with placeholder vectors. */
export class CompactEngine {
  constructor(model, progress) { this.model = model; this.progress = progress; this.voices = new Map(); }
  async load() {
    this.ort = configureCPU();
    const root = this.root = `/models/${this.model.id}`;
    if (this.model.family === 'piper') {
      this.config = await fetchJSON(`${root}/en_US-lessac-medium.onnx.json`);
      this.session = await loadSession(`${root}/en_US-lessac-medium.onnx`, this.progress);
      this.sampleRate = this.config.audio.sample_rate;
    } else {
      this.config = await fetchJSON(`${root}/config.json`);
      const kitten = this.model.family === 'kitten';
      this.vocab = kitten ? await fetchJSON(`${root}/tokens.json`) : (await fetchJSON(`${root}/tokenizer.json`)).model.vocab;
      if (kitten) this.voiceShapes = await fetchJSON(`${root}/voices.json`);
      this.session = await loadSession(`${root}/${kitten ? this.config.model_file : 'onnx/model_quantized.onnx'}`, this.progress);
      this.sampleRate = 24000;
      await this.voiceData(this.model.voices[0]);
    }
  }
  async voiceData(name) {
    const key = this.config.voice_aliases?.[name] || name;
    if (!this.voices.has(key)) {
      const file = this.model.family === 'kitten' ? `${key}.bin` : `voices/${key}.bin`;
      const bytes = await fetchBytes(`${this.root}/${file}`);
      this.voices.set(key, new Float32Array(bytes.buffer));
    }
    return this.voices.get(key);
  }
  async generate(text, { voice, speed = 1, onChunk }) {
    const output = [];
    for (const chunk of splitText(text)) {
      const pcm = await this.generateChunk(chunk, voice, speed);
      output.push(pcm); onChunk?.(pcm);
    }
    return concatPcm(output);
  }
  async generateChunk(text, voice, speed) {
    const family = this.model.family;
    let feeds;
    if (family === 'piper') {
      const ipa = await rawPhonemize(text, this.config.espeak.voice);
      const map = this.config.phoneme_id_map;
      const tokens = [...map['^'], ...map['_']];
      for (const char of ipa) if (map[char]) tokens.push(...map[char], ...map['_']);
      tokens.push(...map['$']);
      const inference = this.config.inference;
      feeds = { input: int64(tokens, [1,tokens.length]), input_lengths: int64([tokens.length], [1]),
        scales: float32([inference.noise_scale, inference.length_scale / speed, inference.noise_w], [3]) };
      if (this.session.inputNames.includes('sid')) feeds.sid = int64([0], [1]);
    } else {
      const kitten = family === 'kitten';
      let ipa = kitten ? await rawPhonemize(text) : await phonemize(text, voice.startsWith('b') ? 'b' : 'a');
      if (kitten) ipa = (ipa.match(/[\p{L}\p{N}_]+|[^\p{L}\p{N}_\s]/gu) || []).join(' ');
      const tokens = [...ipa].filter(c => this.vocab[c] !== undefined).map(c => this.vocab[c]);
      if (!tokens.length) throw new Error('文字無法轉成此模型的音素。');
      if (tokens.length > 509) throw new Error('音素長度超過模型上限，請縮短文字。');
      const voiceData = await this.voiceData(voice);
      const key = this.config.voice_aliases?.[voice] || voice;
      const row = kitten ? Math.min(text.length, this.voiceShapes[key][0] - 1) : Math.min(tokens.length, 509);
      const style = voiceData.slice(row * 256, (row + 1) * 256);
      if (style.length !== 256) throw new Error(`聲音向量格式不符：${voice}`);
      const ids = kitten ? [0, ...tokens, 10, 0] : [0, ...tokens, 0];
      feeds = { input_ids: int64(ids, [1,ids.length]), style: float32(style, [1,256]),
        speed: float32([speed * (this.config.speed_priors?.[key] || 1)], [1]) };
    }
    let outputs;
    try {
      outputs = await this.session.run(feeds);
      const audio = outputs[this.session.outputNames[0]];
      // Match Kitten 0.8's official decoder-tail trim.
      const count = family === 'kitten' ? Math.max(0, audio.data.length - 5000) : audio.data.length;
      return new Float32Array(audio.data.slice(0, count));
    } finally {
      for (const tensor of Object.values(feeds)) tensor.dispose();
      for (const tensor of Object.values(outputs || {})) tensor.dispose();
    }
  }
}
