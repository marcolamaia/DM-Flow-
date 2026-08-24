'use client';

import * as React from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { AtSign, TriangleAlert } from 'lucide-react';
import { ApiError, post } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { Button, Card, Spinner } from '@/components/ui/primitives';

type State = 'working' | 'done' | 'failed';

/**
 * O link enviado ao endereço NOVO cai aqui.
 *
 * É este clique que efetiva a troca — e é ele, e só ele, que prova que quem
 * pediu tem acesso à caixa nova. Por isso a página é pública: a mensagem é
 * quase sempre aberta no celular, sem sessão, e exigir login antes não
 * aumentaria a segurança em nada.
 *
 * Confirmar derruba todas as sessões, inclusive a de quem estiver conectado
 * noutro aparelho. A tela avisa isso em vez de mandar a pessoa para o painel e
 * deixá-la descobrir sozinha que caiu para fora.
 */
function Confirm() {
  const { t } = useI18n();
  const params = useSearchParams();
  const token = params.get('token');

  const [state, setState] = React.useState<State>('working');
  const [email, setEmail] = React.useState('');
  const [message, setMessage] = React.useState('');
  const attempted = React.useRef(false);

  React.useEffect(() => {
    // Em desenvolvimento o React roda o efeito duas vezes, e a segunda gastaria
    // um token que a primeira já consumiu — reportando falha numa troca que deu
    // certo.
    if (attempted.current) return;
    attempted.current = true;

    if (!token) {
      setState('failed');
      setMessage(t('confirmEmailChange.missingToken'));
      return;
    }

    post<{ email: string }>('/account/email/confirm', { token })
      .then((result) => {
        setEmail(result.email);
        setState('done');
      })
      .catch((error: unknown) => {
        setState('failed');
        setMessage(
          error instanceof ApiError ? error.payload.userMessage : t('confirmEmailChange.failed'),
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
              <p className="text-[13px] text-muted">{t('confirmEmailChange.working')}</p>
            </div>
          ) : state === 'done' ? (
            <div className="flex flex-col items-center gap-3 py-2">
              <AtSign className="size-7 text-success" />
              <h1 className="text-[17px] font-semibold tracking-tight">
                {t('confirmEmailChange.done')}
              </h1>
              <p className="text-[13px] leading-relaxed text-muted">
                {t('confirmEmailChange.doneHint')}
              </p>
              <p className="rounded-lg border border-border bg-surface px-3 py-2 text-[14px] font-medium text-fg">
                {email}
              </p>
              <p className="mt-1 text-[12px] leading-relaxed text-subtle">
                {t('confirmEmailChange.signedOut')}
              </p>
              <Link href="/login" className="mt-2 w-full">
                <Button className="w-full">{t('confirmEmailChange.signIn')}</Button>
              </Link>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 py-2">
              <TriangleAlert className="size-7 text-danger" />
              <h1 className="text-[17px] font-semibold tracking-tight">
                {t('confirmEmailChange.failed')}
              </h1>
              <p className="text-[13px] leading-relaxed text-muted">{message}</p>
              <p className="mt-1 text-[12px] leading-relaxed text-subtle">
                {t('confirmEmailChange.failedHint')}
              </p>
              <Link href="/login" className="mt-2 w-full">
                <Button variant="secondary" className="w-full">
                  {t('confirmEmailChange.backToLogin')}
                </Button>
              </Link>
            </div>
          )}
        </Card>
      </div>
    </main>
  );
}

export default function ConfirmEmailChangePage() {
  return (
    <React.Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center">
          <Spinner className="size-5 text-muted" />
        </main>
      }
    >
      <Confirm />
    </React.Suspense>
  );
}
