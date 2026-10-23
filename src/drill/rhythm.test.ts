import { describe, expect, it } from 'vitest';
import { calibrate, COMMIT_GRACE_MS, COUNT_IN_BEATS, gradeFor, RhythmRun, summarizeHits, type RhythmConfig } from './rhythm';

const config: RhythmConfig = { chords: ['G', 'C'], beatsPerChord: 2, startBpm: 60, loops: 3, speedUp: true };
// At 60 BPM a beat is 1000 ms; the count-in ends at 4000 ms.

describe('RhythmRun timeline', () => {
  it('lays out the count-in and the first loop', () => {
    const run = new RhythmRun(config, 0, 0);
    expect(run.totalBeats).toBe(COUNT_IN_BEATS + 3 * 4);
    expect(run.beatTime(0)).toBe(0);
    expect(run.beatTime(4)).toBe(4000);
    expect(run.beatTime(7)).toBe(7000);
    // Loop 1 starts once loop 0 is known, but its inner beats need loop 1's tempo.
    expect(run.beatTime(8)).toBe(8000);
    expect(run.beatTime(9)).toBeNull();
    expect(run.beatAt(5500)).toBeCloseTo(5.5);
  });

  it('only scores real changes', () => {
    const run = new RhythmRun({ ...config, chords: ['G', 'G', 'C'] }, 0, 0);
    expect(run.targets.slice(0, 4).map((t) => t.scored)).toEqual([false, false, true, true]);
  });
});

describe('RhythmRun grading', () => {
  it('grades the strum against the beat, after latency correction', () => {
    const run = new RhythmRun(config, 0, 50);
    // C is due at beat 6 = 6000 ms. Strum heard at 6100 with 50 ms latency → +50 ms.
    expect(run.handleChord('C', 6100)).toMatchObject({ chord: 'C', from: 'G', grade: 'perfect', offsetMs: 50 });
    // The same target can't be graded twice.
    expect(run.handleChord('C', 6150)).toBeNull();
  });

  it('marks unplayed changes as missed once the window and commit grace pass', () => {
    const run = new RhythmRun(config, 0, 0);
    // Due at 6000, late window 700 ms, then the commit grace.
    expect(run.tick(6000 + 700 + COMMIT_GRACE_MS)).toEqual([]);
    expect(run.tick(6000 + 701 + COMMIT_GRACE_MS).map((h) => h.grade)).toEqual(['miss']);
  });

  it('still grades a late strum whose chord is confirmed after the window', () => {
    const run = new RhythmRun(config, 0, 0);
    run.tick(6900); // window closed, grace still running
    expect(run.handleChord('C', 6600)).toMatchObject({ grade: 'late', offsetMs: 600 });
  });

  it('speeds up after a clean loop and holds tempo after a sloppy one', () => {
    const run = new RhythmRun(config, 0, 0);
    run.handleChord('C', 6020); // loop 0's only scored change: clean
    run.tick(7100);
    expect(run.loopBpms).toEqual([60, 65]);

    const sloppy = new RhythmRun(config, 0, 0);
    sloppy.handleChord('C', 6400); // late
    sloppy.tick(7100);
    expect(sloppy.loopBpms).toEqual([60, 60]);
  });

  it('applies the new tempo to the following loop', () => {
    const run = new RhythmRun(config, 0, 0);
    run.handleChord('C', 6000);
    run.tick(7100);
    // Loop 1 starts at 8000 ms at 65 BPM.
    expect(run.beatTime(9)).toBeCloseTo(8000 + 60000 / 65);
    expect(run.topCleanBpm()).toBe(60);
  });
});

describe('helpers', () => {
  it('grades offsets', () => {
    expect(gradeFor(-80)).toBe('perfect');
    expect(gradeFor(150)).toBe('good');
    expect(gradeFor(-260)).toBe('early');
    expect(gradeFor(260)).toBe('late');
  });

  it('summarises hits with streaks and timing tendency', () => {
    const s = summarizeHits([
      { chord: 'C', from: 'G', loop: 0, bpm: 60, grade: 'perfect', offsetMs: 40 },
      { chord: 'G', from: 'C', loop: 0, bpm: 60, grade: 'good', offsetMs: 120 },
      { chord: 'C', from: 'G', loop: 1, bpm: 60, grade: 'miss', offsetMs: null },
      { chord: 'G', from: 'C', loop: 1, bpm: 60, grade: 'perfect', offsetMs: -10 },
    ]);
    expect(s.accuracy).toBe(0.75);
    expect(s.bestStreak).toBe(2);
    // Median of 40, 120, -10.
    expect(s.typicalOffsetMs).toBe(40);
  });

  it('calibrates from the median strum offset, ignoring the listen-in', () => {
    const clicks = Array.from({ length: 12 }, (_, i) => i * 600);
    const onsets = clicks.slice(4).map((c, i) => c + 80 + (i % 2 ? 10 : -10));
    expect(calibrate(clicks, onsets)).toMatchObject({ latencyMs: 80, matched: 8 });
    expect(calibrate(clicks, onsets.slice(0, 3))).toBeNull();
  });
});
