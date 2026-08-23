'use client';

import * as React from 'react';
import Link from 'next/link';
import { MailCheck } from 'lucide-react';
import { ApiError, post } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { Button, Card, Field, Input } from '@/components/ui/primitives';

/**
 * Asking for a new password.
 *
 * The answer is the same whether or not the address is registered. Saying "no
 * account with that email" here would turn this form into a way to find out who
 * has an account, which is the same leak as a login error that distinguishes a
 * wrong password from a missing user.
 */
export default function ForgotPasswordPage() {
  const { t } = useI18n();
  const [email, setEmail] = React.useState('');
  const [sent, setSent] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);

    try {
      await post('/auth/password/forgot', { email: email.trim() });
      setSent(true);
    } catch (caught) {
      // Only a real failure surfaces — a rate limit, or the server being down.
      // An unknown address is not an error.
      setError(caught instanceof ApiError ? caught.payload.userMessage : String(caught));
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
          {sent ? (
            <div className="text-center">
              <MailCheck className="mx-auto mb-3 size-8 text-success" />
              <p className="text-[15px] font-medium text-fg">{t('auth.forgot.sent')}</p>
              <p className="mt-2 text-[13px] text-muted">{t('auth.forgot.sentHint')}</p>
              <Link
                href="/login"
                className="mt-5 inline-block text-[13px] text-accent hover:underline"
              >
                {t('auth.forgot.backToLogin')}
              </Link>
            </div>
          ) : (
            <>
              <h1 className="text-[17px] font-semibold tracking-tight">{t('auth.forgot.title')}</h1>
              <p className="mb-5 mt-1.5 text-[13px] text-muted">{t('auth.forgot.subtitle')}</p>

              <form onSubmit={submit} noValidate>
                <Field label={t('auth.email')}>
                  <Input
                    type="email"
                    autoComplete="email"
                    required
                    autoFocus
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                  />
                </Field>

                {error ? (
                  <div className="mb-4 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2.5">
                    <p className="text-[13px] text-danger">{error}</p>
                  </div>
                ) : null}

                <Button type="submit" className="w-full" loading={pending} disabled={!email.trim()}>
                  {t('auth.forgot.submit')}
                </Button>
              </form>

              <p className="mt-4 text-center text-[13px]">
                <Link href="/login" className="text-accent hover:underline">
                  {t('auth.forgot.backToLogin')}
                </Link>
              </p>
            </>
          )}
        </Card>
      </div>
    </main>
  );
}
