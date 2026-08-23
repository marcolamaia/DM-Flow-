'use client';

import * as React from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Plus, Trash2, Users } from 'lucide-react';
import { ApiError, del, get, patch, post } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useApp } from '@/components/providers/app-providers';
import { PageHeader } from '@/components/page-header';
import {
  Badge,
  Button,
  Card,
  CardBody,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Skeleton,
} from '@/components/ui/primitives';
import {
  ConditionRow,
  EMPTY_CONDITION,
  conditionIsUsable,
  type EditableCondition,
} from '@/components/predicate/condition-row';
import type { CustomField, Tag } from '@/lib/types';

interface Segment {
  id: string;
  name: string;
  description: string | null;
  filter: unknown;
  contactCount?: number;
}

/**
 * Segments: groups defined by a rule rather than by a list.
 *
 * The one thing this screen must not do is let somebody save a rule without
 * knowing what it catches. So the count comes from the real contacts of this
 * account, on demand, before saving — not an estimate, not a sample.
 */
export default function SegmentsPage() {
  const { t } = useI18n();
  const { workspaceId } = useApp();
  const client = useQueryClient();

  const [editing, setEditing] = React.useState<Segment | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [confirming, setConfirming] = React.useState<string | null>(null);

  const segments = useQuery({
    queryKey: ['segments', workspaceId],
    queryFn: () => get<Segment[]>('/segments'),
    enabled: Boolean(workspaceId),
  });

  const remove = useMutation({
    mutationFn: (id: string) => del(`/segments/${id}`),
    onSuccess: async () => {
      setConfirming(null);
      await client.invalidateQueries({ queryKey: ['segments'] });
    },
  });

  const errorOf = (error: unknown) =>
    error instanceof ApiError ? error.payload.userMessage : t('common.error');

  return (
    <>
      <PageHeader
        title={t('segments.title')}
        subtitle={t('segments.subtitle')}
        actions={
          <div className="flex items-center gap-2">
            <Link href="/contacts">
              <Button size="sm" variant="ghost">
                <ArrowLeft className="size-3.5" />
                {t('contacts.title')}
              </Button>
            </Link>
            {!creating && !editing ? (
              <Button size="sm" onClick={() => setCreating(true)}>
                <Plus className="size-3.5" />
                {t('segments.create')}
              </Button>
            ) : null}
          </div>
        }
      />

      <div className="max-w-4xl space-y-4 px-7 py-5">
        {creating || editing ? (
          <SegmentEditor
            segment={editing}
            onDone={async () => {
              setCreating(false);
              setEditing(null);
              await client.invalidateQueries({ queryKey: ['segments'] });
            }}
            onCancel={() => {
              setCreating(false);
              setEditing(null);
            }}
          />
        ) : null}

        {segments.isError ? (
          <ErrorState
            message={errorOf(segments.error)}
            onRetry={() => void segments.refetch()}
            retryLabel={t('common.retry')}
          />
        ) : null}

        {segments.isLoading ? (
          <Card>
            <CardBody className="space-y-3">
              {Array.from({ length: 3 }).map((_, index) => (
                <Skeleton key={index} className="w-64" />
              ))}
            </CardBody>
          </Card>
        ) : (segments.data ?? []).length === 0 && !creating ? (
          <EmptyState icon={<Users />} title={t('segments.empty')} />
        ) : (
          <div className="space-y-2">
            {(segments.data ?? []).map((segment) => (
              <Card key={segment.id}>
                <CardBody>
                  {confirming === segment.id ? (
                    <div className="space-y-2">
                      <p className="text-[13px] font-medium text-fg">
                        {t('segments.delete.title')}
                      </p>
                      {/* Deleting a rule is not deleting people. Saying so stops
                          the hesitation that a generic warning creates. */}
                      <p className="text-xs text-muted">{t('segments.delete.explain')}</p>
                      <div className="flex gap-2">
                        <Button size="sm" variant="secondary" onClick={() => setConfirming(null)}>
                          {t('common.cancel')}
                        </Button>
                        <Button
                          size="sm"
                          variant="danger"
                          loading={remove.isPending}
                          onClick={() => remove.mutate(segment.id)}
                        >
                          {t('common.delete')}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-[13px] font-medium text-fg">{segment.name}</p>
                        {segment.description ? (
                          <p className="truncate text-xs text-muted">{segment.description}</p>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-2">
                        {typeof segment.contactCount === 'number' ? (
                          <Badge>{segment.contactCount}</Badge>
                        ) : null}
                        <Button size="sm" variant="ghost" onClick={() => setEditing(segment)}>
                          {t('segments.edit')}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setConfirming(segment.id)}
                          aria-label={t('common.delete')}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    </div>
                  )}
                </CardBody>
              </Card>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

// ── The editor ───────────────────────────────────────────────

function SegmentEditor({
  segment,
  onDone,
  onCancel,
}: {
  segment: Segment | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const { workspaceId } = useApp();

  const existing = readFilter(segment?.filter);

  const [name, setName] = React.useState(segment?.name ?? '');
  const [description, setDescription] = React.useState(segment?.description ?? '');
  const [mode, setMode] = React.useState<'and' | 'or'>(existing.mode);
  const [rules, setRules] = React.useState<EditableCondition[]>(
    existing.rules.length > 0 ? existing.rules : [{ ...EMPTY_CONDITION }],
  );
  const [matched, setMatched] = React.useState<number | null>(null);

  const tags = useQuery({
    queryKey: ['tags', workspaceId],
    queryFn: () => get<Tag[]>('/tags'),
    enabled: Boolean(workspaceId),
  });
  const fields = useQuery({
    queryKey: ['custom-fields', workspaceId],
    queryFn: () => get<CustomField[]>('/custom-fields'),
    enabled: Boolean(workspaceId),
  });

  const usable = rules.filter(conditionIsUsable);
  const filter = { kind: mode, children: usable };

  const preview = useMutation({
    mutationFn: () => post<{ count: number }>('/segments/preview', { filter }),
    onSuccess: (result) => setMatched(result.count),
  });

  const save = useMutation({
    mutationFn: () => {
      const body = { name: name.trim(), description: description.trim() || undefined, filter };
      return segment ? patch(`/segments/${segment.id}`, body) : post('/segments', body);
    },
    onSuccess: onDone,
  });

  const errorOf = (error: unknown) =>
    error instanceof ApiError ? error.payload.userMessage : t('common.error');

  return (
    <Card>
      <CardBody className="space-y-4">
        <div className="flex flex-wrap gap-3">
          <div className="min-w-56 flex-1">
            <Field label={t('segments.name')}>
              <Input value={name} onChange={(event) => setName(event.target.value)} autoFocus />
            </Field>
          </div>
          <div className="min-w-56 flex-1">
            <Field label={t('segments.description')}>
              <Input
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </Field>
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted">
              {t('segments.rules')}
            </p>
            <div className="flex gap-1 rounded-lg border border-border bg-bg p-1">
              {(['and', 'or'] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => {
                    setMode(option);
                    setMatched(null);
                  }}
                  className={
                    option === mode
                      ? 'rounded-md bg-accent/10 px-3 py-1 text-xs font-medium text-accent'
                      : 'rounded-md px-3 py-1 text-xs text-muted hover:text-fg'
                  }
                >
                  {option === 'and' ? t('segments.matchAll') : t('segments.matchAny')}
                </button>
              ))}
            </div>
          </div>

          {rules.map((rule, index) => (
            <div key={index} className="flex items-end gap-2 rounded-lg border border-border p-3">
              <div className="min-w-0 flex-1">
                <ConditionRow
                  condition={rule}
                  tags={tags.data ?? []}
                  fields={fields.data ?? []}
                  onChange={(next) => {
                    setRules((current) =>
                      current.map((item, position) => (position === index ? next : item)),
                    );
                    // The count belongs to the rule that produced it. Editing
                    // the rule makes it stale, so it goes.
                    setMatched(null);
                  }}
                />
              </div>
              {rules.length > 1 ? (
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={t('segments.removeRule')}
                  onClick={() => {
                    setRules((current) => current.filter((_, position) => position !== index));
                    setMatched(null);
                  }}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              ) : null}
            </div>
          ))}

          <Button
            size="sm"
            variant="secondary"
            onClick={() => setRules((current) => [...current, { ...EMPTY_CONDITION }])}
          >
            <Plus className="size-3.5" />
            {t('segments.addRule')}
          </Button>

          {usable.length === 0 ? (
            // Refused rather than saved: an empty rule set matches everybody,
            // which is never what somebody meant to build.
            <p className="text-xs text-warning">{t('segments.noRules')}</p>
          ) : null}
        </div>

        {/* ── What it actually catches ── */}
        <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
          <Button
            size="sm"
            variant="secondary"
            disabled={usable.length === 0}
            loading={preview.isPending}
            onClick={() => preview.mutate()}
          >
            {t('segments.preview')}
          </Button>

          {matched !== null ? (
            <span className="text-[13px] text-fg">
              <strong>{matched}</strong> {t('segments.previewResult')}
              <span className="ml-2 text-xs text-muted">{t('segments.previewHint')}</span>
            </span>
          ) : null}

          {preview.isError ? (
            <span className="text-[13px] text-danger">{errorOf(preview.error)}</span>
          ) : null}
        </div>

        {save.isError ? <p className="text-[13px] text-danger">{errorOf(save.error)}</p> : null}

        <div className="flex gap-2">
          <Button variant="secondary" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
          <Button
            loading={save.isPending}
            disabled={!name.trim() || usable.length === 0}
            onClick={() => save.mutate()}
          >
            {segment ? t('segments.save') : t('segments.create')}
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

/** Reads a stored filter back into something the editor can show. */
function readFilter(filter: unknown): { mode: 'and' | 'or'; rules: EditableCondition[] } {
  const node = filter as { kind?: string; children?: unknown[] } | undefined;

  if (node?.kind === 'and' || node?.kind === 'or') {
    return {
      mode: node.kind,
      rules: (node.children ?? []).filter(
        (child): child is EditableCondition =>
          typeof child === 'object' && child !== null && (child as { kind?: string }).kind === 'condition',
      ),
    };
  }

  // A single condition, or something this editor cannot represent. Either way
  // the safe reading is "start from one empty rule" rather than silently
  // dropping what is stored.
  if (node?.kind === 'condition') {
    return { mode: 'and', rules: [node as unknown as EditableCondition] };
  }

  return { mode: 'and', rules: [] };
}
