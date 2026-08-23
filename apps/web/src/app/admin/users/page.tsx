'use client';

import * as React from 'react';
import Link from 'next/link';
import { useInfiniteQuery } from '@tanstack/react-query';
import { EyeOff, Search } from 'lucide-react';
import { get } from '@/lib/api';
import { useI18n, type MessageKey } from '@/lib/i18n';
import {
  Badge,
  Banner,
  Button,
  Card,
  CardBody,
  EmptyState,
  ErrorState,
  Input,
  Skeleton,
} from '@/components/ui/primitives';
import type { AdminUserRow } from '@/lib/types';

type Status = 'all' | 'active' | 'suspended' | 'unverified' | 'deleted';

const FILTERS: Array<{ value: Status; label: MessageKey }> = [
  { value: 'all', label: 'admin.users.status.all' },
  { value: 'active', label: 'admin.users.status.active' },
  { value: 'suspended', label: 'admin.users.status.suspended' },
  { value: 'unverified', label: 'admin.users.status.unverified' },
  { value: 'deleted', label: 'admin.users.status.deleted' },
];

interface Page {
  users: AdminUserRow[];
  nextCursor: string | null;
}

export default function AdminUsersPage() {
  const { t, locale } = useI18n();
  const [search, setSearch] = React.useState('');
  const [status, setStatus] = React.useState<Status>('all');

  // Typing a search should not fire a request per keystroke against a table of
  // every account on the platform.
  const [debounced, setDebounced] = React.useState('');
  React.useEffect(() => {
    const timer = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const query = useInfiniteQuery({
    queryKey: ['admin', 'users', debounced, status],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams();
      if (debounced) params.set('search', debounced);
      if (status !== 'all') params.set('status', status);
      if (pageParam) params.set('cursor', pageParam);
      return get<Page>(`/admin/users?${params.toString()}`);
    },
    getNextPageParam: (last) => last.nextCursor,
  });

  const rows = query.data?.pages.flatMap((page) => page.users) ?? [];
  const masked = rows.some((row) => row.piiMasked);

  return (
    <div className="space-y-4">
      <header className="space-y-3">
        <h1 className="text-lg font-semibold text-fg">{t('admin.users.title')}</h1>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-64 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <Input
              className="pl-9"
              placeholder={t('admin.users.search')}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>

          <div className="flex flex-wrap gap-1 rounded-lg border border-border bg-surface p-1">
            {FILTERS.map((filter) => (
              <button
                key={filter.value}
                type="button"
                onClick={() => setStatus(filter.value)}
                className={
                  filter.value === status
                    ? 'rounded-md bg-accent/10 px-3 py-1 text-xs font-medium text-accent'
                    : 'rounded-md px-3 py-1 text-xs text-muted hover:text-fg'
                }
              >
                {t(filter.label)}
              </button>
            ))}
          </div>
        </div>

        {masked ? (
          // Said plainly rather than left as an odd-looking address: the reader
          // should know they are seeing less, and why.
          <Banner tone="accent" title={t('admin.users.masked')}>
            <span className="flex items-center gap-1.5 text-xs">
              <EyeOff className="h-3.5 w-3.5" />
            </span>
          </Banner>
        ) : null}
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

      {!query.isLoading && rows.length === 0 ? <EmptyState title={t('admin.users.empty')} /> : null}

      <div className="space-y-2">
        {rows.map((row) => (
          <Link key={row.id} href={`/admin/users/${row.id}`} className="block">
            <Card className="transition-colors hover:border-accent/40">
              <CardBody className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-fg">
                    {row.name ?? row.email}
                  </p>
                  <p className="truncate text-xs text-muted">{row.email}</p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {row.deletedAt ? <Badge tone="neutral">{t('admin.users.deleted')}</Badge> : null}
                  {row.suspendedAt ? <Badge tone="danger">{t('admin.users.suspended')}</Badge> : null}
                  {!row.emailVerified && !row.deletedAt ? (
                    <Badge tone="warning">{t('admin.users.unverified')}</Badge>
                  ) : null}
                  <span className="text-xs text-muted">
                    {row.workspaceCount} {t('admin.users.workspaces').toLowerCase()}
                  </span>
                  <span className="text-xs text-muted">
                    {t('admin.users.lastLogin')}:{' '}
                    {row.lastLoginAt
                      ? new Date(row.lastLoginAt).toLocaleDateString(locale)
                      : t('admin.users.never')}
                  </span>
                </div>
              </CardBody>
            </Card>
          </Link>
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
    </div>
  );
}
