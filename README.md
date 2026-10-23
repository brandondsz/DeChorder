# DeChorder

A browser-based practice tool for guitar chords. It listens to your guitar through the microphone, recognises the open chord you're playing in real time, and uses that to run drills that make your chord changes faster and cleaner.

Everything runs locally in the browser: no server, no account, and your practice history stays on your machine.

## Features

| Screen | What it does |
|---|---|
| **Detector** | Shows the chord you're playing, how confident the match is, a fingering diagram, and a live bar chart of the notes it hears (C through B). Pick which chords it listens for and set a noise gate. |
| **One-Minute Changes** | The classic drill: switch between two chords as many times as you can in 30 s, 1 min or 2 min. Tracks changes per minute, average and fastest change time, and your personal best for each pair. |
| **Reaction Mode** | Random chords from a set you choose appear one at a time; you change to each as fast as you can. A from → to heatmap shows how fast every transition is, and the "focus on my slowest changes" option gives you more of the ones you struggle with. |
| **Rhythm Mode** | Play a progression along with a metronome while the chords scroll past. Each change is graded Perfect, Good, Early, Late or Miss on how close your strum lands to the beat, and the tempo rises 5 BPM after each clean loop. Includes 7 preset progressions (pop, '50s, minor, 12-bar blues…), a custom progression builder, and timing calibration. |

26 open chords are supported: C, D, E, F, G, A, Am, Dm, Em, the common 7ths (A7, B7, C7, D7, E7, G7, Am7, Dm7, Em7, Cmaj7, Fmaj7), and sus/add chords (Asus2, Asus4, Dsus2, Dsus4, Esus4, Cadd9). F uses the small four-string shape (xx3211).

## Requirements

- A desktop browser with Web Audio and microphone support. Chrome or Edge is recommended.
- A microphone: a laptop mic works, and an audio interface works better.
- Node.js 22 or newer to build and run it (developed on Node 24).

The app was developed and tested with a steel-string acoustic guitar in standard tuning.

## Getting started

```bash
npm install
```

```bash
npm run dev
```

Open http://localhost:5173, click **Start listening** and allow microphone access.

Browsers only allow microphone access on `localhost` or over HTTPS, so if you host the built app somewhere, serve it over HTTPS.

### Scripts

| Command | Does |
|---|---|
| `npm run dev` | Starts the Vite dev server with hot reload |
| `npm run build` | Type-checks and builds a production bundle into `dist/` |
| `npm run preview` | Serves the production build locally |
| `npm test` | Runs the unit tests (Vitest) |
| `npm run typecheck` | Type-checks without building |

## Tips for good detection

- **Set the noise gate.** On the Detector screen, move the gate just above where the level meter sits when you're *not* playing, so room noise isn't analysed.
- **Let chords ring.** A chord is reported once it has rung cleanly for about 100 ms, so a quick half-fretted strum mid-change won't count.
- **Listen for fewer chords.** The fewer chords the detector has to choose between, the more accurate it is. Some chords share almost the same notes: Em/Em7, C/Cmaj7, and Asus2/Esus4, which use exactly the same notes (E, A, B). Leave out look-alikes you aren't practising.
- **Calibrate before Rhythm Mode.** The 15-second calibration measures the delay of your audio hardware together with your own timing habit, and scoring corrects for it. Calibrate again if you change microphone, speakers or headphones.
- **Headphones help in Rhythm Mode.** The metronome is pitched high enough that the analysis ignores it, but headphones keep it out of the mic entirely. Bluetooth headphones add a lot of delay, so calibrate with the ones you'll play with.
- **Changes are counted, not strums.** One-Minute Changes and Reaction Mode count each time the detected chord *changes*, so strumming the same chord twice does nothing.

## How it works

**Chord recognition** ([src/audio/](src/audio/))

1. An `AnalyserNode` takes an FFT of the mic signal over a window of about 340 ms (16384 samples), which is long enough to tell the low E string (82 Hz) apart from the F next to it.
2. [chroma.ts](src/audio/chroma.ts) picks the peaks in that spectrum and works out each one's exact frequency between FFT bins. It also estimates how sharp or flat the guitar is overall, then folds every peak into 12 pitch-class bins (C through B). This is the "Notes heard" chart.
3. [chords.ts](src/audio/chords.ts) builds what each chord *should* sound like from its real fingering, including the overtones each string produces. A G chord's B string adds energy at F♯, for example, so these templates match a real guitar far better than plain chord notes would.
4. [matcher.ts](src/audio/matcher.ts) scores how well the live notes match every chord in the active set, and turns those scores into a confidence value.
5. [stabilizer.ts](src/audio/stabilizer.ts) only reports a chord once it has been the top match for 6 frames in a row, roughly 100 ms.

**Strum timing.** Rhythm Mode needs to know *when* you strummed, and the chord detector only confirms a chord about 250 ms after the strum. So [detector.ts](src/audio/detector.ts) also runs a second, short analyser on a low-passed copy of the input and detects strum attacks within about 35 ms. The chord detector supplies *which* chord was played and the strum detector supplies *when*. Metronome clicks are pitched at 2.7–4 kHz, above both analysers' ranges, so a mic that hears your speakers doesn't mistake them for strums or notes.

**Drills.** The scoring logic for each mode is plain TypeScript, separate from React, in [src/drill/](src/drill/): `changeDrill.ts`, `reaction.ts` and `rhythm.ts`. That makes it easy to unit-test.

**Storage.** Settings and session history are kept in the browser's IndexedDB through [idb](https://github.com/jakearchibald/idb) ([src/storage/db.ts](src/storage/db.ts)). The data lives only in that browser profile: clearing site data for the app deletes it, and it doesn't sync between browsers or machines.

## Project structure

```
src/
├── audio/          # Audio engine: analysis, chord templates, matching, stabilizing
│   └── testing/    # Strum synthesizer + FFT used by the detection tests
├── components/     # Shared UI: chord diagram, chroma chart, chord picker, session chart
├── drill/          # Drill logic (pure TS) and drill-specific components
├── hooks/          # useClock and formatting helpers
├── screens/        # One component per tab
├── storage/        # IndexedDB schema and settings hooks
├── App.tsx         # Tabs and the shared detector engine
└── styles.css      # All styles; light and dark themes via CSS variables
```

## Development

**Testing without a guitar.** In dev mode (`npm run dev`), every screen has a *Developer: synthetic strum* panel that plays a computer-generated strum straight into the detector, so you can try all the modes with no microphone. These panels are left out of production builds.

**Console access.** In dev mode the audio engine is available as `window.dechorder`, so you can watch events from the browser console:

```js
dechorder.onOnset((t) => console.log('strum', t));
dechorder.onChordChange((id, t, strumTime) => console.log(id, t - strumTime, 'ms to commit'));
```

**Tests.** `npm test` covers:
- end-to-end detection on synthesized strums with random overtones, detuning and noise, run through an FFT that mirrors `AnalyserNode`
- the stabilizer
- the scoring rules for all three drills, including tempo changes and calibration

**Tuning detection.** The main constants are at the top of [detector.ts](src/audio/detector.ts):

| Constant | Controls |
|---|---|
| `HOLD_FRAMES` | how long a chord must ring before it's reported |
| `MIN_SIMILARITY` | how closely the sound must match a chord to count |
| `CHROMA_SMOOTHING` | how much the note readings are smoothed between frames |
| `ONSET_RISE_DB` / `ONSET_STEP_DB` | how sharp a jump in volume counts as a strum |

## Known limitations

- Open chords in standard tuning only; barre chords and alternate tunings aren't supported yet.
- Chords with the same notes in a different order (Asus2/Esus4) can't be told apart, because detection doesn't yet look at which note is lowest.
- Detection adds a roughly constant 0.2–0.4 s to Reaction Mode times. That still makes your own sessions comparable, but your true reaction is a little faster than shown.
- Built for desktop browsers; the layout adapts to narrow screens, but phones haven't been tested.

## Roadmap

- Practice home: daily warm-up built from your weakest changes, practice streaks
- Barre chords (F, Bm, B, C♯m, F♯m)
- Lowest-note detection to separate look-alike chords
- Song mode: real songs' chord charts in Rhythm Mode
- Chord Hero: a game-style mode built on Rhythm Mode
