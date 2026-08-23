'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, get, post } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useApp } from '@/components/providers/app-providers';
import { PageHeader } from '@/components/page-header';
import { Badge, Banner, Button, Card, CardBody, CardHeader, CardTitle, Skeleton } from '@/components/ui/primitives';
import { toast } from '@/components/ui/toast';
import { formatMoney, formatNumber } from '@/lib/utils';
import type { Plan, UsageSnapshot } from '@/lib/types';

interface Subscription {
  status: string;
  plan: { code: string; name: string; priceCents: number; currency: string; features: string[] };
  currentPeriodEnd: string | null;
  lastPaymentError: string | null;
  graceDaysRemaining: number | null;
  workspaceStatus: string;
  billingConfigured: boolean;
}

function UsageBar({ label, used, limit }: { label: string; used: number; limit: number | null }) {
  const { t, locale } = useI18n();
  const pct = limit === null ? 0 : Math.min(100, (used / limit) * 100);
  const near = limit !== null && pct >= 80;

  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between text-[12.5px]">
        <span className="text-muted">{label}</span>
        <span className="tabular-nums">
          {formatNumber(used, locale)}{' '}
          <span className="text-subtle">
            / {limit === null ? t('billing.unlimited') : formatNumber(limit, locale)}
          </span>
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-elevated">
        <div
          className={near ? 'h-full rounded-full bg-warning' : 'h-full rounded-full bg-accent'}
          style={{ width: `${limit === null ? 4 : pct}%` }}
        />
      </div>
    </div>
  );
}

export default function BillingPage() {
  const { t, locale } = useI18n();
  const { workspaceId } = useApp();
  const queryClient = useQueryClient();

  const subscription = useQuery({
    queryKey: ['subscription', workspaceId],
    queryFn: () => get<Subscription | null>('/billing/subscription'),
    enabled: Boolean(workspaceId),
  });

  const usage = useQuery({
    queryKey: ['usage', workspaceId],
    queryFn: () => get<UsageSnapshot>('/billing/usage'),
    enabled: Boolean(workspaceId),
  });

  const plans = useQuery({ queryKey: ['plans'], queryFn: () => get<Plan[]>('/billing/plans') });

  const checkout = useMutation({
    mutationFn: (planCode: string) =>
      post<{ mode: string; url?: string; notice?: { 'pt-BR': string; en: string } }>(
        '/billing/checkout',
        { planCode },
      ),
    onSuccess: (result) => {
      if (result.mode === 'checkout' && result.url) {
        window.location.href = result.url;
        return;
      }
      queryClient.invalidateQueries({ queryKey: ['subscription'] });
      queryClient.invalidateQueries({ queryKey: ['usage'] });
      queryClient.invalidateQueries({ queryKey: ['me'] });
      toast.success(result.notice ? result.notice[locale] : t('billing.currentPlan'));
    },
    onError: (error) => {
      if (error instanceof ApiError) toast.error(error.payload.userMessage);
    },
  });

  const portal = useMutation({
    mutationFn: () => post<{ url: string }>('/billing/portal'),
    onSuccess: (result) => {
      window.location.href = result.url;
    },
    onError: (error) => {
      if (error instanceof ApiError) toast.error(error.payload.userMessage);
    },
  });

  const current = subscription.data;

  return (
    <>
      <PageHeader title={t('billing.title')} subtitle={t('billing.subtitle')} />

      <div className="space-y-5 px-7 py-6">
        {current?.workspaceStatus === 'SUSPENDED' ? (
          <Banner tone="danger" title={t('billing.suspended')}>
            <p>{t('billing.suspendedHint')}</p>
            {current.lastPaymentError ? (
              <p className="mt-1 font-medium">{current.lastPaymentError}</p>
            ) : null}
          </Banner>
        ) : current?.workspaceStatus === 'PAST_DUE' ? (
          <Banner tone="warning" title={t('billing.pastDue')}>
            <p>{t('billing.pastDueHint')}</p>
            {current.lastPaymentError ? (
              <p className="mt-1 font-medium">{current.lastPaymentError}</p>
            ) : null}
            {current.graceDaysRemaining !== null ? (
              <p className="mt-1">
                {current.graceDaysRemaining} {t('billing.graceRemaining')}
              </p>
            ) : null}
          </Banner>
        ) : null}

        {current && !current.billingConfigured ? (
          <Banner tone="accent" title={t('billing.notConfigured')} />
        ) : null}

        <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
          <Card>
            <CardHeader>
              <CardTitle>{t('billing.usage')}</CardTitle>
            </CardHeader>
            <CardBody className="space-y-3.5">
              {usage.isLoading ? (
                Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-6" />)
              ) : usage.data ? (
                <>
                  <UsageBar label={t('contacts.title')} used={usage.data.contacts.used} limit={usage.data.contacts.limit} />
                  <UsageBar
                    label={t('automations.title')}
                    used={usage.data.automations.used}
                    limit={usage.data.automations.limit}
                  />
                  <UsageBar
                    label={t('channels.title')}
                    used={usage.data.connectedAccounts.used}
                    limit={usage.data.connectedAccounts.limit}
                  />
                  <UsageBar label={t('team.title')} used={usage.data.members.used} limit={usage.data.members.limit} />
                  <UsageBar
                    label={t('dash.messagesSent')}
                    used={usage.data.messagesPerMonth.used}
                    limit={usage.data.messagesPerMonth.limit}
                  />
                  <UsageBar
                    label={t('dash.executions')}
                    used={usage.data.executionsPerMonth.used}
                    limit={usage.data.executionsPerMonth.limit}
                  />
                </>
              ) : null}
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('billing.currentPlan')}</CardTitle>
            </CardHeader>
            <CardBody>
              {current ? (
                <>
                  <p className="text-[20px] font-semibold">{current.plan.name}</p>
                  <p className="mt-0.5 text-[13px] text-muted">
                    {current.plan.priceCents === 0
                      ? t('billing.free')
                      : `${formatMoney(current.plan.priceCents, current.plan.currency, locale)}/${t('billing.month')}`}
                  </p>
                  <Badge tone={current.status === 'ACTIVE' ? 'success' : 'warning'} className="mt-3">
                    {current.status}
                  </Badge>
                  {current.billingConfigured ? (
                    <Button variant="secondary" className="mt-4 w-full" loading={portal.isPending} onClick={() => portal.mutate()}>
                      {t('billing.manage')}
                    </Button>
                  ) : null}
                </>
              ) : (
                <Skeleton className="h-20" />
              )}
            </CardBody>
          </Card>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {plans.data?.map((plan) => {
            const active = current?.plan.code === plan.code;
            return (
              <Card key={plan.id} className={active ? 'border-accent' : undefined}>
                <CardBody>
                  <div className="flex items-center justify-between">
                    <p className="text-[15px] font-semibold">{plan.name}</p>
                    {active ? <Badge tone="accent">{t('billing.currentPlan')}</Badge> : null}
                  </div>
                  <p className="mt-1 text-[22px] font-semibold tracking-tight">
                    {plan.priceCents === 0
                      ? t('billing.free')
                      : formatMoney(plan.priceCents, plan.currency, locale)}
                  </p>
                  {plan.description ? (
                    <p className="mt-1.5 text-[12.5px] leading-snug text-muted">{plan.description}</p>
                  ) : null}

                  <ul className="mt-3 space-y-1 text-[12px] text-muted">
                    <li>
                      {plan.limits.contacts === null
                        ? t('billing.unlimited')
                        : formatNumber(plan.limits.contacts, locale)}{' '}
                      {t('contacts.title').toLowerCase()}
                    </li>
                    <li>
                      {plan.limits.messagesPerMonth === null
                        ? t('billing.unlimited')
                        : formatNumber(plan.limits.messagesPerMonth, locale)}{' '}
                      {t('dash.messagesSent').toLowerCase()}
                    </li>
                    <li>
                      {plan.limits.connectedAccounts === null
                        ? t('billing.unlimited')
                        : plan.limits.connectedAccounts}{' '}
                      {t('channels.title').toLowerCase()}
                    </li>
                  </ul>

                  {!active ? (
                    <Button
                      variant={plan.priceCents === 0 ? 'secondary' : 'primary'}
                      size="sm"
                      className="mt-4 w-full"
                      loading={checkout.isPending}
                      onClick={() => checkout.mutate(plan.code)}
                    >
                      {t('billing.upgrade')}
                    </Button>
                  ) : null}
                </CardBody>
              </Card>
            );
          })}
        </div>
      </div>
    </>
  );
}
