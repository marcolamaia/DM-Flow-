'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { get } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useDaysAgo } from '@/lib/use-days-ago';
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  ErrorState,
  Skeleton,
} from '@/components/ui/primitives';
import { Money } from '@/components/admin/money';
import type { Cashflow, CollectionProblem, PlanBreakdownRow } from '@/lib/types';

const RANGES = [7, 30, 90] as const;

export default function AdminFinancePage() {
  const { t, locale } = useI18n();
  const [days, setDays] = React.useState<(typeof RANGES)[number]>(30);
  const from = useDaysAgo(days);

  const byPlan = useQuery({
    queryKey: ['admin', 'finance', 'by-plan'],
    queryFn: () => get<PlanBreakdownRow[]>('/admin/finance/by-plan'),
  });
  const cashflow = useQuery({
    queryKey: ['admin', 'finance', 'cashflow', from],
    queryFn: () => get<Cashflow>(`/admin/finance/cashflow?from=${from}`),
    // Ver o comentário em useDaysAgo: até a data existir, não há o que consultar.
    enabled: from !== null,
  });
  const problems = useQuery({
    queryKey: ['admin', 'finance', 'problems'],
    queryFn: () => get<CollectionProblem[]>('/admin/finance/collection-problems'),
  });

  const money = (cents: number, currency: string) =>
    new Intl.NumberFormat(locale, { style: 'currency', currency }).format(cents / 100);

  if (byPlan.isError) {
    return <ErrorState message={(byPlan.error as Error).message} onRetry={() => void byPlan.refetch()} />;
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-fg">{t('admin.fin.title')}</h1>
        <div className="flex gap-1 rounded-lg border border-border bg-surface p-1">
          {RANGES.map((range) => (
            <button
              key={range}
              type="button"
              onClick={() => setDays(range)}
              className={
                range === days
                  ? 'rounded-md bg-accent/10 px-3 py-1 text-xs font-medium text-accent'
                  : 'rounded-md px-3 py-1 text-xs text-muted hover:text-fg'
              }
            >
              {range} {locale === 'en' ? 'days' : 'dias'}
            </button>
          ))}
        </div>
      </header>

      {/* ── Cash in and out ── */}
      <Card>
        <CardHeader>
          <CardTitle>{t('admin.fin.cashflow')}</CardTitle>
        </CardHeader>
        <CardBody>
          {cashflow.isLoading ? (
            <Skeleton className="h-16" />
          ) : cashflow.data ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              <Figure label={t('admin.fin.received')} amounts={cashflow.data.received} />
              <Figure label={t('admin.fin.refunded')} amounts={cashflow.data.refunded} />
              <Figure label={t('admin.fin.chargedBack')} amounts={cashflow.data.chargedBack} />
              <Figure
                label={t('admin.fin.failedCharges')}
                amounts={cashflow.data.failed}
                // Said next to the number so nobody reads it as revenue that is
                // merely late.
                hint={t('admin.fin.failedHint')}
              />
              <Figure label={t('admin.fin.net')} amounts={cashflow.data.net} strong />
            </div>
          ) : null}
        </CardBody>
      </Card>

      {/* ── Recurring revenue, per plan ── */}
      <Card>
        <CardHeader>
          <CardTitle>{t('admin.fin.byPlan')}</CardTitle>
        </CardHeader>
        <CardBody>
          {byPlan.isLoading ? (
            <Skeleton className="h-20" />
          ) : (byPlan.data ?? []).length === 0 ? (
            <p className="text-sm text-muted">{t('admin.fin.noPaidPlans')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                    <th className="pb-2 pr-4 font-medium">{t('admin.subs.plan')}</th>
                    <th className="pb-2 pr-4 font-medium">{t('admin.fin.unitPrice')}</th>
                    <th className="pb-2 pr-4 font-medium">{t('admin.fin.activeCount')}</th>
                    <th className="pb-2 pr-4 font-medium">{t('admin.fin.atRiskCount')}</th>
                    <th className="pb-2 font-medium">{t('admin.fin.planTotal')}</th>
                  </tr>
                </thead>
                <tbody>
                  {(byPlan.data ?? []).map((row) => (
                    <tr key={row.code} className="border-b border-border last:border-0">
                      <td className="py-2 pr-4 text-fg">{row.name}</td>
                      <td className="py-2 pr-4 text-muted">{money(row.unitCents, row.currency)}</td>
                      <td className="py-2 pr-4 text-fg">{row.activeCount}</td>
                      <td className="py-2 pr-4">
                        {row.atRiskCount > 0 ? (
                          <Badge tone="warning">{row.atRiskCount}</Badge>
                        ) : (
                          <span className="text-muted">0</span>
                        )}
                      </td>
                      <td className="py-2 font-medium text-fg">
                        {money(row.mrrCents, row.currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

      {/* ── Who is not paying ── */}
      <Card>
        <CardHeader>
          <CardTitle>{t('admin.fin.problems')}</CardTitle>
        </CardHeader>
        <CardBody>
          {problems.isLoading ? (
            <Skeleton className="h-16" />
          ) : (problems.data ?? []).length === 0 ? (
            <EmptyState title={t('admin.fin.problemsEmpty')} />
          ) : (
            <div className="space-y-3">
              {(problems.data ?? []).map((row) => (
                <div
                  key={row.workspaceId}
                  className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3 last:border-0 last:pb-0"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-fg">{row.workspaceName}</p>
                    <p className="truncate text-xs text-muted">
                      {row.ownerEmail ?? row.workspaceId}
                    </p>
                    {row.lastPaymentError ? (
                      <p className="mt-0.5 text-xs text-danger">
                        {t('admin.fin.lastError')}: {row.lastPaymentError}
                      </p>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap items-center gap-3 text-xs">
                    <Badge tone="danger">{row.status}</Badge>
                    <span className="text-fg">{money(row.monthlyCents, row.currency)}</span>
                    {row.pastDueSince ? (
                      <span className="text-muted">
                        {t('admin.fin.pastDueSince')}{' '}
                        {new Date(row.pastDueSince).toLocaleDateString(locale)}
                      </span>
                    ) : null}
                    {/* The number an operator acts on: how long is left. */}
                    <span
                      className={
                        (row.graceDaysRemaining ?? 99) <= 2
                          ? 'flex items-center gap-1 font-medium text-danger'
                          : 'text-muted'
                      }
                    >
                      {(row.graceDaysRemaining ?? 99) <= 2 ? (
                        <AlertTriangle className="h-3.5 w-3.5" />
                      ) : null}
                      {t('admin.fin.graceRemaining')}: {row.graceDaysRemaining ?? '—'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

function Figure({
  label,
  amounts,
  hint,
  strong,
}: {
  label: string;
  amounts: Record<string, number>;
  hint?: string;
  strong?: boolean;
}) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted">{label}</p>
      <div className={strong ? 'text-xl font-semibold text-fg' : 'text-lg text-fg'}>
        <Money amounts={amounts} />
      </div>
      {hint ? <p className="mt-1 text-[11px] leading-snug text-muted">{hint}</p> : null}
    </div>
  );
}
