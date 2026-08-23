'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ApiError, post, get, setWorkspaceId } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useApp } from '@/components/providers/app-providers';
import { Button, Field, Input, Card, Spinner } from '@/components/ui/primitives';
import type { Me } from '@/lib/types';

function LoginForm() {
  const { t } = useI18n();
  const { selectWorkspace } = useApp();
  const router = useRouter();
  const params = useSearchParams();

  /**
   * Where to land after signing in.
   *
   * Only same-site paths are honoured. Taking an absolute URL from the query
   * string would turn this into an open redirect — a link that looks like ours
   * and lands on somebody else's login form.
   */
  const next = (() => {
    const raw = params.get('next');
    return raw && raw.startsWith('/') && !raw.startsWith('//') ? raw : '/dashboard';
  })();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [needsTotp, setNeedsTotp] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    try {
      await post('/auth/login', { email, password, ...(totp ? { totp } : {}) });
      const me = await get<Me>('/auth/me');
      const workspace = me.workspaces[0];
      if (workspace) {
        setWorkspaceId(workspace.id);
        selectWorkspace(workspace.id);
      }
      router.replace(next);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === 'TOTP_REQUIRED') setNeedsTotp(true);
        setError(err);
      }
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-[400px]">
        <div className="mb-7 text-center">
          <p className="text-lg font-semibold tracking-tight">
            DM <span className="text-accent">FLOW</span>
          </p>
          <h1 className="mt-5 text-[22px] font-semibold tracking-tight">{t('auth.login.title')}</h1>
          <p className="mt-1.5 text-[13px] text-muted">{t('auth.login.subtitle')}</p>
        </div>

        <Card className="p-6">
          <form onSubmit={submit} noValidate>
            <Field label={t('auth.email')}>
              <Input
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoFocus
              />
            </Field>

            <Field label={t('auth.password')}>
              <Input
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>

            {needsTotp ? (
              <Field label="Código de verificação">
                <Input
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={totp}
                  onChange={(e) => setTotp(e.target.value)}
                  autoFocus
                />
              </Field>
            ) : null}

            {error && error.code !== 'TOTP_REQUIRED' ? (
              <div className="mb-4 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2.5">
                <p className="text-[13px] text-danger">{error.payload.userMessage}</p>
                <p className="mt-1 font-mono text-[10px] text-danger/60">{error.correlationId}</p>
              </div>
            ) : null}

            <Button type="submit" className="w-full" loading={loading}>
              {t('auth.submit.login')}
            </Button>

            {/* Without this, somebody who forgets their password has no way back
                in at all — the recovery flow existed and nothing pointed at it. */}
            <p className="mt-4 text-center text-[13px]">
              <Link href="/forgot-password" className="text-muted hover:text-fg hover:underline">
                {t('auth.forgot.link')}
              </Link>
            </p>
          </form>
        </Card>

        <p className="mt-5 text-center text-[13px] text-muted">
          <Link href="/register" className="text-accent hover:underline">
            {t('auth.toRegister')}
          </Link>
        </p>
      </div>
    </main>
  );
}

/** useSearchParams needs a suspense boundary for the static shell to prerender. */
export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center">
          <Spinner className="size-5 text-muted" />
        </main>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
