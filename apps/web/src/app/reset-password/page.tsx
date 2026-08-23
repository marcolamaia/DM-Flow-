'use client';

import * as React from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { CheckCircle2, TriangleAlert } from 'lucide-react';
import { ApiError, post } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { Button, Card, Field, Input, Spinner } from '@/components/ui/primitives';

type State = 'form' | 'done' | 'noToken';

/**
 * Where the link in the recovery email lands.
 *
 * Public on purpose: somebody who cannot sign in is exactly the person using
 * this page, and the message is usually opened on a phone with no session.
 * Holding the token is the proof.
 */
function ResetPassword() {
  const { t } = useI18n();
  const params = useSearchParams();
  const token = params.get('token');

  const [state, setState] = React.useState<State>(token ? 'form' : 'noToken');
  const [password, setPassword] = React.useState('');
  const [confirmation, setConfirmation] = React.useState('');
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const mismatch = confirmation.length > 0 && password !== confirmation;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (mismatch || !token) return;

    setPending(true);
    setError(null);

    try {
      await post('/auth/password/reset', { token, password });
      setState('done');
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.payload.userMessage : t('auth.reset.failed'),
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-[400px]">
        <div className="mb-7 text-center">
          <p className="text-lg font-semibold tracking-tight">
            DM <span className="text-accent">FLOW</span>
          </p>
        </div>

        <Card className="p-6">
          {state === 'noToken' ? (
            <div className="text-center">
              <TriangleAlert className="mx-auto mb-3 size-8 text-warning" />
              <p className="text-[15px] text-fg">{t('auth.reset.missingToken')}</p>
              <Link
                href="/forgot-password"
                className="mt-5 inline-block text-[13px] text-accent hover:underline"
              >
                {t('auth.reset.requestAnother')}
              </Link>
            </div>
          ) : state === 'done' ? (
            <div className="text-center">
              <CheckCircle2 className="mx-auto mb-3 size-8 text-success" />
              <p className="text-[15px] font-medium text-fg">{t('auth.reset.done')}</p>
              {/* Said plainly, because being signed out everywhere right after
                  changing a password looks like something went wrong if nobody
                  explains that it is the point. */}
              <p className="mt-2 text-[13px] text-muted">{t('auth.reset.doneHint')}</p>
              <Link href="/login" className="mt-5 inline-block">
                <Button>{t('auth.reset.goToLogin')}</Button>
              </Link>
            </div>
          ) : (
            <>
              <h1 className="text-[17px] font-semibold tracking-tight">{t('auth.reset.title')}</h1>
              <p className="mb-5 mt-1.5 text-[13px] text-muted">{t('auth.reset.subtitle')}</p>

              <form onSubmit={submit} noValidate>
                <Field label={t('auth.reset.newPassword')} hint={t('auth.passwordHint')}>
                  <Input
                    type="password"
                    autoComplete="new-password"
                    required
                    autoFocus
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                </Field>

                <Field
                  label={t('auth.reset.confirmPassword')}
                  error={mismatch ? t('auth.reset.mismatch') : undefined}
                >
                  <Input
                    type="password"
                    autoComplete="new-password"
                    required
                    value={confirmation}
                    onChange={(event) => setConfirmation(event.target.value)}
                  />
                </Field>

                {error ? (
                  <div className="mb-4 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2.5">
                    <p className="text-[13px] text-danger">{error}</p>
                    <Link
                      href="/forgot-password"
                      className="mt-1 inline-block text-[13px] text-accent hover:underline"
                    >
                      {t('auth.reset.requestAnother')}
                    </Link>
                  </div>
                ) : null}

                <Button
                  type="submit"
                  className="w-full"
                  loading={pending}
                  disabled={mismatch || password.length === 0 || confirmation.length === 0}
                >
                  {t('auth.reset.submit')}
                </Button>
              </form>
            </>
          )}
        </Card>
      </div>
    </main>
  );
}

export default function ResetPasswordPage() {
  return (
    <React.Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <Spinner className="size-6 text-muted" />
        </div>
      }
    >
      <ResetPassword />
    </React.Suspense>
  );
}
