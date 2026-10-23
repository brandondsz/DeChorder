export type ChordGroup = 'major' | 'minor' | 'seventh' | 'suspended';

export interface ChordDef {
  id: string;
  name: string;
  group: ChordGroup;
  /** Fret per string, low E to high e. 0 = open, null = muted. */
  frets: (number | null)[];
  /** Fretting finger per string (1 = index … 4 = pinky), 0 = open, null = muted. */
  fingers: (number | null)[];
}

/** MIDI note numbers of the open strings in standard tuning, low E to high e. */
export const STANDARD_TUNING_MIDI = [40, 45, 50, 55, 59, 64];

export const PITCH_CLASS_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];

export const GROUP_LABELS: Record<ChordGroup, string> = {
  major: 'Major',
  minor: 'Minor',
  seventh: '7ths',
  suspended: 'Sus & add',
};

function parseStrings(shape: string): (number | null)[] {
  return [...shape].map((c) => (c === 'x' ? null : Number(c)));
}

function chord(name: string, group: ChordGroup, frets: string, fingers: string): ChordDef {
  return { id: name, name, group, frets: parseStrings(frets), fingers: parseStrings(fingers) };
}

export const OPEN_CHORDS: ChordDef[] = [
  chord('C', 'major', 'x32010', 'x32010'),
  chord('D', 'major', 'xx0232', 'xx0132'),
  chord('E', 'major', '022100', '023100'),
  chord('F', 'major', 'xx3211', 'xx3211'),
  chord('G', 'major', '320003', '210003'),
  chord('A', 'major', 'x02220', 'x01230'),
  chord('Am', 'minor', 'x02210', 'x02310'),
  chord('Dm', 'minor', 'xx0231', 'xx0231'),
  chord('Em', 'minor', '022000', '023000'),
  chord('A7', 'seventh', 'x02020', 'x02030'),
  chord('B7', 'seventh', 'x21202', 'x21304'),
  chord('C7', 'seventh', 'x32310', 'x32410'),
  chord('D7', 'seventh', 'xx0212', 'xx0213'),
  chord('E7', 'seventh', '020100', '020100'),
  chord('G7', 'seventh', '320001', '320001'),
  chord('Am7', 'seventh', 'x02010', 'x02010'),
  chord('Dm7', 'seventh', 'xx0211', 'xx0211'),
  chord('Em7', 'seventh', '020000', '020000'),
  chord('Cmaj7', 'seventh', 'x32000', 'x32000'),
  chord('Fmaj7', 'seventh', 'xx3210', 'xx3210'),
  chord('Asus2', 'suspended', 'x02200', 'x01200'),
  chord('Asus4', 'suspended', 'x02230', 'x01230'),
  chord('Dsus2', 'suspended', 'xx0230', 'xx0130'),
  chord('Dsus4', 'suspended', 'xx0233', 'xx0134'),
  chord('Esus4', 'suspended', '022200', '023400'),
  chord('Cadd9', 'suspended', 'x32033', 'x21034'),
];

export const CHORDS_BY_ID = new Map(OPEN_CHORDS.map((c) => [c.id, c]));

export const CHORD_PRESETS: { id: string; label: string; chordIds: string[] }[] = [
  { id: 'basics', label: 'Basics', chordIds: ['C', 'D', 'E', 'G', 'A', 'Am', 'Dm', 'Em'] },
  {
    id: 'basics-7ths',
    label: 'Basics + 7ths',
    chordIds: ['C', 'D', 'E', 'G', 'A', 'Am', 'Dm', 'Em', 'A7', 'B7', 'C7', 'D7', 'E7', 'G7'],
  },
  { id: 'all', label: 'All open chords', chordIds: OPEN_CHORDS.map((c) => c.id) },
];

/** MIDI notes actually sounded by a voicing, low to high. */
export function voicingMidi(chord: ChordDef): number[] {
  const notes: number[] = [];
  chord.frets.forEach((fret, string) => {
    if (fret !== null) notes.push(STANDARD_TUNING_MIDI[string] + fret);
  });
  return notes;
}

export function chordPitchClasses(chord: ChordDef): Set<number> {
  return new Set(voicingMidi(chord).map((m) => m % 12));
}

const TEMPLATE_HARMONICS = 6;
const TEMPLATE_HARMONIC_DECAY = 0.6;

/**
 * Expected chroma for a voicing. Each sounded string contributes its fundamental plus
 * decaying overtones, so the template looks like what a real guitar puts into the spectrum
 * rather than a bare triad.
 */
export function chordTemplate(chord: ChordDef): Float32Array {
  const template = new Float32Array(12);
  for (const midi of voicingMidi(chord)) {
    for (let h = 1; h <= TEMPLATE_HARMONICS; h++) {
      const pc = (midi + Math.round(12 * Math.log2(h))) % 12;
      template[pc] += TEMPLATE_HARMONIC_DECAY ** (h - 1);
    }
  }
  return normalize(template);
}

export function normalize(v: Float32Array): Float32Array {
  let norm = 0;
  for (const x of v) norm += x * x;
  norm = Math.sqrt(norm);
  if (norm > 0) for (let i = 0; i < v.length; i++) v[i] /= norm;
  return v;
}
