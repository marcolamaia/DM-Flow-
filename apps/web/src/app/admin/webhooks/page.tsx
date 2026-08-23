'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, RefreshCw } from 'lucide-react';
import { get, post } from '@/lib/api';
import { useI18n, type MessageKey } from '@/lib/i18n';
import {
  Badge,
  Banner,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  ErrorState,
  Skeleton,
} from '@/components/ui/primitives';
import { ReasonDialog } from '@/components/admin/reason-dialog';
import type { AdminMe, ReconciliationReport, WebhookHealth, WebhookRow } from '@/lib/types';

type Filter = 'all' | 'failed' | 'pending' | 'processed';

const FILTERS: Array<{ value: Filter; label: MessageKey }> = [
  { value: 'all', label: 'admin.wh.filter.all' },
  { value: 'failed', label: 'admin.wh.filter.failed' },
  { value: 'pending', label: 'admin.wh.filter.pending' },
  { value: 'processed', label: 'admin.wh.filter.processed' },
];

export default function AdminWebhooksPage() {
  const { t, locale } = useI18n();
  const client = useQueryClient();
  const [filter, setFilter] = React.useState<Filter>('all');
  const [target, setTarget] = React.useState<WebhookRow | null>(null);
  const [outcome, setOutcome] = React.useState<{ succeeded: boolean; error: string | null } | null>(
    null,
  );

  const me = useQuery({ queryKey: ['admin', 'me'], queryFn: () => get<AdminMe>('/admin/me') });
  const health = useQuery({
    queryKey: ['admin', 'webhooks', 'health'],
    queryFn: () => get<WebhookHealth>('/admin/webhooks/health'),
  });
  const events = useQuery({
    queryKey: ['admin', 'webhooks', filter],
    queryFn: () =>
      get<WebhookRow[]>(`/admin/webhooks?limit=100${filter === 'all' ? '' : `&status=${filter}`}`),
  });
  const reconciliation = useQuery({
    queryKey: ['admin', 'reconciliation'],
    queryFn: () => get<ReconciliationReport>('/admin/reconciliation'),
  });

  const reprocess = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      post<{ succeeded: boolean; error: string | null }>(`/admin/webhooks/${id}/reprocess`, {
        reason,
      }),
    onSuccess: async (result) => {
      setTarget(null);
      // Reported either way: the operator asked whether it works now, and "it
      // still fails, here is why" is an answer.
      setOutcome(result);
      await client.invalidateQueries({ queryKey: ['admin', 'webhooks'] });
      await client.invalidateQueries({ queryKey: ['admin', 'reconciliation'] });
    },
  });

  const mayReprocess = me.data?.permissions.includes('admin.jobs.manage') ?? false;

  if (health.isError) {
    return <ErrorState message={(health.error as Error).message} onRetry={() => void health.refetch()} />;
  }

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold text-fg">{t('admin.wh.title')}</h1>

      {outcome ? (
        <Banner
          tone={outcome.succeeded ? 'success' : 'danger'}
          title={outcome.succeeded ? t('admin.wh.reprocessed') : t('admin.wh.reprocessFailed')}
        >
          {outcome.error ? <p className="text-sm">{outcome.error}</p> : null}
        </Banner>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{t('admin.wh.health')}</CardTitle>
        </CardHeader>
        <CardBody>
          {health.isLoading ? (
            <Skeleton className="h-16" />
          ) : health.data ? (
            <>
              {!health.data.configured ? (
                <Banner tone="warning" title={t('admin.wh.notConfigured')} />
              ) : null}

              <div className="mt-3 grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
                <Counter label={t('admin.wh.total')} value={health.data.total} />
                <Counter label={t('admin.wh.processed')} value={health.data.processed} />
                <Counter label={t('admin.wh.failed')} value={health.data.failed} danger={health.data.failed > 0} />
                <Counter label={t('admin.wh.pending')} value={health.data.pending} />
                <Counter
                  label={t('admin.wh.stuck')}
                  value={health.data.stuck}
                  danger={health.data.stuck > 0}
                  hint={health.data.stuck > 0 ? t('admin.wh.stuckHint') : undefined}
                />
              </div>

              <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted">
                <span>
                  {t('admin.wh.lastReceived')}:{' '}
                  {health.data.lastReceivedAt
                    ? new Date(health.data.lastReceivedAt).toLocaleString(locale)
                    : '—'}
                </span>
                <span>
                  {t('admin.wh.lastProcessed')}:{' '}
                  {health.data.lastProcessedAt
                    ? new Date(health.data.lastProcessedAt).toLocaleString(locale)
                    : '—'}
                </span>
              </div>
            </>
          ) : null}
        </CardBody>
      </Card>

      {/* ── Reconciliation ── */}
      <Card>
        <CardHeader className="flex items-center justify-between gap-3">
          <CardTitle>{t('admin.rec.title')}</CardTitle>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void reconciliation.refetch()}
            loading={reconciliation.isFetching}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            {t('admin.rec.recheck')}
          </Button>
        </CardHeader>
        <CardBody className="space-y-3">
          <p className="text-xs text-muted">{t('admin.rec.explain')}</p>

          {reconciliation.isLoading ? (
            <Skeleton className="h-16" />
          ) : reconciliation.data ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={reconciliation.data.stripeChecked ? 'success' : 'warning'}>
                  {reconciliation.data.stripeChecked
                    ? t('admin.rec.bothChecked')
                    : t('admin.rec.localOnly')}
                </Badge>
                <span className="text-xs text-muted">
                  {t('admin.rec.checkedAt')}{' '}
                  {new Date(reconciliation.data.checkedAt).toLocaleString(locale)}
                </span>
              </div>

              {/* Never let "nothing found" and "never looked" render the same. */}
              {reconciliation.data.stripeSkippedReason ? (
                <Banner tone="warning" title={t('admin.rec.stripeSkipped')}>
                  <p className="text-sm">{reconciliation.data.stripeSkippedReason}</p>
                </Banner>
              ) : null}

              {reconciliation.data.findings.length === 0 ? (
                <p className="flex items-center gap-2 text-sm text-success">
                  <CheckCircle2 className="h-4 w-4" />
                  {t('admin.rec.clean')}
                </p>
              ) : (
                <div className="space-y-3">
                  {reconciliation.data.findings.map((finding, index) => (
                    <div
                      key={`${finding.code}-${index}`}
                      className="rounded-lg border border-border p-3"
                    >
                      <div className="flex items-start gap-2">
                        <AlertTriangle
                          className={
                            finding.severity === 'error'
                              ? 'mt-0.5 h-4 w-4 shrink-0 text-danger'
                              : 'mt-0.5 h-4 w-4 shrink-0 text-warning'
                          }
                        />
                        <div className="min-w-0">
                          <p className="text-sm text-fg">{finding.detail}</p>
                          <p className="mt-1 text-xs text-muted">
                            <span className="font-medium">{t('admin.rec.suggestion')}:</span>{' '}
                            {finding.suggestion}
                          </p>
                          <p className="mt-1 font-mono text-[11px] text-subtle">{finding.code}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : null}
        </CardBody>
      </Card>

      {/* ── The events themselves ── */}
      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle>{t('admin.wh.list')}</CardTitle>
          <div className="flex gap-1 rounded-lg border border-border bg-bg p-1">
            {FILTERS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setFilter(option.value)}
                className={
                  option.value === filter
                    ? 'rounded-md bg-accent/10 px-3 py-1 text-xs font-medium text-accent'
                    : 'rounded-md px-3 py-1 text-xs text-muted hover:text-fg'
                }
              >
                {t(option.label)}
              </button>
            ))}
          </div>
        </CardHeader>
        <CardBody>
          {events.isLoading ? (
            <Skeleton className="h-16" />
          ) : (events.data ?? []).length === 0 ? (
            <EmptyState title={t('admin.wh.empty')} />
          ) : (
            <div className="space-y-2">
              {(events.data ?? []).map((row) => (
                <div
                  key={row.id}
                  className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-2 last:border-0 last:pb-0"
                >
                  <div className="min-w-0">
                    <p className="truncate font-mono text-xs text-fg">{row.type}</p>
                    {row.error ? (
                      <p className="truncate text-xs text-danger">{row.error}</p>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    <Badge tone={row.processedAt ? 'success' : row.error ? 'danger' : 'neutral'}>
                      {row.processedAt
                        ? t('admin.wh.filter.processed')
                        : row.error
                          ? t('admin.wh.filter.failed')
                          : t('admin.wh.filter.pending')}
                    </Badge>
                    <span className="text-xs text-muted">
                      {new Date(row.createdAt).toLocaleString(locale)}
                    </span>
                    {mayReprocess ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          setOutcome(null);
                          setTarget(row);
                        }}
                      >
                        {t('admin.wh.reprocess')}
                      </Button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>

      {target ? (
        <ReasonDialog
          title={t('admin.wh.reprocess.title')}
          explanation={t('admin.wh.reprocess.explain')}
          confirmLabel={t('admin.wh.reprocess.confirm')}
          tone="primary"
          pending={reprocess.isPending}
          error={reprocess.isError ? (reprocess.error as Error).message : null}
          onCancel={() => {
            reprocess.reset();
            setTarget(null);
          }}
          onConfirm={(reason) => reprocess.mutate({ id: target.id, reason })}
        >
          <p className="font-mono text-xs text-muted">{target.type}</p>
        </ReasonDialog>
      ) : null}
    </div>
  );
}

function Counter({
  label,
  value,
  danger,
  hint,
}: {
  label: string;
  value: number;
  danger?: boolean;
  hint?: string;
}) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted">{label}</p>
      <p className={danger ? 'text-xl font-semibold text-danger' : 'text-xl font-semibold text-fg'}>
        {value}
      </p>
      {hint ? <p className="mt-1 text-[11px] leading-snug text-muted">{hint}</p> : null}
    </div>
  );
}
