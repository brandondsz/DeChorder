const MIN_DB = -90;
const MAX_DB = -10;

const toPercent = (db: number) => ((Math.min(MAX_DB, Math.max(MIN_DB, db)) - MIN_DB) / (MAX_DB - MIN_DB)) * 100;

interface Props {
  levelDb: number;
  gateDb: number;
  onGateChange: (db: number) => void;
}

/** Live input meter with the silence gate drawn on it, plus the slider that moves the gate. */
export function InputLevel({ levelDb, gateDb, onGateChange }: Props) {
  const open = levelDb >= gateDb;
  return (
    <div className="input-level">
      <div className="meter" aria-hidden="true">
        <div className={`meter-fill${open ? ' open' : ''}`} style={{ width: `${toPercent(levelDb)}%` }} />
        <div className="meter-gate" style={{ left: `${toPercent(gateDb)}%` }} />
      </div>
      <label className="gate-control">
        <span>
          Noise gate <strong>{gateDb} dB</strong>
        </span>
        <input
          type="range"
          min={-80}
          max={-20}
          step={1}
          value={gateDb}
          onChange={(e) => onGateChange(Number(e.target.value))}
        />
      </label>
      <p className="hint">
        Set the gate just above the meter level when you're not playing, so room noise isn't analysed.
      </p>
    </div>
  );
}
