import { useState } from 'react';
import { CHORDS_BY_ID } from '../audio/chords';
import type { DetectorEngine } from '../audio/detector';

/** Dev-only: strum a synthesized chord into the detector, for testing without a guitar. */
export function DevStrum({ engine, chordIds }: { engine: DetectorEngine; chordIds?: string[] }) {
  const ids = chordIds ?? [...CHORDS_BY_ID.keys()];
  const [selected, setSelected] = useState(ids[0]);
  if (!import.meta.env.DEV) return null;

  const play = (id: string) => {
    const chord = CHORDS_BY_ID.get(id);
    if (chord) engine.playTestChord(chord);
  };

  return (
    <div className="dev-tools">
      <h3>Developer: synthetic strum</h3>
      <div className="dev-row">
        {chordIds ? (
          ids.map((id) => (
            <button key={id} type="button" onClick={() => play(id)}>
              Strum {id}
            </button>
          ))
        ) : (
          <>
            <select value={selected} onChange={(e) => setSelected(e.target.value)}>
              {ids.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
            <button type="button" onClick={() => play(selected)}>
              Play into detector
            </button>
          </>
        )}
      </div>
    </div>
  );
}
