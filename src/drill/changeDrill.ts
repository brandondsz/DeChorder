export type ChordPair = [string, string];

/**
 * Scores a One-Minute Changes run from committed-chord events. The first chord heard
 * only sets the starting point; each switch to the other chord after that is a change.
 * Times are in the same clock as the events (performance.now()).
 */
export class ChangeDrill {
  private lastChord: string | null = null;
  private lastTime = 0;
  readonly changeTimesMs: number[] = [];

  constructor(
    readonly chords: ChordPair,
    readonly startTime: number,
    readonly durationMs: number,
  ) {}

  get changes(): number {
    return this.changeTimesMs.length;
  }

  get endTime(): number {
    return this.startTime + this.durationMs;
  }

  /** The chord the player should switch to next. */
  get next(): string {
    if (this.lastChord === null) return this.chords[0];
    return this.lastChord === this.chords[0] ? this.chords[1] : this.chords[0];
  }

  get current(): string | null {
    return this.lastChord;
  }

  /** Returns true when the event counted as a change. */
  handleChord(chordId: string, time: number): boolean {
    if (time < this.startTime || time > this.endTime) return false;
    if (!this.chords.includes(chordId) || chordId === this.lastChord) return false;
    const isChange = this.lastChord !== null;
    if (isChange) this.changeTimesMs.push(time - this.lastTime);
    this.lastChord = chordId;
    this.lastTime = time;
    return isChange;
  }
}

export interface ChangeStats {
  averageMs: number | null;
  fastestMs: number | null;
}

export function changeStats(changeTimesMs: number[]): ChangeStats {
  if (changeTimesMs.length === 0) return { averageMs: null, fastestMs: null };
  return {
    averageMs: changeTimesMs.reduce((a, b) => a + b, 0) / changeTimesMs.length,
    fastestMs: Math.min(...changeTimesMs),
  };
}

/** Order-insensitive key: G→C and C→G are the same pair. */
export function pairKey(chords: ChordPair): string {
  return [...chords].sort().join('|');
}

export function changesPerMinute(changes: number, durationSec: number): number {
  return (changes * 60) / durationSec;
}

/** Classic beginner pairings, roughly easiest first. */
export const SUGGESTED_PAIRS: ChordPair[] = [
  ['A', 'D'],
  ['D', 'E'],
  ['A', 'E'],
  ['Em', 'G'],
  ['C', 'G'],
  ['G', 'D'],
  ['Am', 'E'],
  ['C', 'Am'],
  ['Am', 'Dm'],
  ['C', 'F'],
];
