import { CHORDS_BY_ID } from '../audio/chords';
import { useChordSet, type Detector } from '../audio/useChordDetector';
import { ChordDiagram } from '../components/ChordDiagram';
import { ChordSetPicker } from '../components/ChordSetPicker';
import { ChromaVisualizer } from '../components/ChromaVisualizer';
import { DevStrum } from '../components/DevStrum';
import { InputLevel } from '../components/InputLevel';
import type { DetectorSettings } from '../storage/db';

function confidenceLabel(c: number) {
  if (c >= 0.75) return 'High';
  if (c >= 0.45) return 'Medium';
  return 'Low';
}

interface Props {
  detector: Detector;
  settings: DetectorSettings;
  onSettingsChange: (patch: Partial<DetectorSettings>) => void;
}

export function DetectorScreen({ detector, settings, onSettingsChange }: Props) {
  useChordSet(detector.engine, settings.enabledChordIds);
  const chord = detector.chordId ? (CHORDS_BY_ID.get(detector.chordId) ?? null) : null;
  const listening = detector.status === 'listening';

  let statusText = 'Press Start and allow microphone access.';
  if (detector.status === 'starting') statusText = 'Waiting for microphone…';
  else if (listening && !chord) statusText = 'Strum a chord and let it ring.';
  else if (listening && !detector.live) statusText = 'Last chord heard';
  else if (detector.live) statusText = 'Hearing';

  return (
    <main className="layout">
      <section className="card now-playing" aria-live="polite">
        <p className="status">
          {listening && <span className={`pulse${detector.live ? ' on' : ''}`} aria-hidden="true" />}
          {statusText}
        </p>
        <div className={`chord-name${detector.live ? '' : ' held'}`}>{chord?.name ?? '—'}</div>
        <div className="confidence">
          <div className="confidence-row">
            <span>Confidence</span>
            <span>
              {chord ? `${confidenceLabel(detector.confidence)} · ${Math.round(detector.confidence * 100)}%` : '–'}
            </span>
          </div>
          <div className="bar">
            <div
              className={`bar-fill ${confidenceLabel(detector.confidence).toLowerCase()}`}
              style={{ width: chord ? `${detector.confidence * 100}%` : 0 }}
            />
          </div>
        </div>
        <div className="diagram-slot">{chord && <ChordDiagram chord={chord} />}</div>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Notes heard</h2>
          {detector.tuningCents !== null && (
            <span className="tuning" title="How far your guitar sits from standard A440 pitch">
              Tuning {detector.tuningCents >= 0 ? '+' : '−'}
              {Math.abs(Math.round(detector.tuningCents))}¢
            </span>
          )}
        </div>
        <ChromaVisualizer chroma={detector.engine.chroma} chord={chord} />
        <p className="hint legend">
          <span className="swatch accent" /> notes in the detected chord
          <span className="swatch bar" /> other notes
          <span className="swatch marker" /> expected level
        </p>

        <h2 className="spaced">Closest matches</h2>
        <ol className="candidates">
          {detector.candidates.length === 0 && <li className="empty">Nothing yet</li>}
          {detector.candidates.map((c) => (
            <li key={c.id}>
              <span className="candidate-name">{CHORDS_BY_ID.get(c.id)?.name}</span>
              <div className="bar small">
                <div className="bar-fill neutral" style={{ width: `${Math.max(0, c.similarity) * 100}%` }} />
              </div>
              <span className="candidate-score">{Math.round(c.similarity * 100)}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className="card settings">
        <h2>Chords to listen for</h2>
        <ChordSetPicker
          enabledIds={settings.enabledChordIds}
          onChange={(ids) => onSettingsChange({ enabledChordIds: ids })}
        />
      </section>

      <section className="card settings">
        <h2>Input</h2>
        <InputLevel
          levelDb={detector.levelDb}
          gateDb={settings.gateDb}
          onGateChange={(gateDb) => onSettingsChange({ gateDb })}
        />
        <DevStrum engine={detector.engine} />
      </section>
    </main>
  );
}
