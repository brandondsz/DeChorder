import { CHORDS_BY_ID } from '../audio/chords';

/**
 * A small ChordPro-style chart parser.
 *
 *   {title: Open Road}          {tempo: 90}   {time: 3/4}
 *   [Verse] or {start_of_verse} or {section: Verse}   – start a section
 *   {chorus}                    – repeat the most recent chorus
 *   [G]Take me [C]home          – chords sit before the syllable they land on
 *   [G:2]                       – a chord lasting 2 beats (default: one bar)
 *   [N.C.]                      – no chord (a rest)
 */

export const DEFAULT_BPM = 90;
export const MIN_SONG_BPM = 40;
export const MAX_SONG_BPM = 200;

export interface SongEvent {
  /** Chord id, or null for "no chord". */
  chord: string | null;
  /** As written in the chart, e.g. "C/G". */
  label: string;
  beats: number;
  /** Index into ParsedSong.sections (a section *instance*: a repeated chorus is a new one). */
  section: number;
}

export interface SongSegment {
  /** Event that starts at this point in the line, if any. */
  event: number | null;
  text: string;
}

export interface SongLine {
  section: number;
  segments: SongSegment[];
  /** A blank line in the chart: drawn as a gap. */
  spacer?: boolean;
}

export interface SongSection {
  name: string;
  /** "Chorus (2)" when a name repeats, so instances can be told apart. */
  label: string;
}

export interface SongProblem {
  /** 1-based line in the source. */
  line: number;
  message: string;
  severity: 'error' | 'warning';
}

export interface ParsedSong {
  title: string;
  artist: string;
  bpm: number;
  beatsPerBar: number;
  sections: SongSection[];
  lines: SongLine[];
  events: SongEvent[];
  problems: SongProblem[];
}

const SECTION_WORDS = /^(intro|verse|pre-?chorus|chorus|bridge|outro|solo|interlude|instrumental|refrain|hook|tag|coda|ending)\b/i;
const CHORD_TOKEN = /\[([^\]]*)\]/g;
const SECTION_DIRECTIVES: Record<string, string> = {
  start_of_verse: 'Verse',
  sov: 'Verse',
  start_of_chorus: 'Chorus',
  soc: 'Chorus',
  start_of_bridge: 'Bridge',
  sob: 'Bridge',
};

/** Map a chord as written to a supported chord id (null = N.C.), or explain why not. */
export function resolveChord(written: string): { chord: string | null; warning?: string } | { error: string } {
  const name = written.trim();
  if (/^n\.?\s*c\.?$/i.test(name)) return { chord: null };
  let base = name;
  let warning: string | undefined;
  if (base.includes('/')) {
    base = base.split('/')[0];
    warning = `${name} is played as ${base} (bass notes aren't checked).`;
  }
  base = base.replace(/min$/i, 'm').replace(/maj$/i, '');
  if (CHORDS_BY_ID.has(base)) return { chord: base, warning };
  // Forgive capitalisation, e.g. "am" or "AM".
  const match = [...CHORDS_BY_ID.keys()].find((id) => id.toLowerCase() === base.toLowerCase());
  if (match) return { chord: match, warning };
  return { error: `${name} isn't supported yet. DeChorder knows the open chords only (see the chord list).` };
}

export function parseSong(source: string): ParsedSong {
  const song: ParsedSong = {
    title: '',
    artist: '',
    bpm: DEFAULT_BPM,
    beatsPerBar: 4,
    sections: [],
    lines: [],
    events: [],
    problems: [],
  };
  const explicitBeats: (number | null)[] = [];
  const warned = new Set<string>();
  let current = -1;

  const startSection = (name: string) => {
    const count = song.sections.filter((s) => s.name === name).length;
    song.sections.push({ name, label: count ? `${name} (${count + 1})` : name });
    current = song.sections.length - 1;
  };
  const ensureSection = () => {
    if (current === -1) startSection(song.sections.length ? 'Part' : 'Song');
  };
  const problem = (line: number, message: string, severity: SongProblem['severity'] = 'error') =>
    song.problems.push({ line, message, severity });

  const repeatSection = (name: string, lineNo: number) => {
    const sourceIndex = song.sections.map((s) => s.name).lastIndexOf(name);
    if (sourceIndex === -1) {
      problem(lineNo, `{${name.toLowerCase()}} repeats a ${name.toLowerCase()}, but there isn't one above it.`);
      return;
    }
    const eventMap = new Map<number, number>();
    startSection(name);
    song.events.forEach((event, i) => {
      if (event.section !== sourceIndex) return;
      eventMap.set(i, song.events.length);
      song.events.push({ ...event, section: current });
      explicitBeats.push(explicitBeats[i]);
    });
    for (const line of song.lines.filter((l) => l.section === sourceIndex)) {
      song.lines.push({
        ...line,
        section: current,
        segments: line.segments.map((s) => ({ ...s, event: s.event === null ? null : eventMap.get(s.event)! })),
      });
    }
  };

  source.split(/\r?\n/).forEach((raw, index) => {
    const lineNo = index + 1;
    const line = raw.trimEnd();

    if (line.trim() === '') {
      if (current !== -1) song.lines.push({ section: current, segments: [], spacer: true });
      return;
    }

    const directive = line.trim().match(/^\{\s*([\w-]+)\s*(?::\s*(.*?))?\s*\}$/);
    if (directive) {
      const key = directive[1].toLowerCase();
      const value = (directive[2] ?? '').trim();
      if (key === 'title' || key === 't') song.title = value;
      else if (key === 'artist' || key === 'subtitle' || key === 'st') song.artist = value;
      else if (key === 'tempo') {
        const bpm = Number(value);
        if (!Number.isFinite(bpm) || bpm < MIN_SONG_BPM || bpm > MAX_SONG_BPM) {
          problem(lineNo, `Tempo should be a number of BPM between ${MIN_SONG_BPM} and ${MAX_SONG_BPM}.`);
        } else song.bpm = Math.round(bpm);
      } else if (key === 'time') {
        const beats = Number(value.split('/')[0]);
        if (!Number.isInteger(beats) || beats < 2 || beats > 12) problem(lineNo, 'Time should look like 4/4 or 3/4.');
        else song.beatsPerBar = beats;
      } else if (key === 'section') startSection(value || 'Section');
      else if (SECTION_DIRECTIVES[key]) startSection(value || SECTION_DIRECTIVES[key]);
      else if (key === 'chorus') repeatSection('Chorus', lineNo);
      else if (key.startsWith('end_of_') || ['eov', 'eoc', 'eob'].includes(key)) current = -1;
      else if (!['key', 'capo', 'comment', 'c', 'ci', 'composer', 'album', 'year'].includes(key)) {
        problem(lineNo, `{${key}} isn't understood, so it's ignored.`, 'warning');
      }
      return;
    }

    // A line that is just "[Verse]", "[Chorus 2]" etc. is a heading, not a chord.
    const heading = line.trim().match(/^\[([^\]]+)\]$/);
    if (heading && SECTION_WORDS.test(heading[1]) && !('chord' in resolveChord(heading[1]))) {
      startSection(heading[1].trim());
      return;
    }

    ensureSection();
    const segments: SongSegment[] = [];
    let cursor = 0;
    let lyric = '';
    let pending: number | null = null;
    for (const match of line.matchAll(CHORD_TOKEN)) {
      lyric += line.slice(cursor, match.index);
      if (pending !== null || lyric) segments.push({ event: pending, text: lyric });
      lyric = '';
      cursor = match.index! + match[0].length;
      pending = null;

      const [written, beatsText] = match[1].split(':');
      const beats = beatsText === undefined ? null : Number(beatsText);
      if (beats !== null && (!Number.isInteger(beats) || beats < 1 || beats > 32)) {
        problem(lineNo, `[${match[1]}]: the number after ":" is a length in beats, from 1 to 32.`);
        continue;
      }
      const resolved = resolveChord(written);
      if ('error' in resolved) {
        problem(lineNo, resolved.error);
        continue;
      }
      if (resolved.warning && !warned.has(written)) {
        warned.add(written);
        problem(lineNo, resolved.warning, 'warning');
      }
      song.events.push({ chord: resolved.chord, label: written.trim(), beats: 0, section: current });
      explicitBeats.push(beats);
      pending = song.events.length - 1;
    }
    lyric += line.slice(cursor);
    if (pending !== null || lyric) segments.push({ event: pending, text: lyric });
    // Bar lines in chord-only lines ("| G | C |") are just visual.
    const cleaned = segments
      .map((s) => ({ ...s, text: segments.some((x) => x.event !== null) && /^[\s|]*$/.test(s.text) ? ' ' : s.text }))
      .filter((s) => s.event !== null || s.text.trim() !== '');
    song.lines.push({ section: current, segments: cleaned });
  });

  song.events.forEach((event, i) => {
    event.beats = explicitBeats[i] ?? song.beatsPerBar;
  });
  // A chart with no chords at all can't be played; say so unless something else already failed.
  if (!song.events.some((e) => e.chord !== null) && !song.problems.some((p) => p.severity === 'error')) {
    song.problems.push({ line: 1, message: 'Add some chords, like [G]Take me [C]home.', severity: 'error' });
  }
  if (!song.title) song.title = 'Untitled song';
  return song;
}

export function chordsInSong(song: ParsedSong): string[] {
  return [...new Set(song.events.flatMap((e) => (e.chord ? [e.chord] : [])))];
}

export function songHasErrors(song: ParsedSong): boolean {
  return song.problems.some((p) => p.severity === 'error');
}
