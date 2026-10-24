import { useCallback, useEffect, useMemo, useState } from 'react';
import { CHORDS_BY_ID, OPEN_CHORDS } from '../audio/chords';
import type { ClickKind } from '../audio/detector';
import { useChordSet, type Detector } from '../audio/useChordDetector';
import { ChordDiagram } from '../components/ChordDiagram';
import { DevStrum } from '../components/DevStrum';
import { SessionBars, sessionDateFormat } from '../components/SessionBars';
import { describeHit, readyToPlay, usePlayAlong } from '../drill/usePlayAlong';
import { chordsInSong, parseSong, songHasErrors, type ParsedSong } from '../song/chordpro';
import { EXAMPLE_SONGS, NEW_SONG_TEMPLATE } from '../song/examples';
import { SongSheet, type ChordState } from '../song/SongSheet';
import {
  RATING_LABELS,
  rateSection,
  SongRun,
  summarizeSong,
  type SongHit,
  type SongSummary,
} from '../song/songRun';
import {
  addSongSession,
  deleteSong,
  getSongSessions,
  getSongs,
  saveSong,
  type SongRecord,
  type SongSession,
} from '../storage/db';
import { useRhythmSettings } from '../storage/useRhythmSettings';
import {
  DEFAULT_SPEED_PERCENT,
  MAX_SPEED_PERCENT,
  MIN_SPEED_PERCENT,
  useSongSettings,
} from '../storage/useSongSettings';

const START_LEAD_MS = 800;
const WHOLE_SONG = 'Whole song';
const LOOP_OPTIONS = [2, 4, 8];

interface LibrarySong {
  key: string;
  source: string;
  parsed: ParsedSong;
  /** Present for the user's own songs; examples are built in and read-only. */
  record?: SongRecord;
}

type View =
  | { kind: 'library' }
  | { kind: 'edit'; key: string | null; draft: string }
  | { kind: 'song'; key: string }
  | { kind: 'running'; key: string; run: SongRun; scope: string; speedPercent: number; section: number | null }
  | {
      kind: 'results';
      key: string;
      run: SongRun;
      summary: SongSummary;
      scope: string;
      speedPercent: number;
      section: number | null;
    };

const percent = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 100)}%` : '–');

export function SongModeScreen({ detector }: { detector: Detector }) {
  const { engine } = detector;
  const [records, setRecords] = useState<SongRecord[]>([]);
  const [view, setView] = useState<View>({ kind: 'library' });
  const [songSettings, updateSongSettings] = useSongSettings();
  const [rhythmSettings] = useRhythmSettings();

  const reloadSongs = useCallback(() => {
    getSongs()
      .then(setRecords)
      .catch((err) => console.warn('Could not load songs', err));
  }, []);
  useEffect(reloadSongs, [reloadSongs]);

  const library = useMemo<LibrarySong[]>(
    () => [
      ...records.map((record) => ({ key: `song:${record.id}`, source: record.source, parsed: parseSong(record.source), record })),
      ...EXAMPLE_SONGS.map((e) => ({ key: `example:${e.id}`, source: e.source, parsed: parseSong(e.source) })),
    ],
    [records],
  );
  const find = (key: string) => library.find((s) => s.key === key);
  const selected = 'key' in view && view.key ? find(view.key) : undefined;
  useChordSet(engine, selected ? chordsInSong(selected.parsed) : OPEN_CHORDS.map((c) => c.id));

  const speedFor = (key: string) => songSettings.speedPercent[key] ?? DEFAULT_SPEED_PERCENT;

  const play = async (song: LibrarySong, section: number | null, repeats: number, speedPercent: number) => {
    if (!(await readyToPlay(engine))) return;
    engine.setChordSet(chordsInSong(song.parsed));
    const run = new SongRun(
      song.parsed,
      {
        bpm: Math.round((song.parsed.bpm * speedPercent) / 100),
        latencyMs: rhythmSettings.latencyMs ?? 0,
        sections: section === null ? undefined : [section],
        repeats,
      },
      performance.now() + START_LEAD_MS,
    );
    const scope = section === null ? WHOLE_SONG : song.parsed.sections[section].label;
    setView({ kind: 'running', key: song.key, run, scope, speedPercent, section });
  };

  const finish = (key: string, run: SongRun, scope: string, speedPercent: number, section: number | null) => {
    const summary = summarizeSong(run.gradedHits());
    setView({ kind: 'results', key, run, summary, scope, speedPercent, section });
    const session: SongSession = {
      songKey: key,
      scope,
      speedPercent,
      bpm: run.bpm,
      changes: summary.changes,
      clean: summary.clean,
      landed: summary.landed,
      stalls: summary.stalls,
      sections: summary.sections.map((s) => ({
        label: run.song.sections[s.section].label,
        changes: s.changes,
        clean: s.clean,
      })),
      startedAt: Date.now() - (performance.now() - run.startTime),
    };
    addSongSession(session).catch((err) => console.warn('Could not save song session', err));
  };

  if (view.kind === 'edit') {
    const existing = view.key ? find(view.key) : undefined;
    return (
      <SongEditor
        draft={view.draft}
        onDraftChange={(draft) => setView({ ...view, draft })}
        canDelete={Boolean(existing?.record)}
        onCancel={() => setView(view.key ? { kind: 'song', key: view.key } : { kind: 'library' })}
        onSave={async () => {
          const now = Date.now();
          const id = await saveSong({
            ...(existing?.record ?? { createdAt: now }),
            source: view.draft,
            updatedAt: now,
          });
          reloadSongs();
          setView({ kind: 'song', key: `song:${id}` });
        }}
        onDelete={async () => {
          if (!existing?.record?.id) return;
          if (!window.confirm(`Delete "${existing.parsed.title}" and its practice history?`)) return;
          await deleteSong(existing.record.id);
          reloadSongs();
          setView({ kind: 'library' });
        }}
      />
    );
  }

  if (!selected || view.kind === 'library') {
    return (
      <SongLibrary
        songs={library}
        onOpen={(key) => setView({ kind: 'song', key })}
        onNew={() => setView({ kind: 'edit', key: null, draft: NEW_SONG_TEMPLATE })}
      />
    );
  }

  if (view.kind === 'running') {
    return (
      <SongInProgress
        key={view.run.startTime}
        run={view.run}
        scope={view.scope}
        speedPercent={view.speedPercent}
        detector={detector}
        onStop={() => setView({ kind: 'song', key: view.key })}
        onDone={() => finish(view.key, view.run, view.scope, view.speedPercent, view.section)}
      />
    );
  }

  if (view.kind === 'results') {
    return (
      <SongResults
        song={selected}
        summary={view.summary}
        scope={view.scope}
        speedPercent={view.speedPercent}
        bpm={view.run.bpm}
        onReplay={() => void play(selected, view.section, view.run.options.repeats ?? 1, view.speedPercent)}
        onPractise={(section, speed) => {
          updateSongSettings({ speedPercent: { ...songSettings.speedPercent, [selected.key]: speed } });
          void play(selected, section, section === null ? 1 : 4, speed);
        }}
        onBack={() => setView({ kind: 'song', key: selected.key })}
      />
    );
  }

  return (
    <SongPage
      song={selected}
      speedPercent={speedFor(selected.key)}
      latencyMs={rhythmSettings.latencyMs}
      onSpeedChange={(p) => updateSongSettings({ speedPercent: { ...songSettings.speedPercent, [selected.key]: p } })}
      onPlay={(section, repeats) => void play(selected, section, repeats, speedFor(selected.key))}
      onEdit={() => setView({ kind: 'edit', key: selected.record ? selected.key : null, draft: selected.source })}
      onBack={() => setView({ kind: 'library' })}
    />
  );
}

function SongLibrary({ songs, onOpen, onNew }: { songs: LibrarySong[]; onOpen: (key: string) => void; onNew: () => void }) {
  const mine = songs.filter((s) => s.record);
  const examples = songs.filter((s) => !s.record);
  const card = (song: LibrarySong) => (
    <button key={song.key} type="button" className="song-card" onClick={() => onOpen(song.key)}>
      <span className="song-card-title">{song.parsed.title}</span>
      <span className="song-card-artist">{song.parsed.artist || ' '}</span>
      <span className="song-card-chords">
        {chordsInSong(song.parsed).map((c) => (
          <span key={c} className="mini-chip">
            {c}
          </span>
        ))}
      </span>
      <span className="song-card-meta">
        {song.parsed.bpm} BPM · {song.parsed.beatsPerBar}/4
        {songHasErrors(song.parsed) && <span className="song-card-error"> · has problems</span>}
      </span>
    </button>
  );

  return (
    <main className="song-library">
      <section className="card">
        <div className="card-head">
          <h2>Your songs</h2>
          <button type="button" className="primary" onClick={onNew}>
            New song
          </button>
        </div>
        <p className="lede">
          Paste a chord chart for a song you want to learn and play it through with the metronome. The aim is to keep
          going: get through the whole song without stopping, then make each change clean.
        </p>
        {mine.length ? (
          <div className="song-grid">{mine.map(card)}</div>
        ) : (
          <p className="hint">No songs yet. Add one with New song, or warm up with a practice song below.</p>
        )}
      </section>
      <section className="card">
        <h2>Practice songs</h2>
        <div className="song-grid">{examples.map(card)}</div>
      </section>
    </main>
  );
}

interface EditorProps {
  draft: string;
  onDraftChange: (draft: string) => void;
  canDelete: boolean;
  onSave: () => void;
  onCancel: () => void;
  onDelete: () => void;
}

function SongEditor({ draft, onDraftChange, canDelete, onSave, onCancel, onDelete }: EditorProps) {
  const parsed = useMemo(() => parseSong(draft), [draft]);
  const errors = songHasErrors(parsed);

  return (
    <main className="layout drill-layout">
      <section className="card editor">
        <div className="card-head">
          <h2>Chord chart</h2>
          <div className="result-actions">
            {canDelete && (
              <button type="button" className="secondary danger" onClick={onDelete}>
                Delete
              </button>
            )}
            <button type="button" className="secondary" onClick={onCancel}>
              Cancel
            </button>
            <button type="button" className="primary" onClick={onSave} disabled={errors}>
              Save
            </button>
          </div>
        </div>
        <textarea
          className="chart-input"
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          spellCheck={false}
          aria-label="Chord chart"
        />
        <details className="syntax-help">
          <summary>How to write a chart</summary>
          <ul>
            <li>
              <code>[G]Take me [C]home</code>: put each chord right before the word it lands on.
            </li>
            <li>
              Each chord lasts one bar. <code>[D:2]</code> lasts 2 beats, <code>[G:8]</code> two bars.
            </li>
            <li>
              <code>[Verse]</code>, <code>[Chorus]</code>, <code>[Bridge]</code> on their own line start a section.{' '}
              <code>{'{chorus}'}</code> repeats the last chorus.
            </li>
            <li>
              <code>{'{title: …}'}</code>, <code>{'{artist: …}'}</code>, <code>{'{tempo: 90}'}</code>,{' '}
              <code>{'{time: 3/4}'}</code> set the details.
            </li>
            <li>
              <code>[N.C.]</code> is a rest. Slash chords like <code>[C/G]</code> are played as <code>C</code>.
            </li>
            <li>Chords must be open chords DeChorder knows: {OPEN_CHORDS.map((c) => c.id).join(', ')}.</li>
          </ul>
        </details>
      </section>

      <section className="card">
        <h2>Preview · {parsed.title}</h2>
        {parsed.problems.length > 0 && (
          <ul className="problems">
            {parsed.problems.map((p, i) => (
              <li key={i} className={p.severity}>
                <strong>Line {p.line}:</strong> {p.message}
              </li>
            ))}
          </ul>
        )}
        <SongSheet song={parsed} className="preview" />
      </section>
    </main>
  );
}

interface SongPageProps {
  song: LibrarySong;
  speedPercent: number;
  latencyMs: number | null;
  onSpeedChange: (p: number) => void;
  onPlay: (section: number | null, repeats: number) => void;
  onEdit: () => void;
  onBack: () => void;
}

function SongPage({ song, speedPercent, latencyMs, onSpeedChange, onPlay, onEdit, onBack }: SongPageProps) {
  const { parsed } = song;
  const [section, setSection] = useState<number | null>(null);
  const [repeats, setRepeats] = useState(4);
  const [history, setHistory] = useState<SongSession[]>([]);
  const errors = songHasErrors(parsed);
  const bpm = Math.round((parsed.bpm * speedPercent) / 100);

  useEffect(() => {
    getSongSessions(song.key)
      .then(setHistory)
      .catch((err) => console.warn('Could not load song history', err));
  }, [song.key]);

  return (
    <main className="layout drill-layout">
      <section className="card drill-setup">
        <div className="card-head">
          <button type="button" className="link-button" onClick={onBack}>
            ← All songs
          </button>
          <button type="button" className="secondary" onClick={onEdit}>
            {song.record ? 'Edit chart' : 'Copy to my songs'}
          </button>
        </div>
        <div>
          <h2 className="song-title">{parsed.title}</h2>
          {parsed.artist && <p className="lede">{parsed.artist}</p>}
        </div>

        <div className="field">
          <span className="field-label">Chords in this song</span>
          <div className="song-chord-diagrams">
            {chordsInSong(parsed).map((id) => (
              <figure key={id}>
                <figcaption>{id}</figcaption>
                <ChordDiagram chord={CHORDS_BY_ID.get(id)!} />
              </figure>
            ))}
          </div>
        </div>

        <div className="field">
          <span className="field-label">What to play</span>
          <div className="chips">
            <button type="button" className="chip" aria-pressed={section === null} onClick={() => setSection(null)}>
              {WHOLE_SONG}
            </button>
            {parsed.sections.map((s, i) =>
              parsed.events.some((e) => e.section === i) ? (
                <button key={i} type="button" className="chip" aria-pressed={section === i} onClick={() => setSection(i)}>
                  Loop {s.label}
                </button>
              ) : null,
            )}
          </div>
        </div>

        {section !== null && (
          <div className="field">
            <span className="field-label">Times through</span>
            <div className="segmented" role="group" aria-label="Times through">
              {LOOP_OPTIONS.map((n) => (
                <button key={n} type="button" aria-pressed={n === repeats} onClick={() => setRepeats(n)}>
                  {n}×
                </button>
              ))}
            </div>
          </div>
        )}

        <label className="gate-control">
          <span>
            Practice speed{' '}
            <strong>
              {speedPercent}% · {bpm} BPM
            </strong>{' '}
            <span className="hint inline">(song: {parsed.bpm} BPM)</span>
          </span>
          <input
            type="range"
            min={MIN_SPEED_PERCENT}
            max={MAX_SPEED_PERCENT}
            step={5}
            value={speedPercent}
            onChange={(e) => onSpeedChange(Number(e.target.value))}
          />
        </label>

        {latencyMs === null && (
          <p className="hint">
            Tip: run the timing calibration in Rhythm Mode first so changes are scored fairly for your setup.
          </p>
        )}

        <button
          type="button"
          className="primary large"
          onClick={() => onPlay(section, section === null ? 1 : repeats)}
          disabled={errors}
        >
          {section === null ? 'Play the song' : `Loop ${parsed.sections[section].label}`}
        </button>
        {errors && <p className="hint">This chart has problems. Open it in the editor to fix them.</p>}
      </section>

      <section className="card">
        <h2>Chart</h2>
        <SongSheet song={parsed} focusSections={section === null ? null : new Set([section])} className="preview" />
        <h2 className="spaced">Progress</h2>
        <SongProgress sessions={history} />
      </section>
    </main>
  );
}

function SongProgress({ sessions }: { sessions: SongSession[] }) {
  if (sessions.length === 0) {
    return <p className="hint">Play it through once and your progress will show up here.</p>;
  }
  const throughRuns = sessions.filter((s) => s.scope === WHOLE_SONG && s.stalls === 0);
  const bestThrough = throughRuns.length ? Math.max(...throughRuns.map((s) => s.speedPercent)) : null;
  const last = sessions[sessions.length - 1];
  const shown = Math.min(sessions.length, 20);
  return (
    <>
      <dl className="result-stats compact">
        <div>
          <dt>Played through at</dt>
          <dd>{bestThrough === null ? '–' : `${bestThrough}%`}</dd>
        </div>
        <div>
          <dt>Last clean</dt>
          <dd>{percent(last.clean, last.changes)}</dd>
        </div>
        <div>
          <dt>Sessions</dt>
          <dd>{sessions.length}</dd>
        </div>
      </dl>
      <SessionBars
        caption={`Clean changes (%), ${shown === 1 ? 'first session' : `last ${shown} sessions`}`}
        bestLabel={(best) => `Best ${Math.round(best)}%`}
        axisStep={25}
        bars={sessions.map((s) => {
          const clean = s.changes ? (s.clean / s.changes) * 100 : null;
          return {
            key: s.id ?? s.startedAt,
            value: clean,
            tooltip: [
              clean === null ? 'No changes' : `${Math.round(clean)}% clean`,
              `${s.scope} at ${s.speedPercent}% · ${s.stalls === 0 ? 'no stalls' : `${s.stalls} stall${s.stalls === 1 ? '' : 's'}`}`,
              sessionDateFormat.format(s.startedAt),
            ],
            ariaLabel: `${sessionDateFormat.format(s.startedAt)}: ${s.scope} at ${s.speedPercent}%, ${clean === null ? 'no changes' : `${Math.round(clean)}% clean`}`,
          };
        })}
        table={{
          headers: ['Date', 'Played', 'Speed', 'Clean', 'Stalls'],
          rows: [...sessions]
            .reverse()
            .map((s) => [sessionDateFormat.format(s.startedAt), s.scope, `${s.speedPercent}%`, percent(s.clean, s.changes), s.stalls]),
        }}
      />
    </>
  );
}

interface InProgressProps {
  run: SongRun;
  scope: string;
  speedPercent: number;
  detector: Detector;
  onStop: () => void;
  onDone: () => void;
}

function SongInProgress({ run, scope, speedPercent, detector, onStop, onDone }: InProgressProps) {
  const { song } = run;
  const stepStarts = useMemo(() => new Set(run.steps.map((s) => s.beat)), [run]);
  const clickKind = (beat: number): ClickKind => {
    if (beat < run.countInBeats) return 'count';
    return stepStarts.has(beat) ? 'down' : 'beat';
  };
  const { beat, feedback } = usePlayAlong<SongHit>(run, detector.engine, clickKind, onDone);

  const countIn = beat < run.countInBeats;
  const index = run.stepIndexAt(beat);
  const current = countIn ? run.steps[0] : run.steps[index];
  // Skip rests when showing what's next; you need to know the next chord to reach for.
  const next = run.steps.slice((countIn ? 0 : index) + 1).find((s) => s.chord !== null);
  const summary = summarizeSong(run.gradedHits());

  // Each event shows the state of its most recent play (a looped section repeats events).
  const eventStates: (ChordState | undefined)[] = [];
  run.steps.forEach((step, i) => {
    if (i > index) return;
    const hit = run.hits[i];
    eventStates[step.event] = i === index && !countIn ? 'current' : hit ? hit.grade : 'played';
  });
  if (countIn && current) eventStates[current.event] = 'current';

  const beatInBar = countIn ? beat : (beat - run.countInBeats) % song.beatsPerBar;
  const progress = Math.max(0, Math.min(1, (beat - run.countInBeats) / (run.totalBeats - run.countInBeats)));
  const focus = run.options.sections ? new Set(run.options.sections) : null;

  return (
    <main className="drill-run">
      <section className="card drill-hud">
        <div className="hud-stat">
          <span className="hud-label">{scope === WHOLE_SONG ? song.title : scope}</span>
          <span className="hud-value">{countIn ? 'Count-in' : song.sections[current.section]?.label}</span>
          <span className="hint hud-sub">
            {run.bpm} BPM · {speedPercent}%
          </span>
        </div>
        <div className="hud-stat center">
          <span className="hud-label">Clean changes</span>
          <span className="hud-value big">{percent(summary.clean, summary.changes)}</span>
        </div>
        <div className="hud-stat right">
          <span className="hud-label">Stalls</span>
          <span key={summary.stalls} className={`hud-value${summary.stalls ? ' count-pop' : ''}`}>
            {summary.stalls}
          </span>
        </div>
        <div className="bar hud-progress" aria-hidden="true">
          <div className="bar-fill neutral" style={{ width: `${progress * 100}%`, transition: 'none' }} />
        </div>
      </section>

      <div className="song-play">
        <section className="card song-play-sheet">
          <SongSheet song={song} eventStates={eventStates} currentEvent={current?.event ?? null} focusSections={focus} />
        </section>

        <aside className="song-play-side">
          <section className="card rhythm-chord current" aria-live="polite">
            <span className="drill-chord-tag">
              {countIn ? `Get ready · ${run.countInBeats - Math.max(0, beat)}` : current?.chord ? 'Now' : 'Rest'}
            </span>
            <span className="drill-chord-name">{current?.chord ?? '–'}</span>
            {current?.chord && <ChordDiagram chord={CHORDS_BY_ID.get(current.chord)!} />}
            <div className="beat-dots" aria-hidden="true">
              {Array.from({ length: song.beatsPerBar }, (_, i) => (
                <span key={i} className={`beat-dot${i === beatInBar ? ' on' : ''}${i === 0 ? ' first' : ''}`} />
              ))}
            </div>
          </section>
          <section className="card rhythm-chord next">
            <span className="drill-chord-tag muted">Next</span>
            <span className="drill-chord-name">{next?.chord ?? 'End'}</span>
          </section>
          <p className={`rhythm-feedback${feedback ? ` ${feedback.hit.grade}` : ''}`} aria-live="polite">
            {feedback ? describeHit(feedback.hit) : ' '}
          </p>
        </aside>
      </div>

      <div className="drill-footer">
        <button type="button" className="primary stop" onClick={onStop}>
          Stop without saving
        </button>
        <DevStrum engine={detector.engine} chordIds={chordsInSong(song)} />
      </div>
    </main>
  );
}

interface ResultsProps {
  song: LibrarySong;
  summary: SongSummary;
  scope: string;
  speedPercent: number;
  bpm: number;
  onReplay: () => void;
  onPractise: (section: number | null, speedPercent: number) => void;
  onBack: () => void;
}

function SongResults({ song, summary, scope, speedPercent, bpm, onReplay, onPractise, onBack }: ResultsProps) {
  const { parsed } = song;
  const throughOk = summary.stalls === 0;
  const weakest = [...summary.sections]
    .filter((s) => s.rating !== 'solid' && s.changes >= 2)
    .sort((a, b) => a.clean / a.changes - b.clean / b.changes)[0];
  const allSolid = summary.sections.every((s) => s.rating === 'solid');

  return (
    <main className="layout drill-layout">
      <section className="card drill-results" aria-live="polite">
        <h2>
          {parsed.title} · {scope} at {speedPercent}%
        </h2>
        <div className="result-hero">
          <span className="result-headline">{throughOk ? 'Played it through!' : `${summary.stalls} stall${summary.stalls === 1 ? '' : 's'}`}</span>
        </div>
        <p className={`result-verdict${throughOk ? ' best' : ''}`}>
          {throughOk
            ? 'You kept going from start to finish without getting lost. That is the big one.'
            : 'A stall is two or more changes missed in a row. Loop the tricky part slowly, then try the whole song again.'}
        </p>
        <dl className="result-stats">
          <div>
            <dt>Clean changes</dt>
            <dd>{percent(summary.clean, summary.changes)}</dd>
          </div>
          <div>
            <dt>Changes played</dt>
            <dd>{percent(summary.landed, summary.changes)}</dd>
          </div>
          <div>
            <dt>Tempo</dt>
            <dd>{bpm}</dd>
          </div>
        </dl>

        <div className="field">
          <span className="field-label">By section</span>
          <ul className="section-ratings">
            {summary.sections.map((s) => (
              <li key={s.section} className={s.rating}>
                <span className="section-name">{parsed.sections[s.section].label}</span>
                <span className="bar small">
                  <span className="bar-fill neutral" style={{ width: `${(s.clean / Math.max(1, s.changes)) * 100}%` }} />
                </span>
                <span className="section-rating">
                  {RATING_LABELS[rateSection(s.clean, s.changes)]} · {s.clean}/{s.changes}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="result-actions wrap">
          {weakest ? (
            <button
              type="button"
              className="primary large"
              onClick={() => onPractise(weakest.section, Math.max(MIN_SPEED_PERCENT, speedPercent - 10))}
            >
              Loop {parsed.sections[weakest.section].label} at {Math.max(MIN_SPEED_PERCENT, speedPercent - 10)}%
            </button>
          ) : allSolid && throughOk && speedPercent < MAX_SPEED_PERCENT ? (
            <button
              type="button"
              className="primary large"
              onClick={() => onPractise(null, Math.min(MAX_SPEED_PERCENT, speedPercent + 10))}
            >
              Whole song at {Math.min(MAX_SPEED_PERCENT, speedPercent + 10)}%
            </button>
          ) : null}
          <button type="button" className="secondary" onClick={onReplay}>
            Play again
          </button>
          <button type="button" className="secondary" onClick={onBack}>
            Back to song
          </button>
        </div>
      </section>

      <section className="card">
        <h2>Chart</h2>
        <SongSheet song={parsed} className="preview" />
      </section>
    </main>
  );
}
