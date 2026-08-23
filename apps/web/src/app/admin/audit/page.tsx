'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { get } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { Card, CardBody, EmptyState, ErrorState, Skeleton } from '@/components/ui/primitives';
import type { AdminAuditEntry } from '@/lib/types';

/**
 * What administrators did, and why.
 *
 * Read-only, and there is no endpoint behind this screen that could edit or
 * delete a line — a trail somebody can rewrite is not a trail.
 */
export default function AdminAuditPage() {
  const { t, locale } = useI18n();

  const trail = useQuery({
    queryKey: ['admin', 'audit'],
    queryFn: () => get<AdminAuditEntry[]>('/admin/audit?limit=100'),
  });

  if (trail.isError) {
    return <ErrorState message={(trail.error as Error).message} onRetry={() => void trail.refetch()} />;
  }

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-lg font-semibold text-fg">{t('admin.audit.title')}</h1>
        <p className="text-xs text-muted">{t('admin.audit.explain')}</p>
      </header>

      {trail.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, index) => (
            <Card key={index}>
              <CardBody>
                <Skeleton className="w-72" />
              </CardBody>
            </Card>
          ))}
        </div>
      ) : null}

      {trail.data && trail.data.length === 0 ? <EmptyState title={t('admin.audit.empty')} /> : null}

      <div className="space-y-2">
        {(trail.data ?? []).map((entry) => (
          <Card key={entry.id}>
            <CardBody className="space-y-1">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-mono text-xs text-fg">{entry.action}</span>
                <span className="text-xs text-muted">
                  {new Date(entry.createdAt).toLocaleString(locale)}
                </span>
              </div>

              <p className="text-sm text-fg">
                {t('admin.audit.who')}: {entry.actor?.name ?? entry.actor?.email ?? '—'}
              </p>

              <p className="text-sm text-muted">
                {t('admin.audit.why')}: {entry.reason ?? t('admin.audit.noReason')}
              </p>

              {entry.entityType ? (
                <p className="font-mono text-[11px] text-subtle">
                  {entry.entityType} {entry.entityId}
                </p>
              ) : null}
            </CardBody>
          </Card>
        ))}
      </div>
    </div>
  );
}
