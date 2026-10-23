import { useCallback, useEffect, useRef, useState } from 'react';
import { loadSetting, saveSetting, type SettingsMap } from './db';

/**
 * A settings object loaded from and saved to IndexedDB. Starts at `defaults` and falls
 * back to them if storage is unavailable. `sanitize` repairs stale or partial stored values.
 */
export function usePersistentSetting<K extends keyof SettingsMap>(
  key: K,
  defaults: SettingsMap[K],
  sanitize: (stored: SettingsMap[K] | undefined) => SettingsMap[K],
) {
  const [value, setValue] = useState(defaults);
  const loaded = useRef(false);
  const sanitizeRef = useRef(sanitize);

  useEffect(() => {
    let cancelled = false;
    loadSetting(key)
      .then((stored) => {
        if (!cancelled) setValue(sanitizeRef.current(stored));
      })
      .catch((err) => console.warn(`Could not load ${key} settings`, err))
      .finally(() => {
        loaded.current = true;
      });
    return () => {
      cancelled = true;
    };
  }, [key]);

  useEffect(() => {
    if (!loaded.current) return;
    const timer = setTimeout(() => {
      saveSetting(key, value).catch((err) => console.warn(`Could not save ${key} settings`, err));
    }, 300);
    return () => clearTimeout(timer);
  }, [key, value]);

  const update = useCallback((patch: Partial<SettingsMap[K]>) => {
    setValue((v) => ({ ...v, ...patch }));
  }, []);

  return [value, update] as const;
}
