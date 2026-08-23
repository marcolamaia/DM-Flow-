'use client';

import * as React from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Plus, Trash2 } from 'lucide-react';
import { ApiError, del, get, patch, post } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useApp } from '@/components/providers/app-providers';
import { PageHeader } from '@/components/page-header';
import {
  Button,
  Card,
  CardBody,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Skeleton,
} from '@/components/ui/primitives';
import type { Tag } from '@/lib/types';

const DEFAULT_COLOUR = '#6366f1';

/**
 * Managing the tags of a workspace.
 *
 * Tags are not decoration here — an automation branches on them, so deleting
 * one changes what a running flow finds. The delete confirmation says that out
 * loud instead of asking a generic "are you sure".
 */
export default function TagsPage() {
  const { t } = useI18n();
  const { workspaceId } = useApp();
  const client = useQueryClient();

  const [name, setName] = React.useState('');
  const [colour, setColour] = React.useState(DEFAULT_COLOUR);
  const [editing, setEditing] = React.useState<string | null>(null);
  const [editName, setEditName] = React.useState('');
  const [confirming, setConfirming] = React.useState<string | null>(null);

  const tags = useQuery({
    queryKey: ['tags', workspaceId],
    queryFn: () => get<Tag[]>('/tags'),
    enabled: Boolean(workspaceId),
  });

  const refresh = async () => {
    await client.invalidateQueries({ queryKey: ['tags'] });
    // A tag change shows up on the contact rows too.
    await client.invalidateQueries({ queryKey: ['contacts'] });
  };

  const create = useMutation({
    mutationFn: () => post<Tag>('/tags', { name: name.trim(), color: colour }),
    onSuccess: async () => {
      setName('');
      setColour(DEFAULT_COLOUR);
      await refresh();
    },
  });

  const rename = useMutation({
    mutationFn: ({ id, value }: { id: string; value: string }) =>
      patch(`/tags/${id}`, { name: value.trim() }),
    onSuccess: async () => {
      setEditing(null);
      await refresh();
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => del(`/tags/${id}`),
    onSuccess: async () => {
      setConfirming(null);
      await refresh();
    },
  });

  const errorOf = (error: unknown) =>
    error instanceof ApiError ? error.payload.userMessage : t('common.error');

  return (
    <>
      <PageHeader
        title={t('tags.title')}
        subtitle={t('tags.subtitle')}
        actions={
          <Link href="/contacts">
            <Button size="sm" variant="ghost">
              <ArrowLeft className="size-3.5" />
              {t('contacts.title')}
            </Button>
          </Link>
        }
      />

      <div className="max-w-3xl space-y-4 px-7 py-5">
        {/* ── Creating ── */}
        <Card>
          <CardBody>
            <form
              className="flex flex-wrap items-end gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                if (name.trim()) create.mutate();
              }}
            >
              <div className="min-w-48 flex-1">
                <Field label={t('tags.name')}>
                  <Input
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder={t('tags.new')}
                  />
                </Field>
              </div>

              <div>
                <Field label={t('tags.color')}>
                  <input
                    type="color"
                    value={colour}
                    onChange={(event) => setColour(event.target.value)}
                    className="h-9 w-14 cursor-pointer rounded-lg border border-border bg-surface p-1"
                  />
                </Field>
              </div>

              <Button type="submit" loading={create.isPending} disabled={!name.trim()}>
                <Plus className="size-3.5" />
                {t('tags.create')}
              </Button>
            </form>

            {create.isError ? (
              <p className="mt-2 text-sm text-danger">{errorOf(create.error)}</p>
            ) : null}
          </CardBody>
        </Card>

        {/* ── The list ── */}
        {tags.isError ? (
          <ErrorState
            message={errorOf(tags.error)}
            onRetry={() => void tags.refetch()}
            retryLabel={t('common.retry')}
          />
        ) : null}

        {tags.isLoading ? (
          <Card>
            <CardBody className="space-y-3">
              {Array.from({ length: 4 }).map((_, index) => (
                <Skeleton key={index} className="w-56" />
              ))}
            </CardBody>
          </Card>
        ) : (tags.data ?? []).length === 0 ? (
          <EmptyState title={t('tags.empty')} />
        ) : (
          <Card>
            <CardBody className="divide-y divide-border p-0">
              {(tags.data ?? []).map((tag) => (
                <div key={tag.id} className="px-5 py-3">
                  {editing === tag.id ? (
                    <form
                      className="flex flex-wrap items-center gap-2"
                      onSubmit={(event) => {
                        event.preventDefault();
                        if (editName.trim()) rename.mutate({ id: tag.id, value: editName });
                      }}
                    >
                      <Input
                        value={editName}
                        onChange={(event) => setEditName(event.target.value)}
                        className="max-w-56"
                        autoFocus
                      />
                      <Button size="sm" type="submit" loading={rename.isPending}>
                        {t('tags.save')}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                        {t('common.cancel')}
                      </Button>
                    </form>
                  ) : confirming === tag.id ? (
                    <div className="space-y-2">
                      <p className="text-sm font-medium text-fg">{t('tags.delete.title')}</p>
                      {/* Not a generic warning: an automation branching on this
                          tag stops finding it the moment it goes. */}
                      <p className="text-xs text-muted">{t('tags.delete.explain')}</p>
                      {remove.isError ? (
                        <p className="text-sm text-danger">{errorOf(remove.error)}</p>
                      ) : null}
                      <div className="flex gap-2">
                        <Button size="sm" variant="secondary" onClick={() => setConfirming(null)}>
                          {t('common.cancel')}
                        </Button>
                        <Button
                          size="sm"
                          variant="danger"
                          loading={remove.isPending}
                          onClick={() => remove.mutate(tag.id)}
                        >
                          {t('tags.delete')}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <span
                        className="inline-flex items-center gap-2 rounded-full border px-2.5 py-0.5 text-xs"
                        style={{ borderColor: `${tag.color}55`, color: tag.color }}
                      >
                        <span
                          className="size-2 rounded-full"
                          style={{ backgroundColor: tag.color }}
                        />
                        {tag.name}
                      </span>

                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setEditName(tag.name);
                            setEditing(tag.id);
                          }}
                        >
                          {t('tags.rename')}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setConfirming(tag.id)}
                          aria-label={t('tags.delete')}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </CardBody>
          </Card>
        )}
      </div>
    </>
  );
}
