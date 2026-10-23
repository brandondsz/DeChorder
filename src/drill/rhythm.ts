export const COUNT_IN_BEATS = 4;
export const PERFECT_MS = 90;
export const GOOD_MS = 200;
export const SPEED_UP_BPM = 5;
export const SPEED_UP_ACCURACY = 0.75;
export const MAX_BPM = 200;
/** A change can't be landed more than this early or late, however slow the tempo. */
const MAX_EARLY_MS = 500;
const MAX_LATE_MS = 700;
/** If a loop is still being graded this close to the next one, decide its tempo anyway. */
const TEMPO_DECISION_LEAD_MS = 300;
/**
 * The detector confirms a chord a few hundred ms after its strum, so a strum near the end of
 * the late window is reported after the window closes. Wait this long before calling a miss.
 */
export const COMMIT_GRACE_MS = 450;

export type Grade = 'perfect' | 'good' | 'early' | 'late' | 'miss';

export interface RhythmConfig {
  chords: string[];
  beatsPerChord: number;
  startBpm: number;
  loops: number;
  /** Raise the tempo after a loop played at SPEED_UP_ACCURACY or better. */
  speedUp: boolean;
}

export interface RhythmTarget {
  chord: string;
  from: string | null;
  loop: number;
  /** Absolute beat (count-in included) on which this chord starts. */
  beat: number;
  /** False when nothing changes (first chord, or the same chord twice in a row). */
  scored: boolean;
}

export interface RhythmHit {
  chord: string;
  from: string;
  loop: number;
  bpm: number;
  grade: Grade;
  /** Strum time relative to the beat, after latency correction; null for a miss. */
  offsetMs: number | null;
}

export const isClean = (grade: Grade) => grade === 'perfect' || grade === 'good';

const beatMs = (bpm: number) => 60000 / bpm;

export function gradeFor(offsetMs: number): Grade {
  const abs = Math.abs(offsetMs);
  if (abs <= PERFECT_MS) return 'perfect';
  if (abs <= GOOD_MS) return 'good';
  return offsetMs < 0 ? 'early' : 'late';
}

/**
 * One Rhythm Mode run. The chart is laid out in beats; the tempo of each loop is decided
 * just before it starts, so beat → time is only known for loops decided so far.
 * All times use performance.now(), and a beat's time is when its click is *heard*.
 */
export class RhythmRun {
  readonly targets: RhythmTarget[] = [];
  readonly hits: (RhythmHit | undefined)[] = [];
  readonly loopBpms: number[];
  /** Bumped whenever grading or tempo changes, so the UI knows to re-render. */
  version = 0;
  private loopStarts: number[] = [];

  constructor(
    readonly config: RhythmConfig,
    readonly startTime: number,
    readonly latencyMs: number,
  ) {
    this.loopBpms = [config.startBpm];
    let prev: string | null = null;
    for (let loop = 0; loop < config.loops; loop++) {
      config.chords.forEach((chord, i) => {
        const beat = COUNT_IN_BEATS + (loop * config.chords.length + i) * config.beatsPerChord;
        this.targets.push({ chord, from: prev, loop, beat, scored: prev !== null && prev !== chord });
        prev = chord;
      });
    }
  }

  get beatsPerLoop(): number {
    return this.config.chords.length * this.config.beatsPerChord;
  }

  get totalBeats(): number {
    return COUNT_IN_BEATS + this.config.loops * this.beatsPerLoop;
  }

  get scoredCount(): number {
    return this.targets.filter((t) => t.scored).length;
  }

  loopStart(loop: number): number | null {
    if (loop === 0) return this.startTime + COUNT_IN_BEATS * beatMs(this.config.startBpm);
    if (this.loopStarts[loop] !== undefined) return this.loopStarts[loop];
    const prevStart = this.loopStart(loop - 1);
    const prevBpm = this.loopBpms[loop - 1];
    if (prevStart === null || prevBpm === undefined) return null;
    const start = prevStart + this.beatsPerLoop * beatMs(prevBpm);
    this.loopStarts[loop] = start;
    return start;
  }

  /** When a beat is heard, or null if its loop's tempo isn't decided yet. */
  beatTime(beat: number): number | null {
    if (beat < COUNT_IN_BEATS) return this.startTime + beat * beatMs(this.config.startBpm);
    const loop = Math.floor((beat - COUNT_IN_BEATS) / this.beatsPerLoop);
    const offset = beat - COUNT_IN_BEATS - loop * this.beatsPerLoop;
    const start = this.loopStart(loop);
    if (start === null) return null;
    if (offset === 0) return start;
    const bpm = this.loopBpms[loop];
    return bpm === undefined ? null : start + offset * beatMs(bpm);
  }

  /** Fractional beat position at `now`, for drawing. */
  beatAt(now: number): number {
    const first = this.loopStart(0)!;
    if (now < first) return (now - this.startTime) / beatMs(this.config.startBpm);
    let loop = this.loopBpms.length - 1;
    while (loop > 0 && (this.loopStart(loop) ?? Infinity) > now) loop--;
    return COUNT_IN_BEATS + loop * this.beatsPerLoop + (now - this.loopStart(loop)!) / beatMs(this.loopBpms[loop]);
  }

  bpmAt(now: number): number {
    const beat = this.beatAt(now);
    const loop = Math.max(0, Math.floor((beat - COUNT_IN_BEATS) / this.beatsPerLoop));
    return this.loopBpms[Math.min(loop, this.loopBpms.length - 1)];
  }

  get endTime(): number | null {
    return this.beatTime(this.totalBeats);
  }

  done(now: number): boolean {
    const end = this.endTime;
    return end !== null && now >= end;
  }

  private windows(target: RhythmTarget) {
    const beat = beatMs(this.loopBpms[target.loop]);
    return {
      early: Math.min(MAX_EARLY_MS, beat * 0.75),
      late: Math.min(MAX_LATE_MS, beat * this.config.beatsPerChord * 0.5),
    };
  }

  /** Grade a committed chord against the nearest open target for it. */
  handleChord(chordId: string, strumTime: number): RhythmHit | null {
    const t = strumTime - this.latencyMs;
    let best: { index: number; offset: number } | null = null;
    this.targets.forEach((target, index) => {
      if (!target.scored || this.hits[index] || target.chord !== chordId) return;
      const due = this.beatTime(target.beat);
      if (due === null || this.loopBpms[target.loop] === undefined) return;
      const offset = t - due;
      const { early, late } = this.windows(target);
      if (offset < -early || offset > late) return;
      if (!best || Math.abs(offset) < Math.abs(best.offset)) best = { index, offset };
    });
    if (!best) return null;
    const { index, offset } = best as { index: number; offset: number };
    const target = this.targets[index];
    const hit: RhythmHit = {
      chord: target.chord,
      from: target.from!,
      loop: target.loop,
      bpm: this.loopBpms[target.loop],
      grade: gradeFor(offset),
      offsetMs: Math.round(offset),
    };
    this.hits[index] = hit;
    this.version++;
    return hit;
  }

  /** Mark expired targets as missed and decide upcoming tempos. Call every frame. */
  tick(now: number): RhythmHit[] {
    const t = now - this.latencyMs;
    const missed: RhythmHit[] = [];
    this.targets.forEach((target, index) => {
      if (!target.scored || this.hits[index] || this.loopBpms[target.loop] === undefined) return;
      const due = this.beatTime(target.beat);
      if (due === null || t <= due + this.windows(target).late + COMMIT_GRACE_MS) return;
      const hit: RhythmHit = {
        chord: target.chord,
        from: target.from!,
        loop: target.loop,
        bpm: this.loopBpms[target.loop],
        grade: 'miss',
        offsetMs: null,
      };
      this.hits[index] = hit;
      missed.push(hit);
    });
    if (missed.length) this.version++;
    this.decideNextTempo(now);
    return missed;
  }

  private loopAccuracy(loop: number): { graded: number; scored: number; clean: number } {
    let graded = 0;
    let scored = 0;
    let clean = 0;
    this.targets.forEach((target, index) => {
      if (target.loop !== loop || !target.scored) return;
      scored++;
      const hit = this.hits[index];
      if (hit) {
        graded++;
        if (isClean(hit.grade)) clean++;
      }
    });
    return { graded, scored, clean };
  }

  private decideNextTempo(now: number): void {
    const loop = this.loopBpms.length - 1;
    if (loop + 1 >= this.config.loops) return;
    const { graded, scored, clean } = this.loopAccuracy(loop);
    const nextStart = this.loopStart(loop + 1)!;
    if (graded < scored && nextStart - now > TEMPO_DECISION_LEAD_MS) return;
    const bpm = this.loopBpms[loop];
    // Deciding early (the last change may still be awaiting its grace period): judge what's graded.
    const speedUp = this.config.speedUp && graded > 0 && clean / graded >= SPEED_UP_ACCURACY;
    this.loopBpms.push(speedUp ? Math.min(MAX_BPM, bpm + SPEED_UP_BPM) : bpm);
    this.version++;
  }

  /** Which target the player should be on at `beat` (the latest one that has started). */
  targetIndexAt(beat: number): number {
    let index = -1;
    for (let i = 0; i < this.targets.length && this.targets[i].beat <= beat; i++) index = i;
    return index;
  }

  /** Graded hits in chart order. */
  gradedHits(): RhythmHit[] {
    return this.hits.filter((h): h is RhythmHit => h !== undefined);
  }

  currentStreak(): number {
    let streak = 0;
    for (const hit of this.hits) {
      if (!hit) continue;
      streak = isClean(hit.grade) ? streak + 1 : 0;
    }
    return streak;
  }

  /** Highest tempo of any loop played at SPEED_UP_ACCURACY or better. */
  topCleanBpm(): number | null {
    let best: number | null = null;
    this.loopBpms.forEach((bpm, loop) => {
      const { scored, clean, graded } = this.loopAccuracy(loop);
      if (scored > 0 && graded === scored && clean / scored >= SPEED_UP_ACCURACY) best = Math.max(best ?? 0, bpm);
    });
    return best;
  }
}

export interface RhythmSummary {
  accuracy: number | null;
  counts: Record<Grade, number>;
  bestStreak: number;
  /** Median signed offset of landed strums (positive = late); a median so one sloppy change doesn't skew it. */
  typicalOffsetMs: number | null;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function summarizeHits(hits: RhythmHit[]): RhythmSummary {
  const counts: Record<Grade, number> = { perfect: 0, good: 0, early: 0, late: 0, miss: 0 };
  let streak = 0;
  let bestStreak = 0;
  const offsets: number[] = [];
  for (const hit of hits) {
    counts[hit.grade]++;
    streak = isClean(hit.grade) ? streak + 1 : 0;
    bestStreak = Math.max(bestStreak, streak);
    if (hit.offsetMs !== null) offsets.push(hit.offsetMs);
  }
  return {
    accuracy: hits.length ? (counts.perfect + counts.good) / hits.length : null,
    counts,
    bestStreak,
    typicalOffsetMs: offsets.length ? median(offsets) : null,
  };
}

export interface Calibration {
  latencyMs: number;
  /** Median absolute deviation of the strums: how steady they were. */
  spreadMs: number;
  matched: number;
}

/**
 * Median strum-minus-click offset, ignoring the first `skip` clicks (the listen-in).
 * Null if too few strums landed near a click.
 */
export function calibrate(clickTimes: number[], onsets: number[], skip = 4): Calibration | null {
  const offsets: number[] = [];
  for (const click of clickTimes.slice(skip)) {
    let nearest: number | null = null;
    for (const onset of onsets) {
      const d = onset - click;
      if (Math.abs(d) <= 300 && (nearest === null || Math.abs(d) < Math.abs(nearest))) nearest = d;
    }
    if (nearest !== null) offsets.push(nearest);
  }
  if (offsets.length < 4) return null;
  const latencyMs = median(offsets);
  return {
    latencyMs: Math.round(latencyMs),
    spreadMs: Math.round(median(offsets.map((o) => Math.abs(o - latencyMs)))),
    matched: offsets.length,
  };
}

export function progressionKey(chords: string[], beatsPerChord: number): string {
  return `${chords.join(' ')} /${beatsPerChord}`;
}
