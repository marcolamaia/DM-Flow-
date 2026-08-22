'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Inbox as InboxIcon, Send, StickyNote, UserCheck } from 'lucide-react';
import { ApiError, get, post } from '@/lib/api';
import { useI18n, type MessageKey } from '@/lib/i18n';
import { useApp } from '@/components/providers/app-providers';
import {
  Avatar,
  Badge,
  Button,
  EmptyState,
  Input,
  Skeleton,
  Textarea,
} from '@/components/ui/primitives';
import { toast } from '@/components/ui/toast';
import { cn, relativeTime } from '@/lib/utils';
import type { ConversationSummary } from '@/lib/types';

interface ConversationDetail {
  id: string;
  status: string;
  windowState: string;
  automationPaused: boolean;
  canSend: boolean;
  sendBlockedReason: string | null;
  sendBlockedMessage: { 'pt-BR': string; en: string } | null;
  assignee: { id: string; name: string } | null;
  contact: {
    id: string;
    displayName: string | null;
    username: string | null;
    source: string | null;
    tags: Array<{ id: string; name: string; color: string }>;
    customFields: Array<{ id: string; key: string; label: string; value: unknown }>;
  };
  messages: Array<{
    id: string;
    direction: string;
    senderType: string;
    content: Record<string, unknown>;
    status: string;
    createdAt: string;
  }>;
  notes: Array<{ id: string; body: string; author: { name: string }; createdAt: string }>;
  historyNotice: { 'pt-BR': string; en: string };
}

function messageText(content: Record<string, unknown>): string {
  if (typeof content.text === 'string') return content.text;
  const blocks = content.blocks as Array<{ text?: string }> | undefined;
  return blocks?.[0]?.text ?? '';
}

const WINDOW_TONE: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = {
  OPEN: 'success',
  EXTENDED: 'warning',
  CLOSED: 'danger',
  UNKNOWN: 'neutral',
};

export default function InboxPage() {
  const { t, locale } = useI18n();
  const { workspaceId } = useApp();
  const queryClient = useQueryClient();

  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState('');
  const [note, setNote] = React.useState('');
  const [unreadOnly, setUnreadOnly] = React.useState(false);
  const [search, setSearch] = React.useState('');

  const conversations = useQuery({
    queryKey: ['conversations', workspaceId, unreadOnly, search],
    queryFn: () =>
      get<{ data: ConversationSummary[] }>(
        `/inbox/conversations?${new URLSearchParams({
          ...(unreadOnly ? { unreadOnly: 'true' } : {}),
          ...(search ? { search } : {}),
        })}`,
      ),
    enabled: Boolean(workspaceId),
    refetchInterval: 15_000,
  });

  const detail = useQuery({
    queryKey: ['conversation', selectedId],
    queryFn: () => get<ConversationDetail>(`/inbox/conversations/${selectedId}`),
    enabled: Boolean(selectedId),
    refetchInterval: 10_000,
  });

  const send = useMutation({
    mutationFn: (text: string) =>
      post(`/inbox/conversations/${selectedId}/messages`, { text }),
    onSuccess: () => {
      setDraft('');
      queryClient.invalidateQueries({ queryKey: ['conversation', selectedId] });
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
    },
    onError: (error) => {
      if (error instanceof ApiError) toast.error(error.payload.userMessage);
    },
  });

  const addNote = useMutation({
    mutationFn: (body: string) => post(`/inbox/conversations/${selectedId}/notes`, { body }),
    onSuccess: () => {
      setNote('');
      queryClient.invalidateQueries({ queryKey: ['conversation', selectedId] });
    },
  });

  const handoff = useMutation({
    mutationFn: (paused: boolean) =>
      post(`/inbox/conversations/${selectedId}/handoff`, { paused }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['conversation', selectedId] }),
  });

  React.useEffect(() => {
    if (!selectedId && conversations.data?.data[0]) setSelectedId(conversations.data.data[0].id);
  }, [conversations.data, selectedId]);

  const list = conversations.data?.data ?? [];

  return (
    <div className="flex h-full">
      <aside className="flex w-[320px] shrink-0 flex-col border-r border-border">
        <div className="border-b border-border px-4 py-3">
          <h1 className="mb-2.5 text-[15px] font-semibold">{t('inbox.title')}</h1>
          <Input
            placeholder={t('common.search')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8"
          />
          <div className="mt-2 flex gap-1.5">
            <button
              type="button"
              onClick={() => setUnreadOnly(!unreadOnly)}
              className={cn(
                'rounded-full border px-2.5 py-1 text-[11.5px] transition-colors',
                unreadOnly
                  ? 'border-accent bg-accent/10 text-accent'
                  : 'border-border text-muted hover:text-fg',
              )}
            >
              {t('inbox.filters.unread')}
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {conversations.isLoading ? (
            <div className="space-y-2 p-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="rounded-lg border border-border p-3">
                  <Skeleton className="h-3.5 w-32" />
                  <Skeleton className="mt-2 h-3 w-full" />
                </div>
              ))}
            </div>
          ) : list.length === 0 ? (
            <EmptyState icon={<InboxIcon />} title={t('inbox.empty')} hint={t('inbox.emptyHint')} />
          ) : (
            list.map((conversation) => (
              <button
                key={conversation.id}
                type="button"
                onClick={() => setSelectedId(conversation.id)}
                className={cn(
                  'flex w-full gap-2.5 border-b border-border px-4 py-3 text-left transition-colors',
                  selectedId === conversation.id ? 'bg-elevated' : 'hover:bg-elevated/50',
                )}
              >
                <Avatar
                  name={conversation.contact.displayName}
                  src={conversation.contact.avatarUrl}
                  size={34}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-[13px] font-medium">
                      {conversation.contact.displayName ?? conversation.contact.username ?? '—'}
                    </p>
                    <span className="shrink-0 text-[11px] text-subtle">
                      {relativeTime(conversation.lastInboundAt, locale)}
                    </span>
                  </div>
                  <p className="mt-0.5 truncate text-[12px] text-muted">
                    {conversation.lastMessage ? messageText(conversation.lastMessage.content) : '—'}
                  </p>
                  <div className="mt-1.5 flex items-center gap-1.5">
                    <Badge tone={WINDOW_TONE[conversation.windowState] ?? 'neutral'}>
                      {t(`inbox.window.${conversation.windowState}` as MessageKey)}
                    </Badge>
                    {conversation.unreadCount > 0 ? (
                      <Badge tone="accent">{conversation.unreadCount}</Badge>
                    ) : null}
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      </aside>

      {!selectedId || !detail.data ? (
        <div className="flex flex-1 items-center justify-center">
          <p className="text-[13px] text-subtle">{t('inbox.selectOne')}</p>
        </div>
      ) : (
        <>
          <section className="flex min-w-0 flex-1 flex-col">
            <div className="flex items-center justify-between border-b border-border px-5 py-3">
              <div>
                <p className="text-[14px] font-medium">
                  {detail.data.contact.displayName ?? detail.data.contact.username}
                </p>
                <p className="text-[12px] text-muted">@{detail.data.contact.username}</p>
              </div>
              <Button
                variant={detail.data.automationPaused ? 'secondary' : 'outline'}
                size="sm"
                loading={handoff.isPending}
                onClick={() => handoff.mutate(!detail.data!.automationPaused)}
              >
                <UserCheck />
                {detail.data.automationPaused ? t('inbox.handoff.off') : t('inbox.handoff.on')}
              </Button>
            </div>

            {detail.data.automationPaused ? (
              <div className="border-b border-warning/20 bg-warning/[0.07] px-5 py-2">
                <p className="text-[12px] text-warning">{t('inbox.handoff.active')}</p>
              </div>
            ) : null}

            <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
              <p className="text-center text-[11px] text-subtle">
                {detail.data.historyNotice[locale]}
              </p>

              {detail.data.messages.map((message) => {
                const outbound = message.direction === 'OUTBOUND';
                return (
                  <div
                    key={message.id}
                    className={cn('flex', outbound ? 'justify-end' : 'justify-start')}
                  >
                    <div
                      className={cn(
                        'max-w-[70%] rounded-2xl px-3.5 py-2',
                        outbound
                          ? 'bg-accent text-accent-fg'
                          : 'border border-border bg-surface text-fg',
                      )}
                    >
                      <p className="whitespace-pre-wrap text-[13px] leading-snug">
                        {messageText(message.content)}
                      </p>
                      <p
                        className={cn(
                          'mt-1 text-[10px]',
                          outbound ? 'text-accent-fg/70' : 'text-subtle',
                        )}
                      >
                        {message.senderType === 'AUTOMATION'
                          ? locale === 'en'
                            ? 'automation'
                            : 'automação'
                          : message.senderType === 'AGENT'
                            ? locale === 'en'
                              ? 'agent'
                              : 'atendente'
                            : ''}
                        {message.status === 'FAILED' ? ' · falhou' : ''}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="border-t border-border p-3">
              {detail.data.canSend ? (
                <form
                  className="flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (draft.trim()) send.mutate(draft.trim());
                  }}
                >
                  <Input
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder={t('inbox.placeholder')}
                  />
                  <Button type="submit" loading={send.isPending} disabled={!draft.trim()}>
                    <Send />
                    {t('inbox.send')}
                  </Button>
                </form>
              ) : (
                // The composer is disabled with the actual platform reason, not a
                // generic "cannot send" — the operator learns the constraint.
                <div className="rounded-lg border border-border bg-elevated px-3 py-2.5">
                  <p className="text-[12px] font-medium text-muted">{t('inbox.cannotSend')}</p>
                  {detail.data.sendBlockedMessage ? (
                    <p className="mt-0.5 text-[12px] text-subtle">
                      {detail.data.sendBlockedMessage[locale]}
                    </p>
                  ) : null}
                </div>
              )}
            </div>
          </section>

          <aside className="w-[280px] shrink-0 overflow-y-auto border-l border-border p-4">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-subtle">
              {t('contacts.title')}
            </p>
            <div className="mb-4 space-y-1.5 text-[12.5px]">
              <div className="flex justify-between">
                <span className="text-muted">{t('contacts.source')}</span>
                <span className="font-mono text-[11px]">{detail.data.contact.source ?? '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">{t('inbox.window.OPEN').split(' ')[0]}</span>
                <Badge tone={WINDOW_TONE[detail.data.windowState] ?? 'neutral'}>
                  {t(`inbox.window.${detail.data.windowState}` as MessageKey)}
                </Badge>
              </div>
            </div>

            {detail.data.contact.tags.length > 0 ? (
              <>
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-subtle">
                  {t('contacts.tags')}
                </p>
                <div className="mb-4 flex flex-wrap gap-1.5">
                  {detail.data.contact.tags.map((tag) => (
                    <span
                      key={tag.id}
                      className="rounded-full px-2 py-0.5 text-[11px]"
                      style={{ backgroundColor: `${tag.color}22`, color: tag.color }}
                    >
                      {tag.name}
                    </span>
                  ))}
                </div>
              </>
            ) : null}

            {detail.data.contact.customFields.length > 0 ? (
              <>
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-subtle">
                  {t('contacts.fields')}
                </p>
                <div className="mb-4 space-y-1 text-[12.5px]">
                  {detail.data.contact.customFields.map((field) => (
                    <div key={field.id} className="flex justify-between gap-2">
                      <span className="text-muted">{field.label}</span>
                      <span className="truncate">{String(field.value ?? '—')}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : null}

            <p className="mb-1.5 mt-5 text-[11px] font-semibold uppercase tracking-wider text-subtle">
              {t('inbox.notes')}
            </p>
            <p className="mb-2 text-[11px] leading-snug text-subtle">{t('inbox.noteHint')}</p>
            <div className="mb-2 space-y-2">
              {detail.data.notes.map((item) => (
                <div key={item.id} className="rounded-lg border border-warning/25 bg-warning/[0.06] p-2">
                  <p className="text-[12px] leading-snug">{item.body}</p>
                  <p className="mt-1 text-[10.5px] text-subtle">
                    {item.author.name} · {relativeTime(item.createdAt, locale)}
                  </p>
                </div>
              ))}
            </div>
            <Textarea
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t('inbox.addNote')}
              className="text-[12.5px]"
            />
            <Button
              variant="secondary"
              size="sm"
              className="mt-2 w-full"
              disabled={!note.trim()}
              loading={addNote.isPending}
              onClick={() => addNote.mutate(note.trim())}
            >
              <StickyNote />
              {t('inbox.addNote')}
            </Button>
          </aside>
        </>
      )}
    </div>
  );
}
