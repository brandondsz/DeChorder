import { Fragment, useEffect, useRef } from 'react';
import type { ParsedSong } from './chordpro';

export type ChordState = 'current' | 'played' | 'perfect' | 'good' | 'early' | 'late' | 'miss';

interface Props {
  song: ParsedSong;
  /** Per-event state while playing (index = ParsedSong.events index). */
  eventStates?: (ChordState | undefined)[];
  /** Event being played now; its line is kept centred in view. */
  currentEvent?: number | null;
  /** Section instances being practised; others are dimmed. */
  focusSections?: Set<number> | null;
  className?: string;
}

/** The chart as a lyric sheet, with each chord sitting above the syllable it lands on. */
export function SongSheet({ song, eventStates, currentEvent = null, focusSections = null, className = '' }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const currentLine =
    currentEvent === null ? -1 : song.lines.findIndex((l) => l.segments.some((s) => s.event === currentEvent));

  useEffect(() => {
    const container = containerRef.current;
    const line = container?.querySelector<HTMLElement>(`[data-line="${currentLine}"]`);
    if (!container || !line) return;
    container.scrollTo({
      top: line.offsetTop - container.clientHeight / 2 + line.clientHeight / 2,
      behavior: 'smooth',
    });
  }, [currentLine]);

  return (
    <div className={`song-sheet ${className}`} ref={containerRef}>
      {song.lines.map((line, i) => {
        const newSection = i === 0 || song.lines[i - 1].section !== line.section;
        const dimmed = focusSections !== null && !focusSections.has(line.section);
        const chordOnly = line.segments.every((s) => s.text.trim() === '');
        return (
          <Fragment key={i}>
            {newSection && (
              <h3 className={`sheet-section${dimmed ? ' dimmed' : ''}`}>{song.sections[line.section]?.label}</h3>
            )}
            {line.spacer ? (
              <div className="sheet-gap" />
            ) : (
              <div
                className={`sheet-line${dimmed ? ' dimmed' : ''}${chordOnly ? ' chord-only' : ''}${i === currentLine ? ' active' : ''}`}
                data-line={i}
              >
                {line.segments.map((seg, j) => {
                  const event = seg.event === null ? null : song.events[seg.event];
                  const state = seg.event === null ? undefined : eventStates?.[seg.event];
                  return (
                    <span key={j} className="seg">
                      <span className={`seg-chord${state ? ` ${state}` : ''}`}>
                        {event ? event.label : ' '}
                        {event && event.beats !== song.beatsPerBar && (
                          <span className="seg-beats" title={`${event.beats} beats`}>
                            ·{event.beats}
                          </span>
                        )}
                      </span>
                      {!chordOnly && <span className="seg-lyric">{seg.text || ' '}</span>}
                    </span>
                  );
                })}
              </div>
            )}
          </Fragment>
        );
      })}
    </div>
  );
}
