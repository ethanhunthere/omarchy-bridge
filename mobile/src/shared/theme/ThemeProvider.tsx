import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { StyleSheet } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { DEFAULT_THEME_ID, getTheme, ThemeTokens } from './palettes';

const THEME_KEY = 'omarchy-bridge-theme';

interface ThemeContextValue {
  theme: ThemeTokens;
  themeId: string;
  setThemeId: (id: string) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: getTheme(DEFAULT_THEME_ID),
  themeId: DEFAULT_THEME_ID,
  setThemeId: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [themeId, setThemeIdState] = useState<string>(DEFAULT_THEME_ID);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const stored = await SecureStore.getItemAsync(THEME_KEY);
        if (mounted && stored && getTheme(stored).id === stored) setThemeIdState(stored);
      } catch (e) {}
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const setThemeId = (id: string) => {
    setThemeIdState(id);
    SecureStore.setItemAsync(THEME_KEY, id).catch(() => {});
  };

  const value = useMemo(
    () => ({ theme: getTheme(themeId), themeId, setThemeId }),
    [themeId]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}

/** Build a StyleSheet from theme tokens, rebuilt only when the theme changes. */
export function useThemedStyles<T extends StyleSheet.NamedStyles<T>>(
  factory: (t: ThemeTokens) => T
): T {
  const { theme } = useTheme();
  return useMemo(() => StyleSheet.create(factory(theme)), [theme]);
}
