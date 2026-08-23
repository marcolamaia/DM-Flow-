'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { CheckCircle2, TriangleAlert } from 'lucide-react';
import { ApiError, post } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { Button, Card, Spinner } from '@/components/ui/primitives';

type State = 'working' | 'done' | 'failed';

/**
 * The link from the email lands here.
 *
 * Public on purpose: the message is usually opened on a phone that is not signed
 * in. Holding the token is the proof — demanding a session first would send
 * people back through login for no gain in safety.
 */
function Verify() {
  const { t } = useI18n();
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get('token');

  const [state, setState] = React.useState<State>('working');
  const [message, setMessage] = React.useState('');
  const attempted = React.useRef(false);

  React.useEffect(() => {
    // Guarded because React runs effects twice in development, and the second
    // call would consume the token the first one just spent and report failure.
    if (attempted.current) return;
    attempted.current = true;

    if (!token) {
      setState('failed');
      setMessage(t('verifyEmail.missingToken'));
      return;
    }

    post('/auth/email/verify', { token })
      .then(() => setState('done'))
      .catch((error: unknown) => {
        setState('failed');
        setMessage(
          error instanceof ApiError ? error.payload.userMessage : t('verifyEmail.failed'),
        );
      });
  }, [token, t]);

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-[400px]">
        <div className="mb-7 text-center">
          <p className="text-lg font-semibold tracking-tight">
            DM <span className="text-accent">FLOW</span>
          </p>
        </div>

        <Card className="p-6 text-center">
          {state === 'working' ? (
            <div className="flex flex-col items-center gap-3 py-4">
              <Spinner className="size-5 text-muted" />
              <p className="text-[13px] text-muted">{t('verifyEmail.working')}</p>
            </div>
          ) : state === 'done' ? (
            <div className="flex flex-col items-center gap-3 py-2">
              <CheckCircle2 className="size-7 text-success" />
              <h1 className="text-[17px] font-semibold tracking-tight">{t('verifyEmail.done')}</h1>
              <p className="text-[13px] leading-relaxed text-muted">{t('verifyEmail.doneHint')}</p>
              <Button className="mt-2 w-full" onClick={() => router.replace('/dashboard')}>
                {t('verifyEmail.continue')}
              </Button>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 py-2">
              <TriangleAlert className="size-7 text-danger" />
              <h1 className="text-[17px] font-semibold tracking-tight">{t('verifyEmail.failed')}</h1>
              <p className="text-[13px] leading-relaxed text-muted">{message}</p>
              <p className="mt-1 text-[12px] leading-relaxed text-subtle">
                {t('verifyEmail.failedHint')}
              </p>
              <Link href="/login" className="mt-2 w-full">
                <Button variant="secondary" className="w-full">
                  {t('verifyEmail.backToLogin')}
                </Button>
              </Link>
            </div>
          )}
        </Card>
      </div>
    </main>
  );
}

/** useSearchParams needs a suspense boundary for the static shell to prerender. */
export default function VerifyEmailPage() {
  return (
    <React.Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center">
          <Spinner className="size-5 text-muted" />
        </main>
      }
    >
      <Verify />
    </React.Suspense>
  );
}
