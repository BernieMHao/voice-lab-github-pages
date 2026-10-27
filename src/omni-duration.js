const WEIGHTS = {
  cjk:3.0,hangul:2.5,kana:2.2,ethiopic:3.0,yi:3.0,
  indic:1.8,thai_lao:1.5,khmer_myanmar:1.8,arabic:1.5,hebrew:1.5,
  latin:1.0,cyrillic:1.0,greek:1.0,armenian:1.0,georgian:1.0,
  punctuation:0.5,space:0.2,digit:3.5,mark:0.0,default:1.0,
};

const RANGES = [
  [0x02AF,"latin"],[0x03FF,"greek"],[0x052F,"cyrillic"],[0x058F,"armenian"],
  [0x05FF,"hebrew"],[0x077F,"arabic"],[0x089F,"arabic"],[0x08FF,"arabic"],
  [0x097F,"indic"],[0x09FF,"indic"],[0x0A7F,"indic"],[0x0AFF,"indic"],
  [0x0B7F,"indic"],[0x0BFF,"indic"],[0x0C7F,"indic"],[0x0CFF,"indic"],
  [0x0D7F,"indic"],[0x0DFF,"indic"],[0x0EFF,"thai_lao"],[0x0FFF,"indic"],
  [0x109F,"khmer_myanmar"],[0x10FF,"georgian"],[0x11FF,"hangul"],
  [0x137F,"ethiopic"],[0x139F,"ethiopic"],[0x13FF,"default"],[0x167F,"default"],
  [0x169F,"default"],[0x16FF,"default"],[0x171F,"default"],[0x173F,"default"],
  [0x175F,"default"],[0x177F,"default"],[0x17FF,"khmer_myanmar"],
  [0x18AF,"default"],[0x18FF,"default"],[0x194F,"indic"],[0x19DF,"indic"],
  [0x19FF,"khmer_myanmar"],[0x1A1F,"indic"],[0x1AAF,"indic"],[0x1B7F,"indic"],
  [0x1BBF,"indic"],[0x1BFF,"indic"],[0x1C4F,"indic"],[0x1C7F,"indic"],
  [0x1C8F,"cyrillic"],[0x1CBF,"georgian"],[0x1CCF,"indic"],[0x1CFF,"indic"],
  [0x1D7F,"latin"],[0x1DBF,"latin"],[0x1DFF,"default"],[0x1EFF,"latin"],
  [0x309F,"kana"],[0x30FF,"kana"],[0x312F,"cjk"],[0x318F,"hangul"],
  [0x9FFF,"cjk"],[0xA4CF,"yi"],[0xA4FF,"default"],[0xA63F,"default"],
  [0xA69F,"cyrillic"],[0xA6FF,"default"],[0xA7FF,"latin"],[0xA82F,"indic"],
  [0xA87F,"default"],[0xA8DF,"indic"],[0xA8FF,"indic"],[0xA92F,"indic"],
  [0xA95F,"indic"],[0xA97F,"hangul"],[0xA9DF,"indic"],[0xA9FF,"khmer_myanmar"],
  [0xAA5F,"indic"],[0xAA7F,"khmer_myanmar"],[0xAADF,"indic"],[0xAAFF,"indic"],
  [0xAB2F,"ethiopic"],[0xAB6F,"latin"],[0xABBF,"default"],[0xABFF,"indic"],
  [0xD7AF,"hangul"],[0xFAFF,"cjk"],[0xFDFF,"arabic"],[0xFE6F,"default"],
  [0xFEFF,"arabic"],[0xFFEF,"latin"],
];
const BREAKPOINTS = RANGES.map(r => r[0]);

function bisectLeft(arr, val) {
  let lo = 0, hi = arr.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; arr[mid] < val ? lo = mid + 1 : hi = mid; }
  return lo;
}

export function charWeight(ch) {
  const code = ch.codePointAt(0);
  if ((code >= 65 && code <= 90) || (code >= 97 && code <= 122)) return WEIGHTS.latin;
  if (code === 32) return WEIGHTS.space;
  if (code === 0x0640) return WEIGHTS.mark;
  if (/\p{M}/u.test(ch)) return WEIGHTS.mark;
  if (/\p{P}|\p{S}/u.test(ch)) return WEIGHTS.punctuation;
  if (/\p{Z}/u.test(ch)) return WEIGHTS.space;
  if (/\p{N}/u.test(ch)) return WEIGHTS.digit;
  const idx = bisectLeft(BREAKPOINTS, code);
  if (idx < RANGES.length) return WEIGHTS[RANGES[idx][1]] ?? WEIGHTS.default;
  if (code > 0x20000) return WEIGHTS.cjk;
  return WEIGHTS.default;
}

export function totalWeight(text) {
  return [...text].reduce((s, c) => s + charWeight(c), 0);
}

export function estimateDuration(targetText, refText, refDuration, lowThreshold = 50, boostStrength = 3) {
  if (refDuration <= 0 || !refText) return 0;
  const refW = totalWeight(refText);
  if (refW === 0) return 0;
  const speedFactor = refW / refDuration;
  const targetW = totalWeight(targetText);
  const est = targetW / speedFactor;
  if (lowThreshold != null && est < lowThreshold) {
    return lowThreshold * Math.pow(est / lowThreshold, 1.0 / boostStrength);
  }
  return est;
}
