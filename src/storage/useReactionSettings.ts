import { CHORDS_BY_ID } from '../audio/chords';
import type { ReactionSettings } from './db';
import { usePersistentSetting } from './usePersistentSetting';

export const REACTION_ROUND_OPTIONS = [10, 20, 30];

const DEFAULT_REACTION: ReactionSettings = {
  chordIds: ['C', 'D', 'G', 'Am', 'Em'],
  rounds: 20,
  focusWeak: true,
};

function sanitize(stored: ReactionSettings | undefined): ReactionSettings {
  if (!stored) return DEFAULT_REACTION;
  const ids = (stored.chordIds ?? []).filter((id) => CHORDS_BY_ID.has(id));
  return {
    chordIds: ids.length >= 2 ? ids : DEFAULT_REACTION.chordIds,
    rounds: REACTION_ROUND_OPTIONS.includes(stored.rounds) ? stored.rounds : DEFAULT_REACTION.rounds,
    focusWeak: stored.focusWeak ?? DEFAULT_REACTION.focusWeak,
  };
}

export function useReactionSettings() {
  return usePersistentSetting('reaction', DEFAULT_REACTION, sanitize);
}
