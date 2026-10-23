import { CHORDS_BY_ID } from '../audio/chords';
import { SUGGESTED_PAIRS } from '../drill/changeDrill';
import type { DrillSettings } from './db';
import { usePersistentSetting } from './usePersistentSetting';

export const DRILL_DURATIONS = [30, 60, 120];

const DEFAULT_DRILL: DrillSettings = { chords: SUGGESTED_PAIRS[0], durationSec: 60 };

function sanitize(stored: DrillSettings | undefined): DrillSettings {
  if (!stored) return DEFAULT_DRILL;
  const [a, b] = stored.chords ?? [];
  const validPair = CHORDS_BY_ID.has(a) && CHORDS_BY_ID.has(b) && a !== b;
  return {
    chords: validPair ? [a, b] : DEFAULT_DRILL.chords,
    durationSec: DRILL_DURATIONS.includes(stored.durationSec) ? stored.durationSec : DEFAULT_DRILL.durationSec,
  };
}

export function useDrillSettings() {
  return usePersistentSetting('drill', DEFAULT_DRILL, sanitize);
}
