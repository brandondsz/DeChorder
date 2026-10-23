import { useEffect, useState } from 'react';

/** Re-renders every ~100 ms while active, returning performance.now(). */
export function useClock(active: boolean): number {
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(performance.now()), 100);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

export function formatSeconds(ms: number | null): string {
  return ms === null ? '–' : `${(ms / 1000).toFixed(1)}s`;
}
