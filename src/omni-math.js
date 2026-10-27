export function getTimeSteps(tStart, tEnd, numStep, tShift) {
  const steps = [];
  for (let i = 0; i <= numStep; i++) {
    const t = tStart + (tEnd - tStart) * i / numStep;
    steps.push(tShift * t / (1 + (tShift - 1) * t));
  }
  return steps;
}

export function computeSchedule(tLen, numCodebook, numStep, timesteps) {
  const totalMask = tLen * numCodebook;
  let rem = totalMask;
  const sched = [];
  for (let step = 0; step < numStep; step++) {
    const num = step === numStep - 1
      ? rem
      : Math.min(Math.ceil(totalMask * (timesteps[step + 1] - timesteps[step])), rem);
    sched.push(num); rem -= num;
  }
  return sched;
}

export function logSoftmax1D(arr, offset, len) {
  let max = -Infinity;
  for (let i = 0; i < len; i++) max = Math.max(max, arr[offset + i]);
  let sum = 0;
  for (let i = 0; i < len; i++) sum += Math.exp(arr[offset + i] - max);
  const logSum = Math.log(sum);
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) out[i] = arr[offset + i] - max - logSum;
  return out;
}

export function topkFlatIndices(scores, k) {
  const indexed = Array.from(scores, (v, i) => [v, i]);
  indexed.sort((a, b) => b[0] - a[0]);
  return indexed.slice(0, k).map(([, i]) => i);
}

export function gumbelSample(logits, temperature) {
  const out = new Float32Array(logits.length);
  for (let i = 0; i < logits.length; i++) {
    const u = Math.random();
    const g = -Math.log(-Math.log(u + 1e-10) + 1e-10);
    out[i] = logits[i] / temperature + g;
  }
  return out;
}

export function argmax1D(arr, offset, len) {
  let best = -Infinity, idx = 0;
  for (let i = 0; i < len; i++) {
    if (arr[offset + i] > best) { best = arr[offset + i]; idx = i; }
  }
  return idx;
}
