'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { CheckCircle2, TriangleAlert } from 'lucide-react';
import { ApiError, get, post, setWorkspaceId } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useApp } from '@/components/providers/app-providers';
import { Button, Card, Spinner } from '@/components/ui/primitives';
import type { Me } from '@/lib/types';

type State = 'working' | 'needsAccount' | 'done' | 'failed';

/**
 * Where the invitation link lands.
 *
 * The person may arrive with no session at all, or signed in as somebody else.
 * The server binds an invitation to the address it was sent to, so the only
 * thing this page has to get right is putting them in front of the correct
 * sign-in with the token preserved across it.
 */
function Accept() {
  const { t } = useI18n();
  const router = useRouter();
  const params = useSearchParams();
  const { selectWorkspace } = useApp();
  const token = params.get('token');

  const [state, setState] = React.useState<State>('working');
  const [message, setMessage] = React.useState('');
  const attempted = React.useRef(false);

  React.useEffect(() => {
    if (attempted.current) return;
    attempted.current = true;

    if (!token) {
      setState('failed');
      setMessage(t('acceptInvite.missingToken'));
      return;
    }

    post<{ workspaceId: string }>('/workspaces/invitations/accept', { token })
      .then(async (result) => {
        setWorkspaceId(result.workspaceId);
        selectWorkspace(result.workspaceId);
        // Confirms the session really landed in the workspace before sending
        // them into it, rather than bouncing them off an access error.
        await get<Me>('/auth/me').catch(() => undefined);
        setState('done');
      })
      .catch((error: unknown) => {
        if (error instanceof ApiError && error.code === 'NOT_AUTHENTICATED') {
          setState('needsAccount');
          return;
        }
        setState('failed');
        setMessage(
          error instanceof ApiError ? error.payload.userMessage : t('acceptInvite.failed'),
        );
      });
  }, [token, t, selectWorkspace]);

  const nextParam = `?next=${encodeURIComponent(`/accept-invite?token=${token ?? ''}`)}`;

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
              <p className="text-[13px] text-muted">{t('acceptInvite.working')}</p>
            </div>
          ) : state === 'needsAccount' ? (
            <div className="flex flex-col items-center gap-3 py-2">
              <h1 className="text-[17px] font-semibold tracking-tight">
                {t('acceptInvite.needsAccount')}
              </h1>
              <p className="text-[13px] leading-relaxed text-muted">
                {t('acceptInvite.needsAccountHint')}
              </p>
              <div className="mt-2 flex w-full flex-col gap-2">
                <Button className="w-full" onClick={() => router.push(`/login${nextParam}`)}>
                  {t('acceptInvite.signIn')}
                </Button>
                <Button
                  variant="secondary"
                  className="w-full"
                  onClick={() => router.push(`/register${nextParam}`)}
                >
                  {t('acceptInvite.createAccount')}
                </Button>
              </div>
            </div>
          ) : state === 'done' ? (
            <div className="flex flex-col items-center gap-3 py-2">
              <CheckCircle2 className="size-7 text-success" />
              <h1 className="text-[17px] font-semibold tracking-tight">{t('acceptInvite.done')}</h1>
              <Button className="mt-2 w-full" onClick={() => router.replace('/dashboard')}>
                {t('acceptInvite.continue')}
              </Button>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 py-2">
              <TriangleAlert className="size-7 text-danger" />
              <h1 className="text-[17px] font-semibold tracking-tight">{t('acceptInvite.failed')}</h1>
              <p className="text-[13px] leading-relaxed text-muted">{message}</p>
              <Button
                variant="secondary"
                className="mt-2 w-full"
                onClick={() => router.push('/login')}
              >
                {t('acceptInvite.backToLogin')}
              </Button>
            </div>
          )}
        </Card>
      </div>
    </main>
  );
}

export default function AcceptInvitePage() {
  return (
    <React.Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center">
          <Spinner className="size-5 text-muted" />
        </main>
      }
    >
      <Accept />
    </React.Suspense>
  );
}
