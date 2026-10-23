import { CHORD_PRESETS, CHORDS_BY_ID } from '../audio/chords';
import type { DetectorSettings } from './db';
import { usePersistentSetting } from './usePersistentSetting';

export const DEFAULT_SETTINGS: DetectorSettings = {
  enabledChordIds: CHORD_PRESETS[0].chordIds,
  gateDb: -50,
};

function sanitize(stored: DetectorSettings | undefined): DetectorSettings {
  if (!stored) return DEFAULT_SETTINGS;
  const ids = (stored.enabledChordIds ?? []).filter((id) => CHORDS_BY_ID.has(id));
  return {
    enabledChordIds: ids.length > 0 ? ids : DEFAULT_SETTINGS.enabledChordIds,
    gateDb: Number.isFinite(stored.gateDb) ? stored.gateDb : DEFAULT_SETTINGS.gateDb,
  };
}

export function useDetectorSettings() {
  return usePersistentSetting('detector', DEFAULT_SETTINGS, sanitize);
}
