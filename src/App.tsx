import { useEffect, useState } from 'react';
import { useDetectorEngine } from './audio/useChordDetector';
import { DetectorScreen } from './screens/DetectorScreen';
import { OneMinuteChangesScreen } from './screens/OneMinuteChangesScreen';
import { ReactionModeScreen } from './screens/ReactionModeScreen';
import { RhythmModeScreen } from './screens/RhythmModeScreen';
import { useDetectorSettings } from './storage/useDetectorSettings';

const SCREENS = [
  { id: 'detector', label: 'Detector' },
  { id: 'changes', label: 'One-Minute Changes' },
  { id: 'reaction', label: 'Reaction Mode' },
  { id: 'rhythm', label: 'Rhythm Mode' },
] as const;

type ScreenId = (typeof SCREENS)[number]['id'];

function screenFromHash(): ScreenId {
  const id = window.location.hash.replace(/^#\/?/, '');
  return SCREENS.find((s) => s.id === id)?.id ?? 'detector';
}

function useHashScreen() {
  const [screen, setScreen] = useState(screenFromHash);
  useEffect(() => {
    const onHash = () => setScreen(screenFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  return screen;
}

export default function App() {
  const [settings, updateSettings] = useDetectorSettings();
  const detector = useDetectorEngine(settings.gateDb);
  const screen = useHashScreen();
  const listening = detector.status === 'listening';

  return (
    <div className="app">
      <header className="topbar">
        <h1>DeChorder</h1>
        <nav className="tabs" aria-label="Screens">
          {SCREENS.map((s) => (
            <a key={s.id} href={`#/${s.id}`} className="tab" aria-current={screen === s.id ? 'page' : undefined}>
              {s.label}
            </a>
          ))}
        </nav>
        <button
          type="button"
          className={`primary${listening ? ' stop' : ''}`}
          onClick={() => (listening ? detector.engine.stop() : void detector.engine.start())}
          disabled={detector.status === 'starting'}
        >
          {listening ? 'Stop listening' : 'Start listening'}
        </button>
      </header>

      {detector.error && (
        <div className="error" role="alert">
          {detector.error}
        </div>
      )}

      {screen === 'detector' && (
        <DetectorScreen detector={detector} settings={settings} onSettingsChange={updateSettings} />
      )}
      {screen === 'changes' && <OneMinuteChangesScreen detector={detector} />}
      {screen === 'reaction' && <ReactionModeScreen detector={detector} />}
      {screen === 'rhythm' && <RhythmModeScreen detector={detector} />}
    </div>
  );
}
