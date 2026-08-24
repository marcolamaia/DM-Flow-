'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { AlertTriangle, Trash2 } from 'lucide-react';
import { api, get } from '@/lib/api';
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
  Skeleton,
} from '@/components/ui/primitives';

interface Blocker {
  code: 'ACCOUNT_DELETE_LAST_OWNER' | 'ACCOUNT_DELETE_ACTIVE_SUBSCRIPTION';
  workspaceId: string;
  workspaceName: string;
  otherMembers?: number;
  planName?: string;
}

interface WorkspaceOutcome {
  id: string;
  name: string;
  outcome: 'deleted' | 'left';
  contacts?: number;
  automations?: number;
  conversations?: number;
}

interface Preview {
  blockers: Blocker[];
  workspaces: WorkspaceOutcome[];
  sessions: number;
}

/**
 * Encerrar a conta.
 *
 * Três coisas separam isto de um botão vermelho qualquer:
 *
 * 1. A tela **lista o que vai ser destruído**, com números, antes de perguntar
 *    qualquer coisa. Confirmação sem informação não é consentimento.
 * 2. Quando existe impedimento, ela diz **qual** e **o que fazer** — em vez de
 *    desabilitar o botão e deixar a pessoa adivinhando.
 * 3. Exige a senha e digitar o próprio e-mail. Não é burocracia: é tempo de
 *    reflexão numa ação que não tem desfazer.
 */
export function DeleteAccountCard({
  currentEmail,
  errorOf,
}: {
  currentEmail: string;
  errorOf: (error: unknown) => string;
}) {
  const { t } = useI18n();
  const router = useRouter();

  const [open, setOpen] = React.useState(false);
  const [password, setPassword] = React.useState('');
  const [typedEmail, setTypedEmail] = React.useState('');

  const preview = useQuery({
    queryKey: ['account', 'deletion-preview'],
    queryFn: () => get<Preview>('/account/deletion-preview'),
  });

  const remove = useMutation({
    mutationFn: () => api('/account', { method: 'DELETE', body: { password } }),
    onSuccess: () => {
      // Sem tela de despedida dentro do aplicativo: a conta não existe mais, e
      // qualquer rota interna responderia 401 no instante seguinte.
      router.replace('/login?deleted=1');
    },
  });

  const blockers = preview.data?.blockers ?? [];
  const bloqueado = blockers.length > 0;
  const confere = typedEmail.trim().toLowerCase() === currentEmail.toLowerCase();

  return (
    <Card className="border-danger/30">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-danger">
          <Trash2 className="size-4" />
          {t('account.delete.title')}
        </CardTitle>
      </CardHeader>

      <CardBody className="space-y-4">
        <p className="text-[13px] text-muted">{t('account.delete.explain')}</p>

        {preview.isLoading ? (
          <div className="space-y-2">
            <Skeleton className="w-48" />
            <Skeleton className="w-64" />
          </div>
        ) : null}

        {/* ── Impedimentos ── */}
        {blockers.map((blocker) => (
          <Banner
            key={`${blocker.code}-${blocker.workspaceId}`}
            tone="danger"
            title={
              blocker.code === 'ACCOUNT_DELETE_LAST_OWNER'
                ? t('account.delete.blockedOwner')
                : t('account.delete.blockedBilling')
            }
          >
            {blocker.code === 'ACCOUNT_DELETE_LAST_OWNER' ? (
              <>
                <strong>{blocker.workspaceName}</strong> {t('account.delete.blockedOwnerBody')}{' '}
                {blocker.otherMembers} {t('account.delete.blockedOwnerPeople')}
                <span className="mt-1 block">{t('account.delete.blockedOwnerFix')}</span>
              </>
            ) : (
              <>
                <strong>{blocker.workspaceName}</strong> {t('account.delete.blockedBillingBody')}{' '}
                <strong>{blocker.planName}</strong>.
                <span className="mt-1 block">{t('account.delete.blockedBillingFix')}</span>
              </>
            )}
          </Banner>
        ))}

        {/* ── O que se perde ── */}
        {!preview.isLoading && !bloqueado ? (
          <div className="rounded-lg border border-border bg-surface p-3">
            <p className="flex items-center gap-1.5 text-[13px] font-medium text-fg">
              <AlertTriangle className="size-3.5 text-danger" />
              {t('account.delete.whatGoes')}
            </p>

            <ul className="mt-2 space-y-1.5 text-[13px] text-muted">
              {preview.data?.workspaces.map((ws) => (
                <li key={ws.id}>
                  {ws.outcome === 'deleted' ? (
                    <>
                      <span className="text-danger">●</span>{' '}
                      <strong className="text-fg">{ws.name}</strong>{' '}
                      {t('account.delete.wsDeleted')} — {ws.contacts} {t('account.delete.contacts')},{' '}
                      {ws.automations} {t('account.delete.automations')}, {ws.conversations}{' '}
                      {t('account.delete.conversations')}
                    </>
                  ) : (
                    <>
                      <span className="text-muted">○</span>{' '}
                      <strong className="text-fg">{ws.name}</strong> {t('account.delete.wsLeft')}
                    </>
                  )}
                </li>
              ))}
              <li>
                <span className="text-danger">●</span> {preview.data?.sessions}{' '}
                {t('account.delete.sessions')}
              </li>
            </ul>

            <p className="mt-3 text-[13px] font-medium text-danger">
              {t('account.delete.noUndo')}
            </p>
          </div>
        ) : null}

        {/* ── Confirmação ── */}
        {!bloqueado && !preview.isLoading ? (
          !open ? (
            <Button variant="danger" onClick={() => setOpen(true)}>
              {t('account.delete.start')}
            </Button>
          ) : (
            <form
              className="space-y-3 rounded-lg border border-danger/30 bg-danger/5 p-3"
              onSubmit={(event) => {
                event.preventDefault();
                remove.mutate();
              }}
            >
              <Field label={t('account.delete.typeEmail')} hint={currentEmail}>
                <Input
                  value={typedEmail}
                  autoComplete="off"
                  onChange={(event) => setTypedEmail(event.target.value)}
                />
              </Field>

              <Field label={t('account.delete.password')}>
                <Input
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </Field>

              {remove.isError ? (
                <p className="text-[13px] text-danger">{errorOf(remove.error)}</p>
              ) : null}

              <div className="flex gap-2">
                <Button
                  type="submit"
                  variant="danger"
                  loading={remove.isPending}
                  disabled={!confere || password.length === 0}
                >
                  {t('account.delete.confirm')}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setOpen(false);
                    setTypedEmail('');
                    setPassword('');
                  }}
                >
                  {t('common.cancel')}
                </Button>
              </div>
            </form>
          )
        ) : null}
      </CardBody>
    </Card>
  );
}
