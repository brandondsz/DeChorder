/** Practice songs that ship with the app. Words and music are original, written for DeChorder. */
export interface ExampleSong {
  id: string;
  source: string;
}

export const EXAMPLE_SONGS: ExampleSong[] = [
  {
    id: 'open-road',
    source: `{title: Open Road}
{artist: DeChorder practice song}
{tempo: 84}

[Intro]
| [G] | [D] | [Em] | [C] |

[Verse]
[G]Woke up early, [D]coffee on the stove
[Em]Sunlight on the [C]window, time to go
[G]Pack a little [D]bag and close the door
[Em]Never really [C]needed any more

[Chorus]
[C]Open [G]road, [D]take me where you [Em]go
[C]Every mile I [G]learn a little [D]more
[C]Open [G]road, [D]singing as I [Em]drive
[C]Every change I [D]make, I come a[G]live

[Verse]
[G]Strings are buzzing, [D]fingers finding home
[Em]Every chord a [C]little less unknown
[G]One more time, a [D]little faster now
[Em]Hands remember [C]even when I don't know how

{chorus}

[Outro]
| [G] | [D] | [C] | [G:8] |
`,
  },
  {
    id: 'kitchen-waltz',
    source: `{title: Kitchen Waltz}
{artist: DeChorder practice song}
{tempo: 108}
{time: 3/4}

[Verse]
[C]Round the table, [Am]round we go
[Dm]Kettle singing [G]soft and low
[C]One two three and [Am]one two three
[Dm]Dancing slowly, [G]you and [C]me

[Chorus]
[F]Spin me [C]once, [G]spin me [Am]twice
[F]Plates and [C]cups and [G]all things [C]nice
[F]Kitchen [C]waltz in [Am]evening [Dm]light
[G]Hold the chord and [G7]hold it [C:6]tight

{chorus}
`,
  },
  {
    id: 'twelve-bar-shuffle',
    source: `{title: Twelve-Bar Shuffle}
{artist: DeChorder practice song}
{tempo: 96}

[Verse]
| [A7] | [A7] | [A7] | [A7] |
| [D7] | [D7] | [A7] | [A7] |
| [E7] | [D7] | [A7] | [E7] |

[Verse]
| [A7] | [A7] | [A7] | [A7] |
| [D7] | [D7] | [A7] | [A7] |
| [E7] | [D7] | [A7] | [A7:8] |
`,
  },
];

/** Starting point for a new song in the editor. */
export const NEW_SONG_TEMPLATE = `{title: My song}
{artist: }
{tempo: 90}

[Verse]
[G]Put each chord in [C]brackets, right be[G]fore the word it [D]lands on

[Chorus]
[C]Each chord lasts a [G]bar, or add a [D:2]length in [Em:2]beats
`;
