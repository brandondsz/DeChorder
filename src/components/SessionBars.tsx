import { useState } from 'react';

const MAX_BARS = 20;
const CHART_HEIGHT = 140;

export const sessionDateFormat = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

export interface SessionBar {
  key: string | number;
  /** null draws a stub bar (e.g. a session with nothing to measure). */
  value: number | null;
  /** First line is the headline; the rest are detail. */
  tooltip: string[];
  ariaLabel: string;
}

interface Props {
  bars: SessionBar[];
  caption: string;
  /** Label for the dashed best-so-far line, given the best value. */
  bestLabel: (best: number) => string;
  table: { headers: string[]; rows: (string | number)[][] };
  /** Round the axis maximum up to a multiple of this. */
  axisStep?: number;
}

/** One-series bar chart of recent sessions with a personal-best line, hover tooltips and a table view. */
export function SessionBars({ bars, caption, bestLabel, table, axisStep = 10 }: Props) {
  const [hovered, setHovered] = useState<number | null>(null);
  const recent = bars.slice(-MAX_BARS);
  const values = bars.flatMap((b) => (b.value === null ? [] : [b.value]));
  const best = values.length ? Math.max(...values) : null;
  const scaleMax = Math.max(axisStep, Math.ceil(((best ?? 0) * 1.15) / axisStep) * axisStep);
  const y = (v: number) => (v / scaleMax) * CHART_HEIGHT;
  const hoveredBar = hovered !== null ? recent[hovered] : null;

  return (
    <figure className="history">
      <figcaption className="history-caption">{caption}</figcaption>
      <div className="history-plot" style={{ height: CHART_HEIGHT }} onMouseLeave={() => setHovered(null)}>
        <span className="history-axis-label top">{scaleMax}</span>
        <span className="history-axis-label bottom">0</span>
        {best !== null && (
          <div className="history-best" style={{ bottom: y(best) }}>
            <span>{bestLabel(best)}</span>
          </div>
        )}
        <div className="history-bars">
          {recent.map((bar, i) => (
            <div
              key={bar.key}
              className="history-slot"
              onMouseEnter={() => setHovered(i)}
              onFocus={() => setHovered(i)}
              onBlur={() => setHovered(null)}
              tabIndex={0}
              aria-label={bar.ariaLabel}
            >
              <div
                className={`history-bar${hovered === i ? ' hovered' : ''}${bar.value === null ? ' stub' : ''}`}
                style={{ height: Math.max(2, y(bar.value ?? 0)) }}
              />
            </div>
          ))}
        </div>
        {hoveredBar && hovered !== null && (
          <div
            className="history-tooltip"
            style={{ left: `${((hovered + 0.5) / recent.length) * 100}%`, bottom: y(hoveredBar.value ?? 0) + 10 }}
            role="status"
          >
            {hoveredBar.tooltip.map((line, i) =>
              i === 0 ? <strong key={i}>{line}</strong> : <span key={i} className={i === hoveredBar.tooltip.length - 1 ? 'muted' : undefined}>{line}</span>,
            )}
          </div>
        )}
      </div>
      <details className="history-table">
        <summary>Show as table</summary>
        <table>
          <thead>
            <tr>
              {table.headers.map((h) => (
                <th key={h} scope="col">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, r) => (
              <tr key={r}>
                {row.map((cell, c) => (
                  <td key={c}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
