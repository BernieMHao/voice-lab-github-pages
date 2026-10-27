const TARGET_SR = 24000;

export async function decodeAudioFile(file) {
  const ctx = new OfflineAudioContext(1, 1, TARGET_SR);
  const buf = await file.arrayBuffer();
  const decoded = await ctx.decodeAudioData(buf);
  const numFrames = decoded.length;
  const offCtx = new OfflineAudioContext(1, Math.round(numFrames * TARGET_SR / decoded.sampleRate), TARGET_SR);
  const src = offCtx.createBufferSource();
  src.buffer = decoded;
  src.connect(offCtx.destination);
  src.start(0);
  const resampled = await offCtx.startRendering();
  return resampled.getChannelData(0);
}

export function encodeWAV(samples, sampleRate) {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buf);
  const str = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); view.setUint32(4, 36 + samples.length * 2, true);
  str(8, 'WAVE'); str(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true);
  view.setUint16(34, 16, true); str(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }
  return new Uint8Array(buf);
}

export function downloadWAV(samples, sampleRate, filename = 'output.wav') {
  const wav = encodeWAV(samples, sampleRate);
  const blob = new Blob([wav], { type: 'audio/wav' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function playAudio(samples, sampleRate) {
  const ctx = new AudioContext();
  const buf = ctx.createBuffer(1, samples.length, sampleRate);
  buf.copyToChannel(samples, 0);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(ctx.destination);
  src.start(0);
  return new Promise(resolve => { src.onended = resolve; });
}

export function rmsNormalize(samples, targetRms) {
  const rms = Math.sqrt(samples.reduce((s, x) => s + x * x, 0) / samples.length);
  if (rms > 1e-6) {
    const scale = targetRms / rms;
    for (let i = 0; i < samples.length; i++) samples[i] *= scale;
  }
  return samples;
}
