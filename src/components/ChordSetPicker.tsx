import { CHORD_PRESETS, GROUP_LABELS, OPEN_CHORDS, type ChordGroup } from '../audio/chords';

interface Props {
  enabledIds: string[];
  onChange: (ids: string[]) => void;
  minSelected?: number;
  hint?: string;
}

const GROUPS = Object.keys(GROUP_LABELS) as ChordGroup[];

const DEFAULT_HINT =
  "Fewer chords means fewer look-alikes to confuse. Some pairs share notes almost exactly (Em/Em7, Asus2/Esus4), so leave out the ones you aren't practising.";

export function ChordSetPicker({ enabledIds, onChange, minSelected = 1, hint = DEFAULT_HINT }: Props) {
  const enabled = new Set(enabledIds);
  const toggle = (id: string) => {
    if (enabled.has(id)) {
      if (enabled.size > minSelected) onChange(enabledIds.filter((x) => x !== id));
    } else {
      onChange(OPEN_CHORDS.map((c) => c.id).filter((x) => x === id || enabled.has(x)));
    }
  };
  const activePreset = CHORD_PRESETS.find(
    (p) => p.chordIds.length === enabled.size && p.chordIds.every((id) => enabled.has(id)),
  );

  return (
    <div className="chord-set">
      <div className="presets" role="group" aria-label="Presets">
        {CHORD_PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            className="preset"
            aria-pressed={activePreset?.id === p.id}
            onClick={() => onChange(p.chordIds)}
          >
            {p.label}
          </button>
        ))}
      </div>
      {GROUPS.map((group) => (
        <div key={group} className="chord-group">
          <span className="chord-group-label">{GROUP_LABELS[group]}</span>
          <div className="chips">
            {OPEN_CHORDS.filter((c) => c.group === group).map((c) => (
              <button
                key={c.id}
                type="button"
                className="chip"
                aria-pressed={enabled.has(c.id)}
                onClick={() => toggle(c.id)}
              >
                {c.name}
              </button>
            ))}
          </div>
        </div>
      ))}
      <p className="hint">{hint}</p>
    </div>
  );
}
