import { useState } from 'react';
import { formatSeconds } from '../hooks/useClock';
import { transitionKey, type TransitionStat } from './reaction';

/**
 * Fixed bins (not relative to the data) so a cell visibly lightens as that change gets
 * faster across sessions. Index = sequential ramp step, slowest last.
 */
const BINS = [
  { maxMs: 800, label: '< 0.8s' },
  { maxMs: 1200, label: '0.8–1.2s' },
  { maxMs: 1800, label: '1.2–1.8s' },
  { maxMs: 2500, label: '1.8–2.5s' },
  { maxMs: Infinity, label: '> 2.5s' },
];

const binOf = (ms: number) => BINS.findIndex((b) => ms < b.maxMs);

interface Props {
  chordIds: string[];
  stats: Map<string, TransitionStat>;
}

/** From-chord rows × to-chord columns, shaded by average change time. */
export function TransitionHeatmap({ chordIds, stats }: Props) {
  const [hovered, setHovered] = useState<string | null>(null);
  const hoveredStat = hovered ? stats.get(hovered) : undefined;

  return (
    <figure className="heatmap">
      <div
        className="heatmap-grid"
        style={{ gridTemplateColumns: `auto repeat(${chordIds.length}, minmax(34px, 1fr))` }}
        onMouseLeave={() => setHovered(null)}
        role="table"
        aria-label="Average change time, from chord (rows) to chord (columns)"
      >
        <div role="row" className="heatmap-row">
          <span className="heatmap-corner" role="columnheader">
            from ↓ to →
          </span>
          {chordIds.map((to) => (
            <span key={to} className="heatmap-head" role="columnheader">
              {to}
            </span>
          ))}
        </div>
        {chordIds.map((from) => (
          <div key={from} role="row" className="heatmap-row">
            <span className="heatmap-head row" role="rowheader">
              {from}
            </span>
            {chordIds.map((to) => {
              if (from === to) return <span key={to} className="heatmap-cell self" role="cell" aria-label="n/a" />;
              const key = transitionKey(from, to);
              const stat = stats.get(key);
              const bin = stat ? binOf(stat.meanMs) : null;
              return (
                <span
                  key={to}
                  role="cell"
                  tabIndex={stat ? 0 : -1}
                  className={`heatmap-cell${stat ? ` step-${bin}` : ' empty'}${hovered === key ? ' hovered' : ''}`}
                  onMouseEnter={() => setHovered(stat ? key : null)}
                  onFocus={() => setHovered(stat ? key : null)}
                  onBlur={() => setHovered(null)}
                  aria-label={stat ? `${from} to ${to}: ${formatSeconds(stat.meanMs)}` : `${from} to ${to}: not tried`}
                >
                  {stat ? (stat.meanMs / 1000).toFixed(1) : ''}
                </span>
              );
            })}
          </div>
        ))}
      </div>

      <div className="heatmap-footer">
        <div className="scale-legend" aria-label="Colour scale">
          {BINS.map((b, i) => (
            <span key={b.label} className="scale-item">
              <span className={`scale-swatch step-${i}`} />
              {b.label}
            </span>
          ))}
        </div>
        <p className="heatmap-detail" role="status">
          {hoveredStat
            ? `${hoveredStat.from} → ${hoveredStat.to}: ${formatSeconds(hoveredStat.meanMs)} average over the last ${hoveredStat.attempts} ${hoveredStat.attempts === 1 ? 'try' : 'tries'}${hoveredStat.misses ? `, ${hoveredStat.misses} missed` : ''}`
            : 'Hover a cell for details. Blank cells haven’t come up yet.'}
        </p>
      </div>
    </figure>
  );
}
