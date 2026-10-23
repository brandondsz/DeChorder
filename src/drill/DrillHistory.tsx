import { SessionBars, sessionDateFormat } from '../components/SessionBars';
import type { DrillSession } from '../storage/db';
import { changesPerMinute } from './changeDrill';

/** Changes-per-minute for recent sessions of one pair, with the personal best marked. */
export function DrillHistory({ sessions }: { sessions: DrillSession[] }) {
  if (sessions.length === 0) {
    return <p className="hint">No sessions yet for this pair. Your progress will show up here.</p>;
  }
  const shown = Math.min(sessions.length, 20);
  return (
    <SessionBars
      caption={`Changes per minute, ${shown === 1 ? 'first session' : `last ${shown} sessions`}`}
      bestLabel={(best) => `Best ${Math.round(best)}`}
      bars={sessions.map((s) => {
        const rate = changesPerMinute(s.changes, s.durationSec);
        return {
          key: s.id ?? s.startedAt,
          value: rate,
          tooltip: [`${Math.round(rate)} / min`, `${s.changes} changes in ${s.durationSec}s`, sessionDateFormat.format(s.startedAt)],
          ariaLabel: `${sessionDateFormat.format(s.startedAt)}: ${s.changes} changes in ${s.durationSec} seconds`,
        };
      })}
      table={{
        headers: ['Date', 'Changes', 'Duration', 'Per minute'],
        rows: [...sessions]
          .reverse()
          .map((s) => [
            sessionDateFormat.format(s.startedAt),
            s.changes,
            `${s.durationSec}s`,
            Math.round(changesPerMinute(s.changes, s.durationSec)),
          ]),
      }}
    />
  );
}
