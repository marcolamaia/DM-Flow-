'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { get } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useDaysAgo } from '@/lib/use-days-ago';
import { Card, CardBody, CardHeader, CardTitle, ErrorState, Skeleton } from '@/components/ui/primitives';
import { Metric, Money, Rate } from '@/components/admin/money';
import type { AdminOverview, MetricDefinition } from '@/lib/types';

const RANGES = [7, 30, 90] as const;

/**
 * The first screen.
 *
 * Small on purpose. Recurring revenue, what moved, and the counts behind both —
 * enough to know whether the platform is healthy, without the twenty numbers
 * that teach nobody which three matter.
 */
export default function AdminOverviewPage() {
  const { t, locale } = useI18n();
  const [days, setDays] = React.useState<(typeof RANGES)[number]>(30);

  const from = useDaysAgo(days);

  const overview = useQuery({
    queryKey: ['admin', 'overview', from],
    queryFn: () => get<AdminOverview>(`/admin/overview?from=${from}`),
    // Sem data ainda não há período: consultar sem ela devolveria números de
    // um intervalo que ninguém pediu.
    enabled: from !== null,
  });

  const byId = React.useMemo(() => {
    const map = new Map<string, MetricDefinition>();
    for (const definition of overview.data?.definitions ?? []) map.set(definition.id, definition);
    return map;
  }, [overview.data]);

  if (overview.isError) {
    return (
      <ErrorState
        message={(overview.error as Error).message}
        onRetry={() => void overview.refetch()}
      />
    );
  }

  if (overview.isLoading || !overview.data) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, index) => (
          <Card key={index}>
            <CardBody className="space-y-3">
              <Skeleton className="w-24" />
              <Skeleton className="h-7 w-32" />
            </CardBody>
          </Card>
        ))}
      </div>
    );
  }

  const { revenue, growth } = overview.data;
  const timeZone = growth.period.timeZone;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-fg">{t('admin.overview.title')}</h1>
          {/* Stated next to the numbers, not buried in a settings screen: two
              people comparing figures need to know they are comparing the same
              days. */}
          <p className="text-xs text-muted">
            {t('admin.overview.timezone')}: {timeZone}
          </p>
        </div>

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

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Metric definition={byId.get('mrr')}>
          <Money amounts={revenue.mrr} />
        </Metric>
        <Metric definition={byId.get('arr')}>
          <Money amounts={revenue.arr} />
        </Metric>
        <Metric definition={byId.get('mrr_at_risk')}>
          <Money amounts={revenue.atRisk} />
        </Metric>
        <Metric definition={byId.get('arpa')}>
          <Money amounts={revenue.arpa} />
        </Metric>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Metric definition={byId.get('active_subscriptions')}>{revenue.activeSubscriptions}</Metric>
        <Metric definition={byId.get('trialing_subscriptions')}>
          {revenue.trialingSubscriptions}
        </Metric>
        <Metric definition={byId.get('signups')}>{growth.signups}</Metric>
        <Metric definition={byId.get('activated_workspaces')}>{growth.activatedWorkspaces}</Metric>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Metric definition={byId.get('new_subscriptions')}>{growth.newSubscriptions}</Metric>
        <Metric definition={byId.get('churned_subscriptions')}>{growth.churnedSubscriptions}</Metric>
        <Metric definition={byId.get('logo_churn')}>
          <Rate rate={growth.logoChurn} />
        </Metric>
        <Metric definition={byId.get('revenue_churn')}>
          <Rate rate={growth.revenueChurn} />
        </Metric>
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <Metric definition={byId.get('net_revenue')}>
          <Money amounts={growth.netRevenue} />
        </Metric>
        <Metric
          definition={byId.get('ltv')}
          // Empty is the honest state on a young platform, and saying why beats
          // a dash the reader has to interpret.
          footnote={Object.keys(growth.ltv).length === 0 ? t('admin.overview.notEnoughData') : undefined}
        >
          <Money amounts={growth.ltv} />
        </Metric>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>{t('admin.overview.howCalculated')}</CardTitle>
        </CardHeader>
        <CardBody className="space-y-3">
          {overview.data.definitions.map((definition) => (
            <div key={definition.id} className="text-sm">
              <p className="font-medium text-fg">
                {definition.label[locale === 'en' ? 'en' : 'pt-BR']}
              </p>
              <p className="text-muted">{definition.formula[locale === 'en' ? 'en' : 'pt-BR']}</p>
              {definition.excludes ? (
                <p className="text-xs text-muted">
                  {definition.excludes[locale === 'en' ? 'en' : 'pt-BR']}
                </p>
              ) : null}
            </div>
          ))}
        </CardBody>
      </Card>
    </div>
  );
}
