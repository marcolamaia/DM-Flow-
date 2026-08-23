'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ApiError, post, setWorkspaceId } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useApp } from '@/components/providers/app-providers';
import { Button, Field, Input, Card, Spinner } from '@/components/ui/primitives';

function RegisterForm() {
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

  const [form, setForm] = useState({ name: '', email: '', password: '', workspaceName: '' });
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(false);

  const fieldError = (path: string): string | undefined => {
    const details = error?.payload.details;
    if (!Array.isArray(details)) return undefined;
    return (details as Array<{ path: string; message: string }>).find((d) => d.path === path)
      ?.message;
  };

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const result = await post<{ workspaceId: string }>('/auth/register', form);
      setWorkspaceId(result.workspaceId);
      selectWorkspace(result.workspaceId);
      router.replace(next);
    } catch (err) {
      if (err instanceof ApiError) setError(err);
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
          <h1 className="mt-5 text-[22px] font-semibold tracking-tight">
            {t('auth.register.title')}
          </h1>
          <p className="mt-1.5 text-[13px] text-muted">{t('auth.register.subtitle')}</p>
        </div>

        <Card className="p-6">
          <form onSubmit={submit} noValidate>
            <Field label={t('auth.name')} error={fieldError('name')}>
              <Input
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                autoFocus
              />
            </Field>

            <Field label={t('auth.email')} error={fieldError('email')}>
              <Input
                type="email"
                autoComplete="email"
                required
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </Field>

            <Field
              label={t('auth.password')}
              hint={t('auth.passwordHint')}
              error={fieldError('password')}
            >
              <Input
                type="password"
                autoComplete="new-password"
                required
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
            </Field>

            <Field label={`${t('auth.workspaceName')} (${t('common.optional')})`}>
              <Input
                value={form.workspaceName}
                onChange={(e) => setForm({ ...form, workspaceName: e.target.value })}
              />
            </Field>

            {error && !Array.isArray(error.payload.details) ? (
              <div className="mb-4 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2.5">
                <p className="text-[13px] text-danger">{error.payload.userMessage}</p>
              </div>
            ) : null}

            <Button type="submit" className="w-full" loading={loading}>
              {t('auth.submit.register')}
            </Button>
          </form>
        </Card>

        {/* O consentimento é dado aqui, então o link precisa estar aqui — não
            escondido num rodapé de outra página. */}
        <p className="mt-4 text-center text-[12px] leading-relaxed text-subtle">
          {t('legal.acceptOnRegister')}{' '}
          <Link href="/termos" className="text-muted underline hover:text-fg">
            {t('legal.terms')}
          </Link>{' '}
          {t('legal.and')}{' '}
          <Link href="/privacidade" className="text-muted underline hover:text-fg">
            {t('legal.privacy')}
          </Link>
          .
        </p>

        <p className="mt-5 text-center text-[13px] text-muted">
          <Link href="/login" className="text-accent hover:underline">
            {t('auth.toLogin')}
          </Link>
        </p>
      </div>
    </main>
  );
}

/** useSearchParams needs a suspense boundary for the static shell to prerender. */
export default function RegisterPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center">
          <Spinner className="size-5 text-muted" />
        </main>
      }
    >
      <RegisterForm />
    </Suspense>
  );
}
