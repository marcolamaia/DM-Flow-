'use client';

import { useQuery } from '@tanstack/react-query';
import { get } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useApp } from '@/components/providers/app-providers';
import { PageHeader } from '@/components/page-header';
import { Card, CardBody, CardHeader, CardTitle, EmptyState, Skeleton } from '@/components/ui/primitives';
import { formatDuration, formatNumber, formatPercent } from '@/lib/utils';

interface AutomationStat {
  automationId: string;
  name: string;
  started: number;
  completed: number;
  failed: number;
  completionRate: number | null;
  medianDurationMs: number | null;
}

export default function AnalyticsPage() {
  const { t, locale } = useI18n();
  const { workspaceId } = useApp();

  const automations = useQuery({
    queryKey: ['analytics-automations', workspaceId],
    queryFn: () => get<AutomationStat[]>('/analytics/automations'),
    enabled: Boolean(workspaceId),
  });

  const failures = useQuery({
    queryKey: ['analytics-failures', workspaceId],
    queryFn: () => get<Array<{ errorCode: string; nodeType: string; count: number }>>('/analytics/failures'),
    enabled: Boolean(workspaceId),
  });

  const triggers = useQuery({
    queryKey: ['analytics-triggers', workspaceId],
    queryFn: () => get<Array<{ type: string; started: number; completed: number }>>('/analytics/triggers'),
    enabled: Boolean(workspaceId),
  });

  return (
    <>
      <PageHeader title={t('analytics.title')} subtitle={t('analytics.subtitle')} />

      <div className="space-y-5 px-7 py-6">
        <Card>
          <CardHeader>
            <CardTitle>{t('analytics.byAutomation')}</CardTitle>
          </CardHeader>
          {automations.isLoading ? (
            <CardBody>
              <Skeleton className="h-4 w-full" />
              <Skeleton className="mt-2 h-4 w-full" />
            </CardBody>
          ) : automations.data?.length === 0 ? (
            <EmptyState title={t('automations.empty')} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[13px]">
                <thead className="border-b border-border text-[11.5px] uppercase tracking-wider text-subtle">
                  <tr>
                    <th className="px-5 py-2.5 font-medium">{t('automations.title')}</th>
                    <th className="px-5 py-2.5 text-right font-medium">{t('dash.executions')}</th>
                    <th className="px-5 py-2.5 text-right font-medium">{t('dash.completed')}</th>
                    <th className="px-5 py-2.5 text-right font-medium">{t('dash.completionRate')}</th>
                    <th className="px-5 py-2.5 text-right font-medium">Mediana</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {automations.data?.map((row) => (
                    <tr key={row.automationId}>
                      <td className="px-5 py-2.5 font-medium">{row.name}</td>
                      <td className="px-5 py-2.5 text-right tabular-nums">
                        {formatNumber(row.started, locale)}
                      </td>
                      <td className="px-5 py-2.5 text-right tabular-nums">
                        {formatNumber(row.completed, locale)}
                      </td>
                      <td className="px-5 py-2.5 text-right tabular-nums">
                        {formatPercent(row.completionRate, locale)}
                      </td>
                      <td className="px-5 py-2.5 text-right tabular-nums text-muted">
                        {formatDuration(row.medianDurationMs)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <div className="grid gap-5 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>{t('analytics.failures')}</CardTitle>
            </CardHeader>
            {failures.data?.length === 0 ? (
              <EmptyState title={t('analytics.noFailures')} />
            ) : (
              <CardBody className="space-y-2">
                {failures.data?.map((row) => (
                  <div
                    key={`${row.errorCode}-${row.nodeType}`}
                    className="flex items-center justify-between rounded-lg border border-border px-3 py-2"
                  >
                    <div>
                      <p className="font-mono text-[12px]">{row.errorCode}</p>
                      <p className="text-[11px] text-subtle">{row.nodeType}</p>
                    </div>
                    <span className="text-[13px] font-medium tabular-nums">{row.count}</span>
                  </div>
                ))}
              </CardBody>
            )}
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('analytics.triggers')}</CardTitle>
            </CardHeader>
            <CardBody className="space-y-2">
              {triggers.data?.map((row) => (
                <div
                  key={row.type}
                  className="flex items-center justify-between rounded-lg border border-border px-3 py-2"
                >
                  <span className="font-mono text-[12px]">{row.type}</span>
                  <span className="text-[13px] tabular-nums">
                    {formatNumber(row.started, locale)}
                  </span>
                </div>
              ))}
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
