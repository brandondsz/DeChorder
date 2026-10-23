import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CHORDS_BY_ID, OPEN_CHORDS } from '../audio/chords';
import type { ClickKind } from '../audio/detector';
import { useChordSet, type Detector } from '../audio/useChordDetector';
import { ChordDiagram } from '../components/ChordDiagram';
import { DevStrum } from '../components/DevStrum';
import { SessionBars, sessionDateFormat } from '../components/SessionBars';
import { CUSTOM_PROGRESSION_ID, MAX_CUSTOM_CHORDS, PROGRESSIONS } from '../drill/progressions';
import {
  calibrate,
  COUNT_IN_BEATS,
  progressionKey,
  RhythmRun,
  summarizeHits,
  type Calibration,
  type RhythmHit,
} from '../drill/rhythm';
import { GRADE_LABELS, RhythmLane } from '../drill/RhythmLane';
import { useClock } from '../hooks/useClock';
import { addRhythmSession, getRhythmSessions, type RhythmSession, type RhythmSettings } from '../storage/db';
import {
  BEATS_PER_CHORD_OPTIONS,
  LOOP_OPTIONS,
  MAX_START_BPM,
  MIN_BPM,
  progressionChords,
  useRhythmSettings,
} from '../storage/useRhythmSettings';

/** Lead time between pressing Start and the first count-in click. */
const START_LEAD_MS = 800;
const CALIBRATION_BPM = 90;
const CALIBRATION_CLICKS = 16;
const CALIBRATION_LISTEN = 4;

type Phase =
  | { kind: 'setup' }
  | { kind: 'calibrating'; clicks: number[] }
  | { kind: 'calibrated'; result: Calibration | null }
  | { kind: 'running'; run: RhythmRun }
  | { kind: 'results'; session: RhythmSession; previousTop: number | null };

const unique = (ids: string[]) => [...new Set(ids)];

function percent(x: number | null): string {
  return x === null ? '–' : `${Math.round(x * 100)}%`;
}

function describeOffset(ms: number | null): string {
  if (ms === null) return '';
  if (Math.abs(ms) <= 15) return 'on the beat';
  return `${Math.abs(Math.round(ms))} ms ${ms < 0 ? 'early' : 'late'}`;
}

export function RhythmModeScreen({ detector }: { detector: Detector }) {
  const { engine } = detector;
  const [settings, updateSettings] = useRhythmSettings();
  const chords = progressionChords(settings);
  const chordSet = useMemo(() => unique(chords), [chords]);
  useChordSet(engine, chordSet);

  const [phase, setPhase] = useState<Phase>({ kind: 'setup' });
  const [history, setHistory] = useState<RhythmSession[]>([]);
  const key = progressionKey(chords, settings.beatsPerChord);

  const reloadHistory = useCallback(() => {
    getRhythmSessions(key)
      .then(setHistory)
      .catch((err) => console.warn('Could not load rhythm history', err));
  }, [key]);
  useEffect(reloadHistory, [reloadHistory]);

  const ensureAudio = async () => {
    if (engine.getSnapshot().status !== 'listening') {
      await engine.start();
      if (engine.getSnapshot().status !== 'listening' && !import.meta.env.DEV) return false;
    }
    await engine.prepareAudio();
    return true;
  };

  const begin = async () => {
    if (!(await ensureAudio())) return;
    engine.setChordSet(chordSet);
    const run = new RhythmRun(
      {
        chords,
        beatsPerChord: settings.beatsPerChord,
        startBpm: settings.bpm,
        loops: settings.loops,
        speedUp: settings.speedUp,
      },
      performance.now() + START_LEAD_MS,
      settings.latencyMs ?? 0,
    );
    setPhase({ kind: 'running', run });
  };

  const beginCalibration = async () => {
    if (!(await ensureAudio())) return;
    const start = performance.now() + START_LEAD_MS;
    const beat = 60000 / CALIBRATION_BPM;
    const clicks = Array.from({ length: CALIBRATION_CLICKS }, (_, i) => start + i * beat);
    clicks.forEach((t, i) => engine.scheduleClick(t, i < CALIBRATION_LISTEN ? 'count' : 'beat'));
    setPhase({ kind: 'calibrating', clicks });
  };

  const finish = useCallback(
    (run: RhythmRun) => {
      const hits = run.gradedHits();
      const session: RhythmSession = {
        progressionKey: progressionKey(run.config.chords, run.config.beatsPerChord),
        chords: run.config.chords,
        beatsPerChord: run.config.beatsPerChord,
        startBpm: run.config.startBpm,
        topCleanBpm: run.topCleanBpm(),
        accuracy: summarizeHits(hits).accuracy,
        hits,
        startedAt: Date.now() - (performance.now() - run.startTime),
      };
      const tops = history.flatMap((s) => (s.topCleanBpm === null ? [] : [s.topCleanBpm]));
      setPhase({ kind: 'results', session, previousTop: tops.length ? Math.max(...tops) : null });
      addRhythmSession(session)
        .then(reloadHistory)
        .catch((err) => console.warn('Could not save rhythm session', err));
    },
    [history, reloadHistory],
  );

  if (phase.kind === 'running') {
    return (
      <RhythmInProgress
        run={phase.run}
        detector={detector}
        chordSet={chordSet}
        onStop={() => setPhase({ kind: 'setup' })}
        onDone={finish}
      />
    );
  }

  return (
    <main className="layout drill-layout">
      {phase.kind === 'results' && (
        <RhythmResults
          session={phase.session}
          previousTop={phase.previousTop}
          onAgain={() => void begin()}
          onDone={() => setPhase({ kind: 'setup' })}
        />
      )}
      {phase.kind === 'calibrating' && (
        <CalibrationRun
          clicks={phase.clicks}
          detector={detector}
          onDone={(result) => setPhase({ kind: 'calibrated', result })}
        />
      )}
      {phase.kind === 'calibrated' && (
        <CalibrationResult
          result={phase.result}
          onSave={(latencyMs) => {
            updateSettings({ latencyMs });
            setPhase({ kind: 'setup' });
          }}
          onRetry={() => void beginCalibration()}
          onCancel={() => setPhase({ kind: 'setup' })}
        />
      )}
      {phase.kind === 'setup' && (
        <RhythmSetup
          settings={settings}
          chords={chords}
          onChange={updateSettings}
          onStart={() => void begin()}
          onCalibrate={() => void beginCalibration()}
        />
      )}

      <section className="card">
        <h2>Progress · {chords.join(' ')}</h2>
        <RhythmProgress sessions={history} beatsPerChord={settings.beatsPerChord} />
      </section>
    </main>
  );
}

interface SetupProps {
  settings: RhythmSettings;
  chords: string[];
  onChange: (patch: Partial<RhythmSettings>) => void;
  onStart: () => void;
  onCalibrate: () => void;
}

function RhythmSetup({ settings, chords, onChange, onStart, onCalibrate }: SetupProps) {
  const custom = settings.progressionId === CUSTOM_PROGRESSION_ID;
  const [adding, setAdding] = useState(OPEN_CHORDS[0].id);
  const canStart = unique(chords).length >= 2;

  return (
    <section className="card drill-setup">
      <h2>Rhythm Mode</h2>
      <p className="lede">
        Play a progression along with the metronome. Each change is scored on how close your strum lands to the
        first beat of the new chord. Hold the first chord during the count-in.
      </p>

      <div className="field">
        <span className="field-label">Progression</span>
        <div className="progression-list" role="radiogroup" aria-label="Progression">
          {PROGRESSIONS.map((p) => (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={settings.progressionId === p.id}
              className="progression-option"
              onClick={() => onChange({ progressionId: p.id })}
            >
              <span className="progression-name">{p.name}</span>
              <span className="progression-chords">{p.chords.join(' · ')}</span>
            </button>
          ))}
          <button
            type="button"
            role="radio"
            aria-checked={custom}
            className="progression-option"
            onClick={() => onChange({ progressionId: CUSTOM_PROGRESSION_ID })}
          >
            <span className="progression-name">Custom</span>
            <span className="progression-chords">{settings.customChords.join(' · ')}</span>
          </button>
        </div>
        {custom && (
          <div className="custom-builder">
            <div className="chips">
              {settings.customChords.map((id, i) => (
                <button
                  key={`${id}-${i}`}
                  type="button"
                  className="chip removable"
                  aria-label={`Remove ${id} (position ${i + 1})`}
                  onClick={() => onChange({ customChords: settings.customChords.filter((_, j) => j !== i) })}
                >
                  {id} <span aria-hidden="true">×</span>
                </button>
              ))}
            </div>
            <div className="dev-row">
              <select value={adding} onChange={(e) => setAdding(e.target.value)} aria-label="Chord to add">
                {OPEN_CHORDS.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={settings.customChords.length >= MAX_CUSTOM_CHORDS}
                onClick={() => onChange({ customChords: [...settings.customChords, adding] })}
              >
                Add chord
              </button>
            </div>
            {!canStart && <p className="hint">Add at least two different chords.</p>}
          </div>
        )}
      </div>

      <div className="field-row">
        <div className="field">
          <span className="field-label">Beats per chord</span>
          <div className="segmented" role="group" aria-label="Beats per chord">
            {BEATS_PER_CHORD_OPTIONS.map((n) => (
              <button key={n} type="button" aria-pressed={n === settings.beatsPerChord} onClick={() => onChange({ beatsPerChord: n })}>
                {n}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <span className="field-label">Loops</span>
          <div className="segmented" role="group" aria-label="Loops">
            {LOOP_OPTIONS.map((n) => (
              <button key={n} type="button" aria-pressed={n === settings.loops} onClick={() => onChange({ loops: n })}>
                {n}
              </button>
            ))}
          </div>
        </div>
      </div>

      <label className="gate-control">
        <span>
          Starting tempo <strong>{settings.bpm} BPM</strong>
        </span>
        <input
          type="range"
          min={MIN_BPM}
          max={MAX_START_BPM}
          step={5}
          value={settings.bpm}
          onChange={(e) => onChange({ bpm: Number(e.target.value) })}
        />
      </label>

      <label className="toggle">
        <input type="checkbox" checked={settings.speedUp} onChange={(e) => onChange({ speedUp: e.target.checked })} />
        <span>
          <strong>Speed up as I improve</strong>
          <span className="hint">+5 BPM after each loop with at least 75% clean changes.</span>
        </span>
      </label>

      <div className="calibration-row">
        <span>
          <strong>Timing calibration</strong>
          <span className="hint">
            {settings.latencyMs === null
              ? 'Not calibrated. Takes 15 seconds and makes scoring fair for your setup.'
              : `Strums are corrected by ${settings.latencyMs} ms.`}
          </span>
        </span>
        <button type="button" className="secondary" onClick={onCalibrate}>
          {settings.latencyMs === null ? 'Calibrate' : 'Recalibrate'}
        </button>
      </div>

      <button type="button" className="primary large" onClick={onStart} disabled={!canStart}>
        Start
      </button>
    </section>
  );
}

function clickKind(run: RhythmRun, beat: number): ClickKind {
  if (beat < COUNT_IN_BEATS) return 'count';
  return (beat - COUNT_IN_BEATS) % run.config.beatsPerChord === 0 ? 'down' : 'beat';
}

interface InProgressProps {
  run: RhythmRun;
  detector: Detector;
  chordSet: string[];
  onStop: () => void;
  onDone: (run: RhythmRun) => void;
}

function RhythmInProgress({ run, detector, chordSet, onStop, onDone }: InProgressProps) {
  const { engine } = detector;
  const [frame, setFrame] = useState({ beat: -1, version: 0 });
  const [feedback, setFeedback] = useState<{ hit: RhythmHit; at: number } | null>(null);
  const [tempoUpAt, setTempoUpAt] = useState<number | null>(null);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    return engine.onChordChange((chordId, _time, strumTime) => {
      const hit = run.handleChord(chordId, strumTime);
      if (hit) setFeedback({ hit, at: performance.now() });
    });
  }, [engine, run]);

  useEffect(() => {
    let raf = 0;
    let nextClick = 0;
    let lastBeat = -1;
    let lastVersion = -1;
    let knownLoops = run.loopBpms.length;
    let finished = false;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const now = performance.now();
      const missed = run.tick(now);
      if (missed.length) setFeedback({ hit: missed[missed.length - 1], at: now });
      if (run.loopBpms.length > knownLoops) {
        const prev = run.loopBpms[run.loopBpms.length - 2];
        if (run.loopBpms[run.loopBpms.length - 1] > prev) setTempoUpAt(run.loopStart(run.loopBpms.length - 1));
        knownLoops = run.loopBpms.length;
      }
      while (nextClick < run.totalBeats) {
        const t = run.beatTime(nextClick);
        if (t === null || t > now + 200) break;
        engine.scheduleClick(t, clickKind(run, nextClick));
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
        onDoneRef.current(run);
      }
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, [run, engine]);

  const now = performance.now();
  const countIn = frame.beat < COUNT_IN_BEATS;
  const currentIndex = run.targetIndexAt(Math.max(frame.beat, COUNT_IN_BEATS));
  const current = countIn ? run.targets[0] : run.targets[currentIndex];
  const next = run.targets[countIn ? 1 : currentIndex + 1];
  const hits = run.gradedHits();
  const { accuracy } = summarizeHits(hits);
  const beatInBar = countIn
    ? frame.beat
    : (frame.beat - COUNT_IN_BEATS) % run.config.beatsPerChord;
  const tempoUp = tempoUpAt !== null && now >= tempoUpAt - 1500 && now < tempoUpAt + 2500;
  const showFeedback = feedback && now - feedback.at < 1500;

  return (
    <main className="drill-run">
      <section className="card drill-hud">
        <div className="hud-stat">
          <span className="hud-label">Tempo</span>
          <span key={run.loopBpms.length} className={`hud-value${tempoUp ? ' count-pop' : ''}`}>
            {run.bpmAt(now)} BPM
          </span>
          <span className="hint hud-sub">{tempoUp ? 'Tempo up!' : ' '}</span>
        </div>
        <div className="hud-stat center">
          <span className="hud-label">Clean changes</span>
          <span className="hud-value big">{percent(accuracy)}</span>
        </div>
        <div className="hud-stat right">
          <span className="hud-label">Streak</span>
          <span className="hud-value">{run.currentStreak()}</span>
        </div>
      </section>

      <section className="card lane-card">
        <RhythmLane run={run} version={frame.version} />
        <div className="beat-dots" aria-hidden="true">
          {Array.from({ length: countIn ? COUNT_IN_BEATS : run.config.beatsPerChord }, (_, i) => (
            <span key={i} className={`beat-dot${i === beatInBar ? ' on' : ''}${i === 0 ? ' first' : ''}`} />
          ))}
        </div>
      </section>

      <div className="rhythm-now">
        <section className="card rhythm-chord current" aria-live="polite">
          <span className="drill-chord-tag">{countIn ? `Get ready · ${COUNT_IN_BEATS - Math.max(0, frame.beat)}` : 'Now'}</span>
          <span className="drill-chord-name">{current?.chord ?? '–'}</span>
          {current && CHORDS_BY_ID.get(current.chord) && <ChordDiagram chord={CHORDS_BY_ID.get(current.chord)!} />}
        </section>
        <section className="card rhythm-chord next">
          <span className="drill-chord-tag muted">Next</span>
          <span className="drill-chord-name">{next?.chord ?? 'End'}</span>
          {next && CHORDS_BY_ID.get(next.chord) && <ChordDiagram chord={CHORDS_BY_ID.get(next.chord)!} />}
        </section>
      </div>

      <p className={`rhythm-feedback${showFeedback ? ` ${feedback.hit.grade}` : ''}`} aria-live="polite">
        {showFeedback
          ? `${GRADE_LABELS[feedback.hit.grade]}${feedback.hit.offsetMs !== null ? ` · ${describeOffset(feedback.hit.offsetMs)}` : ''} · ${feedback.hit.from} → ${feedback.hit.chord}`
          : ' '}
      </p>

      <div className="drill-footer">
        <button type="button" className="primary stop" onClick={onStop}>
          Stop without saving
        </button>
        <DevStrum engine={engine} chordIds={chordSet} />
      </div>
    </main>
  );
}

function CalibrationRun({
  clicks,
  detector,
  onDone,
}: {
  clicks: number[];
  detector: Detector;
  onDone: (result: Calibration | null) => void;
}) {
  const onsets = useRef<number[]>([]);
  const [strums, setStrums] = useState(0);
  const now = useClock(true);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(
    () =>
      detector.engine.onOnset((t) => {
        onsets.current.push(t);
        if (t >= clicks[CALIBRATION_LISTEN] - 300) setStrums((n) => n + 1);
      }),
    [detector.engine, clicks],
  );

  const end = clicks[clicks.length - 1] + 400;
  useEffect(() => {
    if (now >= end) onDoneRef.current(calibrate(clicks, onsets.current, CALIBRATION_LISTEN));
  }, [now, end, clicks]);

  const clickIndex = clicks.filter((c) => c <= now).length - 1;
  const listening = clickIndex < CALIBRATION_LISTEN;

  return (
    <section className="card drill-setup">
      <h2>Timing calibration</h2>
      <p className="lede">
        {listening
          ? 'Listen to the first four clicks…'
          : 'Strum on every click. Any chord, or muted strings, is fine.'}
      </p>
      <div className="calibration-dots" aria-hidden="true">
        {clicks.map((_, i) => (
          <span
            key={i}
            className={`beat-dot${i < CALIBRATION_LISTEN ? ' listen' : ''}${i === clickIndex ? ' on' : ''}${i < clickIndex ? ' past' : ''}`}
          />
        ))}
      </div>
      <p className="hint">Strums heard: {strums}</p>
      <DevStrum engine={detector.engine} chordIds={['G']} />
    </section>
  );
}

function CalibrationResult({
  result,
  onSave,
  onRetry,
  onCancel,
}: {
  result: Calibration | null;
  onSave: (latencyMs: number) => void;
  onRetry: () => void;
  onCancel: () => void;
}) {
  return (
    <section className="card drill-results">
      <h2>Timing calibration</h2>
      {result ? (
        <>
          <div className="result-hero">
            <span className="result-number">{result.latencyMs}</span>
            <span className="result-unit">ms between click and strum</span>
          </div>
          <p className={`result-verdict${result.spreadMs <= 30 ? ' best' : ''}`}>
            {result.spreadMs <= 30
              ? `Nice and steady (±${result.spreadMs} ms across ${result.matched} strums).`
              : `A bit uneven (±${result.spreadMs} ms). It'll work, but another try may be more accurate.`}
          </p>
          <p className="hint">
            This covers your audio hardware's delay and your own timing habit. Rhythm scoring subtracts it from every
            strum.
          </p>
          <div className="result-actions">
            <button type="button" className="primary large" onClick={() => onSave(result.latencyMs)}>
              Use this
            </button>
            <button type="button" className="secondary" onClick={onRetry}>
              Try again
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="result-verdict">
            Not enough strums lined up with the clicks. Make sure you're listening (the meter on the Detector tab should
            move when you play), then strum once on each click.
          </p>
          <div className="result-actions">
            <button type="button" className="primary large" onClick={onRetry}>
              Try again
            </button>
            <button type="button" className="secondary" onClick={onCancel}>
              Cancel
            </button>
          </div>
        </>
      )}
    </section>
  );
}

function RhythmResults({
  session,
  previousTop,
  onAgain,
  onDone,
}: {
  session: RhythmSession;
  previousTop: number | null;
  onAgain: () => void;
  onDone: () => void;
}) {
  const { accuracy, counts, bestStreak, typicalOffsetMs } = summarizeHits(session.hits);
  const top = session.topCleanBpm;

  let verdict = 'No loop reached 75% clean changes yet. Try a slower tempo.';
  if (top !== null && previousTop === null) verdict = `First clean tempo for this progression: ${top} BPM.`;
  else if (top !== null && previousTop !== null && top > previousTop) verdict = `New best clean tempo: ${top} BPM, up from ${previousTop}.`;
  else if (top !== null) verdict = `Clean up to ${top} BPM. Your best is ${previousTop} BPM.`;
  const isBest = top !== null && (previousTop === null || top > previousTop);

  let tendency = '';
  if (typicalOffsetMs !== null && Math.abs(typicalOffsetMs) > 40) {
    tendency = `You tend to land ${Math.round(Math.abs(typicalOffsetMs))} ms ${typicalOffsetMs > 0 ? 'late' : 'early'}${typicalOffsetMs > 0 ? '. Start moving to the next chord a beat sooner.' : '. Let the chord ring until the beat.'}`;
  }

  return (
    <section className="card drill-results" aria-live="polite">
      <h2>Result · {session.chords.join(' ')}</h2>
      <div className="result-hero">
        <span className="result-number">{percent(accuracy)}</span>
        <span className="result-unit">clean changes</span>
      </div>
      <p className={`result-verdict${isBest ? ' best' : ''}`}>{verdict}</p>
      <dl className="grade-counts">
        {(['perfect', 'good', 'early', 'late', 'miss'] as const).map((g) => (
          <div key={g} className={g}>
            <dt>{GRADE_LABELS[g]}</dt>
            <dd>{counts[g]}</dd>
          </div>
        ))}
      </dl>
      <dl className="result-stats">
        <div>
          <dt>Best streak</dt>
          <dd>{bestStreak}</dd>
        </div>
        <div>
          <dt>Clean tempo</dt>
          <dd>{top === null ? '–' : `${top}`}</dd>
        </div>
        <div>
          <dt>Typical timing</dt>
          <dd>{typicalOffsetMs === null ? '–' : `${typicalOffsetMs > 0 ? '+' : ''}${Math.round(typicalOffsetMs)} ms`}</dd>
        </div>
      </dl>
      {tendency && <p className="hint">{tendency}</p>}
      <div className="result-actions">
        <button type="button" className="primary large" onClick={onAgain}>
          Go again
        </button>
        <button type="button" className="secondary" onClick={onDone}>
          Change settings
        </button>
      </div>
    </section>
  );
}

function RhythmProgress({ sessions, beatsPerChord }: { sessions: RhythmSession[]; beatsPerChord: number }) {
  if (sessions.length === 0) {
    return (
      <p className="hint">
        No sessions yet for this progression at {beatsPerChord} beats per chord. Your best clean tempo will show up
        here.
      </p>
    );
  }
  const tops = sessions.flatMap((s) => (s.topCleanBpm === null ? [] : [s.topCleanBpm]));
  const last = sessions[sessions.length - 1];
  const shown = Math.min(sessions.length, 20);
  return (
    <>
      <dl className="result-stats compact">
        <div>
          <dt>Best clean tempo</dt>
          <dd>{tops.length ? `${Math.max(...tops)}` : '–'}</dd>
        </div>
        <div>
          <dt>Last accuracy</dt>
          <dd>{percent(last.accuracy)}</dd>
        </div>
        <div>
          <dt>Sessions</dt>
          <dd>{sessions.length}</dd>
        </div>
      </dl>
      <SessionBars
        caption={`Clean tempo (BPM), ${shown === 1 ? 'first session' : `last ${shown} sessions`}`}
        bestLabel={(best) => `Best ${best}`}
        axisStep={20}
        bars={sessions.map((s) => ({
          key: s.id ?? s.startedAt,
          value: s.topCleanBpm,
          tooltip: [
            s.topCleanBpm === null ? 'No clean loop' : `${s.topCleanBpm} BPM clean`,
            `${percent(s.accuracy)} clean changes, started at ${s.startBpm} BPM`,
            sessionDateFormat.format(s.startedAt),
          ],
          ariaLabel: `${sessionDateFormat.format(s.startedAt)}: ${s.topCleanBpm === null ? 'no clean loop' : `clean at ${s.topCleanBpm} BPM`}, ${percent(s.accuracy)} clean`,
        }))}
        table={{
          headers: ['Date', 'Start BPM', 'Clean BPM', 'Clean changes'],
          rows: [...sessions]
            .reverse()
            .map((s) => [sessionDateFormat.format(s.startedAt), s.startBpm, s.topCleanBpm ?? '–', percent(s.accuracy)]),
        }}
      />
    </>
  );
}
