/** A prompt not played within this long counts as a miss and moves on. */
export const REACTION_TIMEOUT_MS = 6000;
/** Only the most recent attempts at a transition count, so improvement shows up. */
const RECENT_ATTEMPTS = 10;

export interface ReactionRound {
  from: string;
  to: string;
  /** Time from prompt to the target chord being heard; null when missed. */
  ms: number | null;
}

export type PickNext = (from: string | null) => string;

/**
 * One Reaction Mode run. The first prompt is an untimed warm-up (there's no chord to
 * change from yet); after that each prompt is timed from when it appears until the
 * target chord is committed by the detector.
 */
export class ReactionRun {
  readonly rounds: ReactionRound[] = [];
  private held: string | null = null;
  private roundFrom: string | null = null;
  private targetId: string;
  private shownAtMs: number;

  constructor(
    readonly totalRounds: number,
    private readonly pickNext: PickNext,
    now: number,
    readonly timeoutMs = REACTION_TIMEOUT_MS,
  ) {
    this.targetId = pickNext(null);
    this.shownAtMs = now;
  }

  get target(): string {
    return this.targetId;
  }

  get shownAt(): number {
    return this.shownAtMs;
  }

  /** The chord the player is changing from; null during the warm-up. */
  get from(): string | null {
    return this.roundFrom;
  }

  get done(): boolean {
    return this.rounds.length >= this.totalRounds;
  }

  /** Returns true if the event completed the current prompt. */
  handleChord(chordId: string, time: number): boolean {
    if (this.done) return false;
    this.held = chordId;
    if (chordId !== this.targetId) return false;
    if (this.roundFrom !== null) {
      this.rounds.push({ from: this.roundFrom, to: this.targetId, ms: time - this.shownAtMs });
    }
    this.advance(time);
    return true;
  }

  /** Call regularly; returns true if the current prompt timed out. */
  tick(now: number): boolean {
    if (this.done || this.roundFrom === null || now - this.shownAtMs < this.timeoutMs) return false;
    this.rounds.push({ from: this.roundFrom, to: this.targetId, ms: null });
    this.advance(now);
    return true;
  }

  private advance(now: number): void {
    if (this.done) return;
    this.roundFrom = this.held;
    this.targetId = this.pickNext(this.held);
    this.shownAtMs = now;
  }
}

export interface TransitionStat {
  from: string;
  to: string;
  /** Mean of recent attempts, with misses counted as the timeout. */
  meanMs: number;
  attempts: number;
  misses: number;
}

export const transitionKey = (from: string, to: string) => `${from}>${to}`;

/** Per-transition stats from rounds ordered oldest first. */
export function transitionStats(rounds: ReactionRound[]): Map<string, TransitionStat> {
  const byKey = new Map<string, ReactionRound[]>();
  for (const r of rounds) {
    const key = transitionKey(r.from, r.to);
    const list = byKey.get(key) ?? [];
    list.push(r);
    byKey.set(key, list);
  }
  const stats = new Map<string, TransitionStat>();
  for (const [key, list] of byKey) {
    const recent = list.slice(-RECENT_ATTEMPTS);
    const total = recent.reduce((sum, r) => sum + (r.ms ?? REACTION_TIMEOUT_MS), 0);
    stats.set(key, {
      from: recent[0].from,
      to: recent[0].to,
      meanMs: total / recent.length,
      attempts: recent.length,
      misses: recent.filter((r) => r.ms === null).length,
    });
  }
  return stats;
}

/**
 * Chooses the next chord, never repeating the current one. With `focusWeak`, slower
 * transitions come up more often (weight ∝ mean time²), and untried ones are treated as
 * slow so they get explored.
 */
export function makePicker(
  chordIds: string[],
  getStats: () => Map<string, TransitionStat>,
  focusWeak: boolean,
  rand: () => number = Math.random,
): PickNext {
  return (from) => {
    const options = chordIds.filter((id) => id !== from);
    if (!focusWeak || from === null) return options[Math.floor(rand() * options.length)];

    const stats = getStats();
    const known = options.flatMap((to) => stats.get(transitionKey(from, to))?.meanMs ?? []);
    const untried = Math.max(2000, ...known);
    const weights = options.map((to) => (stats.get(transitionKey(from, to))?.meanMs ?? untried) ** 2);
    let r = rand() * weights.reduce((a, b) => a + b, 0);
    for (let i = 0; i < options.length; i++) {
      r -= weights[i];
      if (r < 0) return options[i];
    }
    return options[options.length - 1];
  };
}
