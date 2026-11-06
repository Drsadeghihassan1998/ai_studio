import { createContext, useContext } from 'react';
import type { Settings } from '../lib/db';

export const SettingsContext = createContext<Settings | null>(null);

export function useSettings(): Settings {
  const settings = useContext(SettingsContext);
  if (!settings) throw new Error('settings not loaded');
  return settings;
}

export const useUnit = () => useSettings().displayUnit;
