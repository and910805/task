import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

const ThemeContext = createContext(null);

const THEME_STORAGE_KEY = 'app_theme_preference';

const resolveSystemTheme = () =>
  window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';

const getInitialPreference = () => {
  if (typeof window === 'undefined') {
    return 'system';
  }
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (stored === 'light' || stored === 'dark' || stored === 'system') {
    return stored;
  }
  return 'system';
};

export const ThemeProvider = ({ children }) => {
  const [preference, setPreference] = useState(getInitialPreference);
  const [systemTheme, setSystemTheme] = useState(resolveSystemTheme);

  const theme = preference === 'system' ? systemTheme : preference;

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const listener = (event) => {
      setSystemTheme(event.matches ? 'dark' : 'light');
    };
    media.addEventListener('change', listener);
    return () => media.removeEventListener('change', listener);
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  useEffect(() => {
    window.localStorage.setItem(THEME_STORAGE_KEY, preference);
  }, [preference]);

  const toggleTheme = useCallback(() => {
    setPreference((prev) => {
      const next = prev === 'dark' ? 'light' : 'dark';
      if (prev === 'system') {
        return systemTheme === 'dark' ? 'light' : 'dark';
      }
      return next;
    });
  }, [systemTheme]);

  const setThemePreference = useCallback((value) => {
    if (value === 'light' || value === 'dark' || value === 'system') {
      setPreference(value);
    }
  }, []);

  const value = useMemo(
    () => ({
      theme,
      preference,
      setPreference: setThemePreference,
      toggleTheme,
    }),
    [theme, preference, setThemePreference, toggleTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};
