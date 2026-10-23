import { CHORDS_BY_ID } from '../audio/chords';
import { CUSTOM_PROGRESSION_ID, MAX_CUSTOM_CHORDS, PROGRESSIONS } from '../drill/progressions';
import type { RhythmSettings } from './db';
import { usePersistentSetting } from './usePersistentSetting';

export const BEATS_PER_CHORD_OPTIONS = [2, 4];
export const LOOP_OPTIONS = [4, 8, 16];
export const MIN_BPM = 40;
export const MAX_START_BPM = 160;

const DEFAULT_RHYTHM: RhythmSettings = {
  progressionId: PROGRESSIONS[0].id,
  customChords: ['G', 'C', 'D'],
  beatsPerChord: 4,
  bpm: 70,
  loops: 4,
  speedUp: true,
  latencyMs: null,
};

function sanitize(stored: RhythmSettings | undefined): RhythmSettings {
  if (!stored) return DEFAULT_RHYTHM;
  const custom = (stored.customChords ?? []).filter((id) => CHORDS_BY_ID.has(id)).slice(0, MAX_CUSTOM_CHORDS);
  const knownProgression =
    stored.progressionId === CUSTOM_PROGRESSION_ID || PROGRESSIONS.some((p) => p.id === stored.progressionId);
  return {
    progressionId: knownProgression ? stored.progressionId : DEFAULT_RHYTHM.progressionId,
    customChords: new Set(custom).size >= 2 ? custom : DEFAULT_RHYTHM.customChords,
    beatsPerChord: BEATS_PER_CHORD_OPTIONS.includes(stored.beatsPerChord) ? stored.beatsPerChord : DEFAULT_RHYTHM.beatsPerChord,
    bpm: Number.isFinite(stored.bpm) ? Math.min(MAX_START_BPM, Math.max(MIN_BPM, stored.bpm)) : DEFAULT_RHYTHM.bpm,
    loops: LOOP_OPTIONS.includes(stored.loops) ? stored.loops : DEFAULT_RHYTHM.loops,
    speedUp: stored.speedUp ?? DEFAULT_RHYTHM.speedUp,
    latencyMs: Number.isFinite(stored.latencyMs) ? stored.latencyMs : null,
  };
}

export function useRhythmSettings() {
  return usePersistentSetting('rhythm', DEFAULT_RHYTHM, sanitize);
}

export function progressionChords(settings: RhythmSettings): string[] {
  if (settings.progressionId === CUSTOM_PROGRESSION_ID) return settings.customChords;
  return PROGRESSIONS.find((p) => p.id === settings.progressionId)?.chords ?? PROGRESSIONS[0].chords;
}
