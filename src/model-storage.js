import { BASE, assetURL } from './paths.js';
import { sha256 } from '@noble/hashes/sha2.js';
export const MODEL_CACHE = 'voice-lab-models:' + BASE;
export const APP_CACHE = 'voice-lab-app:' + BASE;
export const formatBytes = bytes => bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(2)} GB` : `${(bytes / 1024 ** 2).toFixed(1)} MB`;
const keyFor = file => { const url = new URL(assetURL(file.path)); url.searchParams.set('sha', file.sha256); return url.href; };
const hex = bytes => Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2,'0')).join('');

export class ModelStorage {
  async init() {
    const response = await fetch(assetURL('catalog.json'));
    if (!response.ok) throw new Error('無法讀取下載清單。');
    this.catalog = await response.json();
    this.cache = await caches.open(MODEL_CACHE);
    const shell = await (await fetch(assetURL('shell.json'))).json();
    this.shell = shell;
    this.revisions = Object.fromEntries(await Promise.all(Object.entries(this.catalog.models).map(async ([id, model]) => [id, hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([model, shell]))))])));
    return this;
  }
  model(id) {
    const model = this.catalog.models[id];
    if (!model) throw new Error('未知的下載模型。');
    return model;
  }
  async state(id) {
    const model = this.model(id);
    let saved = 0, count = 0, largestMissing = 0;
    const incomplete = new Set();
    for (const file of model.files) {
      const response = await this.cache.match(keyFor(file));
      if (response?.headers.get('X-Asset-SHA256') === file.sha256) { saved += file.bytes; count++; }
      else { incomplete.add(file.sha256); largestMissing = Math.max(largestMissing, file.bytes); }
    }
    const prefix = assetURL(`__chunks__/${id}/`);
    for (const key of await this.cache.keys()) {
      if (!key.url.startsWith(prefix)) continue;
      const hash = key.url.slice(prefix.length).split('/')[0];
      if (incomplete.has(hash)) saved += Number((await this.cache.match(key)).headers.get('Content-Length')) || 0;
    }
    const marker = await this.cache.match(assetURL(`__ready__/${id}/${this.revisions[id]}`));
    return { ready: count === model.files.length && !!marker, saved, total: model.bytes, count, files: model.files.length, largestMissing };
  }
  async fetchData(source, signal, progress) {
    const url = /^https:\/\//.test(source.url) ? source.url : assetURL(source.url);
    let lastError;
    for (let attempt = 0; attempt < 3; attempt++) {
      signal?.throwIfAborted();
      try {
        const response = await fetch(url, { signal, credentials:'omit', mode:'cors', ...(source.range ? { headers:{ Range:source.range } } : {}) });
        if (!response.ok) throw new Error(`下載失敗（HTTP ${response.status}）。`);
        if (source.range && response.status !== 206) throw new Error('下載來源未提供需要的分段回應。');
        const reader = response.body.getReader(), chunks = [];
        let bytes = 0, lastUpdate = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value); bytes += value.length;
          if (bytes > source.bytes) { await reader.cancel(); throw new Error('下載分段大小不符。'); }
          if (performance.now() - lastUpdate > 100) { progress(bytes); lastUpdate = performance.now(); }
        }
        if (bytes !== source.bytes) throw new Error('下載分段不完整。');
        progress(bytes);
        const data = new Uint8Array(bytes); let offset = 0;
        for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length; }
        return data;
      } catch (error) {
        signal?.throwIfAborted(); lastError = error;
        if (attempt < 2) await new Promise(resolve => setTimeout(resolve, (attempt + 1) * 1500));
      }
    }
    throw new Error(`${lastError.message} 已完成的分段已保存，請再按繼續下載。`);
  }
  async ensure(id, { signal, progress, family }) {
    const model = this.model(id);
    const estimate = await navigator.storage?.estimate?.();
    const current = await this.state(id);
    if (estimate?.quota && estimate.quota - estimate.usage < (model.bytes - current.saved + current.largestMissing) * 1.05) throw new Error('瀏覽器可用空間不足。分段組合時需要額外暫存空間，請刪除模型或釋放裝置空間。');
    let completed = 0;
    for (const file of model.files) {
      signal?.throwIfAborted();
      const key = keyFor(file), old = await this.cache.match(key);
      if (old?.headers.get('X-Asset-SHA256') === file.sha256) { completed += file.bytes; continue; }
      const segmentSize = 8 * 1024 * 1024;
      const sources = file.parts || (file.bytes > segmentSize * 2 ? Array.from({length:Math.ceil(file.bytes/segmentSize)}, (_, i) => {
        const start = i * segmentSize, end = Math.min(file.bytes, start + segmentSize) - 1;
        return { url:file.url, bytes:end-start+1, range:`bytes=${start}-${end}` };
      }) : [{url:file.url,bytes:file.bytes}]);
      let partBytes = 0; const chunkKeys = [], hasher = sha256.create();
      for (let i = 0; i < sources.length; i++) {
        signal?.throwIfAborted();
        const source = sources[i], chunkKey = assetURL(`__chunks__/${id}/${file.sha256}/${i}`);
        let cached = await this.cache.match(chunkKey), data;
        if (cached && Number(cached.headers.get('Content-Length')) === source.bytes) data = new Uint8Array(await cached.arrayBuffer());
        else {
          data = await this.fetchData(source, signal, count => progress?.(`下載 ${file.path.split('/').at(-1)} · ${formatBytes(completed + partBytes + count)} / ${formatBytes(model.bytes)}`, (completed + partBytes + count) / model.bytes * 100));
          signal?.throwIfAborted();
          await this.cache.put(chunkKey, new Response(data, {headers:{'Content-Length':String(data.length)}}));
        }
        hasher.update(data); chunkKeys.push(chunkKey); partBytes += data.length;
      }
      progress?.(`驗證 ${file.path.split('/').at(-1)}…`, completed / model.bytes * 100);
      const checksum = hex(hasher.digest());
      if (checksum !== file.sha256) {
        for (const chunk of chunkKeys) await this.cache.delete(chunk);
        throw new Error('模型 SHA-256 驗證失敗，損壞的分段已刪除，請重試。');
      }
      signal?.throwIfAborted();
      const cache = this.cache; let index = 0;
      const stream = new ReadableStream({ async pull(output) {
        try {
          signal?.throwIfAborted();
          if (index === chunkKeys.length) { output.close(); return; }
          const chunk = await cache.match(chunkKeys[index++]);
          if (!chunk) throw new Error('模型分段已被瀏覽器清理，請重新下載。');
          output.enqueue(new Uint8Array(await chunk.arrayBuffer()));
        } catch(error) { output.error(error); }
      }});
      await this.cache.put(key, new Response(stream, { headers:{ 'Content-Type':file.path.endsWith('.json') ? 'application/json' : 'application/octet-stream', 'Content-Length':String(file.bytes), 'X-Asset-SHA256':checksum } }));
      for (const chunk of chunkKeys) await this.cache.delete(chunk);
      completed += file.bytes;
    }
    // Cache the matching JS and CPU runtime as well, so a completed download can run offline.
    const runtime = await (await fetch(assetURL('runtimes.json'))).json();
    const group = ['pocket','phonon'].includes(family) ? 'pocket' : family === 'sherpa' ? 'sherpa' : 'onnx';
    const resources = [...this.shell, ...runtime[group], ...(['kokoro','kitten','piper'].includes(family) ? runtime.phonemizer : [])];
    const app = await caches.open(APP_CACHE);
    for (const path of resources) {
      signal?.throwIfAborted();
      const url = assetURL(path);
      if (await app.match(url)) continue;
      progress?.('保存本機 CPU 推論程式，供離線使用…', 100);
      const response = await fetch(url, { signal });
      if (!response.ok) throw new Error('CPU 推論程式下載失敗，請再按下載完成準備。');
      await app.put(url, response);
    }
    await this.cache.put(assetURL(`__ready__/${id}/${this.revisions[id]}`), new Response('ready'));
  }
  async remove(id) {
    const paths = new Set(this.model(id).files.map(file => assetURL(file.path)));
    for (const key of await this.cache.keys()) { const url = new URL(key.url); url.search = ''; if (paths.has(url.href) || url.href.startsWith(assetURL(`__ready__/${id}/`)) || url.href.startsWith(assetURL(`__chunks__/${id}/`))) await this.cache.delete(key); }
  }
}
