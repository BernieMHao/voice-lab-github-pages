import { assetURL } from './paths.js';
export const VOICES = ['alba', 'marius', 'jean', 'anna', 'cosette', 'fantine', 'vera', 'javert'];
export const KITTEN_VOICES = ['Bella', 'Jasper', 'Luna', 'Bruno', 'Rosie', 'Hugo', 'Kiki', 'Leo'];
export const KOKORO_VOICES = ['af_heart', 'af_bella', 'af_sarah', 'am_adam', 'am_michael', 'bf_emma', 'bm_george'];
export const SUPER_LANGS = ['en','ko','ja','ar','bg','cs','da','de','el','es','et','fi','fr','hi','hr','hu','id','it','lt','lv','nl','pl','pt','ro','ru','sk','sl','sv','tr','uk','vi'];
export const MODELS = [
  { id: '100m', name: 'Pocket TTS 100M', size: '100M', family: 'pocket', checkpoint: 'english_2026-01', note: '原始 100M 英文模型（January 2026）。純 CPU · WASM SIMD。下載權重與聲音約 274 MB。' },
  { id: '18m', name: 'Pocket TTS 18M', size: '18.2M', family: 'pocket', checkpoint: 'english_18m_2026-10', note: 'October 2026 · 18.2M 參數，包含音訊解碼器。英文模型；適合先比較音質與速度。' },
  { id: '7m', name: 'Pocket TTS 7M', size: '6.9M', family: 'pocket', checkpoint: 'english_7m_2026-10', note: 'October 2026 · 6.9M 參數，包含音訊解碼器。英文模型；比 18M 更小。' },
  { id: '2m', name: 'Pocket TTS 2M', size: '1.9M', family: 'pocket', checkpoint: 'english_2m_2026-10', note: 'October 2026 · 1.9M 參數，包含音訊解碼器。官方實驗模型，發音與自然度可能較不穩定。' },
  { id: 'omnivoice', name: 'OmniVoice', size: '0.6B', family: 'omni', steps: [8,16,32], defaultSteps: 32, languages: ['en','zh','ja','ko','de','fr','es'], note: 'OmniVoice 多語言實驗模型 · KitsuMate CPU INT4 / FP32 codec · WASM CPU。首次載入較大、兩執行緒生成可能需要數分鐘。此版本提供自動聲音與文字描述，不含錄音複製。' },
  { id: 'kokoro', name: 'Kokoro 82M', size: '82M', family: 'kokoro', voices: KOKORO_VOICES, speed: true, note: 'Kokoro v1.0 · 82M · INT8。提供七個美式／英式英文聲音，使用瀏覽器 eSpeak IPA 前處理。24 kHz；目前整合英文。' },
  ...['nano','micro','mini'].map((size, i) => ({ id: `kitten-${size}`, name: `Kitten ${size[0].toUpperCase()+size.slice(1)}`, size: ['15M','40M','80M'][i], family: 'kitten', voices: KITTEN_VOICES, speed: true, note: `KittenTTS ${size} 0.8 · ${['15M','40M','80M'][i]} · 英文。八個官方聲音、正確音素詞表與長度對應的聲音向量；Nano 使用官方 int8 權重。` })),
  { id: 'piper', name: 'Piper · Lessac Medium', size: 'VITS', family: 'piper', voices: ['Lessac'], speed: true, sampleRate: 22050, note: 'Piper en_US-lessac-medium · 英文單聲音 · 22.05 kHz。Piper 是模型家族，此選項使用 Lessac Medium checkpoint。' },
  { id: 'supertonic', name: 'Supertonic 3', size: '99M', family: 'supertonic', voices: ['F1','F2','F3','F4','F5','M1','M2','M3','M4','M5'], speed: true, steps: [2,5,10,20], defaultSteps: 5, languages: SUPER_LANGS, note: 'Supertonic 3 · 99M · 十個聲音、31 種語言（不含中文）。44.1 kHz，官方四階段 ONNX pipeline，強制 WASM CPU。', sampleRate: 44100 },
  { id: 'phonon', name: 'Phonon 31M', size: '31M', family: 'phonon', voices: ['default'], note: 'Gradium Phonon 31M 英文模型 · Q8 GGUF · 24 kHz。31M 不包含音訊 tokenizer，使用官方預設聲音，不含錄音複製。' },
  { id: 'matcha', name: 'Matcha · 中文', size: 'Baker', family: 'sherpa', threads: 1, voices: ['Baker'], languages: ['zh'], speed: true, sampleRate: 22050, testText: '你好，歡迎來到語音實驗室。', note: 'Matcha icefall zh-baker · 中文女聲 · 3 steps · Vocos 22.05 kHz。繁體輸入在瀏覽器轉為簡體，使用官方中文詞典、分詞與數字正規化。官方 WASM SIMD 使用 1 個 CPU 推論執行緒。' },
  { id: 'zipvoice', name: 'ZipVoice-Distill', size: 'INT8', family: 'sherpa', threads: 1, voices: ['news-female'], languages: ['zh','en'], speed: true, steps: [4,8,16], defaultSteps: 4, testText: '你好，歡迎來到語音實驗室。', note: 'ZipVoice-Distill zh-en Emilia · INT8 · 中英文 · 24 kHz。使用官方 news-female 參考音訊與逐字稿；目前提供此預設聲音。官方 WASM SIMD 使用 1 個 CPU 推論執行緒。' },
  { id: 'qwen', name: 'Qwen3-TTS 0.6B', size: '0.6B', family: 'qwen', voices: ['vivian','serena','uncle_fu','ryan','aiden','ono_anna','sohee','eric','dylan'], languages: ['zh','en','ja','ko','de','fr','es','it','pt','ru'], testText: '你好，歡迎來到語音實驗室。', note: 'Qwen3-TTS 12Hz 0.6B CustomVoice · INT4 · 九個內建聲音、十種語言 · 24 kHz。六階段 ONNX pipeline；WASM CPU / 2 threads。資產約 1.1 GB，兩執行緒生成較慢；目前每次最多 200 字元。Eric／Dylan 使用官方四川話／北京話語言標記。' }
];
export function isStreamingModel(model) { return model.family === 'pocket' || model.family === 'phonon'; }
export function runtimeSpec(model) {
  if (model.family === 'pocket') return pocketSpec(model.id);
  if (model.family !== 'phonon') throw new Error('Unknown streaming model');
  return { weights: { q8: assetURL('/models/phonon/model.q8.gguf') }, tokenizer: assetURL('/models/phonon/tokenizer.json'),
    config: assetURL('/models/phonon/config.json'), defaultVoice: 'default', voices: { default: assetURL('/models/phonon/default-voice.safetensors') } };
}
export function pocketSpec(id) {
  if (!MODELS.some(m => m.id === id && m.family === 'pocket')) throw new Error('Unknown Pocket model');
  return { weights: { f32: assetURL(`/models/pocket/${id}/model.safetensors`) },
    tokenizer: assetURL(`/models/pocket/${id}/tokenizer.json`), config: assetURL(`/configs/${id}.json`),
    defaultVoice: 'alba', voices: Object.fromEntries(VOICES.map(v => [v, assetURL(`/models/pocket/${id}/embeddings/${v}.safetensors`)])) };
}
