import { describe, expect, it } from 'vitest';
import { CHORD_PRESETS, CHORDS_BY_ID, OPEN_CHORDS, type ChordDef } from './chords';
import { spectrumToChroma } from './chroma';
import { buildTemplates, rankChords } from './matcher';
import { ChordStabilizer } from './stabilizer';
import { analyserSpectrumDb, mulberry32, synthesizeStrum } from './testing/synth';

const SAMPLE_RATE = 48000;
const FFT_SIZE = 16384;

function detect(chord: ChordDef, vocabulary: ChordDef[], seed: number, tuningCents = 0) {
  const signal = synthesizeStrum(chord, {
    sampleRate: SAMPLE_RATE,
    length: FFT_SIZE,
    rand: mulberry32(seed),
    tuningCents,
  });
  const { chroma, tuningCents: estimated } = spectrumToChroma(analyserSpectrumDb(signal), SAMPLE_RATE);
  return { ranked: rankChords(chroma, buildTemplates(vocabulary)), estimated };
}

const basics = CHORD_PRESETS[0].chordIds.map((id) => CHORDS_BY_ID.get(id)!);

describe('chord detection on synthesized strums', () => {
  it.each(basics.map((c) => c.id))('recognises %s within the basics set', (id) => {
    const chord = CHORDS_BY_ID.get(id)!;
    for (let seed = 1; seed <= 5; seed++) {
      expect(detect(chord, basics, seed).ranked[0].chord.id).toBe(id);
    }
  });

  it('copes with a guitar tuned 30 cents sharp', () => {
    for (const chord of basics) {
      const { ranked, estimated } = detect(chord, basics, 7, 30);
      expect(ranked[0].chord.id).toBe(chord.id);
      expect(estimated).toBeGreaterThan(15);
      expect(estimated).toBeLessThan(45);
    }
  });

  it('is mostly right across every open chord', () => {
    let correct = 0;
    let total = 0;
    const misses: string[] = [];
    for (const chord of OPEN_CHORDS) {
      for (let seed = 1; seed <= 6; seed++) {
        const top = detect(chord, OPEN_CHORDS, seed * 31).ranked[0].chord.id;
        total++;
        if (top === chord.id) correct++;
        else misses.push(`${chord.id}→${top}`);
      }
    }
    console.log(`full vocabulary: ${correct}/${total}`, misses.join(' '));
    expect(correct / total).toBeGreaterThan(0.85);
  });
});

describe('ChordStabilizer', () => {
  it('commits only after the hold period and keeps the chord through silence', () => {
    const s = new ChordStabilizer(3);
    expect(s.push('G')).toBeNull();
    expect(s.push('G')).toBeNull();
    expect(s.push('G')).toBe('G');
    expect(s.push('C')).toBe('G');
    expect(s.push(null)).toBe('G');
    s.push('C');
    s.push('C');
    expect(s.push('C')).toBe('C');
  });

  it('flags a fresh commit once per held streak, including the same chord after silence', () => {
    const s = new ChordStabilizer(2);
    s.push('G');
    s.push('G');
    expect(s.justCommitted).toBe(true);
    s.push('G');
    expect(s.justCommitted).toBe(false);
    s.push(null);
    s.push('G');
    expect(s.justCommitted).toBe(false);
    s.push('G');
    expect(s.justCommitted).toBe(true);
  });
});
