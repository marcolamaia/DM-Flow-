'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, X } from 'lucide-react';
import { ApiError, del, get, patch, post } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import {
  Avatar,
  Badge,
  Button,
  Field,
  Input,
  Select,
  Skeleton,
} from '@/components/ui/primitives';
import { relativeTime } from '@/lib/utils';
import type { Contact, Tag } from '@/lib/types';

/**
 * One contact, opened beside the list.
 *
 * A panel rather than its own page: an operator working through a list is
 * usually comparing rows, and sending them to a separate route loses that
 * place. Everything here writes to the API and comes back through the same
 * queries the list uses, so the row updates behind the panel.
 */
export function ContactDrawer({
  contactId,
  tags,
  onClose,
}: {
  contactId: string;
  tags: Tag[];
  onClose: () => void;
}) {
  const { t, locale } = useI18n();
  const client = useQueryClient();

  const [displayName, setDisplayName] = React.useState('');
  const [status, setStatus] = React.useState('');
  const [dirty, setDirty] = React.useState(false);
  const [confirmingDelete, setConfirmingDelete] = React.useState(false);
  const [saved, setSaved] = React.useState(false);

  const contact = useQuery({
    queryKey: ['contact', contactId],
    queryFn: () => get<Contact>(`/contacts/${contactId}`),
  });

  // Filled once from the server, then owned by the form — refilling on every
  // refetch would overwrite what the person is in the middle of typing.
  React.useEffect(() => {
    if (!contact.data || dirty) return;
    setDisplayName(contact.data.displayName ?? '');
    setStatus(contact.data.status);
  }, [contact.data, dirty]);

  const refresh = async () => {
    await client.invalidateQueries({ queryKey: ['contact', contactId] });
    await client.invalidateQueries({ queryKey: ['contacts'] });
  };

  const save = useMutation({
    mutationFn: () =>
      patch(`/contacts/${contactId}`, {
        displayName: displayName.trim() || undefined,
        status,
      }),
    onSuccess: async () => {
      setDirty(false);
      setSaved(true);
      await refresh();
    },
  });

  const addTag = useMutation({
    mutationFn: (tagId: string) => post(`/contacts/${contactId}/tags/${tagId}`),
    onSuccess: refresh,
  });

  const removeTag = useMutation({
    mutationFn: (tagId: string) => del(`/contacts/${contactId}/tags/${tagId}`),
    onSuccess: refresh,
  });

  const remove = useMutation({
    mutationFn: () => del(`/contacts/${contactId}`),
    onSuccess: async () => {
      await refresh();
      onClose();
    },
  });

  const record = contact.data;
  const attached = new Set(record?.tags.map((tag) => tag.id) ?? []);
  const available = tags.filter((tag) => !attached.has(tag.id));

  return (
    <aside className="fixed inset-y-0 right-0 z-40 flex w-full max-w-md flex-col border-l border-border bg-surface shadow-xl">
      <header className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
        {contact.isLoading || !record ? (
          <Skeleton className="h-8 w-48" />
        ) : (
          <div className="flex min-w-0 items-center gap-3">
            <Avatar name={record.displayName} src={record.avatarUrl} size={36} />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-fg">
                {record.displayName ?? '—'}
              </p>
              {record.username ? (
                <p className="truncate text-xs text-muted">@{record.username}</p>
              ) : null}
            </div>
          </div>
        )}
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded-md p-1 text-muted hover:bg-elevated hover:text-fg"
          aria-label={t('common.cancel')}
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
        {contact.isError ? (
          <p className="text-sm text-danger">
            {contact.error instanceof ApiError
              ? contact.error.payload.userMessage
              : t('common.error')}
          </p>
        ) : null}

        {record ? (
          <>
            {/* ── What can be edited ── */}
            <section className="space-y-3">
              {/* Said plainly, because most of this record came from Instagram
                  and an operator will otherwise wonder why they cannot fix it. */}
              <p className="text-xs text-muted">{t('contacts.editHint')}</p>

              <Field label={t('contacts.displayName')}>
                <Input
                  value={displayName}
                  onChange={(event) => {
                    setDisplayName(event.target.value);
                    setDirty(true);
                    setSaved(false);
                  }}
                />
              </Field>

              <Field label={t('contacts.changeStatus')}>
                <Select
                  value={status}
                  onChange={(event) => {
                    setStatus(event.target.value);
                    setDirty(true);
                    setSaved(false);
                  }}
                >
                  <option value="ACTIVE">{t('contacts.status.ACTIVE')}</option>
                  <option value="UNSUBSCRIBED">{t('contacts.status.UNSUBSCRIBED')}</option>
                  <option value="BLOCKED">{t('contacts.status.BLOCKED')}</option>
                </Select>
              </Field>

              {save.isError ? (
                <p className="text-sm text-danger">
                  {save.error instanceof ApiError
                    ? save.error.payload.userMessage
                    : t('common.error')}
                </p>
              ) : null}

              <div className="flex items-center gap-3">
                <Button
                  size="sm"
                  disabled={!dirty}
                  loading={save.isPending}
                  onClick={() => save.mutate()}
                >
                  {t('common.save')}
                </Button>
                {saved ? <span className="text-xs text-success">{t('contacts.saved')}</span> : null}
              </div>
            </section>

            {/* ── Tags ── */}
            <section className="space-y-2 border-t border-border pt-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted">
                {t('contacts.manageTags')}
              </p>

              {record.tags.length === 0 ? (
                <p className="text-sm text-muted">{t('contacts.noTags')}</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {record.tags.map((tag) => (
                    <span
                      key={tag.id}
                      className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-0.5 text-xs"
                      style={{ borderColor: `${tag.color}55`, color: tag.color }}
                    >
                      {tag.name}
                      <button
                        type="button"
                        onClick={() => removeTag.mutate(tag.id)}
                        className="text-muted hover:text-danger"
                        aria-label={t('contacts.removeTag')}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}

              {available.length > 0 ? (
                <Select
                  value=""
                  onChange={(event) => {
                    if (event.target.value) addTag.mutate(event.target.value);
                  }}
                  className="mt-2"
                >
                  <option value="">{t('contacts.addTag')}</option>
                  {available.map((tag) => (
                    <option key={tag.id} value={tag.id}>
                      {tag.name}
                    </option>
                  ))}
                </Select>
              ) : null}
            </section>

            {/* ── What the platform knows, read-only ── */}
            <section className="space-y-2 border-t border-border pt-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted">
                {t('contacts.customFields')}
              </p>
              {record.customFields.length === 0 ? (
                <p className="text-sm text-muted">{t('contacts.noCustomFields')}</p>
              ) : (
                <dl className="space-y-1.5">
                  {record.customFields.map((field) => (
                    <div key={field.id} className="flex justify-between gap-3 text-sm">
                      <dt className="text-muted">{field.label}</dt>
                      <dd className="text-fg">{String(field.value ?? '—')}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </section>

            <section className="space-y-2 border-t border-border pt-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted">
                {t('contacts.conversations')}
              </p>
              {record.conversations.length === 0 ? (
                <p className="text-sm text-muted">{t('contacts.noConversations')}</p>
              ) : (
                <ul className="space-y-1.5">
                  {record.conversations.map((conversation) => (
                    <li key={conversation.id} className="flex items-center gap-2 text-sm">
                      <Badge tone="neutral">{conversation.channel}</Badge>
                      <span className="text-muted">{conversation.status}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="border-t border-border pt-4 text-xs text-muted">
              <p>
                {t('contacts.createdAt')}: {new Date(record.createdAt).toLocaleDateString(locale)}
              </p>
              {record.lastInteractionAt ? (
                <p>
                  {t('contacts.lastInteraction')}:{' '}
                  {relativeTime(record.lastInteractionAt, locale)}
                </p>
              ) : null}
            </section>
          </>
        ) : null}
      </div>

      {/* ── Deleting ── */}
      <footer className="border-t border-border px-5 py-4">
        {confirmingDelete ? (
          <div className="space-y-2">
            <p className="text-sm font-medium text-fg">{t('contacts.delete.title')}</p>
            {/* What actually goes with them, before they press it. */}
            <p className="text-xs text-muted">{t('contacts.delete.explain')}</p>
            {remove.isError ? (
              <p className="text-sm text-danger">
                {remove.error instanceof ApiError
                  ? remove.error.payload.userMessage
                  : t('common.error')}
              </p>
            ) : null}
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setConfirmingDelete(false)}
                disabled={remove.isPending}
              >
                {t('common.cancel')}
              </Button>
              <Button
                size="sm"
                variant="danger"
                loading={remove.isPending}
                onClick={() => remove.mutate()}
              >
                {t('contacts.delete.confirm')}
              </Button>
            </div>
          </div>
        ) : (
          <Button size="sm" variant="ghost" onClick={() => setConfirmingDelete(true)}>
            <Trash2 className="h-3.5 w-3.5" />
            {t('contacts.delete')}
          </Button>
        )}
      </footer>
    </aside>
  );
}

/** The tag picker used when nothing is attached yet. */
export function AddTagButton({ onPick }: { onPick: () => void }) {
  const { t } = useI18n();
  return (
    <Button size="sm" variant="secondary" onClick={onPick}>
      <Plus className="h-3.5 w-3.5" />
      {t('contacts.addTag')}
    </Button>
  );
}
