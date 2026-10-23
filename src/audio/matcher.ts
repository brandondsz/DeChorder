import { chordTemplate, type ChordDef } from './chords';

export interface ChordTemplate {
  chord: ChordDef;
  template: Float32Array;
}

export interface ChordCandidate {
  chord: ChordDef;
  /** Cosine similarity between the observed chroma and the chord template, 0..1. */
  similarity: number;
  /** Softmax over the candidate set: how strongly this chord wins against the others. */
  probability: number;
}

export function buildTemplates(chords: ChordDef[]): ChordTemplate[] {
  return chords.map((chord) => ({ chord, template: chordTemplate(chord) }));
}

/** Rank chords by similarity to the chroma, best first. */
export function rankChords(
  chroma: Float32Array,
  templates: ChordTemplate[],
  temperature = 0.03,
): ChordCandidate[] {
  let norm = 0;
  for (const x of chroma) norm += x * x;
  norm = Math.sqrt(norm);

  const similarities = templates.map(({ template }) => {
    if (norm === 0) return 0;
    let dot = 0;
    for (let i = 0; i < 12; i++) dot += chroma[i] * template[i];
    return dot / norm;
  });

  const best = Math.max(...similarities);
  const exps = similarities.map((s) => Math.exp((s - best) / temperature));
  const total = exps.reduce((a, b) => a + b, 0);

  return templates
    .map(({ chord }, i) => ({ chord, similarity: similarities[i], probability: exps[i] / total }))
    .sort((a, b) => b.similarity - a.similarity);
}

/**
 * How sure we are about a candidate: it has to both beat the alternatives (probability)
 * and actually resemble the chord (similarity), otherwise a two-chord set would always
 * look confident.
 */
export function confidenceOf(candidate: ChordCandidate): number {
  const fit = Math.min(1, Math.max(0, (candidate.similarity - 0.6) / 0.3));
  return candidate.probability * fit;
}
