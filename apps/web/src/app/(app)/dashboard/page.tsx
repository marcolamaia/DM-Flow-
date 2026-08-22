'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { ArrowUpRight, Plug, Workflow } from 'lucide-react';
import { get } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useApp } from '@/components/providers/app-providers';
import { PageHeader } from '@/components/page-header';
import { Button, Card, CardBody, EmptyState, Skeleton, Badge } from '@/components/ui/primitives';
import { formatNumber, formatPercent } from '@/lib/utils';
import type { ConnectedAccount } from '@/lib/types';

interface Overview {
  executions: {
    started: number;
    completed: number;
    failed: number;
    running: number;
    completionRate: number | null;
  };
  messages: { sent: number; failed: number; received: number; deliveryRate: number | null };
  contacts: { new: number };
  conversations: { new: number };
}

interface Responsiveness {
  outbound: number;
  replied: number;
  responseRate: number | null;
  medianReplySeconds: number | null;
}

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <Card>
      <CardBody>
        <p className="text-[12px] font-medium text-muted">{label}</p>
        <p className="mt-1.5 text-[26px] font-semibold leading-none tracking-tight tabular-nums">
          {value}
        </p>
        {sub ? <p className="mt-1.5 text-[12px] text-subtle">{sub}</p> : null}
      </CardBody>
    </Card>
  );
}

export default function DashboardPage() {
  const { t, locale } = useI18n();
  const { workspaceId } = useApp();

  const overview = useQuery({
    queryKey: ['overview', workspaceId],
    queryFn: () => get<Overview>('/analytics/overview'),
    enabled: Boolean(workspaceId),
  });

  const responsiveness = useQuery({
    queryKey: ['responsiveness', workspaceId],
    queryFn: () => get<Responsiveness>('/analytics/responsiveness'),
    enabled: Boolean(workspaceId),
  });

  const channels = useQuery({
    queryKey: ['channels', workspaceId],
    queryFn: () => get<ConnectedAccount[]>('/channels'),
    enabled: Boolean(workspaceId),
  });

  const hasNoData =
    overview.data && overview.data.executions.started === 0 && overview.data.messages.sent === 0;

  return (
    <>
      <PageHeader title={t('dash.title')} subtitle={t('dash.subtitle')} />

      <div className="px-7 py-6">
        {channels.data && channels.data.length === 0 ? (
          <Card className="mb-6 border-accent/30 bg-accent/[0.04]">
            <CardBody className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium">{t('channels.empty')}</p>
                <p className="mt-0.5 text-[13px] text-muted">{t('channels.emptyHint')}</p>
              </div>
              <Button asChild size="sm">
                <Link href="/settings/channels">
                  <Plug />
                  {t('channels.connect')}
                </Link>
              </Button>
            </CardBody>
          </Card>
        ) : null}

        {overview.isLoading ? (
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Card key={i}>
                <CardBody>
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="mt-3 h-7 w-16" />
                </CardBody>
              </Card>
            ))}
          </div>
        ) : hasNoData ? (
          <Card>
            <EmptyState
              icon={<Workflow />}
              title={t('dash.empty')}
              action={
                <Button asChild size="sm">
                  <Link href="/automations">
                    {t('automations.new')}
                    <ArrowUpRight />
                  </Link>
                </Button>
              }
            />
          </Card>
        ) : overview.data ? (
          <>
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <Stat
                label={t('dash.executions')}
                value={formatNumber(overview.data.executions.started, locale)}
                sub={`${formatNumber(overview.data.executions.completed, locale)} ${t('dash.completed').toLowerCase()}`}
              />
              <Stat
                label={t('dash.completionRate')}
                value={formatPercent(overview.data.executions.completionRate, locale)}
                sub={
                  overview.data.executions.failed > 0
                    ? `${formatNumber(overview.data.executions.failed, locale)} falhas`
                    : undefined
                }
              />
              <Stat
                label={t('dash.messagesSent')}
                value={formatNumber(overview.data.messages.sent, locale)}
                sub={
                  overview.data.messages.failed > 0
                    ? `${formatNumber(overview.data.messages.failed, locale)} falharam`
                    : undefined
                }
              />
              <Stat
                label={t('dash.messagesReceived')}
                value={formatNumber(overview.data.messages.received, locale)}
              />
              <Stat
                label={t('dash.newContacts')}
                value={formatNumber(overview.data.contacts.new, locale)}
              />
              <Stat
                label={t('dash.responseRate')}
                value={formatPercent(responsiveness.data?.responseRate ?? null, locale)}
                sub={
                  responsiveness.data?.medianReplySeconds != null
                    ? `mediana ${Math.round(responsiveness.data.medianReplySeconds / 60)}min`
                    : undefined
                }
              />
              <Stat
                label="Execuções ativas"
                value={formatNumber(overview.data.executions.running, locale)}
              />
              <Stat
                label="Conversas novas"
                value={formatNumber(overview.data.conversations.new, locale)}
              />
            </div>

            {channels.data && channels.data.length > 0 ? (
              <Card className="mt-6">
                <CardBody>
                  <p className="mb-3 text-[12px] font-medium text-muted">{t('channels.title')}</p>
                  <div className="space-y-2">
                    {channels.data.map((account) => (
                      <div
                        key={account.id}
                        className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5"
                      >
                        <div className="flex items-center gap-2.5">
                          <span className="text-[13px] font-medium">@{account.username}</span>
                          {account.isSandbox ? (
                            <Badge tone="warning">{t('channels.sandbox')}</Badge>
                          ) : null}
                        </div>
                        <Badge tone={account.status === 'CONNECTED' ? 'success' : 'danger'}>
                          {t(`channels.status.${account.status}` as never)}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </CardBody>
              </Card>
            ) : null}
          </>
        ) : null}
      </div>
    </>
  );
}
