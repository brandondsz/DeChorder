import { useEffect, useRef } from 'react';
import { COUNT_IN_BEATS, type Grade, type RhythmRun } from './rhythm';

const PX_PER_BEAT = 64;
/** Where "now" sits, as a fraction of the lane width. */
const NOW_LINE = 0.22;

export const GRADE_LABELS: Record<Grade, string> = {
  perfect: 'Perfect',
  good: 'Good',
  early: 'Early',
  late: 'Late',
  miss: 'Miss',
};

/**
 * The chart as a strip of chord blocks scrolling left past a fixed "now" line.
 * Blocks are positioned in beats, so a tempo change only changes the scroll speed.
 * `version` is passed so grade badges re-render when the run's grading changes.
 */
export function RhythmLane({ run }: { run: RhythmRun; version: number }) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let raf = 0;
    const frame = () => {
      raf = requestAnimationFrame(frame);
      const viewport = viewportRef.current;
      const track = trackRef.current;
      if (!viewport || !track) return;
      const x = viewport.clientWidth * NOW_LINE - run.beatAt(performance.now()) * PX_PER_BEAT;
      track.style.transform = `translateX(${x}px)`;
    };
    frame();
    return () => cancelAnimationFrame(raf);
  }, [run]);

  const blockWidth = run.config.beatsPerChord * PX_PER_BEAT;

  return (
    <div className="lane" ref={viewportRef} aria-hidden="true">
      <div className="lane-track" ref={trackRef} style={{ ['--beat' as string]: `${PX_PER_BEAT}px` }}>
        {Array.from({ length: COUNT_IN_BEATS }, (_, b) => (
          <div key={`count${b}`} className="lane-block count" style={{ left: b * PX_PER_BEAT, width: PX_PER_BEAT }}>
            {b + 1}
          </div>
        ))}
        {run.targets.map((target, i) => {
          const hit = run.hits[i];
          return (
            <div
              key={i}
              className={`lane-block${target.scored ? '' : ' unscored'}${hit ? ` graded ${hit.grade}` : ''}`}
              style={{ left: target.beat * PX_PER_BEAT, width: blockWidth }}
            >
              <span className="lane-chord">{target.chord}</span>
              {hit && <span className="lane-grade">{GRADE_LABELS[hit.grade]}</span>}
            </div>
          );
        })}
      </div>
      <div className="lane-now" style={{ left: `${NOW_LINE * 100}%` }} />
    </div>
  );
}
