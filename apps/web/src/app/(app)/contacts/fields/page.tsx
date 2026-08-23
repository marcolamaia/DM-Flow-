'use client';

import * as React from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Plus, Trash2 } from 'lucide-react';
import { ApiError, del, get, post } from '@/lib/api';
import { useI18n, type MessageKey } from '@/lib/i18n';
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
  Select,
  Skeleton,
  Textarea,
} from '@/components/ui/primitives';
import type { CustomField } from '@/lib/types';

const TYPES = ['TEXT', 'NUMBER', 'BOOLEAN', 'DATE', 'DATETIME', 'SELECT'] as const;

/** `Nome da empresa` → `nome_da_empresa`. */
function toKey(label: string): string {
  return label
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
}

export default function CustomFieldsPage() {
  const { t } = useI18n();
  const { workspaceId } = useApp();
  const client = useQueryClient();

  const [label, setLabel] = React.useState('');
  const [key, setKey] = React.useState('');
  const [keyTouched, setKeyTouched] = React.useState(false);
  const [type, setType] = React.useState<(typeof TYPES)[number]>('TEXT');
  const [options, setOptions] = React.useState('');
  const [confirming, setConfirming] = React.useState<string | null>(null);

  const fields = useQuery({
    queryKey: ['custom-fields', workspaceId],
    queryFn: () => get<CustomField[]>('/custom-fields'),
    enabled: Boolean(workspaceId),
  });

  const create = useMutation({
    mutationFn: () =>
      post('/custom-fields', {
        label: label.trim(),
        key: (keyTouched ? key : toKey(label)).trim(),
        type,
        ...(type === 'SELECT'
          ? { options: options.split('\n').map((line) => line.trim()).filter(Boolean) }
          : {}),
      }),
    onSuccess: async () => {
      setLabel('');
      setKey('');
      setKeyTouched(false);
      setOptions('');
      setType('TEXT');
      await client.invalidateQueries({ queryKey: ['custom-fields'] });
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => del(`/custom-fields/${id}`),
    onSuccess: async () => {
      setConfirming(null);
      await client.invalidateQueries({ queryKey: ['custom-fields'] });
    },
  });

  const errorOf = (error: unknown) =>
    error instanceof ApiError ? error.payload.userMessage : t('common.error');

  // Derived unless the person has taken it over — typing a label and watching
  // the identifier follow explains what the identifier is far better than a
  // paragraph would.
  const shownKey = keyTouched ? key : toKey(label);

  return (
    <>
      <PageHeader
        title={t('fields.title')}
        subtitle={t('fields.subtitle')}
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
        <Card>
          <CardBody>
            <form
              className="space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                if (label.trim() && shownKey) create.mutate();
              }}
            >
              <div className="flex flex-wrap gap-3">
                <div className="min-w-48 flex-1">
                  <Field label={t('fields.label')}>
                    <Input value={label} onChange={(event) => setLabel(event.target.value)} />
                  </Field>
                </div>

                <div className="min-w-48 flex-1">
                  <Field label={t('fields.key')} hint={t('fields.keyHint')}>
                    <Input
                      value={shownKey}
                      onChange={(event) => {
                        setKeyTouched(true);
                        setKey(event.target.value);
                      }}
                      className="font-mono"
                    />
                  </Field>
                </div>

                <div className="min-w-40">
                  <Field label={t('fields.type')}>
                    <Select
                      value={type}
                      onChange={(event) => setType(event.target.value as (typeof TYPES)[number])}
                    >
                      {TYPES.map((option) => (
                        <option key={option} value={option}>
                          {t(`fields.type.${option}` as MessageKey)}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </div>
              </div>

              {type === 'SELECT' ? (
                <Field label={t('fields.options')} hint={t('fields.optionsHint')}>
                  <Textarea
                    rows={3}
                    value={options}
                    onChange={(event) => setOptions(event.target.value)}
                  />
                </Field>
              ) : null}

              {create.isError ? (
                <p className="text-[13px] text-danger">{errorOf(create.error)}</p>
              ) : null}

              <Button type="submit" loading={create.isPending} disabled={!label.trim() || !shownKey}>
                <Plus className="size-3.5" />
                {t('fields.create')}
              </Button>
            </form>
          </CardBody>
        </Card>

        {fields.isError ? (
          <ErrorState
            message={errorOf(fields.error)}
            onRetry={() => void fields.refetch()}
            retryLabel={t('common.retry')}
          />
        ) : null}

        {fields.isLoading ? (
          <Card>
            <CardBody className="space-y-3">
              {Array.from({ length: 3 }).map((_, index) => (
                <Skeleton key={index} className="w-56" />
              ))}
            </CardBody>
          </Card>
        ) : (fields.data ?? []).length === 0 ? (
          <EmptyState title={t('fields.empty')} />
        ) : (
          <Card>
            <CardBody className="divide-y divide-border p-0">
              {(fields.data ?? []).map((field) => (
                <div key={field.id} className="px-5 py-3">
                  {confirming === field.id ? (
                    <div className="space-y-2">
                      <p className="text-[13px] font-medium text-fg">{t('fields.delete.title')}</p>
                      {/* Both consequences, because only one of them is obvious. */}
                      <p className="text-xs text-muted">{t('fields.delete.explain')}</p>
                      <div className="flex gap-2">
                        <Button size="sm" variant="secondary" onClick={() => setConfirming(null)}>
                          {t('common.cancel')}
                        </Button>
                        <Button
                          size="sm"
                          variant="danger"
                          loading={remove.isPending}
                          onClick={() => remove.mutate(field.id)}
                        >
                          {t('common.delete')}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-[13px] font-medium text-fg">{field.label}</p>
                        <p className="truncate font-mono text-xs text-muted">{field.key}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge tone="neutral">
                          {t(`fields.type.${field.type}` as MessageKey)}
                        </Badge>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setConfirming(field.id)}
                          aria-label={t('common.delete')}
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
