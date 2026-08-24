'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AtSign, Clock } from 'lucide-react';
import { get, post } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import {
  Banner,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Field,
  Input,
} from '@/components/ui/primitives';

interface Pending {
  maskedNewEmail: string;
  expiresAt: string;
}

/**
 * Trocar o e-mail da conta.
 *
 * A tela existe para deixar visível a coisa que mais confunde nesse fluxo: o
 * endereço NÃO muda quando você clica em salvar. Um cliente que não entende
 * isso troca o e-mail, sai, tenta entrar com o novo e acha que a plataforma
 * quebrou.
 */
export function EmailCard({
  currentEmail,
  errorOf,
}: {
  currentEmail: string;
  errorOf: (error: unknown) => string;
}) {
  const { t } = useI18n();
  const queryClient = useQueryClient();

  const [newEmail, setNewEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [sentTo, setSentTo] = React.useState<string | null>(null);

  const pending = useQuery({
    queryKey: ['account', 'email', 'pending'],
    queryFn: () => get<{ pending: Pending | null }>('/account/email/pending'),
  });

  const request = useMutation({
    mutationFn: () => post<{ maskedNewEmail: string }>('/account/email', { newEmail, password }),
    onSuccess: (result) => {
      setSentTo(result.maskedNewEmail);
      setNewEmail('');
      setPassword('');
      void queryClient.invalidateQueries({ queryKey: ['account', 'email', 'pending'] });
    },
  });

  const cancel = useMutation({
    mutationFn: () => post('/account/email/cancel'),
    onSuccess: () => {
      setSentTo(null);
      void queryClient.invalidateQueries({ queryKey: ['account', 'email', 'pending'] });
    },
  });

  const aberto = pending.data?.pending ?? null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <AtSign className="size-4" />
          {t('account.email.title')}
        </CardTitle>
      </CardHeader>

      <CardBody className="space-y-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-subtle">
            {t('account.email.current')}
          </p>
          <p className="mt-1 text-[15px] text-fg">{currentEmail}</p>
        </div>

        {sentTo ? (
          <Banner tone="success" title={t('account.email.sent')}>
            {t('account.email.sentBody')} <strong>{sentTo}</strong>
          </Banner>
        ) : null}

        {/* Um pedido em aberto precisa aparecer mesmo depois de recarregar a
            página: é a única pista de que existe um link solto por aí. */}
        {aberto && !sentTo ? (
          <Banner tone="warning" title={t('account.email.pending')}>
            <span className="flex flex-wrap items-center gap-1.5">
              <Clock className="size-3.5" />
              {t('account.email.pendingBody')} <strong>{aberto.maskedNewEmail}</strong>
            </span>
          </Banner>
        ) : null}

        {aberto ? (
          <Button
            variant="secondary"
            size="sm"
            loading={cancel.isPending}
            onClick={() => cancel.mutate()}
          >
            {t('account.email.cancel')}
          </Button>
        ) : null}

        <p className="text-[13px] text-muted">{t('account.email.explain')}</p>

        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            request.mutate();
          }}
        >
          <Field label={t('account.email.new')}>
            <Input
              type="email"
              autoComplete="email"
              value={newEmail}
              onChange={(event) => setNewEmail(event.target.value)}
            />
          </Field>

          <Field label={t('account.email.password')} hint={t('account.email.passwordHint')}>
            <Input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </Field>

          {request.isError ? (
            <p className="text-[13px] text-danger">{errorOf(request.error)}</p>
          ) : null}

          <Button
            type="submit"
            loading={request.isPending}
            disabled={newEmail.trim().length < 3 || password.length === 0}
          >
            {t('account.email.submit')}
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}
