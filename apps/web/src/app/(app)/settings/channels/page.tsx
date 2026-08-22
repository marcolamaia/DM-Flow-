'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { Plug, RefreshCw } from 'lucide-react';
import { ApiError, del, get, post } from '@/lib/api';
import { useI18n, type MessageKey } from '@/lib/i18n';
import { useApp } from '@/components/providers/app-providers';
import { PageHeader } from '@/components/page-header';
import { Badge, Banner, Button, Card, CardBody, EmptyState, Skeleton } from '@/components/ui/primitives';
import { ConfirmDialog } from '@/components/ui/dialog';
import { toast } from '@/components/ui/toast';
import { relativeTime } from '@/lib/utils';
import type { ConnectedAccount } from '@/lib/types';

const STATUS_TONE: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = {
  CONNECTED: 'success',
  TOKEN_EXPIRING: 'warning',
  PENDING_APP_REVIEW: 'warning',
  RATE_LIMITED: 'warning',
  AUTHORIZATION_INCOMPLETE: 'warning',
  MISSING_PERMISSION: 'danger',
  TOKEN_INVALID: 'danger',
  WEBHOOK_UNHEALTHY: 'danger',
  PROVIDER_ERROR: 'danger',
  ACCOUNT_RESTRICTED: 'danger',
  DISCONNECTED: 'neutral',
};

export default function ChannelsPage() {
  const { t, locale } = useI18n();
  const { workspaceId } = useApp();
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();

  const [disconnecting, setDisconnecting] = React.useState<ConnectedAccount | null>(null);

  React.useEffect(() => {
    const connected = searchParams.get('connected');
    const error = searchParams.get('error');
    if (connected) toast.success(`@${connected}`);
    if (error) toast.error(error);
  }, [searchParams]);

  const accounts = useQuery({
    queryKey: ['channels', workspaceId],
    queryFn: () => get<ConnectedAccount[]>('/channels'),
    enabled: Boolean(workspaceId),
  });

  const connect = useMutation({
    mutationFn: () => post<{ authorizationUrl: string }>('/channels/connect', { channel: 'INSTAGRAM' }),
    onSuccess: (result) => {
      window.location.href = result.authorizationUrl;
    },
    onError: (error) => {
      if (error instanceof ApiError) toast.error(error.payload.userMessage);
    },
  });

  const check = useMutation({
    mutationFn: (id: string) => post(`/channels/${id}/health`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['channels'] }),
  });

  const disconnect = useMutation({
    mutationFn: (id: string) => del<{ automationsPaused: number }>(`/channels/${id}`),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['channels'] });
      setDisconnecting(null);
      toast.success(
        result.automationsPaused > 0
          ? locale === 'en'
            ? `${result.automationsPaused} automation(s) paused`
            : `${result.automationsPaused} automação(ões) pausada(s)`
          : t('channels.disconnect'),
      );
    },
  });

  return (
    <>
      <PageHeader
        title={t('channels.title')}
        subtitle={t('channels.subtitle')}
        actions={
          <Button size="sm" loading={connect.isPending} onClick={() => connect.mutate()}>
            <Plug />
            {t('channels.connect')}
          </Button>
        }
      />

      <div className="space-y-4 px-7 py-6">
        {accounts.data?.some((a) => a.isSandbox) ? (
          <Banner tone="warning" title={t('channels.sandbox')}>
            {t('channels.sandboxHint')}
          </Banner>
        ) : null}

        {accounts.isLoading ? (
          <Card className="p-4">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="mt-2 h-3 w-64" />
          </Card>
        ) : accounts.data?.length === 0 ? (
          <Card>
            <EmptyState
              icon={<Plug />}
              title={t('channels.empty')}
              hint={t('channels.emptyHint')}
              action={
                <Button size="sm" onClick={() => connect.mutate()} loading={connect.isPending}>
                  {t('channels.connect')}
                </Button>
              }
            />
          </Card>
        ) : (
          accounts.data?.map((account) => (
            <Card key={account.id}>
              <CardBody className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-[14px] font-medium">@{account.username}</p>
                    <Badge tone={STATUS_TONE[account.status] ?? 'neutral'}>
                      {t(`channels.status.${account.status}` as MessageKey)}
                    </Badge>
                    {account.isSandbox ? <Badge tone="warning">{t('channels.sandbox')}</Badge> : null}
                  </div>

                  {account.statusDetail ? (
                    <p className="mt-1 text-[12.5px] text-muted">{account.statusDetail}</p>
                  ) : null}

                  <div className="mt-2 space-y-0.5 text-[12px] text-subtle">
                    {account.tokenExpiresInDays !== null ? (
                      <p>
                        {t('channels.tokenExpires')} {account.tokenExpiresInDays} {t('channels.days')}
                      </p>
                    ) : null}
                    {account.lastHealthCheckAt ? (
                      <p>
                        {t('channels.checkHealth')}: {relativeTime(account.lastHealthCheckAt, locale)}
                      </p>
                    ) : null}
                    {account.grantedScopes.length > 0 ? (
                      <p className="font-mono">{account.grantedScopes.join(' ')}</p>
                    ) : null}
                  </div>
                </div>

                <div className="flex shrink-0 gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={check.isPending}
                    onClick={() => check.mutate(account.id)}
                  >
                    <RefreshCw />
                    {t('channels.checkHealth')}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setDisconnecting(account)}>
                    {t('channels.disconnect')}
                  </Button>
                </div>
              </CardBody>
            </Card>
          ))
        )}
      </div>

      <ConfirmDialog
        open={Boolean(disconnecting)}
        onOpenChange={(open) => !open && setDisconnecting(null)}
        title={t('channels.disconnect')}
        description={
          locale === 'en'
            ? 'Automations bound to this account will be paused. Stored tokens are destroyed.'
            : 'As automações ligadas a esta conta serão pausadas. Os tokens salvos são destruídos.'
        }
        confirmLabel={t('channels.disconnect')}
        cancelLabel={t('common.cancel')}
        requireTypedName={disconnecting?.username}
        loading={disconnect.isPending}
        onConfirm={() => disconnecting && disconnect.mutate(disconnecting.id)}
      />
    </>
  );
}
