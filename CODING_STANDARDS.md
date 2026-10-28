# Coding standards

How code in DeChorder is written. The rules describe the codebase as it is, so new code should look like the code around it. Where a rule isn't met yet, it's listed under [Known gaps](#known-gaps).

**MUST** rules are required for every change. **SHOULD** rules are the default: break one only with a reason, and write that reason in a comment.

## Contents

- [General](#general)
- [TypeScript](#typescript)
- [React](#react)
- [Architecture](#architecture)
- [Persistence](#persistence)
- [Testing](#testing)
- [CSS](#css)
- [Before you commit](#before-you-commit)
- [Known gaps](#known-gaps)

## General

- **MUST** use 2-space indentation, LF line endings and UTF-8, with a newline at the end of every file.
- **SHOULD** keep lines under about 120 characters. Long JSX attribute lists wrap one attribute per line.
- **MUST** spell user-facing text in British English to match the app ("practise", "colour"). Code identifiers use US spelling (`color`, `center`) to match the platform APIs.
- **MUST NOT** commit commented-out code, `console.log`, or debugging leftovers.

## TypeScript

### Compiler

- **MUST** keep every flag in [tsconfig.json](tsconfig.json) on: `strict`, `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`, `isolatedModules`.
- **MUST** pass `npm run typecheck` with zero errors. Errors are fixed, never suppressed: no `@ts-ignore` or `@ts-expect-error`.

### Formatting

- Single quotes. Template literals only when interpolating.
- Semicolons at the end of statements.
- Trailing commas in multi-line arrays, objects, parameter lists and imports.
- Imports in this order: packages, then app modules by relative path. Use `import type` (or inline `type`) for type-only imports:

  ```ts
  import { useEffect, useState } from 'react';
  import { CHORDS_BY_ID, type ChordDef } from '../audio/chords';
  ```

### Types

- **MUST NOT** use `any`. Use `unknown` and narrow it.
- **MUST** use type assertions (`as`) only at trust boundaries: values read from IndexedDB, DOM lookups, and test fixtures. Never use one to silence a type error in your own code.
- **SHOULD** narrow instead of using the non-null `!`. Use `!` only when the value is guaranteed by construction, such as looking up a chord id that came from the same static table (`CHORDS_BY_ID.get(id)!`).
- Use `interface` for object shapes and `type` for unions, aliases and function types.
- Use string-literal unions instead of `enum`, e.g. `type Grade = 'perfect' | 'good' | …`.
- Mark static tables `as const` when their literal types are used, as with `SCREENS` in [App.tsx](src/App.tsx).
- Mark class fields that are never reassigned `readonly`. Mark constructor parameters stored as fields `private readonly`.
- Give exported functions explicit return types when the type isn't obvious from the code.

### Naming

| Kind | Style | Example |
|---|---|---|
| Types, interfaces, classes, React components | PascalCase | `RhythmRun`, `SongSheet` |
| Functions, variables, methods | camelCase | `spectrumToChroma`, `beatTime` |
| Module-level constants | UPPER_SNAKE_CASE | `HOLD_FRAMES`, `COUNT_IN_BEATS` |
| Hooks | `use` + PascalCase | `usePlayAlong` |
| Booleans | read as a yes/no question | `live`, `scored`, `isClean()` |
| Component files | PascalCase `.tsx` | `ChordDiagram.tsx` |
| Other modules | camelCase `.ts` | `changeDrill.ts` |
| Tests | `<module>.test.ts`, next to the module | `rhythm.test.ts` |

### Units

- **MUST** put the unit in the name of any number where it isn't obvious: `_MS`, `_DB`, `_HZ`, `Sec`, `Percent`, `Bpm`. Examples: `ONSET_REFRACTORY_MS`, `gateDb`, `durationSec`, `speedPercent`.
- Times are milliseconds from `performance.now()` unless the name says otherwise. Use epoch time (`Date.now()`) only for stored timestamps (`startedAt`).
- Levels are in dBFS.

### Constants

- **MUST NOT** use magic numbers. Name the constant and add a doc comment explaining *why* it has that value:

  ```ts
  /** ~340 ms window at 48 kHz: ~3 Hz bins, enough to separate low E from F. */
  const FFT_SIZE = 16384;
  ```

### Functions and errors

- Prefer small functions and early returns over nested conditionals.
- **MUST NOT** leave a floating promise. Await it, or mark an intentional fire-and-forget with `void` (e.g. `onClick={() => void begin()}`).
- Show user-facing failures as a readable message (see `describeError` in [detector.ts](src/audio/detector.ts)), never as a raw exception.
- Storage failures are not fatal: catch them, `console.warn` with context (`'Could not save drill session'`), and carry on with defaults. Every empty `catch` has a comment saying why.

### Comments

- Explain *why*, not *what*. If code needs a comment to say what it does, rename or simplify it first.
- **SHOULD** give exported functions, classes and interfaces a `/** … */` doc comment when the name doesn't tell the whole story: units, edge cases, which clock a time is on.
- Each non-obvious step in an algorithm gets a one-line comment, as in [chroma.ts](src/audio/chroma.ts).
- A `TODO` says what is missing and why it isn't done yet.

## React

- Function components only.
- **MUST** use named exports. The only default export is `App`.
- Type props inline when there are one or two (`{ chord }: { chord: ChordDef }`). Otherwise declare an interface named `Props`, or `<Component>Props` when the file has more than one component.
- Keep state minimal. Derive values during render rather than storing them; Rhythm Mode's "tempo up" flash is computed from the run, not kept in state.
- **MUST** clean up in every effect that subscribes, listens, schedules a timer or starts a frame loop. Return the unsubscribe function, `clearInterval`/`cancelAnimationFrame`, or set a `cancelled` flag for async work.
- **MUST NOT** call `setState` on every animation frame. Per-frame work (the chroma canvas, the rhythm lane) writes to the DOM through a ref. React state changes only when something visible changes, such as a new beat or a graded change.
- Read external mutable stores, like the detector engine, with `useSyncExternalStore`.
- Keep callbacks that a long-lived effect needs in a ref, so the effect doesn't restart on every render (see `usePlayAlong`).
- List keys use stable ids. Use an index only for lists that never reorder.
- Mark controls with their semantic state: `aria-pressed` for toggles, `role="radio"` + `aria-checked` for single-choice groups, `aria-current="page"` for navigation. Use `aria-live` for live results, and add `aria-label`s where the visible text isn't enough.
- Dev-only UI, like the synthetic strum panels, is gated on `import.meta.env.DEV` so it never ships in production builds.

## Architecture

Each folder in `src/` has one job, and dependencies point in one direction:

| Folder | Job | May use |
|---|---|---|
| `audio/` | Web Audio engine, chord templates, detection | nothing app-specific |
| `drill/`, `song/` | Practice logic (pure TS) and its specific components | `audio/` |
| `storage/` | All IndexedDB access and settings hooks | the types of the folders above |
| `components/` | Shared presentational components | `audio/` types |
| `hooks/` | Small shared hooks and formatting helpers | – |
| `screens/` | One component per tab; composes everything | all of the above |

- **MUST** keep scoring and timing logic in plain TypeScript, with no React, DOM or Web Audio. That is what makes it testable (`RhythmRun`, `SongRun`, `ChangeDrill`, the chart parser).
- **MUST** only touch IndexedDB from `storage/`.
- **MUST** keep imports free of cycles.
- Code shared by two features lives in one place (`usePlayAlong`, `changeWindows`, `SessionBars`), not in two copies.

## Persistence

- **MUST** pass every stored shape through a `sanitize` function on load, which repairs stale, partial or invalid values and falls back to defaults. See [useRhythmSettings.ts](src/storage/useRhythmSettings.ts).
- **MUST** bump the database version for a schema change and add a new `if (oldVersion < N)` block in [db.ts](src/storage/db.ts). Never edit an existing migration block: browsers that already ran it won't run it again.
- Keep small, per-browser preferences that must apply before first paint, like the theme, in `localStorage`. Wrap every access in `try`/`catch`.

## Testing

- Tests use Vitest. **MUST** pass `npm test` before every commit.
- **MUST** unit-test every pure logic module in a `*.test.ts` file next to it.
- **MUST** add a regression test with every bug fix, reproducing the bug, e.g. the "late strum confirmed after the window" case in [rhythm.test.ts](src/drill/rhythm.test.ts).
- **MUST** keep tests deterministic: no real timers, audio devices or `Math.random`. Use the seeded `mulberry32` and the synthesizer in [src/audio/testing/](src/audio/testing/), and pass explicit timestamps.
- Name tests as behaviour sentences: `it('still grades a late strum whose chord is confirmed after the window', …)`.
- Prefer one behaviour per test. Use `it.each` for the same check across a table of inputs.

## CSS

All styles are in [src/styles.css](src/styles.css), in commented sections in roughly screen order. New features add their own section with a heading comment (`/* Songs: library */`).

### Design tokens

- **MUST** take every colour, radius, shadow and font from a custom property defined on `:root`. Dark values override them only in `:root[data-theme='dark']`. Never key theme styles off `prefers-color-scheme`; [theme.ts](src/theme.ts) resolves Auto into `data-theme`.
- **MUST NOT** write raw colour values (hex, `rgb()`, named colours) outside the token blocks. The one exception is a data-visualisation scale scoped to its chart (`.heatmap`), with its dark variant beside it.
- Tints and overlays use `color-mix()` on tokens, e.g. `color-mix(in srgb, var(--pop-yellow) 30%, transparent)`.
- Every token has one role and is only used for it:

  | Tokens | Role |
  |---|---|
  | `--bg`, `--surface`, `--chip-bg`, `--border`, `--ink` | Surfaces, lines and outlines |
  | `--text`, `--text-muted` | All text |
  | `--accent`, `--accent-text` | Selection, interaction and focus |
  | `--pop-orange`, `--pop-yellow`, `--pop-teal`, `--pop-pink`, `--on-pop` | Decoration only, never meaning |
  | `--good`, `--warn`, `--danger` | Status only, always next to a text label |
  | `--chroma-track`, `--chroma-bar` | Chart furniture |

- Canvas drawing reads colours from these tokens with `getComputedStyle` (see [ChromaVisualizer.tsx](src/components/ChromaVisualizer.tsx)), so charts follow the theme.

### Naming and selectors

- Class names are kebab-case and prefixed with their component: `.song-card`, `.song-card-title`, `.lane-block`.
- Variants are an extra class on the same element: `.chip.removable`, `.lane-block.count`.
- Interactive state is styled from ARIA attributes, not extra classes: `[aria-pressed='true']`, `[aria-checked='true']`, `[aria-current='page']`. Use state classes (`.current`, `.hovered`, `.dimmed`) only where no ARIA attribute applies.
- **MUST NOT** use ID selectors or `!important`.
- **SHOULD** keep selectors to 3 levels at most. Style bare elements only in the base reset at the top of the file.

### Layout and units

- Use flexbox and grid with `gap`, not margins between siblings.
- **MUST** keep pages free of horizontal scrolling at any width. The single mobile breakpoint is `max-width: 760px`; larger layout shifts use `flex-wrap`, `auto-fill` and `minmax()` rather than more breakpoints.
- Use `rem` for type sizes, and `px` for borders, shadows and small fixed gaps.
- Use the `tabular-nums` font variant for numbers that update live.

### Accessibility and motion

- **MUST** keep a visible focus ring: the global `:focus-visible` outline. Never remove it without a replacement.
- **MUST** meet WCAG AA contrast in both themes: 4.5:1 for body text, 3:1 for large text and UI outlines.
- **MUST NOT** use colour alone to carry meaning. Grades, ratings and statuses always include their text label.
- **SHOULD** make click targets at least 32 px in each direction.
- Keep transitions short (250 ms or less) and limited to `transform`, `opacity`, `box-shadow` and colours.
- **MUST** wrap new animations in `@media (prefers-reduced-motion: no-preference)`. See [Known gaps](#known-gaps).

### Formatting

- One declaration per line, and one selector per line in a selector list.
- Multi-value properties (`transition`, `text-shadow`, `background`) put each value on its own line once there are more than one.
- Use single quotes inside attribute selectors: `[data-theme='dark']`.

## Before you commit

1. `npm run typecheck`, `npm test` and `npm run build` all pass.
2. Visible changes are checked in Bright and Dark, and at a narrow (~380 px) and a wide (~1280 px) window.
3. New features and behaviour changes are described in the [README](README.md).
4. The commit message has a short imperative summary (`Add Song Mode: play whole songs from chord charts`), a blank line, then bullet points for the notable changes.

## Known gaps

These parts of the codebase don't meet the standards yet. Fix them when you're working nearby, and remove each entry once it's done.

- **No automated linting or formatting.** The formatting rules above are only enforced by review. ESLint (with `typescript-eslint` and the React hooks rules), Prettier and Stylelint would enforce them automatically.
- **No reduced-motion handling.** Existing animations (`pop`, `target-in`, the lane scroll) run even when the system asks for reduced motion.
- **Small click targets.** Chips, segmented buttons and the theme switch are about 28–30 px tall, below the 32 px target.
- **Line endings.** There's no `.gitattributes`, so Git on Windows converts LF to CRLF in working copies. Adding `* text=auto eol=lf` would fix it.
- **One large stylesheet.** `styles.css` is about 1,700 lines. If it keeps growing, split it into one file per area (`base.css`, `drills.css`, `songs.css`…), imported in order from `main.tsx`.
