import { useEffect, useState } from 'react';
import { useDetectorEngine } from './audio/useChordDetector';
import { DetectorScreen } from './screens/DetectorScreen';
import { OneMinuteChangesScreen } from './screens/OneMinuteChangesScreen';
import { ReactionModeScreen } from './screens/ReactionModeScreen';
import { RhythmModeScreen } from './screens/RhythmModeScreen';
import { SongModeScreen } from './screens/SongModeScreen';
import { useDetectorSettings } from './storage/useDetectorSettings';
import { useTheme, type ThemePref } from './theme';

const SCREENS = [
  { id: 'detector', label: 'Detector' },
  { id: 'changes', label: 'One-Minute Changes' },
  { id: 'reaction', label: 'Reaction Mode' },
  { id: 'rhythm', label: 'Rhythm Mode' },
  { id: 'songs', label: 'Songs' },
] as const;

type ScreenId = (typeof SCREENS)[number]['id'];

const THEMES: { id: ThemePref; label: string; icon: string; title: string }[] = [
  { id: 'auto', label: 'Auto', icon: '◐', title: 'Follow my system setting' },
  { id: 'light', label: 'Bright', icon: '☀', title: 'Bright theme' },
  { id: 'dark', label: 'Dark', icon: '☾', title: 'Dark theme' },
];

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
  const [themePref, setThemePref] = useTheme();
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
        <div className="theme-switch" role="radiogroup" aria-label="Theme">
          {THEMES.map((t) => (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={themePref === t.id}
              title={t.title}
              onClick={() => setThemePref(t.id)}
            >
              <span aria-hidden="true">{t.icon}</span>
              <span className="theme-label">{t.label}</span>
            </button>
          ))}
        </div>
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
      {screen === 'songs' && <SongModeScreen detector={detector} />}
    </div>
  );
}
