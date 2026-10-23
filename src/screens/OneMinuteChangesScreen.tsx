import { useCallback, useEffect, useRef, useState } from 'react';
import { CHORDS_BY_ID, OPEN_CHORDS } from '../audio/chords';
import { useChordSet, type Detector } from '../audio/useChordDetector';
import { ChordDiagram } from '../components/ChordDiagram';
import { DevStrum } from '../components/DevStrum';
import {
  ChangeDrill,
  changeStats,
  changesPerMinute,
  pairKey,
  SUGGESTED_PAIRS,
  type ChordPair,
} from '../drill/changeDrill';
import { DrillHistory } from '../drill/DrillHistory';
import { formatSeconds, useClock } from '../hooks/useClock';
import { addDrillSession, getDrillSessions, type DrillSession } from '../storage/db';
import { DRILL_DURATIONS, useDrillSettings } from '../storage/useDrillSettings';

const COUNTDOWN_MS = 3000;

type Phase =
  | { kind: 'setup' }
  | { kind: 'countdown'; endsAt: number }
  | { kind: 'running'; drill: ChangeDrill }
  | { kind: 'results'; session: DrillSession; previousBest: number | null };

function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function bestRate(sessions: DrillSession[]): number | null {
  if (sessions.length === 0) return null;
  return Math.max(...sessions.map((s) => changesPerMinute(s.changes, s.durationSec)));
}

export function OneMinuteChangesScreen({ detector }: { detector: Detector }) {
  const { engine } = detector;
  const [settings, updateSettings] = useDrillSettings();
  const { chords, durationSec } = settings;
  useChordSet(engine, chords);

  const [phase, setPhase] = useState<Phase>({ kind: 'setup' });
  const [history, setHistory] = useState<DrillSession[]>([]);
  const [, setChangeCount] = useState(0);
  const key = pairKey(chords);

  const reloadHistory = useCallback(() => {
    getDrillSessions(key)
      .then(setHistory)
      .catch((err) => console.warn('Could not load drill history', err));
  }, [key]);
  useEffect(reloadHistory, [reloadHistory]);

  const timing = phase.kind === 'countdown' || phase.kind === 'running';
  const now = useClock(timing);

  // Countdown: beep on each second, then start the drill.
  const lastBeep = useRef<number | null>(null);
  useEffect(() => {
    if (phase.kind !== 'countdown') return;
    const remaining = Math.ceil((phase.endsAt - now) / 1000);
    if (remaining > 0 && remaining !== lastBeep.current) {
      lastBeep.current = remaining;
      engine.beep(660);
    } else if (remaining <= 0) {
      lastBeep.current = null;
      engine.beep(990, 0.2);
      // Reset detection so a chord already ringing is heard fresh at "go".
      engine.setChordSet(chords);
      setPhase({ kind: 'running', drill: new ChangeDrill(chords, phase.endsAt, durationSec * 1000) });
    }
  }, [phase, now, engine, chords, durationSec]);

  // Running: count changes from committed-chord events.
  useEffect(() => {
    if (phase.kind !== 'running') return;
    const { drill } = phase;
    return engine.onChordChange((chordId, time) => {
      drill.handleChord(chordId, time);
      setChangeCount(drill.changes);
    });
  }, [phase, engine]);

  // Running: finish when time is up.
  useEffect(() => {
    if (phase.kind !== 'running' || now < phase.drill.endTime) return;
    const { drill } = phase;
    engine.beep(990, 0.35);
    const session: DrillSession = {
      pairKey: pairKey(drill.chords),
      chords: drill.chords,
      durationSec,
      changes: drill.changes,
      changeTimesMs: drill.changeTimesMs,
      startedAt: Date.now() - durationSec * 1000,
    };
    setPhase({ kind: 'results', session, previousBest: bestRate(history) });
    addDrillSession(session)
      .then(reloadHistory)
      .catch((err) => console.warn('Could not save drill session', err));
  }, [phase, now, engine, durationSec, history, reloadHistory]);

  const begin = async () => {
    if (engine.getSnapshot().status !== 'listening') {
      await engine.start();
      if (engine.getSnapshot().status !== 'listening' && !import.meta.env.DEV) return;
    }
    setPhase({ kind: 'countdown', endsAt: performance.now() + COUNTDOWN_MS });
  };

  if (phase.kind === 'countdown' || phase.kind === 'running') {
    return (
      <DrillInProgress
        chords={chords}
        phase={phase}
        now={now}
        durationSec={durationSec}
        heardId={detector.live ? detector.chordId : null}
        onStop={() => setPhase({ kind: 'setup' })}
        detector={detector}
      />
    );
  }

  return (
    <main className="layout drill-layout">
      {phase.kind === 'results' ? (
        <DrillResults
          session={phase.session}
          previousBest={phase.previousBest}
          onAgain={() => void begin()}
          onDone={() => setPhase({ kind: 'setup' })}
        />
      ) : (
        <DrillSetup
          chords={chords}
          durationSec={durationSec}
          onChordsChange={(c) => updateSettings({ chords: c })}
          onDurationChange={(d) => updateSettings({ durationSec: d })}
          onStart={() => void begin()}
          heardId={detector.status === 'listening' ? detector.chordId : null}
        />
      )}

      <section className="card">
        <div className="card-head">
          <h2>
            Progress · {chords[0]} ↔ {chords[1]}
          </h2>
        </div>
        <ProgressSummary sessions={history} />
        <DrillHistory sessions={history} />
      </section>
    </main>
  );
}

interface SetupProps {
  chords: ChordPair;
  durationSec: number;
  onChordsChange: (chords: ChordPair) => void;
  onDurationChange: (sec: number) => void;
  onStart: () => void;
  heardId: string | null;
}

function DrillSetup({ chords, durationSec, onChordsChange, onDurationChange, onStart, heardId }: SetupProps) {
  const setChord = (index: 0 | 1, id: string) => {
    const other = chords[1 - index];
    // Picking the chord already in the other slot swaps them rather than making a pair of one.
    const next: ChordPair = index === 0 ? [id, id === other ? chords[0] : other] : [id === other ? chords[1] : other, id];
    onChordsChange(next);
  };
  const currentKey = pairKey(chords);

  return (
    <section className="card drill-setup">
      <h2>One-Minute Changes</h2>
      <p className="lede">
        Switch between two chords as many times as you can. Strum once per change, and let each chord ring
        cleanly. Only clean changes count.
      </p>

      <div className="pair-picker">
        {([0, 1] as const).map((i) => {
          const chord = CHORDS_BY_ID.get(chords[i])!;
          return (
            <div key={i} className="pair-slot">
              <select
                aria-label={i === 0 ? 'First chord' : 'Second chord'}
                value={chords[i]}
                onChange={(e) => setChord(i, e.target.value)}
              >
                {OPEN_CHORDS.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <ChordDiagram chord={chord} />
              <span className={`heard-tag${heardId === chord.id ? ' on' : ''}`}>
                {heardId === chord.id ? 'Hearing' : ' '}
              </span>
            </div>
          );
        })}
      </div>

      <div className="field">
        <span className="field-label">Suggested pairs</span>
        <div className="chips">
          {SUGGESTED_PAIRS.map((pair) => (
            <button
              key={pairKey(pair)}
              type="button"
              className="chip"
              aria-pressed={pairKey(pair) === currentKey}
              onClick={() => onChordsChange(pair)}
            >
              {pair[0]} ↔ {pair[1]}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <span className="field-label">Duration</span>
        <div className="segmented" role="group" aria-label="Duration">
          {DRILL_DURATIONS.map((d) => (
            <button key={d} type="button" aria-pressed={d === durationSec} onClick={() => onDurationChange(d)}>
              {d < 60 ? `${d}s` : `${d / 60} min`}
            </button>
          ))}
        </div>
      </div>

      <button type="button" className="primary large" onClick={onStart}>
        Start drill
      </button>
    </section>
  );
}

interface InProgressProps {
  chords: ChordPair;
  phase: Extract<Phase, { kind: 'countdown' | 'running' }>;
  now: number;
  durationSec: number;
  heardId: string | null;
  onStop: () => void;
  detector: Detector;
}

function DrillInProgress({ chords, phase, now, durationSec, heardId, onStop, detector }: InProgressProps) {
  const drill = phase.kind === 'running' ? phase.drill : null;
  const remainingMs = drill ? drill.endTime - now : durationSec * 1000;
  const elapsedFraction = drill ? Math.min(1, (now - drill.startTime) / drill.durationMs) : 0;
  const countdown = phase.kind === 'countdown' ? Math.max(1, Math.ceil((phase.endsAt - now) / 1000)) : null;
  const next = drill?.next ?? chords[0];
  const lastChange = drill?.changeTimesMs.at(-1) ?? null;

  let prompt = `Get ready on ${chords[0]}`;
  if (drill && drill.current === null) prompt = `Strum ${chords[0]} or ${chords[1]} to begin`;
  else if (drill) prompt = `Change to ${next}`;

  return (
    <main className="drill-run">
      <section className="card drill-hud">
        <div className="hud-stat">
          <span className="hud-label">Time left</span>
          <span className="hud-value">{formatClock(remainingMs)}</span>
        </div>
        <div className="hud-stat center">
          <span className="hud-label">Changes</span>
          <span key={drill?.changes ?? 0} className="hud-value big count-pop">
            {drill?.changes ?? 0}
          </span>
        </div>
        <div className="hud-stat right">
          <span className="hud-label">Last change</span>
          <span className="hud-value">{formatSeconds(lastChange)}</span>
        </div>
        <div className="bar hud-progress" aria-hidden="true">
          <div className="bar-fill neutral" style={{ width: `${elapsedFraction * 100}%`, transition: 'none' }} />
        </div>
      </section>

      <p className="drill-prompt" aria-live="polite">
        {prompt}
      </p>

      <div className="drill-chords">
        {chords.map((id) => {
          const chord = CHORDS_BY_ID.get(id)!;
          const isNext = drill !== null && drill.current !== null && id === next;
          const isHeld = drill?.current === id;
          return (
            <section
              key={id}
              className={`card drill-chord${isNext ? ' next' : ''}${isHeld ? ' held' : ''}`}
              aria-label={`${chord.name}${isNext ? ', play next' : ''}`}
            >
              <span className="drill-chord-tag">{isNext ? 'Next' : isHeld ? (heardId === id ? 'Hearing' : 'Last') : ' '}</span>
              <span className="drill-chord-name">{chord.name}</span>
              <ChordDiagram chord={chord} />
            </section>
          );
        })}
      </div>

      {countdown !== null && (
        <div className="countdown" aria-live="assertive">
          <span key={countdown}>{countdown}</span>
        </div>
      )}

      <div className="drill-footer">
        <button type="button" className="primary stop" onClick={onStop}>
          Stop without saving
        </button>
        <DevStrum engine={detector.engine} chordIds={chords} />
      </div>
    </main>
  );
}

interface ResultsProps {
  session: DrillSession;
  previousBest: number | null;
  onAgain: () => void;
  onDone: () => void;
}

function DrillResults({ session, previousBest, onAgain, onDone }: ResultsProps) {
  const rate = changesPerMinute(session.changes, session.durationSec);
  const { averageMs, fastestMs } = changeStats(session.changeTimesMs);
  const isBest = previousBest === null || rate > previousBest;

  let verdict = `Your best is ${Math.round(previousBest ?? 0)} per minute. Keep at it.`;
  if (previousBest === null) verdict = 'First session for this pair. This is the number to beat.';
  else if (isBest) verdict = `New personal best, up from ${Math.round(previousBest)} per minute.`;
  else if (Math.round(rate) === Math.round(previousBest)) verdict = 'Matched your personal best.';

  return (
    <section className="card drill-results" aria-live="polite">
      <h2>
        Result · {session.chords[0]} ↔ {session.chords[1]}
      </h2>
      <div className="result-hero">
        <span className="result-number">{session.changes}</span>
        <span className="result-unit">changes in {session.durationSec}s</span>
      </div>
      <p className={`result-verdict${isBest ? ' best' : ''}`}>{verdict}</p>
      <dl className="result-stats">
        <div>
          <dt>Per minute</dt>
          <dd>{Math.round(rate)}</dd>
        </div>
        <div>
          <dt>Avg per change</dt>
          <dd>{formatSeconds(averageMs)}</dd>
        </div>
        <div>
          <dt>Fastest change</dt>
          <dd>{formatSeconds(fastestMs)}</dd>
        </div>
      </dl>
      <div className="result-actions">
        <button type="button" className="primary large" onClick={onAgain}>
          Go again
        </button>
        <button type="button" className="secondary" onClick={onDone}>
          Change pair
        </button>
      </div>
    </section>
  );
}

function ProgressSummary({ sessions }: { sessions: DrillSession[] }) {
  const best = bestRate(sessions);
  const last = sessions.at(-1);
  return (
    <dl className="result-stats compact">
      <div>
        <dt>Best per minute</dt>
        <dd>{best === null ? '–' : Math.round(best)}</dd>
      </div>
      <div>
        <dt>Last session</dt>
        <dd>{last ? Math.round(changesPerMinute(last.changes, last.durationSec)) : '–'}</dd>
      </div>
      <div>
        <dt>Sessions</dt>
        <dd>{sessions.length}</dd>
      </div>
    </dl>
  );
}
