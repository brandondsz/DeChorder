import type { ChordDef } from '../audio/chords';

const STRINGS = 6;
const FRETS = 4;
const LEFT = 18;
const TOP = 26;
const STRING_GAP = 20;
const FRET_GAP = 26;
const WIDTH = LEFT * 2 + STRING_GAP * (STRINGS - 1);
const HEIGHT = TOP + FRET_GAP * FRETS + 10;

export function ChordDiagram({ chord }: { chord: ChordDef }) {
  const x = (string: number) => LEFT + string * STRING_GAP;
  return (
    <svg
      className="chord-diagram"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      role="img"
      aria-label={`${chord.name} chord diagram`}
    >
      <rect x={x(0)} y={TOP - 4} width={x(5) - x(0)} height={4} className="nut" />
      {Array.from({ length: FRETS }, (_, f) => (
        <line key={`f${f}`} x1={x(0)} x2={x(5)} y1={TOP + (f + 1) * FRET_GAP} y2={TOP + (f + 1) * FRET_GAP} className="fret" />
      ))}
      {Array.from({ length: STRINGS }, (_, s) => (
        <line key={`s${s}`} x1={x(s)} x2={x(s)} y1={TOP} y2={TOP + FRETS * FRET_GAP} className="string" />
      ))}
      {chord.frets.map((fret, s) => {
        if (fret === null) {
          return (
            <text key={s} x={x(s)} y={TOP - 10} className="marker">
              ×
            </text>
          );
        }
        if (fret === 0) {
          return <circle key={s} cx={x(s)} cy={TOP - 14} r={4.5} className="open" />;
        }
        const cy = TOP + (fret - 0.5) * FRET_GAP;
        return (
          <g key={s}>
            <circle cx={x(s)} cy={cy} r={8} className="dot" />
            <text x={x(s)} y={cy + 0.5} className="finger">
              {chord.fingers[s]}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
