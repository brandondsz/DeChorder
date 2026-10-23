import { useEffect, useState } from 'react';

export type ThemePref = 'auto' | 'light' | 'dark';

/** Kept in localStorage (not IndexedDB) so index.html can apply it before first paint. */
const STORAGE_KEY = 'dechorder-theme';
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');

function readPref(): ThemePref {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    // Storage can be unavailable (private mode, blocked site data); fall back to auto.
  }
  return 'auto';
}

function apply(pref: ThemePref): void {
  const dark = pref === 'dark' || (pref === 'auto' && darkQuery.matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}

/** The theme preference, applied to <html data-theme> and remembered across visits. */
export function useTheme() {
  const [pref, setPref] = useState<ThemePref>(readPref);

  useEffect(() => {
    apply(pref);
    try {
      if (pref === 'auto') localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, pref);
    } catch {
      // Not persisted this time; the choice still applies for this visit.
    }
    if (pref !== 'auto') return;
    const onChange = () => apply('auto');
    darkQuery.addEventListener('change', onChange);
    return () => darkQuery.removeEventListener('change', onChange);
  }, [pref]);

  return [pref, setPref] as const;
}
