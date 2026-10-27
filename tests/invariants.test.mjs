import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeWav } from '../src/audio.js';
import { computeSchedule, getTimeSteps, logSoftmax1D } from '../src/omni-math.js';
import { MODELS, pocketSpec } from '../src/models.js';

test('all fifteen required models are distinct and Pocket checkpoints never alias the default', () => {
  assert.deepEqual(MODELS.map(m => m.id), ['100m', '18m', '7m', '2m', 'omnivoice', 'kokoro', 'kitten-nano', 'kitten-micro', 'kitten-mini', 'piper', 'supertonic', 'phonon', 'matcha', 'zipvoice', 'qwen']);
  assert.equal(new Set(MODELS.map(m => m.id)).size, 15);
  assert.equal(new Set(MODELS.filter(m => m.family === 'pocket').map(m => m.checkpoint)).size, 4);
  assert.throws(() => pocketSpec('omnivoice'));
});
test('masked diffusion schedules fill every codebook exactly, even for short audio', () => {
  for (const frames of [1, 10, 50, 200]) for (const steps of [8, 16, 32]) {
    const times = getTimeSteps(0, 1, steps, .1);
    const schedule = computeSchedule(frames, 8, steps, times);
    assert.ok(schedule.every(n => Number.isInteger(n) && n >= 0));
    assert.equal(schedule.reduce((a, b) => a + b, 0), frames * 8);
  }
});
test('log softmax remains normalized for extreme logits', () => {
  const result = logSoftmax1D(new Float32Array([10000, 10001, -10000]), 0, 3);
  assert.ok(result.every(Number.isFinite));
  assert.ok(Math.abs(result.reduce((s, x) => s + Math.exp(x), 0) - 1) < 1e-5);
});
test('WAV output has mono PCM16 header, correct duration and clips overflow safely', async () => {
  const samples = new Float32Array([-2, -1, 0, 1, 2]);
  const v = new DataView(await encodeWav(samples).arrayBuffer());
  assert.equal(v.getUint32(24, true), 24000);
  assert.equal(v.getUint16(22, true), 1);
  assert.equal(v.getUint32(40, true), 10);
  assert.equal(v.getInt16(44, true), -32768);
  assert.equal(v.getInt16(52, true), 32767);
});
