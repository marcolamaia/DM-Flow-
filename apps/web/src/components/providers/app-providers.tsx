'use client';

import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nContext, translate, type Locale, type MessageKey } from '@/lib/i18n';
import { ApiError, setLocale, setWorkspaceId } from '@/lib/api';
import { Toaster } from '@/components/ui/toast';

export type Theme = 'light' | 'dark' | 'system';

interface AppState {
  locale: Locale;
  setLocaleState: (locale: Locale) => void;
  theme: Theme;
  setTheme: (theme: Theme) => void;
  workspaceId: string | null;
  selectWorkspace: (id: string) => void;
}

const AppContext = React.createContext<AppState | null>(null);

export function useApp(): AppState {
  const ctx = React.useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside AppProviders');
  return ctx;
}

function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const dark = theme === 'dark' || (theme === 'system' && prefersDark);
  root.classList.toggle('dark', dark);
}

export function AppProviders({ children }: { children: React.ReactNode }) {
  const [queryClient] = React.useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 15_000,
            refetchOnWindowFocus: false,
            retry: (failureCount, error) => {
              // Retrying a 403 or a validation error just delays the real message.
              if (error instanceof ApiError) return error.payload.retryable && failureCount < 2;
              return failureCount < 2;
            },
          },
        },
      }),
  );

  const [locale, setLocaleValue] = React.useState<Locale>('pt-BR');
  const [theme, setThemeValue] = React.useState<Theme>('system');
  const [workspaceId, setWorkspaceState] = React.useState<string | null>(null);

  React.useEffect(() => {
    const storedLocale = window.localStorage.getItem('dmflow.locale') as Locale | null;
    const storedTheme = window.localStorage.getItem('dmflow.theme') as Theme | null;
    const storedWorkspace = window.localStorage.getItem('dmflow.workspace');

    if (storedLocale) {
      setLocaleValue(storedLocale);
      setLocale(storedLocale);
    }
    if (storedTheme) setThemeValue(storedTheme);
    if (storedWorkspace) {
      setWorkspaceState(storedWorkspace);
      setWorkspaceId(storedWorkspace);
    }
    applyTheme(storedTheme ?? 'system');
  }, []);

  React.useEffect(() => {
    applyTheme(theme);
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const listener = () => theme === 'system' && applyTheme('system');
    media.addEventListener('change', listener);
    return () => media.removeEventListener('change', listener);
  }, [theme]);

  const value = React.useMemo<AppState>(
    () => ({
      locale,
      setLocaleState: (next) => {
        setLocaleValue(next);
        setLocale(next);
        window.localStorage.setItem('dmflow.locale', next);
      },
      theme,
      setTheme: (next) => {
        setThemeValue(next);
        window.localStorage.setItem('dmflow.theme', next);
      },
      workspaceId,
      selectWorkspace: (id) => {
        setWorkspaceState(id);
        setWorkspaceId(id);
      },
    }),
    [locale, theme, workspaceId],
  );

  const i18nValue = React.useMemo(
    () => ({ locale, t: (key: MessageKey) => translate(locale, key) }),
    [locale],
  );

  return (
    <QueryClientProvider client={queryClient}>
      <AppContext.Provider value={value}>
        <I18nContext.Provider value={i18nValue}>
          {children}
          <Toaster />
        </I18nContext.Provider>
      </AppContext.Provider>
    </QueryClientProvider>
  );
}
