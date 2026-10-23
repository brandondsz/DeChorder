export interface Progression {
  id: string;
  name: string;
  chords: string[];
}

export const PROGRESSIONS: Progression[] = [
  { id: 'fifties-g', name: '’50s in G', chords: ['G', 'Em', 'C', 'D'] },
  { id: 'pop-g', name: 'Pop (I–V–vi–IV) in G', chords: ['G', 'D', 'Em', 'C'] },
  { id: 'pop-c', name: 'Pop (I–V–vi–IV) in C', chords: ['C', 'G', 'Am', 'F'] },
  { id: 'minor-am', name: 'Minor (vi–IV–I–V) in C', chords: ['Am', 'F', 'C', 'G'] },
  { id: 'em-c-g-d', name: 'Em–C–G–D', chords: ['Em', 'C', 'G', 'D'] },
  { id: 'three-d', name: 'Three chords in D', chords: ['D', 'G', 'D', 'A'] },
  {
    id: 'blues-a',
    name: '12-bar blues in A',
    chords: ['A7', 'A7', 'A7', 'A7', 'D7', 'D7', 'A7', 'A7', 'E7', 'D7', 'A7', 'E7'],
  },
];

export const CUSTOM_PROGRESSION_ID = 'custom';
export const MAX_CUSTOM_CHORDS = 8;
