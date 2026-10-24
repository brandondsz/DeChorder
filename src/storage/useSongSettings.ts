import type { SongSettings } from './db';
import { usePersistentSetting } from './usePersistentSetting';

export const MIN_SPEED_PERCENT = 50;
export const MAX_SPEED_PERCENT = 100;
export const DEFAULT_SPEED_PERCENT = 70;

const DEFAULT_SONGS: SongSettings = { speedPercent: {} };

function sanitize(stored: SongSettings | undefined): SongSettings {
  const speeds: Record<string, number> = {};
  for (const [key, value] of Object.entries(stored?.speedPercent ?? {})) {
    if (Number.isFinite(value)) speeds[key] = Math.min(MAX_SPEED_PERCENT, Math.max(MIN_SPEED_PERCENT, value));
  }
  return { speedPercent: speeds };
}

export function useSongSettings() {
  return usePersistentSetting('songs', DEFAULT_SONGS, sanitize);
}
