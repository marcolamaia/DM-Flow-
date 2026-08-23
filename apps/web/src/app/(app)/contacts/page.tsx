'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { ListFilter, SlidersHorizontal, Tags, Users } from 'lucide-react';
import { ApiError, get } from '@/lib/api';
import { useI18n, type MessageKey } from '@/lib/i18n';
import { useApp } from '@/components/providers/app-providers';
import { PageHeader } from '@/components/page-header';
import {
  Avatar,
  Badge,
  Card,
  EmptyState,
  ErrorState,
  Input,
  Select,
  Skeleton,
} from '@/components/ui/primitives';
import Link from 'next/link';
import { relativeTime } from '@/lib/utils';
import { ContactDrawer } from '@/components/contacts/contact-drawer';
import { Button } from '@/components/ui/primitives';
import type { Contact, Tag } from '@/lib/types';

export default function ContactsPage() {
  const { t, locale } = useI18n();
  const { workspaceId } = useApp();

  const [search, setSearch] = React.useState('');
  const [openContactId, setOpenContactId] = React.useState<string | null>(null);
  const [tagId, setTagId] = React.useState('');
  const [status, setStatus] = React.useState('');

  const tags = useQuery({
    queryKey: ['tags', workspaceId],
    queryFn: () => get<Tag[]>('/tags'),
    enabled: Boolean(workspaceId),
  });

  const contacts = useQuery({
    queryKey: ['contacts', workspaceId, search, tagId, status],
    queryFn: () =>
      get<{ data: Contact[]; pagination: { total: number } }>(
        `/contacts?${new URLSearchParams({
          ...(search ? { search } : {}),
          ...(tagId ? { tagIds: tagId } : {}),
          ...(status ? { status } : {}),
        })}`,
      ),
    enabled: Boolean(workspaceId),
  });

  return (
    <>
      <PageHeader
        title={t('contacts.title')}
        subtitle={t('contacts.subtitle')}
        actions={
          <div className="flex items-center gap-2">
            {contacts.data ? <Badge>{contacts.data.pagination.total}</Badge> : null}
            <Link href="/contacts/tags">
              <Button size="sm" variant="secondary">
                <Tags className="size-3.5" />
                {t('tags.title')}
              </Button>
            </Link>
            <Link href="/contacts/fields">
              <Button size="sm" variant="secondary">
                <SlidersHorizontal className="size-3.5" />
                {t('fields.title')}
              </Button>
            </Link>
            <Link href="/contacts/segments">
              <Button size="sm" variant="secondary">
                <ListFilter className="size-3.5" />
                {t('segments.title')}
              </Button>
            </Link>
          </div>
        }
      />

      <div className="px-7 py-5">
        <div className="mb-4 flex flex-wrap gap-2">
          <Input
            placeholder={t('common.search')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-[260px]"
          />
          <Select value={tagId} onChange={(e) => setTagId(e.target.value)} className="max-w-[180px]">
            <option value="">{t('contacts.tags')}: {t('common.all')}</option>
            {tags.data?.map((tag) => (
              <option key={tag.id} value={tag.id}>
                {tag.name}
              </option>
            ))}
          </Select>
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="max-w-[180px]">
            <option value="">{t('contacts.status')}: {t('common.all')}</option>
            <option value="ACTIVE">{t('contacts.status.ACTIVE')}</option>
            <option value="UNSUBSCRIBED">{t('contacts.status.UNSUBSCRIBED')}</option>
            <option value="BLOCKED">{t('contacts.status.BLOCKED')}</option>
          </Select>
        </div>

        <Card className="overflow-hidden">
          {contacts.isLoading ? (
            <div className="divide-y divide-border">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-3">
                  <Skeleton className="size-8 rounded-full" />
                  <Skeleton className="h-3.5 w-40" />
                </div>
              ))}
            </div>
          ) : contacts.isError ? (
            <ErrorState
              message={
                contacts.error instanceof ApiError
                  ? contacts.error.payload.userMessage
                  : t('common.error')
              }
              onRetry={() => contacts.refetch()}
              retryLabel={t('common.retry')}
            />
          ) : contacts.data?.data.length === 0 ? (
            <EmptyState icon={<Users />} title={t('contacts.empty')} hint={t('contacts.emptyHint')} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[13px]">
                <thead className="border-b border-border text-[11.5px] uppercase tracking-wider text-subtle">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">{t('auth.name')}</th>
                    <th className="px-4 py-2.5 font-medium">{t('contacts.tags')}</th>
                    <th className="px-4 py-2.5 font-medium">{t('contacts.source')}</th>
                    <th className="px-4 py-2.5 font-medium">{t('contacts.status')}</th>
                    <th className="px-4 py-2.5 font-medium">{t('contacts.lastInteraction')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {contacts.data?.data.map((contact) => (
                    <tr
                      key={contact.id}
                      onClick={() => setOpenContactId(contact.id)}
                      className="cursor-pointer hover:bg-elevated/50"
                    >
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2.5">
                          <Avatar name={contact.displayName} src={contact.avatarUrl} size={28} />
                          <div className="min-w-0">
                            <p className="truncate font-medium">{contact.displayName ?? '—'}</p>
                            {contact.username ? (
                              <p className="truncate text-[11.5px] text-subtle">
                                @{contact.username}
                              </p>
                            ) : null}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex flex-wrap gap-1">
                          {contact.tags.map((tag) => (
                            <span
                              key={tag.id}
                              className="rounded-full px-2 py-0.5 text-[11px]"
                              style={{ backgroundColor: `${tag.color}22`, color: tag.color }}
                            >
                              {tag.name}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 font-mono text-[11.5px] text-muted">
                        {contact.source ?? '—'}
                      </td>
                      <td className="px-4 py-2.5">
                        <Badge tone={contact.status === 'ACTIVE' ? 'success' : 'neutral'}>
                          {t(`contacts.status.${contact.status}` as MessageKey)}
                        </Badge>
                      </td>
                      <td className="px-4 py-2.5 text-muted">
                        {relativeTime(contact.lastInteractionAt, locale)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      {openContactId ? (
        <ContactDrawer
          contactId={openContactId}
          tags={tags.data ?? []}
          onClose={() => setOpenContactId(null)}
        />
      ) : null}
    </>
  );
}
