import { MODELS, VOICES, runtimeSpec, isStreamingModel } from './models.js';
import { concatPcm, encodeWav } from './audio.js';
import { Converter } from 'opencc-js/t2cn';
import { assetURL } from './paths.js';
import { ModelStorage, formatBytes } from './model-storage.js';
const toSimplified = Converter({ from: 'tw', to: 'cn' });

const $ = id => document.getElementById(id);
let selected = MODELS.find(m => m.id === '2m');
let pocket = null, inferenceWorker = null, loadedId = null, busy = false, controller = null;
let entries = [], currentUrl = null, generationToken = 0;
const storage = new ModelStorage();
const storageReady = storage.init();

for (const m of MODELS) $('model').add(new Option(m.name, m.id));
$('model').value = selected.id;

function status(message, state = '') {
  $('status').textContent = message;
  $('status').parentElement.className = `status-row ${state}`;
}
function setBusy(value) {
  busy = value;
  for (const id of ['model','voice','temperature','seed','steps','language','instruct','load','generate','sample','new-session','speed','download-model','delete-model']) $(id).disabled = value;
  for (const button of $('download-list').querySelectorAll('button')) button.disabled = value;
  $('cancel').classList.toggle('hidden', !value);
  $('generate').classList.toggle('hidden', value);
  if (!value) $('progress').classList.add('hidden');
}
function dispose() {
  controller?.abort(); controller = null;
  pocket?.dispose(); pocket = null;
  inferenceWorker?.terminate(); inferenceWorker = null;
  loadedId = null;
  $('load').textContent = '載入模型';
}
function refreshModel() {
  const omni = selected.family === 'omni';
  const streaming = isStreamingModel(selected);
  $('model-size').textContent = selected.size;
  $('caption-name').textContent = selected.name;
  const languageHint = selected.languages?.length === 1 ? '中文' : selected.languages ? 'Multilingual' : 'English';
  $('caption-detail').textContent = `${languageHint} · ${(selected.sampleRate || 24000) / 1000} kHz · WASM`;
  $('language-hint').textContent = languageHint;
  $('model-note').textContent = selected.note;
  const voices = selected.voices || (omni ? ['auto'] : VOICES);
  $('voice').replaceChildren(...voices.map(v => new Option(v === 'auto' ? '自動／文字描述' : v === 'default' ? '官方預設聲音' : v, v)));
  $('omni-settings').classList.toggle('hidden', !selected.languages);
  $('instruct').classList.toggle('hidden', !omni);
  document.querySelector('label[for="instruct"]').classList.toggle('hidden', !omni);
  const languageLabels = { en:'English', zh:'中文', ja:'日本語', ko:'한국어', de:'Deutsch', fr:'Français', es:'Español' };
  const displayLanguages = new Intl.DisplayNames(['zh-Hant'], { type: 'language' });
  if (selected.languages) $('language').replaceChildren(...selected.languages.map(l => new Option(languageLabels[l] || displayLanguages.of(l), l)));
  $('steps-setting').classList.toggle('hidden', !selected.steps);
  if (selected.steps) {
    $('steps').replaceChildren(...selected.steps.map(n => new Option(String(n), String(n))));
    $('steps').value = String(selected.defaultSteps);
  }
  $('speed-setting').classList.toggle('hidden', !selected.speed);
  $('speed').value = '1';
  $('temp-setting').classList.toggle('hidden', !streaming);
  $('seed-setting').classList.toggle('hidden', ['kokoro','kitten','piper','sherpa'].includes(selected.family));
  $('temperature').value = selected.family === 'phonon' ? '.8' : '.3';
  $('temperature-value').value = selected.family === 'phonon' ? '.8' : '.3';
  $('thread-badge').textContent = `${selected.threads || 2} threads`;
  status('尚未載入模型，第一次使用會讀取並快取權重。');
  updateDownloads().catch(error => status(error.message, 'error'));
}
function progress(message, percent) {
  status(message, 'busy');
  $('progress').classList.remove('hidden');
  if (Number.isFinite(percent)) $('progress').value = percent;
  else $('progress').removeAttribute('value');
}
async function loadModel() {
  if (loadedId === selected.id) return;
  dispose();
  controller = new AbortController();
  if (!crossOriginIsolated || typeof SharedArrayBuffer === 'undefined') throw new Error('請使用 GitHub Pages HTTPS 與新版 Chrome／Edge，並允許 Service Worker。');
  await storageReady;
  await storage.ensure(selected.id, { signal:controller.signal, progress, family:selected.family });
  await updateDownloads();
  progress(`載入 ${selected.name}…`);
  if (isStreamingModel(selected)) {
    const runtimeUrl = assetURL('/pocket/index.js');
    const { PhononTTS } = await import(/* @vite-ignore */ runtimeUrl);
    pocket = await PhononTTS.load({
      cache: false, lang: 'en', rewrites: selected.family === 'phonon' ? 'default' : 'none', device: 'cpu', threads: 2, quant: selected.family === 'phonon' ? 'q8' : 'f32',
      conditions: selected.family === 'phonon' ? { num_speakers: '1', duration_delta: 0 } : undefined,
      signal: controller.signal,
      model: runtimeSpec(selected), voices: [selected.family === 'phonon' ? 'default' : 'alba'],
      onProgress: p => progress(`${p.cached ? '從快取讀取' : '載入'} ${p.file} · ${(p.loaded / 1048576).toFixed(1)} MB`, p.total ? p.loaded / p.total * 100 : undefined)
    });
    if (pocket.device !== 'cpu' || pocket.threads > 2) { dispose(); throw new Error('Runtime 未符合 CPU／兩執行緒限制，已停止。'); }
    $('thread-badge').textContent = `${pocket.threads} threads`;
  } else {
    inferenceWorker = selected.family === 'sherpa' ? new Worker(assetURL('/sherpa/worker.js')) : selected.family === 'omni'
      ? new Worker(new URL('./omni.worker.js', import.meta.url), { type: 'module' })
      : new Worker(new URL('./tts.worker.js', import.meta.url), { type: 'module' });
    const ready = await workerRequest({ type: 'load', model: selected.id }, 'ready');
    if (ready.device !== 'wasm' || ready.threads > 2) throw new Error('Runtime 未符合 CPU／兩執行緒限制。');
    $('thread-badge').textContent = `${ready.threads} threads`;
  }
  loadedId = selected.id;
  $('load').textContent = '已載入 ✓';
  status(`${selected.name} 已就緒 · 瀏覽器 CPU · ${isStreamingModel(selected) ? pocket.threads : selected.threads || 2} 個推論執行緒`);
}
function workerRequest(payload, completion) {
  const worker = inferenceWorker;
  return new Promise((resolve, reject) => {
    worker.onmessage = ({ data }) => {
      if (data.type === 'progress') progress(data.message);
      else if (data.type === 'step') progress(`${selected.name} 生成中 · ${data.step} / ${data.total} 步`, data.step / data.total * 100);
      else if (data.type === completion) resolve(data);
      else if (data.type === 'error') reject(new Error(data.message));
    };
    worker.onerror = e => reject(new Error(e.message || '模型 worker 意外終止；可能是瀏覽器記憶體不足。'));
    worker.postMessage(payload);
  });
}
async function withBusy(action) {
  if (busy) return;
  const token = ++generationToken;
  setBusy(true);
  try { await action(token); }
  catch (e) { if (token === generationToken) { dispose(); status(e.message || String(e), 'error'); } }
  finally {
    if (token === generationToken) setBusy(false);
    if (!busy) await updateDownloads();
  }
}
$('load').onclick = () => withBusy(async token => { await loadModel(); });
$('generate').onclick = () => withBusy(async token => {
  const text = $('text').value.trim();
  if (!text) throw new Error('請先輸入要生成語音的文字。');
  if (!selected.languages && /[\u3400-\u9fff]/u.test(text)) throw new Error('這個 checkpoint 是英文模型。中文請選擇 Matcha、ZipVoice、Qwen 或 OmniVoice。');
  if (selected.family === 'supertonic' && /[\u3400-\u9fff]/u.test(text) && $('language').value !== 'ja') throw new Error('Supertonic 3 不含中文。日文請先選擇日本語；中文請選擇 Matcha、ZipVoice、Qwen 或 OmniVoice。');
  if (selected.id === 'matcha' && !/[\u3400-\u9fff]/u.test(text)) throw new Error('Matcha Baker 是中文 checkpoint，請輸入中文。');
  const seed = Number($('seed').value);
  if (!Number.isInteger(seed) || seed < 0 || seed > 4294967295) throw new Error('種子請輸入 0 到 4294967295 之間的整數。');
  if (selected.family === 'omni' && text.length > 350) throw new Error('OmniVoice 目前每次最多 350 字元，避免兩核心瀏覽器推論超出記憶體。');
  if (selected.family === 'qwen' && text.length > 200) throw new Error('Qwen3-TTS 目前每次最多 200 字元，請分段生成。');
  const speed = Number($('speed').value);
  if (selected.speed && (!Number.isFinite(speed) || speed < .5 || speed > 2)) throw new Error('語速倍率請輸入 0.5 到 2。');
  await loadModel();
  if (token !== generationToken) return;
  progress(`正在用 ${selected.name} 生成…`);
  const start = performance.now();
  let pcm, sampleRate = selected.sampleRate || 24000, firstMs = null;
  if (isStreamingModel(selected)) {
    controller = new AbortController();
    const stream = pocket.stream(text, { voice: $('voice').value, temperature: Number($('temperature').value), seed, signal: controller.signal });
    const chunks = [];
    for await (const chunk of stream) {
      if (token !== generationToken) return;
      firstMs ??= performance.now() - start;
      chunks.push(chunk);
      status(`生成中 · 已產生 ${(chunks.reduce((n,c) => n + c.length, 0) / sampleRate).toFixed(1)} 秒音訊`, 'busy');
    }
    const stats = await stream.done;
    if (stats.cancelled || token !== generationToken) return;
    pcm = concatPcm(chunks);
  } else {
    const data = await workerRequest({ type: 'generate', text: selected.family === 'sherpa' ? toSimplified(text) : text, seed,
      voice: $('voice').value, speed, language: $('language').value, instruct: $('instruct').value.trim(), steps: Number($('steps').value) }, 'audio');
    pcm = data.pcm; sampleRate = data.sampleRate; firstMs = data.firstMs ?? null;
  }
  if (token !== generationToken) return;
  if (!pcm.length || !pcm.every(Number.isFinite)) throw new Error('模型回傳空白或非有限音訊；已停止輸出，請重試或切換模型。');
  const totalMs = performance.now() - start;
  const entry = { model: selected.name, voice: $('voice').value, language: selected.languages ? $('language').value : 'en', text, pcm, sampleRate, totalMs, firstMs,
    blob: encodeWav(pcm, sampleRate), created: new Date() };
  entries.unshift(entry);
  // Bound retained PCM/WAV memory to the newest eight utterances.
  entries = entries.slice(0, 8);
  showResult(entry); renderHistory();
  status(`已完成 · ${selected.name} · CPU / ${isStreamingModel(selected) ? pocket.threads : selected.threads || 2} threads · 文字與音訊留在瀏覽器`);
});
$('cancel').onclick = () => {
  ++generationToken;
  dispose(); setBusy(false);
  status('已停止並釋放模型記憶體。');
};
$('model').onchange = () => { dispose(); selected = MODELS.find(m => m.id === $('model').value); refreshModel(); };
$('temperature').oninput = () => $('temperature-value').value = Number($('temperature').value).toFixed(2).replace(/0$/, '');
$('text').oninput = () => $('char-count').textContent = `${$('text').value.length.toLocaleString()} / 2,000`;
$('sample').onclick = () => {
  const examples = {
    zh: '你好，歡迎來到語音實驗室。這段聲音完全在瀏覽器裡，使用中央處理器生成。',
    ja: 'こんにちは。音声ラボへようこそ。この音声はブラウザーの中で生成されています。',
    ko: '안녕하세요. 음성 연구실에 오신 것을 환영합니다. 이 음성은 브라우저에서 생성됩니다.',
    de: 'Hallo und willkommen im Sprachlabor. Diese Stimme wird direkt in Ihrem Browser erzeugt.',
    fr: 'Bonjour et bienvenue au laboratoire vocal. Cette voix est créée directement dans votre navigateur.',
    es: 'Hola y bienvenidos al laboratorio de voz. Esta voz se genera directamente en el navegador.',
  };
  $('text').value = (selected.languages && examples[$('language').value]) || 'Hello! Welcome to Voice Lab. This voice is generated entirely in your browser, using only your CPU.';
  $('text').oninput();
};
$('new-session').onclick = () => { $('text').value = ''; $('text').oninput(); $('text').focus(); $('result').classList.add('hidden'); $('audio').pause(); };
document.addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); if (!busy) $('generate').click(); }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); if (!busy) $('new-session').click(); }
});
function showResult(entry) {
  $('audio').pause();
  if (currentUrl) URL.revokeObjectURL(currentUrl);
  currentUrl = URL.createObjectURL(entry.blob);
  $('audio').src = currentUrl;
  $('download').href = currentUrl;
  $('download').download = `${entry.model.replaceAll(' ', '-').toLowerCase()}-${entry.created.getTime()}.wav`;
  $('result').classList.remove('hidden');
  const duration = entry.pcm.length / entry.sampleRate;
  $('result').setAttribute('aria-label', `${entry.model} 生成結果`);
  $('result-meta').textContent = [entry.model, entry.voice, entry.language].filter(Boolean).join(' · ');
  $('metric-time').textContent = `${(entry.totalMs / 1000).toFixed(2)} s`;
  $('metric-duration').textContent = `${duration.toFixed(2)} s`;
  $('metric-rtf').textContent = (entry.totalMs / 1000 / duration).toFixed(2);
  $('metric-first').textContent = entry.firstMs === null ? '整段輸出' : `${(entry.firstMs / 1000).toFixed(2)} s`;
  drawWave(entry.pcm);
}
function drawWave(pcm) {
  const canvas = $('waveform'), ctx = canvas.getContext('2d');
  canvas.width = Math.max(300, canvas.clientWidth) * devicePixelRatio;
  canvas.height = 68 * devicePixelRatio;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const bars = 140, stride = Math.max(1, Math.floor(pcm.length / bars)), width = canvas.width / bars;
  ctx.fillStyle = '#bca5cf';
  for (let i = 0; i < bars; i++) {
    let peak = 0; for (let j = i * stride; j < Math.min(pcm.length, (i + 1) * stride); j++) peak = Math.max(peak, Math.abs(pcm[j]));
    const height = Math.max(3, Math.sqrt(peak) * canvas.height * .82);
    ctx.fillRect(i * width, (canvas.height - height) / 2, Math.max(1, width * .43), height);
  }
}
function renderHistory() {
  $('history').replaceChildren(...entries.map(entry => {
    const button = document.createElement('button'); button.className = 'history-item';
    const title = document.createElement('span'); title.textContent = entry.text.slice(0, 45);
    const detail = document.createElement('small'); detail.textContent = `${entry.model} · ${entry.created.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    button.append(title, detail); button.onclick = () => showResult(entry); return button;
  }));
}
window.addEventListener('beforeunload', () => { dispose(); if (currentUrl) URL.revokeObjectURL(currentUrl); });
refreshModel(); $('text').oninput();

async function updateDownloads() {
  await storageReady;
  const identity = selected.id, state = await storage.state(identity);
  if (selected.id !== identity) return;
  $('download-state').textContent = state.ready ? '已下載 · 可離線執行' : state.saved ? '部分已下載 · 可續傳' : '尚未下載';
  $('download-info').textContent = `${selected.name} · 下載大小 ${formatBytes(state.total)} · 已保存 ${formatBytes(state.saved)}。使用這台裝置的 CPU 與瀏覽器儲存空間。`;
  $('download-model').textContent = state.ready ? '檢查離線檔案' : state.saved ? '繼續下載' : '下載選取模型';
  const estimate = await navigator.storage?.estimate?.();
  const persisted = await navigator.storage?.persisted?.();
  $('storage-info').textContent = `${estimate?.quota ? `此網站來源已用 ${formatBytes(estimate.usage)}，可用約 ${formatBytes(Math.max(0,estimate.quota-estimate.usage))}` : '瀏覽器未提供儲存空間估計'}。${persisted ? '已獲准保留資料。' : '瀏覽器仍可能清理快取；可申請保留離線資料。'}`;
  const rows = [];
  for (const model of MODELS) {
    const saved = await storage.state(model.id);
    const button = document.createElement('button');
    button.setAttribute('aria-current', String(model.id === selected.id));
    button.disabled = busy;
    const label = document.createElement('strong'); label.textContent = model.name;
    const detail = document.createElement('span'); detail.textContent = `${saved.ready ? '✓ ' : ''}${formatBytes(saved.total)}`;
    button.append(label, detail);
    button.onclick = () => { $('model').value = model.id; $('model').onchange(); };
    rows.push(button);
  }
  if (selected.id === identity) $('download-list').replaceChildren(...rows);
}
$('download-model').onclick = () => withBusy(async () => {
  dispose(); controller = new AbortController();
  await storageReady;
  await storage.ensure(selected.id, { signal:controller.signal, progress, family:selected.family });
  await updateDownloads();
  status(`${selected.name} 已下載並驗證，可在這台裝置離線執行。`);
});
$('delete-model').onclick = () => withBusy(async () => {
  dispose(); await storageReady; await storage.remove(selected.id); await updateDownloads();
  status(`已刪除 ${selected.name} 的瀏覽器模型檔案。`);
});
$('persist-storage').onclick = async () => {
  try {
    const granted = await navigator.storage?.persist?.();
    await updateDownloads();
    status(granted ? '瀏覽器已允許保留離線資料；仍可由你主動刪除。' : '瀏覽器未允許保留資料，模型仍可使用，但日後可能被瀏覽器清理。');
  } catch (error) { status(error.message, 'error'); }
};
await storageReady;
let firstDownload = true;
try { firstDownload = !localStorage.getItem('voice-lab-initial-2m-complete'); } catch {}
if (firstDownload && !(await storage.state('2m')).ready) {
  await withBusy(async () => {
    controller = new AbortController();
    await storage.ensure('2m', { signal:controller.signal, progress, family:'pocket' });
    try { localStorage.setItem('voice-lab-initial-2m-complete','1'); } catch {}
    await updateDownloads();
    status('Pocket TTS 2M 已自動下載完成。輸入文字即可在這台裝置生成語音。');
  });
}
