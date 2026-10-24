import { describe, expect, it } from 'vitest';
import { COMMIT_GRACE_MS } from '../drill/rhythm';
import { parseSong } from './chordpro';
import { SongRun, summarizeSong, type SongHit } from './songRun';

// 60 BPM in 4/4: one beat = 1000 ms; the count-in is one bar (4000 ms).
const song = parseSong(`{tempo: 60}
[Verse]
[G]One [C]two
[Chorus]
[D:2]Three [G:2]four [N.C.:2] [G:2]`);

describe('SongRun timeline', () => {
  it('lays chords out after a one-bar count-in and scores only real changes', () => {
    const run = new SongRun(song, { bpm: 60, latencyMs: 0 }, 0);
    expect(run.countInBeats).toBe(4);
    expect(run.steps.map((s) => [s.chord, s.beat, s.scored])).toEqual([
      ['G', 4, false],
      ['C', 8, true],
      ['D', 12, true],
      ['G', 14, true],
      [null, 16, false],
      // Same chord as before the rest: nothing changes, so nothing to score.
      ['G', 18, false],
    ]);
    expect(run.totalBeats).toBe(20);
    expect(run.endTime).toBe(20000);
  });

  it('can loop a single section', () => {
    const run = new SongRun(song, { bpm: 60, latencyMs: 0, sections: [1], repeats: 2 }, 0);
    expect(run.steps.map((s) => s.chord)).toEqual(['D', 'G', null, 'G', 'D', 'G', null, 'G']);
    // Back to D after the loop is a change too.
    expect(run.steps[4]).toMatchObject({ from: 'G', scored: true });
  });
});

describe('SongRun grading', () => {
  it('grades strums against the beat with latency correction', () => {
    const run = new SongRun(song, { bpm: 60, latencyMs: 100 }, 0);
    expect(run.handleChord('C', 8150)).toMatchObject({ chord: 'C', from: 'G', grade: 'perfect', offsetMs: 50 });
    expect(run.handleChord('D', 12450)).toMatchObject({ grade: 'late', offsetMs: 350 });
  });

  it('misses a change only after its window and the commit grace', () => {
    const run = new SongRun(song, { bpm: 60, latencyMs: 0 }, 0);
    // C at 8000 ms lasts 4 beats, so its late window is 700 ms.
    expect(run.tick(8000 + 700 + COMMIT_GRACE_MS)).toEqual([]);
    expect(run.tick(8000 + 701 + COMMIT_GRACE_MS).map((h) => h.chord)).toEqual(['C']);
  });
});

describe('summarizeSong', () => {
  const hit = (section: number, grade: SongHit['grade']): SongHit => ({
    step: 0,
    section,
    chord: 'G',
    from: 'C',
    grade,
    offsetMs: grade === 'miss' ? null : 0,
  });

  it('counts stalls as runs of two or more misses, and rates sections', () => {
    const summary = summarizeSong([
      hit(0, 'perfect'),
      hit(0, 'miss'),
      hit(0, 'miss'),
      hit(0, 'miss'),
      hit(1, 'good'),
      hit(1, 'miss'),
      hit(1, 'late'),
      hit(1, 'miss'),
      hit(1, 'miss'),
    ]);
    expect(summary.stalls).toBe(2);
    expect(summary.landed).toBe(3);
    expect(summary.clean).toBe(2);
    expect(summary.sections).toEqual([
      { section: 0, changes: 4, clean: 1, rating: 'work' },
      { section: 1, changes: 5, clean: 1, rating: 'work' },
    ]);
  });
});
