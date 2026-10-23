import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../audio/testing/synth';
import { makePicker, REACTION_TIMEOUT_MS, ReactionRun, transitionKey, transitionStats, type PickNext } from './reaction';

/** Deterministic picker cycling through a fixed list. */
function scripted(sequence: string[]): PickNext {
  let i = 0;
  return () => sequence[i++ % sequence.length];
}

describe('ReactionRun', () => {
  it('treats the first prompt as an untimed warm-up, then times each prompt', () => {
    const run = new ReactionRun(2, scripted(['G', 'C', 'D']), 0);
    expect(run.target).toBe('G');
    expect(run.from).toBeNull();
    expect(run.handleChord('G', 400)).toBe(true);
    expect(run.rounds).toEqual([]);
    expect(run.target).toBe('C');
    expect(run.from).toBe('G');
    run.handleChord('C', 1300);
    run.handleChord('D', 2000);
    expect(run.rounds).toEqual([
      { from: 'G', to: 'C', ms: 900 },
      { from: 'C', to: 'D', ms: 700 },
    ]);
    expect(run.done).toBe(true);
  });

  it('ignores wrong chords but records the miss on timeout', () => {
    const run = new ReactionRun(5, scripted(['G', 'C', 'D']), 0);
    run.handleChord('G', 100);
    expect(run.handleChord('D', 500)).toBe(false);
    expect(run.tick(100 + REACTION_TIMEOUT_MS - 1)).toBe(false);
    expect(run.tick(100 + REACTION_TIMEOUT_MS)).toBe(true);
    expect(run.rounds).toEqual([{ from: 'G', to: 'C', ms: null }]);
    // The player was last on D, so the next round is timed from D.
    expect(run.from).toBe('D');
  });

  it('does not time out during the warm-up', () => {
    const run = new ReactionRun(3, scripted(['G', 'C']), 0);
    expect(run.tick(REACTION_TIMEOUT_MS * 3)).toBe(false);
    expect(run.rounds).toEqual([]);
  });
});

describe('transitionStats', () => {
  it('averages the recent attempts per transition, counting misses as the timeout', () => {
    const stats = transitionStats([
      { from: 'G', to: 'C', ms: 1000 },
      { from: 'G', to: 'C', ms: null },
      { from: 'C', to: 'G', ms: 500 },
    ]);
    expect(stats.get(transitionKey('G', 'C'))).toMatchObject({
      meanMs: (1000 + REACTION_TIMEOUT_MS) / 2,
      attempts: 2,
      misses: 1,
    });
    expect(stats.get(transitionKey('C', 'G'))?.meanMs).toBe(500);
  });
});

describe('makePicker', () => {
  it('never repeats the current chord', () => {
    const pick = makePicker(['C', 'G', 'D'], () => new Map(), false, mulberry32(1));
    for (let i = 0; i < 50; i++) expect(pick('G')).not.toBe('G');
  });

  it('favours slow transitions when focusing on weak changes', () => {
    const stats = transitionStats([
      { from: 'G', to: 'C', ms: 3000 },
      { from: 'G', to: 'D', ms: 600 },
    ]);
    const pick = makePicker(['G', 'C', 'D'], () => stats, true, mulberry32(2));
    let slow = 0;
    for (let i = 0; i < 1000; i++) if (pick('G') === 'C') slow++;
    // Weights 3000² vs 600² → C should come up ~96% of the time.
    expect(slow).toBeGreaterThan(900);
  });
});
