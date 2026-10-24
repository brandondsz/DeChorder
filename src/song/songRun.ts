import { changeWindows, COMMIT_GRACE_MS, gradeFor, isClean, type Grade } from '../drill/rhythm';
import type { ParsedSong } from './chordpro';

/** Two or more missed changes in a row: you stopped (or got lost). */
export const STALL_MISSES = 2;

export interface SongStep {
  /** Index into ParsedSong.events. */
  event: number;
  chord: string | null;
  /** Absolute beat (count-in included) on which this chord starts. */
  beat: number;
  beats: number;
  /** Section instance (index into ParsedSong.sections). */
  section: number;
  /** The last real chord before this one (rests skipped). */
  from: string | null;
  /** Only audible changes are scored: not the first chord, a repeat, a rest, or a return after a rest. */
  scored: boolean;
}

export interface SongHit {
  step: number;
  section: number;
  chord: string;
  from: string;
  grade: Grade;
  offsetMs: number | null;
}

export interface SongRunOptions {
  bpm: number;
  latencyMs: number;
  /** Section instances to play, in order; the whole song when omitted. */
  sections?: number[];
  /** How many times to play them through (for looping one section). */
  repeats?: number;
}

/**
 * A play-through of a song (or part of one) at a fixed tempo, after a one-bar count-in.
 * Scoring matches Rhythm Mode; on top of that it tracks stalls, the "did you keep going" measure.
 */
export class SongRun {
  readonly steps: SongStep[] = [];
  readonly hits: (SongHit | undefined)[] = [];
  readonly countInBeats: number;
  readonly totalBeats: number;
  readonly beatMs: number;
  /** Bumped whenever grading changes, so the UI knows to re-render. */
  version = 0;

  constructor(
    readonly song: ParsedSong,
    readonly options: SongRunOptions,
    readonly startTime: number,
  ) {
    this.beatMs = 60000 / options.bpm;
    this.countInBeats = song.beatsPerBar;
    const sections = options.sections ?? song.sections.map((_, i) => i);
    let beat = this.countInBeats;
    // Changes are judged against the last real chord: the detector keeps reporting it through a
    // rest, so G → N.C. → G isn't a change it can hear.
    let lastChord: string | null = null;
    for (let r = 0; r < (options.repeats ?? 1); r++) {
      for (const section of sections) {
        song.events.forEach((e, event) => {
          if (e.section !== section) return;
          const scored = lastChord !== null && e.chord !== null && e.chord !== lastChord;
          this.steps.push({ event, chord: e.chord, beat, beats: e.beats, section, from: lastChord, scored });
          if (e.chord !== null) lastChord = e.chord;
          beat += e.beats;
        });
      }
    }
    this.totalBeats = beat;
  }

  get bpm(): number {
    return this.options.bpm;
  }

  beatTime(beat: number): number {
    return this.startTime + beat * this.beatMs;
  }

  beatAt(now: number): number {
    return (now - this.startTime) / this.beatMs;
  }

  get endTime(): number {
    return this.beatTime(this.totalBeats);
  }

  done(now: number): boolean {
    return now >= this.endTime;
  }

  /** Index of the step playing at `beat` (the latest that has started), or -1 during the count-in. */
  stepIndexAt(beat: number): number {
    let index = -1;
    for (let i = 0; i < this.steps.length && this.steps[i].beat <= beat; i++) index = i;
    return index;
  }

  private windows(step: SongStep) {
    return changeWindows(this.beatMs, step.beats);
  }

  handleChord(chordId: string, strumTime: number): SongHit | null {
    const t = strumTime - this.options.latencyMs;
    let best: { index: number; offset: number } | null = null;
    this.steps.forEach((step, index) => {
      if (!step.scored || this.hits[index] || step.chord !== chordId) return;
      const offset = t - this.beatTime(step.beat);
      const { early, late } = this.windows(step);
      if (offset < -early || offset > late) return;
      if (!best || Math.abs(offset) < Math.abs(best.offset)) best = { index, offset };
    });
    if (!best) return null;
    const { index, offset } = best as { index: number; offset: number };
    const step = this.steps[index];
    const hit: SongHit = {
      step: index,
      section: step.section,
      chord: step.chord!,
      from: step.from ?? 'N.C.',
      grade: gradeFor(offset),
      offsetMs: Math.round(offset),
    };
    this.hits[index] = hit;
    this.version++;
    return hit;
  }

  /** Mark changes whose window (plus the commit grace) has passed as missed. */
  tick(now: number): SongHit[] {
    const t = now - this.options.latencyMs;
    const missed: SongHit[] = [];
    this.steps.forEach((step, index) => {
      if (!step.scored || this.hits[index]) return;
      if (t <= this.beatTime(step.beat) + this.windows(step).late + COMMIT_GRACE_MS) return;
      const hit: SongHit = {
        step: index,
        section: step.section,
        chord: step.chord!,
        from: step.from ?? 'N.C.',
        grade: 'miss',
        offsetMs: null,
      };
      this.hits[index] = hit;
      missed.push(hit);
    });
    if (missed.length) this.version++;
    return missed;
  }

  gradedHits(): SongHit[] {
    return this.hits.filter((h): h is SongHit => h !== undefined);
  }
}

export type SectionRating = 'solid' | 'close' | 'work';

export const RATING_LABELS: Record<SectionRating, string> = {
  solid: 'Solid',
  close: 'Getting there',
  work: 'Needs work',
};

export interface SectionSummary {
  section: number;
  changes: number;
  clean: number;
  rating: SectionRating;
}

export interface SongSummary {
  changes: number;
  clean: number;
  /** Changes played at all (anything but a miss). */
  landed: number;
  stalls: number;
  /** Per section instance, in play order (each instance once). */
  sections: SectionSummary[];
}

export function rateSection(clean: number, changes: number): SectionRating {
  const ratio = changes ? clean / changes : 1;
  if (ratio >= 0.85) return 'solid';
  if (ratio >= 0.6) return 'close';
  return 'work';
}

/** Summarise graded hits in chart order. */
export function summarizeSong(hits: SongHit[]): SongSummary {
  let stalls = 0;
  let missRun = 0;
  const bySection = new Map<number, { changes: number; clean: number }>();
  for (const hit of hits) {
    missRun = hit.grade === 'miss' ? missRun + 1 : 0;
    if (missRun === STALL_MISSES) stalls++;
    const s = bySection.get(hit.section) ?? { changes: 0, clean: 0 };
    s.changes++;
    if (isClean(hit.grade)) s.clean++;
    bySection.set(hit.section, s);
  }
  return {
    changes: hits.length,
    clean: hits.filter((h) => isClean(h.grade)).length,
    landed: hits.filter((h) => h.grade !== 'miss').length,
    stalls,
    sections: [...bySection].map(([section, s]) => ({ section, ...s, rating: rateSection(s.clean, s.changes) })),
  };
}
