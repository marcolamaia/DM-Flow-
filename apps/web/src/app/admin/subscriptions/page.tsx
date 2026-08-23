'use client';

import * as React from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { get, post } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import {
  Badge,
  Button,
  Card,
  CardBody,
  EmptyState,
  ErrorState,
  Input,
  Select,
  Skeleton,
} from '@/components/ui/primitives';
import { ReasonDialog } from '@/components/admin/reason-dialog';
import type { AdminMe, AdminSubscriptionRow, Plan } from '@/lib/types';

const STATUSES = ['ACTIVE', 'TRIALING', 'PAST_DUE', 'UNPAID', 'CANCELED', 'PAUSED'];

interface Page {
  subscriptions: AdminSubscriptionRow[];
  nextCursor: string | null;
}

export default function AdminSubscriptionsPage() {
  const { t, locale } = useI18n();
  const client = useQueryClient();

  const [search, setSearch] = React.useState('');
  const [debounced, setDebounced] = React.useState('');
  const [status, setStatus] = React.useState('');
  const [target, setTarget] = React.useState<AdminSubscriptionRow | null>(null);
  const [planCode, setPlanCode] = React.useState('');

  React.useEffect(() => {
    const timer = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const me = useQuery({ queryKey: ['admin', 'me'], queryFn: () => get<AdminMe>('/admin/me') });
  const plans = useQuery({ queryKey: ['plans'], queryFn: () => get<Plan[]>('/billing/plans') });

  const query = useInfiniteQuery({
    queryKey: ['admin', 'subscriptions', debounced, status],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams();
      if (debounced) params.set('search', debounced);
      if (status) params.set('status', status);
      if (pageParam) params.set('cursor', pageParam);
      return get<Page>(`/admin/subscriptions?${params.toString()}`);
    },
    getNextPageParam: (last) => last.nextCursor,
  });

  const changePlan = useMutation({
    mutationFn: ({ workspaceId, reason }: { workspaceId: string; reason: string }) =>
      post(`/admin/subscriptions/${workspaceId}/plan`, { planCode, reason }),
    onSuccess: async () => {
      setTarget(null);
      setPlanCode('');
      await client.invalidateQueries({ queryKey: ['admin', 'subscriptions'] });
      // Recurring revenue moved, so the overview is stale now.
      await client.invalidateQueries({ queryKey: ['admin', 'overview'] });
    },
  });

  const rows = query.data?.pages.flatMap((page) => page.subscriptions) ?? [];
  const mayChange = me.data?.permissions.includes('admin.subscriptions.write') ?? false;

  return (
    <div className="space-y-4">
      <header className="space-y-3">
        <h1 className="text-lg font-semibold text-fg">{t('admin.subs.title')}</h1>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-64 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <Input
              className="pl-9"
              placeholder={t('admin.subs.search')}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>

          <Select
            className="w-52"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="">{t('admin.subs.allStatuses')}</option>
            {STATUSES.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </Select>
        </div>
      </header>

      {query.isError ? (
        <ErrorState message={(query.error as Error).message} onRetry={() => void query.refetch()} />
      ) : null}

      {query.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, index) => (
            <Card key={index}>
              <CardBody>
                <Skeleton className="w-64" />
              </CardBody>
            </Card>
          ))}
        </div>
      ) : null}

      {!query.isLoading && rows.length === 0 ? <EmptyState title={t('admin.subs.empty')} /> : null}

      <div className="space-y-2">
        {rows.map((row) => (
          <Card key={row.id}>
            <CardBody className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-fg">{row.workspace.name}</p>
                <p className="truncate text-xs text-muted">
                  {row.owner?.email ?? row.workspace.id}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <Badge tone={row.status === 'ACTIVE' ? 'success' : row.status === 'PAST_DUE' ? 'danger' : 'neutral'}>
                  {row.status}
                </Badge>
                <Badge tone="neutral">{row.plan.name}</Badge>

                <span className="text-sm font-medium text-fg">
                  {new Intl.NumberFormat(locale, {
                    style: 'currency',
                    currency: row.currency,
                  }).format(row.monthlyCents / 100)}
                </span>

                <span className="text-xs text-muted">
                  {row.billingLinked ? t('admin.subs.billingLinked') : t('admin.subs.billingNotLinked')}
                </span>

                {row.currentPeriodEnd ? (
                  <span className="text-xs text-muted">
                    {t('admin.subs.renewsAt')}{' '}
                    {new Date(row.currentPeriodEnd).toLocaleDateString(locale)}
                  </span>
                ) : null}

                {mayChange ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      setTarget(row);
                      setPlanCode(row.plan.code);
                    }}
                  >
                    {t('admin.subs.changePlan')}
                  </Button>
                ) : null}
              </div>
            </CardBody>
          </Card>
        ))}
      </div>

      {query.hasNextPage ? (
        <Button
          variant="secondary"
          onClick={() => void query.fetchNextPage()}
          loading={query.isFetchingNextPage}
        >
          {t('admin.users.loadMore')}
        </Button>
      ) : null}

      {target ? (
        <ReasonDialog
          title={t('admin.subs.changePlan.title')}
          // Said before the action, not after it: the platform's grant moves,
          // the provider's charge does not.
          explanation={t('admin.subs.changePlan.explain')}
          confirmLabel={t('admin.subs.changePlan.confirm')}
          tone="primary"
          pending={changePlan.isPending}
          error={changePlan.isError ? (changePlan.error as Error).message : null}
          onCancel={() => {
            changePlan.reset();
            setTarget(null);
          }}
          onConfirm={(reason) => changePlan.mutate({ workspaceId: target.workspace.id, reason })}
        >
          <label className="block text-xs font-medium text-fg" htmlFor="admin-plan">
            {t('admin.subs.plan')}
          </label>
          <Select
            id="admin-plan"
            className="mt-1"
            value={planCode}
            onChange={(event) => setPlanCode(event.target.value)}
          >
            {(plans.data ?? []).map((plan) => (
              <option key={plan.code} value={plan.code}>
                {plan.name}
              </option>
            ))}
          </Select>
        </ReasonDialog>
      ) : null}
    </div>
  );
}
