import { createContext, useContext, useEffect, useState } from 'react';

/**
 * Light/Dark/System theme provider — small custom impl rather than pulling
 * in next-themes (we're not on Next). Persists to localStorage and
 * subscribes to the OS color-scheme media query when 'system' is selected.
 *
 * Toggles a `dark` class on <html>, which the Tailwind dark-variant CSS
 * keys off of. The actual color tokens live in src/index.css.
 */
type Theme = 'light' | 'dark' | 'system';

interface ThemeContextValue {
  theme: Theme;
  setTheme: (t: Theme) => void;
  resolved: 'light' | 'dark';
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const STORAGE_KEY = 'colyseus-admin-theme';

function getInitialTheme(): Theme {
  if (typeof window === 'undefined') { return 'system'; }
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === 'light' || stored === 'dark' || stored === 'system') { return stored; }
  return 'system';
}

function resolve(t: Theme): 'light' | 'dark' {
  if (t === 'system') {
    return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark' : 'light';
  }
  return t;
}

function apply(resolved: 'light' | 'dark') {
  if (typeof document === 'undefined') { return; }
  document.documentElement.classList.toggle('dark', resolved === 'dark');
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => getInitialTheme());
  const [resolved, setResolved] = useState<'light' | 'dark'>(() => resolve(getInitialTheme()));

  // Apply on mount + whenever `theme` changes.
  useEffect(() => {
    const r = resolve(theme);
    setResolved(r);
    apply(r);
  }, [theme]);

  // When `system` is active, follow OS color-scheme changes.
  useEffect(() => {
    if (theme !== 'system' || typeof window === 'undefined') { return; }
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => {
      const r = mq.matches ? 'dark' : 'light';
      setResolved(r);
      apply(r);
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [theme]);

  const setTheme = (t: Theme) => {
    localStorage.setItem(STORAGE_KEY, t);
    setThemeState(t);
  };

  return (
    <ThemeContext.Provider value={{ theme, setTheme, resolved }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) { throw new Error('useTheme must be used within <ThemeProvider>'); }
  return ctx;
}
