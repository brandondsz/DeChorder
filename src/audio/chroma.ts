import { normalize } from './chords';

/** Below the low E string (82 Hz) there is only rumble. */
export const CHROMA_MIN_HZ = 75;
/** Covers the first several overtones of the high e string. */
export const CHROMA_MAX_HZ = 2500;
/** Peaks quieter than this (relative to the loudest one) are treated as noise. */
const PEAK_RANGE_DB = 40;
/** Spread of a peak's contribution around its nearest semitone, in semitones. */
const PITCH_SIGMA = 0.25;

export interface ChromaResult {
  chroma: Float32Array;
  /** Estimated deviation of the instrument from A440, in cents. */
  tuningCents: number;
  peakCount: number;
}

interface Peak {
  midi: number;
  weight: number;
}

/**
 * Fold a dB magnitude spectrum (as produced by AnalyserNode.getFloatFrequencyData)
 * into a 12-bin, unit-length pitch-class profile.
 */
export function spectrumToChroma(
  spectrumDb: Float32Array,
  sampleRate: number,
  out: Float32Array = new Float32Array(12),
): ChromaResult {
  const binHz = sampleRate / (spectrumDb.length * 2);
  const kMin = Math.max(1, Math.ceil(CHROMA_MIN_HZ / binHz));
  const kMax = Math.min(spectrumDb.length - 2, Math.floor(CHROMA_MAX_HZ / binHz));

  let maxDb = -Infinity;
  for (let k = kMin; k <= kMax; k++) if (spectrumDb[k] > maxDb) maxDb = spectrumDb[k];
  const thresholdDb = maxDb - PEAK_RANGE_DB;

  const peaks: Peak[] = [];
  for (let k = kMin; k <= kMax; k++) {
    const b = spectrumDb[k];
    if (!(b > thresholdDb) || b <= spectrumDb[k - 1] || b < spectrumDb[k + 1]) continue;
    const a = spectrumDb[k - 1];
    const c = spectrumDb[k + 1];
    // Parabolic interpolation gives sub-bin frequency precision.
    const denom = a - 2 * b + c;
    const p = Number.isFinite(a) && Number.isFinite(c) && denom !== 0 ? (0.5 * (a - c)) / denom : 0;
    const peakDb = b - 0.25 * (a - c) * p;
    const freq = (k + p) * binHz;
    // sqrt of linear magnitude: keeps loud fundamentals from drowning out the rest.
    const weight = Math.sqrt(10 ** (Number.isFinite(peakDb) ? peakDb / 20 : b / 20));
    peaks.push({ midi: 69 + 12 * Math.log2(freq / 440), weight });
  }

  // Estimate how far the guitar sits from A440 (circular mean of semitone deviations),
  // so a slightly sharp or flat instrument still lands in the right bins.
  let sx = 0;
  let sy = 0;
  for (const { midi, weight } of peaks) {
    const angle = 2 * Math.PI * (midi - Math.round(midi));
    sx += weight * Math.cos(angle);
    sy += weight * Math.sin(angle);
  }
  const offset = peaks.length >= 3 ? Math.atan2(sy, sx) / (2 * Math.PI) : 0;

  out.fill(0);
  for (const { midi, weight } of peaks) {
    const tuned = midi - offset;
    const nearest = Math.round(tuned);
    const deviation = (tuned - nearest) / PITCH_SIGMA;
    out[((nearest % 12) + 12) % 12] += weight * Math.exp(-0.5 * deviation * deviation);
  }
  normalize(out);

  return { chroma: out, tuningCents: offset * 100, peakCount: peaks.length };
}
