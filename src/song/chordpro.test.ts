import { describe, expect, it } from 'vitest';
import { chordsInSong, parseSong, resolveChord, songHasErrors } from './chordpro';
import { EXAMPLE_SONGS } from './examples';

describe('parseSong', () => {
  it('reads metadata, sections, chords and lyric positions', () => {
    const song = parseSong(`{title: Open Road}
{artist: Me}
{tempo: 100}
[Verse]
[G]Take me [C]home
[Chorus]
[D:2]Oh [Em:2]yes`);
    expect(song.title).toBe('Open Road');
    expect(song.artist).toBe('Me');
    expect(song.bpm).toBe(100);
    expect(song.sections.map((s) => s.name)).toEqual(['Verse', 'Chorus']);
    expect(song.events.map((e) => [e.chord, e.beats, e.section])).toEqual([
      ['G', 4, 0],
      ['C', 4, 0],
      ['D', 2, 1],
      ['Em', 2, 1],
    ]);
    expect(song.lines[0].segments).toEqual([
      { event: 0, text: 'Take me ' },
      { event: 1, text: 'home' },
    ]);
    expect(songHasErrors(song)).toBe(false);
    expect(chordsInSong(song)).toEqual(['G', 'C', 'D', 'Em']);
  });

  it('keeps lyric text before the first chord', () => {
    const song = parseSong('Well [G]hello there');
    expect(song.lines[0].segments).toEqual([
      { event: null, text: 'Well ' },
      { event: 0, text: 'hello there' },
    ]);
    expect(song.sections[0].name).toBe('Song');
  });

  it('uses the time signature for the default chord length', () => {
    const song = parseSong('{time: 3/4}\n[G] [C] [D:6]');
    expect(song.beatsPerBar).toBe(3);
    expect(song.events.map((e) => e.beats)).toEqual([3, 3, 6]);
  });

  it('repeats the last chorus with {chorus}, as a new section instance', () => {
    const song = parseSong(`{soc}
[G]La [D]la
{eoc}
[Verse]
[Em]Hm
{chorus}`);
    expect(song.sections.map((s) => s.label)).toEqual(['Chorus', 'Verse', 'Chorus (2)']);
    expect(song.events.map((e) => `${e.chord}@${e.section}`)).toEqual(['G@0', 'D@0', 'Em@1', 'G@2', 'D@2']);
    const repeated = song.lines.filter((l) => l.section === 2 && !l.spacer);
    expect(repeated[0].segments.map((s) => s.event)).toEqual([3, 4]);
  });

  it('reports unsupported chords, bad lengths and missing chords', () => {
    const song = parseSong('[Bm]No [G:0]way');
    expect(song.problems.map((p) => p.severity)).toEqual(['error', 'error']);
    expect(song.problems[0].message).toMatch(/Bm isn't supported/);
    expect(songHasErrors(parseSong('just words'))).toBe(true);
  });

  it('treats bar lines in chord-only lines as decoration', () => {
    const song = parseSong('| [G] | [C] | [N.C.] |');
    expect(song.events.map((e) => e.chord)).toEqual(['G', 'C', null]);
    expect(song.lines[0].segments.every((s) => s.event !== null)).toBe(true);
  });
});

describe('example songs', () => {
  it.each(EXAMPLE_SONGS.map((e) => e.id))('%s parses cleanly', (id) => {
    const song = parseSong(EXAMPLE_SONGS.find((e) => e.id === id)!.source);
    expect(song.problems).toEqual([]);
    expect(song.events.length).toBeGreaterThan(8);
  });
});

describe('resolveChord', () => {
  it('accepts slash chords, min/maj spellings and odd capitalisation', () => {
    expect(resolveChord('C/G')).toMatchObject({ chord: 'C', warning: expect.stringContaining('C/G') });
    expect(resolveChord('Amin')).toEqual({ chord: 'Am', warning: undefined });
    expect(resolveChord('Gmaj')).toEqual({ chord: 'G', warning: undefined });
    expect(resolveChord('am')).toEqual({ chord: 'Am', warning: undefined });
    expect(resolveChord('N.C.')).toEqual({ chord: null });
    expect(resolveChord('F#m')).toHaveProperty('error');
  });
});
