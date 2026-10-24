import { useEffect, useRef, useState } from 'react';
import type { ClickKind, DetectorEngine } from '../audio/detector';
import type { Grade } from './rhythm';
import { GRADE_LABELS } from './RhythmLane';

/** What a run needs to expose to be played along with a metronome. */
export interface PlayAlongRun {
  readonly totalBeats: number;
  readonly version: number;
  beatTime(beat: number): number | null;
  beatAt(now: number): number;
  done(now: number): boolean;
  /** Grade a committed chord; returns the hit if it counted for a change. */
  handleChord(chordId: string, strumTime: number): PlayAlongHit | null;
  /** Mark expired changes as missed (and anything else time-driven). */
  tick(now: number): PlayAlongHit[];
}

export interface PlayAlongHit {
  chord: string;
  from: string;
  grade: Grade;
  offsetMs: number | null;
}

/**
 * Make sure the mic is listening and the audio clock is running before a play-along.
 * Call from a click. In dev builds it carries on without a mic, for the synthetic strums.
 */
export async function readyToPlay(engine: DetectorEngine): Promise<boolean> {
  if (engine.getSnapshot().status !== 'listening') {
    await engine.start();
    if (engine.getSnapshot().status !== 'listening' && !import.meta.env.DEV) return false;
  }
  await engine.prepareAudio();
  return true;
}

function describeOffset(ms: number): string {
  if (Math.abs(ms) <= 15) return 'on the beat';
  return `${Math.abs(Math.round(ms))} ms ${ms < 0 ? 'early' : 'late'}`;
}

/** e.g. "Good · 120 ms late · G → C" */
export function describeHit(hit: PlayAlongHit): string {
  const timing = hit.offsetMs !== null ? ` · ${describeOffset(hit.offsetMs)}` : '';
  return `${GRADE_LABELS[hit.grade]}${timing} · ${hit.from} → ${hit.chord}`;
}

export interface PlayAlongFeedback<H extends PlayAlongHit> {
  hit: H;
  at: number;
}

/**
 * Drives a play-along run: schedules metronome clicks just ahead of time, grades chord
 * changes from the detector, marks misses, and calls `onDone` once at the end.
 * Re-renders on each beat and whenever grading changes.
 */
export function usePlayAlong<H extends PlayAlongHit>(
  run: PlayAlongRun,
  engine: DetectorEngine,
  clickKind: (beat: number) => ClickKind,
  onDone: () => void,
) {
  const [frame, setFrame] = useState({ beat: -1, version: 0 });
  const [feedback, setFeedback] = useState<PlayAlongFeedback<H> | null>(null);
  const callbacks = useRef({ clickKind, onDone });
  callbacks.current = { clickKind, onDone };

  useEffect(
    () =>
      engine.onChordChange((chordId, _time, strumTime) => {
        const hit = run.handleChord(chordId, strumTime);
        if (hit) setFeedback({ hit: hit as H, at: performance.now() });
      }),
    [engine, run],
  );

  useEffect(() => {
    let raf = 0;
    let nextClick = 0;
    let lastBeat = -1;
    let lastVersion = -1;
    let finished = false;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const now = performance.now();
      const missed = run.tick(now);
      if (missed.length) setFeedback({ hit: missed[missed.length - 1] as H, at: now });
      while (nextClick < run.totalBeats) {
        const t = run.beatTime(nextClick);
        if (t === null || t > now + 200) break;
        engine.scheduleClick(t, callbacks.current.clickKind(nextClick));
        nextClick++;
      }
      const beat = Math.floor(run.beatAt(now));
      if (beat !== lastBeat || run.version !== lastVersion) {
        lastBeat = beat;
        lastVersion = run.version;
        setFrame({ beat, version: run.version });
      }
      if (!finished && run.done(now)) {
        finished = true;
        engine.beep(990, 0.3);
        callbacks.current.onDone();
      }
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, [run, engine]);

  const now = performance.now();
  return {
    beat: frame.beat,
    version: frame.version,
    /** The latest graded change, for ~1.5 s after it happened. */
    feedback: feedback && now - feedback.at < 1500 ? feedback : null,
  };
}
