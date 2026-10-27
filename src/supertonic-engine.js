import { assetURL } from './paths.js';
import { configureCPU, CPU_OPTIONS } from './cpu-runtime.js';
import { loadTextToSpeech, loadVoiceStyle } from './supertonic-helper.js';

export class SupertonicEngine {
  constructor(model, progress) { this.model = model; this.progress = progress; this.styles = new Map(); }
  async load() {
    configureCPU();
    const { textToSpeech } = await loadTextToSpeech(assetURL('/models/supertonic/onnx'), CPU_OPTIONS,
      (name, index, total) => this.progress?.(`載入 Supertonic ${name} · ${index} / ${total}`));
    this.tts = textToSpeech;
    this.sampleRate = this.tts.sampleRate;
    await this.style('F1');
  }
  async style(voice) {
    if (!this.model.voices.includes(voice)) throw new Error('未知 Supertonic 聲音。');
    if (!this.styles.has(voice)) this.styles.set(voice, await loadVoiceStyle([assetURL(`/models/supertonic/voice_styles/${voice}.json`)]));
    return this.styles.get(voice);
  }
  async generate(text, { voice, language, steps, speed = 1, onStep }) {
    if (!this.model.languages.includes(language)) throw new Error('Supertonic 3 不支援此語言。');
    const { wav } = await this.tts.call(text, language, await this.style(voice), steps, speed, .3, onStep);
    return Float32Array.from(wav);
  }
}
