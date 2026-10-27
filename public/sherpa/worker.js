const base = new URL('../', self.location.href);
const assetURL = path => new URL(path.replace(/^\//, ''), base).href;
/* sherpa-onnx CPU SIMD build: no pthread pool, one inference thread. */
let tts, modelId, reference, referenceRate;
const progress = message => self.postMessage({ type: 'progress', message });
const json = async url => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`缺少模型資產：${url}`);
  return response.json();
};
async function load(id) {
  if (!['matcha', 'zipvoice'].includes(id)) throw new Error('未知 Sherpa 模型。');
  modelId = id;
  const root = assetURL(`/models/${id}/`);
  const files = await json(root + 'files.json');
  // All filesystem and model state lives in this worker; terminating releases it.
  await new Promise((resolve, reject) => {
    self.Module = {
      locateFile: () => assetURL('/sherpa/sherpa-onnx.wasm'),
      onRuntimeInitialized: resolve,
      onAbort: message => reject(new Error(String(message))),
      print: () => {}, printErr: message => console.warn(message)
    };
    importScripts(assetURL('/sherpa/sherpa-runtime.js'), assetURL('/sherpa/sherpa-api.js'));
  });
  for (let i = 0; i < files.length; i++) {
    const name = files[i];
    progress(`讀取 ${id} · ${i + 1}/${files.length} · ${name}`);
    const response = await fetch(root + name);
    if (!response.ok) throw new Error(`缺少模型資產：${name}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const path = '/' + name, parent = path.slice(0, path.lastIndexOf('/'));
    if (parent) FS.mkdirTree(parent);
    FS.writeFile(path, bytes, { canOwn: true });
  }
  progress(`建立 ${id} · WASM CPU / 1 thread…`);
  const model = { numThreads: 1, provider: 'cpu', debug: 0 };
  const config = { model, maxNumSentences: 1, silenceScale: .2 };
  if (id === 'matcha') {
    model.matcha = { acousticModel: '/model-steps-3.onnx', vocoder: '/vocos-22khz-univ.onnx',
      tokens: '/tokens.txt', lexicon: '/lexicon.txt', dictDir: '/dict', noiseScale: .667, lengthScale: 1 };
    config.ruleFsts = '/phone.fst,/date.fst,/number.fst';
  } else {
    model.zipvoice = { encoder: '/encoder.int8.onnx', decoder: '/decoder.int8.onnx', vocoder: '/vocos_24khz.onnx',
      tokens: '/tokens.txt', lexicon: '/lexicon.txt', dataDir: '/espeak-ng-data', featScale: .1,
      tShift: .5, targetRMS: .1, guidanceScale: 1 };
    const wav = FS.readFile('/test_wavs/news-female.wav');
    const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
    let offset = 12;
    while (offset + 8 <= view.byteLength) {
      const name = String.fromCharCode(...wav.subarray(offset, offset + 4));
      const size = view.getUint32(offset + 4, true);
      if (name === 'fmt ') {
        if (view.getUint16(offset + 8, true) !== 1 || view.getUint16(offset + 10, true) !== 1 || view.getUint16(offset + 22, true) !== 16) throw new Error('參考 WAV 格式錯誤。');
        referenceRate = view.getUint32(offset + 12, true);
      }
      if (name === 'data') {
        reference = Float32Array.from({ length: size / 2 }, (_, i) => view.getInt16(offset + 8 + i * 2, true) / 32768);
        break;
      }
      offset += 8 + size + (size % 2);
    }
    if (!reference || !referenceRate) throw new Error('缺少參考音訊。');
  }
  tts = self.createOfflineTts(Module, config);
  if (!tts.handle || !tts.sampleRate) throw new Error('無法建立中文推論模型。');
  self.postMessage({ type: 'ready', device: 'wasm', threads: 1 });
}
self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'load') await load(data.model);
    else if (data.type === 'generate') {
      if (!tts) throw new Error('請先載入模型。');
      let result;
      if (modelId === 'matcha') result = tts.generate({ text: data.text, sid: 0, speed: data.speed });
      else result = tts.generateWithConfig(data.text, { speed: data.speed, numSteps: data.steps,
        referenceAudio: reference, referenceSampleRate: referenceRate,
        referenceText: '各位村民, 大家新年好! 近期, 湖北省武汉市等多个地区' });
      self.postMessage({ type: 'audio', pcm: result.samples, sampleRate: result.sampleRate, firstMs: null }, [result.samples.buffer]);
    }
  } catch (error) { self.postMessage({ type: 'error', message: error.message || String(error) }); }
};
