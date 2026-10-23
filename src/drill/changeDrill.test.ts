import { describe, expect, it } from 'vitest';
import { ChangeDrill, changeStats, changesPerMinute, pairKey } from './changeDrill';

describe('ChangeDrill', () => {
  it('counts switches after the first chord, with time per change', () => {
    const drill = new ChangeDrill(['G', 'C'], 1000, 60_000);
    expect(drill.next).toBe('G');
    expect(drill.handleChord('G', 1500)).toBe(false);
    expect(drill.next).toBe('C');
    expect(drill.handleChord('C', 2700)).toBe(true);
    expect(drill.handleChord('G', 3500)).toBe(true);
    expect(drill.changes).toBe(2);
    expect(drill.changeTimesMs).toEqual([1200, 800]);
  });

  it('lets the player start on either chord', () => {
    const drill = new ChangeDrill(['G', 'C'], 0, 60_000);
    drill.handleChord('C', 100);
    expect(drill.next).toBe('G');
    expect(drill.handleChord('G', 900)).toBe(true);
  });

  it('ignores repeats, outside chords, and events outside the time window', () => {
    const drill = new ChangeDrill(['G', 'C'], 1000, 60_000);
    expect(drill.handleChord('G', 500)).toBe(false);
    drill.handleChord('G', 1100);
    expect(drill.handleChord('G', 1200)).toBe(false);
    expect(drill.handleChord('D', 1300)).toBe(false);
    expect(drill.handleChord('C', 61_001)).toBe(false);
    expect(drill.changes).toBe(0);
  });
});

describe('helpers', () => {
  it('summarises change times', () => {
    expect(changeStats([])).toEqual({ averageMs: null, fastestMs: null });
    expect(changeStats([1000, 500, 1500])).toEqual({ averageMs: 1000, fastestMs: 500 });
  });

  it('treats a pair the same in either order and normalises to per minute', () => {
    expect(pairKey(['G', 'C'])).toBe(pairKey(['C', 'G']));
    expect(changesPerMinute(12, 30)).toBe(24);
  });
});
