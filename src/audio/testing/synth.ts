import { voicingMidi, type ChordDef } from '../chords';

/** Small seeded PRNG so test runs are reproducible. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface StrumOptions {
  sampleRate: number;
  length: number;
  rand: () => number;
  /** Whole-instrument tuning offset in cents. */
  tuningCents?: number;
  /** Per-string random detune range (±), in cents. */
  detuneCents?: number;
  noiseLevel?: number;
}

/** A plucked-string-ish rendering of a voicing: stiff-string overtones with random levels. */
export function synthesizeStrum(chord: ChordDef, opts: StrumOptions): Float32Array {
  const { sampleRate, length, rand, tuningCents = 0, detuneCents = 8, noiseLevel = 0.01 } = opts;
  const out = new Float32Array(length);
  const inharmonicity = 1e-4;
  for (const midi of voicingMidi(chord)) {
    const cents = tuningCents + (rand() * 2 - 1) * detuneCents;
    const f0 = 440 * 2 ** ((midi - 69 + cents / 100) / 12);
    const stringLevel = 0.4 + rand() * 0.6;
    for (let h = 1; h <= 10; h++) {
      const f = h * f0 * Math.sqrt(1 + inharmonicity * h * h);
      if (f > sampleRate / 2) break;
      const amp = stringLevel * 0.65 ** (h - 1) * (0.5 + rand());
      const phase = rand() * 2 * Math.PI;
      const w = (2 * Math.PI * f) / sampleRate;
      for (let n = 0; n < length; n++) out[n] += amp * Math.sin(w * n + phase);
    }
  }
  let peak = 0;
  for (const x of out) peak = Math.max(peak, Math.abs(x));
  for (let n = 0; n < length; n++) out[n] = (out[n] / peak) * 0.5 + (rand() * 2 - 1) * noiseLevel;
  return out;
}

/**
 * Mirror of AnalyserNode.getFloatFrequencyData: Blackman window, FFT, |X|/N in dB.
 * Length must be a power of two.
 */
export function analyserSpectrumDb(signal: Float32Array): Float32Array {
  const n = signal.length;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const x = i / n;
    const w = 0.42 - 0.5 * Math.cos(2 * Math.PI * x) + 0.08 * Math.cos(4 * Math.PI * x);
    re[i] = signal[i] * w;
  }
  fft(re, im);
  const db = new Float32Array(n / 2);
  for (let k = 0; k < n / 2; k++) db[k] = 20 * Math.log10(Math.hypot(re[k], im[k]) / n + 1e-20);
  return db;
}

function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const angle = (-2 * Math.PI) / size;
    const wr = Math.cos(angle);
    const wi = Math.sin(angle);
    for (let start = 0; start < n; start += size) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < size / 2; k++) {
        const a = start + k;
        const b = a + size / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        [cr, ci] = [cr * wr - ci * wi, cr * wi + ci * wr];
      }
    }
  }
}
