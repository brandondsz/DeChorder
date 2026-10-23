import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import { CHORDS_BY_ID } from '../audio/chords';
import { useChordSet, type Detector } from '../audio/useChordDetector';
import { ChordDiagram } from '../components/ChordDiagram';
import { ChordSetPicker } from '../components/ChordSetPicker';
import { DevStrum } from '../components/DevStrum';
import { makePicker, ReactionRun, transitionStats, type ReactionRound, type TransitionStat } from '../drill/reaction';
import { TransitionHeatmap } from '../drill/TransitionHeatmap';
import { formatSeconds, useClock } from '../hooks/useClock';
import { addReactionSession, getReactionSessions, type ReactionSession } from '../storage/db';
import { REACTION_ROUND_OPTIONS, useReactionSettings } from '../storage/useReactionSettings';

type Phase =
  | { kind: 'setup' }
  | { kind: 'running'; run: ReactionRun; startedAt: number }
  | { kind: 'results'; session: ReactionSession; previousAverage: number | null };

function summarize(rounds: ReactionRound[]) {
  const hits = rounds.flatMap((r) => (r.ms === null ? [] : [r.ms]));
  return {
    averageMs: hits.length ? hits.reduce((a, b) => a + b, 0) / hits.length : null,
    fastestMs: hits.length ? Math.min(...hits) : null,
    misses: rounds.length - hits.length,
  };
}

function slowest(stats: TransitionStat[], count = 3): TransitionStat[] {
  return [...stats].sort((a, b) => b.meanMs - a.meanMs).slice(0, count);
}

export function ReactionModeScreen({ detector }: { detector: Detector }) {
  const { engine } = detector;
  const [settings, updateSettings] = useReactionSettings();
  const { chordIds, rounds, focusWeak } = settings;
  useChordSet(engine, chordIds);

  const [phase, setPhase] = useState<Phase>({ kind: 'setup' });
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  const [history, setHistory] = useState<ReactionSession[]>([]);

  const reloadHistory = useCallback(() => {
    getReactionSessions()
      .then(setHistory)
      .catch((err) => console.warn('Could not load reaction history', err));
  }, []);
  useEffect(reloadHistory, [reloadHistory]);

  const pastRounds = useMemo(() => history.flatMap((s) => s.rounds), [history]);
  const stats = useMemo(() => transitionStats(pastRounds), [pastRounds]);
  const now = useClock(phase.kind === 'running');

  const begin = async () => {
    if (engine.getSnapshot().status !== 'listening') {
      await engine.start();
      if (engine.getSnapshot().status !== 'listening' && !import.meta.env.DEV) return;
    }
    engine.setChordSet(chordIds);
    // The picker reads this run's rounds too, so a change you fumble comes back sooner.
    let run: ReactionRun | undefined;
    const pick = makePicker(chordIds, () => transitionStats(run ? [...pastRounds, ...run.rounds] : pastRounds), focusWeak);
    run = new ReactionRun(rounds, pick, performance.now());
    setPhase({ kind: 'running', run, startedAt: Date.now() });
  };

  useEffect(() => {
    if (phase.kind !== 'running') return;
    const { run } = phase;
    return engine.onChordChange((chordId, time) => {
      if (run.handleChord(chordId, time)) rerender();
    });
  }, [phase, engine]);

  useEffect(() => {
    if (phase.kind !== 'running') return;
    const { run, startedAt } = phase;
    if (run.tick(now)) rerender();
    if (!run.done) return;
    engine.beep(990, 0.35);
    const session: ReactionSession = { chordIds, rounds: run.rounds, startedAt };
    const previous = history.at(-1);
    setPhase({
      kind: 'results',
      session,
      previousAverage: previous ? summarize(previous.rounds).averageMs : null,
    });
    addReactionSession(session)
      .then(reloadHistory)
      .catch((err) => console.warn('Could not save reaction session', err));
  }, [phase, now, engine, chordIds, history, reloadHistory]);

  if (phase.kind === 'running') {
    return (
      <ReactionInProgress
        run={phase.run}
        now={now}
        heardId={detector.live ? detector.chordId : null}
        onStop={() => setPhase({ kind: 'setup' })}
        detector={detector}
        chordIds={chordIds}
      />
    );
  }

  const selectedStats = [...stats.values()].filter((s) => chordIds.includes(s.from) && chordIds.includes(s.to));

  return (
    <main className="layout drill-layout">
      {phase.kind === 'results' ? (
        <ReactionResults
          session={phase.session}
          previousAverage={phase.previousAverage}
          onAgain={() => void begin()}
          onDone={() => setPhase({ kind: 'setup' })}
        />
      ) : (
        <section className="card drill-setup">
          <h2>Reaction Mode</h2>
          <p className="lede">
            A random chord appears. Change to it as fast as you can and strum. The clock runs from the moment it
            appears until the chord rings clean.
          </p>
          <div className="field">
            <span className="field-label">Chords in the mix</span>
            <ChordSetPicker
              enabledIds={chordIds}
              onChange={(ids) => updateSettings({ chordIds: ids })}
              minSelected={2}
              hint="Start with 4–6 chords you know. Every pair in both directions is a separate change to learn."
            />
          </div>
          <div className="field">
            <span className="field-label">Rounds</span>
            <div className="segmented" role="group" aria-label="Rounds">
              {REACTION_ROUND_OPTIONS.map((n) => (
                <button key={n} type="button" aria-pressed={n === rounds} onClick={() => updateSettings({ rounds: n })}>
                  {n}
                </button>
              ))}
            </div>
          </div>
          <label className="toggle">
            <input type="checkbox" checked={focusWeak} onChange={(e) => updateSettings({ focusWeak: e.target.checked })} />
            <span>
              <strong>Focus on my slowest changes</strong>
              <span className="hint">Slow and untried transitions come up more often.</span>
            </span>
          </label>
          <button type="button" className="primary large" onClick={() => void begin()}>
            Start
          </button>
        </section>
      )}

      <section className="card">
        <h2>Your changes</h2>
        {selectedStats.length === 0 ? (
          <p className="hint">Play a round and your change times will fill in here, one cell per transition.</p>
        ) : (
          <>
            <TransitionHeatmap chordIds={chordIds} stats={stats} />
            <h2 className="spaced">Slowest changes</h2>
            <ol className="slowest">
              {slowest(selectedStats).map((s) => (
                <li key={`${s.from}>${s.to}`}>
                  <span className="slowest-pair">
                    {s.from} → {s.to}
                  </span>
                  <span className="slowest-time">{formatSeconds(s.meanMs)}</span>
                </li>
              ))}
            </ol>
          </>
        )}
      </section>
    </main>
  );
}

interface InProgressProps {
  run: ReactionRun;
  now: number;
  heardId: string | null;
  onStop: () => void;
  detector: Detector;
  chordIds: string[];
}

function ReactionInProgress({ run, now, heardId, onStop, detector, chordIds }: InProgressProps) {
  const target = CHORDS_BY_ID.get(run.target)!;
  const { averageMs } = summarize(run.rounds);
  const last = run.rounds.at(-1);
  const timed = run.from !== null;
  const elapsed = Math.min(1, (now - run.shownAt) / run.timeoutMs);
  const roundNumber = Math.min(run.rounds.length + 1, run.totalRounds);

  return (
    <main className="drill-run">
      <section className="card drill-hud">
        <div className="hud-stat">
          <span className="hud-label">Round</span>
          <span className="hud-value">{timed ? `${roundNumber} / ${run.totalRounds}` : 'Warm-up'}</span>
        </div>
        <div className="hud-stat center">
          <span className="hud-label">Average</span>
          <span className="hud-value big">{formatSeconds(averageMs)}</span>
        </div>
        <div className="hud-stat right">
          <span className="hud-label">Last change</span>
          <span key={run.rounds.length} className={`hud-value${last ? ' count-pop' : ''}`}>
            {last ? (last.ms === null ? 'Missed' : formatSeconds(last.ms)) : '–'}
          </span>
          {last && (
            <span className="hint hud-sub">
              {last.from} → {last.to}
            </span>
          )}
        </div>
      </section>

      <section key={run.shownAt} className="card reaction-target" aria-live="polite">
        <span className="drill-chord-tag">{timed ? `From ${run.from} to` : 'Warm-up · not timed · play'}</span>
        <span className="drill-chord-name">{target.name}</span>
        <ChordDiagram chord={target} />
        <span className={`heard-tag${heardId ? ' on' : ''}`}>{heardId ? `Hearing ${heardId}` : ' '}</span>
        {timed && (
          <div className="bar reaction-timeout" aria-hidden="true">
            <div className="bar-fill neutral" style={{ width: `${elapsed * 100}%`, transition: 'none' }} />
          </div>
        )}
      </section>

      <div className="drill-footer">
        <button type="button" className="primary stop" onClick={onStop}>
          Stop without saving
        </button>
        <DevStrum engine={detector.engine} chordIds={chordIds} />
      </div>
    </main>
  );
}

interface ResultsProps {
  session: ReactionSession;
  previousAverage: number | null;
  onAgain: () => void;
  onDone: () => void;
}

function ReactionResults({ session, previousAverage, onAgain, onDone }: ResultsProps) {
  const { averageMs, fastestMs, misses } = summarize(session.rounds);
  const runStats = [...transitionStats(session.rounds).values()];

  let verdict = 'First run. This is your baseline.';
  if (previousAverage !== null && averageMs !== null) {
    const delta = previousAverage - averageMs;
    if (Math.abs(delta) < 50) verdict = `About the same as last time (${formatSeconds(previousAverage)}).`;
    else if (delta > 0) verdict = `${formatSeconds(delta)} faster than last time.`;
    else verdict = `${formatSeconds(-delta)} slower than last time (${formatSeconds(previousAverage)}).`;
  }
  const improved = previousAverage !== null && averageMs !== null && previousAverage - averageMs >= 50;

  return (
    <section className="card drill-results" aria-live="polite">
      <h2>Result · {session.rounds.length} changes</h2>
      <div className="result-hero">
        <span className="result-number">{averageMs === null ? '–' : (averageMs / 1000).toFixed(2)}</span>
        <span className="result-unit">seconds per change, on average</span>
      </div>
      <p className={`result-verdict${improved ? ' best' : ''}`}>{verdict}</p>
      <dl className="result-stats">
        <div>
          <dt>Fastest</dt>
          <dd>{formatSeconds(fastestMs)}</dd>
        </div>
        <div>
          <dt>Missed</dt>
          <dd>{misses}</dd>
        </div>
        <div>
          <dt>Slowest</dt>
          <dd>{runStats.length ? formatSeconds(slowest(runStats, 1)[0].meanMs) : '–'}</dd>
        </div>
      </dl>
      {runStats.length > 0 && (
        <div className="field">
          <span className="field-label">Slowest this run</span>
          <ol className="slowest">
            {slowest(runStats).map((s) => (
              <li key={`${s.from}>${s.to}`}>
                <span className="slowest-pair">
                  {s.from} → {s.to}
                </span>
                <span className="slowest-time">
                  {formatSeconds(s.meanMs)}
                  {s.misses ? ` · ${s.misses} missed` : ''}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
      <div className="result-actions">
        <button type="button" className="primary large" onClick={onAgain}>
          Go again
        </button>
        <button type="button" className="secondary" onClick={onDone}>
          Change chords
        </button>
      </div>
    </section>
  );
}
