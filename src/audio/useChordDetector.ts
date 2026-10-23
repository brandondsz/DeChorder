import { useEffect, useState, useSyncExternalStore } from 'react';
import { DetectorEngine } from './detector';

/** One engine for the whole app, so the microphone stays open across screens. */
export function useDetectorEngine(gateDb: number) {
  const [engine] = useState(() => new DetectorEngine());

  useEffect(() => {
    // Handy for poking at timing from the browser console during development.
    if (import.meta.env.DEV) (window as unknown as { dechorder: DetectorEngine }).dechorder = engine;
  }, [engine]);
  const snapshot = useSyncExternalStore(engine.subscribe, engine.getSnapshot);

  useEffect(() => {
    engine.setGate(gateDb);
  }, [engine, gateDb]);

  useEffect(() => () => engine.stop(), [engine]);

  return { engine, ...snapshot };
}

export type Detector = ReturnType<typeof useDetectorEngine>;

/** Restrict what the engine listens for while the calling screen is mounted. */
export function useChordSet(engine: DetectorEngine, chordIds: string[]) {
  const chordKey = chordIds.join(',');
  useEffect(() => {
    engine.setChordSet(chordKey.split(','));
  }, [engine, chordKey]);
}
