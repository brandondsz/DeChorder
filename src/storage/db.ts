import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { ChordPair } from '../drill/changeDrill';
import type { ReactionRound } from '../drill/reaction';
import type { RhythmHit } from '../drill/rhythm';

export interface DetectorSettings {
  enabledChordIds: string[];
  /** Input level (dBFS) below which the detector treats the input as silence. */
  gateDb: number;
}

export interface DrillSettings {
  chords: ChordPair;
  durationSec: number;
}

export interface ReactionSettings {
  chordIds: string[];
  rounds: number;
  /** Bias prompts toward the player's slowest transitions. */
  focusWeak: boolean;
}

export interface RhythmSettings {
  /** A PROGRESSIONS id, or 'custom' for customChords. */
  progressionId: string;
  customChords: string[];
  beatsPerChord: number;
  bpm: number;
  loops: number;
  speedUp: boolean;
  /** Measured strum-after-click delay; null until calibrated. */
  latencyMs: number | null;
}

export interface SettingsMap {
  detector: DetectorSettings;
  drill: DrillSettings;
  reaction: ReactionSettings;
  rhythm: RhythmSettings;
}

export interface RhythmSession {
  id?: number;
  /** See progressionKey(): chords plus beats per chord. */
  progressionKey: string;
  chords: string[];
  beatsPerChord: number;
  startBpm: number;
  topCleanBpm: number | null;
  accuracy: number | null;
  hits: RhythmHit[];
  /** Epoch milliseconds. */
  startedAt: number;
}

export interface ReactionSession {
  id?: number;
  chordIds: string[];
  rounds: ReactionRound[];
  /** Epoch milliseconds. */
  startedAt: number;
}

export interface DrillSession {
  id?: number;
  /** Order-insensitive pair key, see pairKey(). */
  pairKey: string;
  chords: ChordPair;
  durationSec: number;
  changes: number;
  changeTimesMs: number[];
  /** Epoch milliseconds. */
  startedAt: number;
}

interface DeChorderDB extends DBSchema {
  settings: {
    key: keyof SettingsMap;
    value: SettingsMap[keyof SettingsMap];
  };
  drillSessions: {
    key: number;
    value: DrillSession;
    indexes: { byPair: string };
  };
  reactionSessions: {
    key: number;
    value: ReactionSession;
  };
  rhythmSessions: {
    key: number;
    value: RhythmSession;
    indexes: { byProgression: string };
  };
}

let dbPromise: Promise<IDBPDatabase<DeChorderDB>> | null = null;

function db() {
  dbPromise ??= openDB<DeChorderDB>('dechorder', 4, {
    upgrade(database, oldVersion) {
      if (oldVersion < 1) database.createObjectStore('settings');
      if (oldVersion < 2) {
        const sessions = database.createObjectStore('drillSessions', { keyPath: 'id', autoIncrement: true });
        sessions.createIndex('byPair', 'pairKey');
      }
      if (oldVersion < 3) database.createObjectStore('reactionSessions', { keyPath: 'id', autoIncrement: true });
      if (oldVersion < 4) {
        const sessions = database.createObjectStore('rhythmSessions', { keyPath: 'id', autoIncrement: true });
        sessions.createIndex('byProgression', 'progressionKey');
      }
    },
  });
  return dbPromise;
}

export async function loadSetting<K extends keyof SettingsMap>(key: K): Promise<SettingsMap[K] | undefined> {
  return (await (await db()).get('settings', key)) as SettingsMap[K] | undefined;
}

export async function saveSetting<K extends keyof SettingsMap>(key: K, value: SettingsMap[K]): Promise<void> {
  await (await db()).put('settings', value, key);
}

export async function addDrillSession(session: DrillSession): Promise<number> {
  return (await db()).add('drillSessions', session);
}

export async function addReactionSession(session: ReactionSession): Promise<number> {
  return (await db()).add('reactionSessions', session);
}

/** All Reaction Mode sessions, oldest first. */
export async function getReactionSessions(): Promise<ReactionSession[]> {
  const sessions = await (await db()).getAll('reactionSessions');
  return sessions.sort((a, b) => a.startedAt - b.startedAt);
}

export async function addRhythmSession(session: RhythmSession): Promise<number> {
  return (await db()).add('rhythmSessions', session);
}

/** Sessions for a progression, oldest first. */
export async function getRhythmSessions(progressionKey: string): Promise<RhythmSession[]> {
  const sessions = await (await db()).getAllFromIndex('rhythmSessions', 'byProgression', progressionKey);
  return sessions.sort((a, b) => a.startedAt - b.startedAt);
}

/** Sessions for a pair, oldest first. */
export async function getDrillSessions(pairKey: string): Promise<DrillSession[]> {
  const sessions = await (await db()).getAllFromIndex('drillSessions', 'byPair', pairKey);
  return sessions.sort((a, b) => a.startedAt - b.startedAt);
}
