'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { get, post } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import {
  Badge,
  Banner,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  ErrorState,
  Skeleton,
} from '@/components/ui/primitives';
import { ReasonDialog } from '@/components/admin/reason-dialog';
import type { AdminMe, AdminUserDetail } from '@/lib/types';

export default function AdminUserDetailPage() {
  const { t, locale } = useI18n();
  const params = useParams<{ id: string }>();
  const client = useQueryClient();
  const [dialog, setDialog] = React.useState<'suspend' | 'reactivate' | null>(null);

  const me = useQuery({ queryKey: ['admin', 'me'], queryFn: () => get<AdminMe>('/admin/me') });
  const user = useQuery({
    queryKey: ['admin', 'user', params.id],
    queryFn: () => get<AdminUserDetail>(`/admin/users/${params.id}`),
  });

  const action = useMutation({
    mutationFn: ({ kind, reason }: { kind: 'suspend' | 'reactivate'; reason: string }) =>
      post(`/admin/users/${params.id}/${kind}`, { reason }),
    onSuccess: async () => {
      setDialog(null);
      await client.invalidateQueries({ queryKey: ['admin', 'user', params.id] });
      await client.invalidateQueries({ queryKey: ['admin', 'users'] });
    },
  });

  if (user.isError) {
    return <ErrorState message={(user.error as Error).message} onRetry={() => void user.refetch()} />;
  }

  if (user.isLoading || !user.data) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-32" />
      </div>
    );
  }

  const record = user.data;
  const mayBlock = me.data?.permissions.includes('admin.users.suspend') ?? false;
  const format = (value: string | null) =>
    value ? new Date(value).toLocaleString(locale) : t('admin.users.never');

  return (
    <div className="space-y-5">
      <Link
        href="/admin/users"
        className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg"
      >
        <ArrowLeft className="h-4 w-4" />
        {t('admin.users.title')}
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-fg">{record.name ?? record.email}</h1>
          <p className="text-sm text-muted">{record.email}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {record.suspendedAt ? <Badge tone="danger">{t('admin.users.suspended')}</Badge> : null}
            {record.deletedAt ? <Badge tone="neutral">{t('admin.users.deleted')}</Badge> : null}
            <Badge tone={record.emailVerified ? 'success' : 'warning'}>
              {record.emailVerified ? t('admin.users.verified') : t('admin.users.unverified')}
            </Badge>
            {record.twoFactorEnabled ? (
              <Badge tone="success">{t('admin.users.twoFactor')}</Badge>
            ) : null}
          </div>
        </div>

        {mayBlock && !record.deletedAt ? (
          <Button
            variant={record.suspendedAt ? 'secondary' : 'danger'}
            onClick={() => setDialog(record.suspendedAt ? 'reactivate' : 'suspend')}
          >
            {record.suspendedAt ? t('admin.reactivate.action') : t('admin.suspend.action')}
          </Button>
        ) : null}
      </header>

      {record.suspendedAt ? (
        <Banner tone="danger" title={`${t('admin.suspendedSince')} ${format(record.suspendedAt)}`}>
          <p className="text-sm">
            {t('admin.suspendedReason')}: {record.suspensionReason ?? t('admin.audit.noReason')}
          </p>
        </Banner>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardBody>
            <p className="text-xs uppercase tracking-wide text-muted">{t('admin.users.createdAt')}</p>
            <p className="text-sm text-fg">{new Date(record.createdAt).toLocaleString(locale)}</p>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <p className="text-xs uppercase tracking-wide text-muted">{t('admin.users.lastLogin')}</p>
            <p className="text-sm text-fg">{format(record.lastLoginAt)}</p>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <p className="text-xs uppercase tracking-wide text-muted">
              {t('admin.users.activeSessions')}
            </p>
            <p className="text-sm text-fg">{record.activeSessions}</p>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('admin.users.workspaces')}</CardTitle>
        </CardHeader>
        <CardBody className="space-y-3">
          {record.workspaces.map((workspace) => (
            <div
              key={workspace.id}
              className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3 last:border-0 last:pb-0"
            >
              <div>
                <p className="text-sm font-medium text-fg">{workspace.name}</p>
                <p className="text-xs text-muted">
                  {workspace.role} · {workspace.status}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
                <span>
                  {workspace.usage.contacts} {t('admin.users.usage.contacts')}
                </span>
                <span>
                  {workspace.usage.automations} {t('admin.users.usage.automations')}
                </span>
                <span>
                  {workspace.usage.connectedAccounts} {t('admin.users.usage.channels')}
                </span>
                {workspace.subscription ? (
                  <Badge tone={workspace.subscription.monthlyCents > 0 ? 'accent' : 'neutral'}>
                    {workspace.subscription.plan}
                    {workspace.subscription.monthlyCents > 0
                      ? ` · ${new Intl.NumberFormat(locale, {
                          style: 'currency',
                          currency: workspace.subscription.currency,
                        }).format(workspace.subscription.monthlyCents / 100)}`
                      : ''}
                  </Badge>
                ) : null}
              </div>
            </div>
          ))}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('admin.users.recentEvents')}</CardTitle>
        </CardHeader>
        <CardBody>
          {record.recentEvents.length === 0 ? (
            <p className="text-sm text-muted">{t('admin.users.noEvents')}</p>
          ) : (
            <ul className="space-y-1.5">
              {record.recentEvents.map((event, index) => (
                <li key={index} className="flex justify-between gap-3 text-sm">
                  <span className="font-mono text-xs text-fg">{event.event}</span>
                  <span className="shrink-0 text-xs text-muted">
                    {new Date(event.occurredAt).toLocaleString(locale)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      {dialog ? (
        <ReasonDialog
          title={dialog === 'suspend' ? t('admin.suspend.title') : t('admin.reactivate.title')}
          explanation={
            dialog === 'suspend' ? t('admin.suspend.explain') : t('admin.reactivate.explain')
          }
          confirmLabel={
            dialog === 'suspend' ? t('admin.suspend.confirm') : t('admin.reactivate.confirm')
          }
          tone={dialog === 'suspend' ? 'danger' : 'primary'}
          pending={action.isPending}
          error={action.isError ? (action.error as Error).message : null}
          onCancel={() => {
            action.reset();
            setDialog(null);
          }}
          onConfirm={(reason) => action.mutate({ kind: dialog, reason })}
        />
      ) : null}
    </div>
  );
}
