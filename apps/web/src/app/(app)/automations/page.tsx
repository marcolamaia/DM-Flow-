'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Workflow } from 'lucide-react';
import { ApiError, get, post } from '@/lib/api';
import { useI18n, type MessageKey } from '@/lib/i18n';
import { useApp } from '@/components/providers/app-providers';
import { PageHeader } from '@/components/page-header';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Skeleton,
} from '@/components/ui/primitives';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { toast } from '@/components/ui/toast';
import { relativeTime } from '@/lib/utils';
import type { AutomationSummary } from '@/lib/types';

const STATUS_TONE = {
  DRAFT: 'neutral',
  PUBLISHED: 'success',
  PAUSED: 'warning',
  ARCHIVED: 'neutral',
} as const;

export default function AutomationsPage() {
  const { t, locale } = useI18n();
  const { workspaceId } = useApp();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [creating, setCreating] = React.useState(false);
  const [name, setName] = React.useState('');

  const automations = useQuery({
    queryKey: ['automations', workspaceId],
    queryFn: () => get<AutomationSummary[]>('/automations'),
    enabled: Boolean(workspaceId),
  });

  const create = useMutation({
    mutationFn: () => post<{ id: string }>('/automations', { name: name.trim() }),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ['automations'] });
      setCreating(false);
      setName('');
      router.push(`/automations/${created.id}`);
    },
    onError: (error) => {
      if (error instanceof ApiError) toast.error(error.payload.userMessage);
    },
  });

  return (
    <>
      <PageHeader
        title={t('automations.title')}
        subtitle={t('automations.subtitle')}
        actions={
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus />
            {t('automations.new')}
          </Button>
        }
      />

      <div className="px-7 py-6">
        {automations.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Card key={i} className="p-4">
                <Skeleton className="h-4 w-48" />
                <Skeleton className="mt-2.5 h-3 w-72" />
              </Card>
            ))}
          </div>
        ) : automations.isError ? (
          <Card>
            <ErrorState
              message={
                automations.error instanceof ApiError
                  ? automations.error.payload.userMessage
                  : t('common.error')
              }
              correlationId={
                automations.error instanceof ApiError ? automations.error.correlationId : undefined
              }
              onRetry={() => automations.refetch()}
              retryLabel={t('common.retry')}
            />
          </Card>
        ) : automations.data && automations.data.length === 0 ? (
          <Card>
            <EmptyState
              icon={<Workflow />}
              title={t('automations.empty')}
              hint={t('automations.emptyHint')}
              action={
                <Button size="sm" onClick={() => setCreating(true)}>
                  <Plus />
                  {t('automations.new')}
                </Button>
              }
            />
          </Card>
        ) : (
          <div className="space-y-2">
            {automations.data?.map((automation) => (
              <Link
                key={automation.id}
                href={`/automations/${automation.id}`}
                className="block rounded-xl border border-border bg-surface px-4 py-3.5 transition-colors hover:border-accent/40"
              >
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-[14px] font-medium">{automation.name}</p>
                      <Badge tone={STATUS_TONE[automation.status]}>
                        {t(`automations.status.${automation.status}` as MessageKey)}
                      </Badge>
                      {automation.hasUnpublishedChanges ? (
                        <Badge tone="warning">{t('automations.unpublished')}</Badge>
                      ) : null}
                    </div>
                    {automation.description ? (
                      <p className="mt-1 truncate text-[13px] text-muted">
                        {automation.description}
                      </p>
                    ) : null}
                    {automation.triggerTypes.length > 0 ? (
                      <p className="mt-1.5 font-mono text-[11px] text-subtle">
                        {automation.triggerTypes.join(' · ')}
                      </p>
                    ) : null}
                  </div>

                  <div className="shrink-0 text-right">
                    <p className="text-[13px] font-medium tabular-nums">
                      {automation.executionCount}
                    </p>
                    <p className="text-[11px] text-subtle">{t('automations.executions')}</p>
                    <p className="mt-1 text-[11px] text-subtle">
                      {relativeTime(automation.updatedAt, locale)}
                    </p>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent title={t('automations.new')}>
          <Field label={t('auth.name')}>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter' && name.trim()) create.mutate();
              }}
            />
          </Field>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreating(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              disabled={!name.trim()}
              loading={create.isPending}
              onClick={() => create.mutate()}
            >
              {t('common.create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
