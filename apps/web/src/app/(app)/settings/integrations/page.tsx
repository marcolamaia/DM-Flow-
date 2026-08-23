'use client';

import * as React from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Plus, Trash2, Webhook } from 'lucide-react';
import { ApiError, del, get, post } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useApp } from '@/components/providers/app-providers';
import { PageHeader } from '@/components/page-header';
import {
  Badge,
  Banner,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Field,
  Input,
  Skeleton,
} from '@/components/ui/primitives';
import { SecretOnce } from '@/components/settings/secret-once';

interface ApiKeyRow {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  lastUsedAt: string | null;
  createdAt: string;
}

interface WebhookRow {
  id: string;
  name: string;
  url: string;
  events: string[];
  enabled: boolean;
  createdAt: string;
}

/**
 * The customer's own integration surface.
 *
 * Both halves hand out a secret exactly once, because the server keeps only a
 * hash. Both are also gated by the plan, so a refusal here is a normal answer
 * and gets pointed at the billing screen rather than shown as an error.
 */
export default function IntegrationsPage() {
  const { t, locale } = useI18n();
  const { workspaceId } = useApp();
  const client = useQueryClient();

  const errorOf = (error: unknown) =>
    error instanceof ApiError ? error.payload.userMessage : t('common.error');

  const planBlocked = (error: unknown) =>
    error instanceof ApiError && error.code === 'PLAN_LIMIT_REACHED';

  return (
    <>
      <PageHeader title={t('dev.title')} subtitle={t('dev.subtitle')} />

      <div className="max-w-3xl space-y-5 px-7 py-5">
        <ApiKeysCard
          workspaceId={workspaceId}
          errorOf={errorOf}
          planBlocked={planBlocked}
          client={client}
          locale={locale}
        />
        <WebhooksCard
          workspaceId={workspaceId}
          errorOf={errorOf}
          planBlocked={planBlocked}
          client={client}
        />
      </div>
    </>
  );
}

// ── API keys ─────────────────────────────────────────────────

function ApiKeysCard({
  workspaceId,
  errorOf,
  planBlocked,
  client,
  locale,
}: {
  workspaceId: string | null;
  errorOf: (error: unknown) => string;
  planBlocked: (error: unknown) => boolean;
  client: ReturnType<typeof useQueryClient>;
  locale: string;
}) {
  const { t } = useI18n();
  const [name, setName] = React.useState('');
  const [issued, setIssued] = React.useState<string | null>(null);
  const [confirming, setConfirming] = React.useState<string | null>(null);

  const keys = useQuery({
    queryKey: ['api-keys', workspaceId],
    queryFn: () => get<ApiKeyRow[]>('/api-keys'),
    enabled: Boolean(workspaceId),
  });

  const create = useMutation({
    mutationFn: () => post<{ id: string; key: string }>('/api-keys', { name: name.trim() }),
    onSuccess: async (result) => {
      setName('');
      // Held in state, never refetched — there is nothing to refetch it from.
      setIssued(result.key);
      await client.invalidateQueries({ queryKey: ['api-keys'] });
    },
  });

  const revoke = useMutation({
    mutationFn: (id: string) => del(`/api-keys/${id}`),
    onSuccess: async () => {
      setConfirming(null);
      await client.invalidateQueries({ queryKey: ['api-keys'] });
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="size-4" />
          {t('dev.keys.title')}
        </CardTitle>
      </CardHeader>

      <CardBody className="space-y-4">
        <p className="text-[13px] text-muted">{t('dev.keys.explain')}</p>

        {issued ? (
          <SecretOnce
            label={t('dev.keys.created')}
            value={issued}
            warning={t('dev.keys.onlyOnce')}
            onDismiss={() => setIssued(null)}
          />
        ) : null}

        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (name.trim()) create.mutate();
          }}
        >
          <div className="min-w-56 flex-1">
            <Field label={t('dev.keys.new')} hint={t('dev.keys.newHint')}>
              <Input value={name} onChange={(event) => setName(event.target.value)} />
            </Field>
          </div>
          <Button type="submit" loading={create.isPending} disabled={!name.trim()}>
            <Plus className="size-3.5" />
            {t('dev.keys.create')}
          </Button>
        </form>

        {create.isError ? (
          planBlocked(create.error) ? (
            // A plan that does not include the feature is a normal answer, not
            // a failure — so it points somewhere useful.
            <Banner tone="accent" title={t('dev.planRequired')}>
              <Link href="/settings/billing" className="text-[13px] text-accent hover:underline">
                {t('dev.seePlans')}
              </Link>
            </Banner>
          ) : (
            <p className="text-[13px] text-danger">{errorOf(create.error)}</p>
          )
        ) : null}

        {keys.isLoading ? (
          <Skeleton className="h-12" />
        ) : (keys.data ?? []).length === 0 ? (
          <p className="text-[13px] text-muted">{t('dev.keys.empty')}</p>
        ) : (
          <div className="divide-y divide-border rounded-lg border border-border">
            {(keys.data ?? []).map((key) => (
              <div key={key.id} className="px-4 py-3">
                {confirming === key.id ? (
                  <div className="space-y-2">
                    <p className="text-[13px] font-medium text-fg">{t('dev.keys.revoke.title')}</p>
                    <p className="text-xs text-muted">{t('dev.keys.revoke.explain')}</p>
                    <div className="flex gap-2">
                      <Button size="sm" variant="secondary" onClick={() => setConfirming(null)}>
                        {t('common.cancel')}
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        loading={revoke.isPending}
                        onClick={() => revoke.mutate(key.id)}
                      >
                        {t('dev.keys.revoke')}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-medium text-fg">{key.name}</p>
                      {/* Only ever the prefix. The rest exists nowhere. */}
                      <p className="truncate font-mono text-xs text-muted">{key.prefix}…</p>
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                      <span className="text-xs text-muted">
                        {t('dev.keys.lastUsed')}:{' '}
                        {key.lastUsedAt
                          ? new Date(key.lastUsedAt).toLocaleDateString(locale)
                          : t('dev.keys.neverUsed')}
                      </span>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setConfirming(key.id)}
                        aria-label={t('dev.keys.revoke')}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

// ── Outbound webhooks ────────────────────────────────────────

function WebhooksCard({
  workspaceId,
  errorOf,
  planBlocked,
  client,
}: {
  workspaceId: string | null;
  errorOf: (error: unknown) => string;
  planBlocked: (error: unknown) => boolean;
  client: ReturnType<typeof useQueryClient>;
}) {
  const { t } = useI18n();
  const [name, setName] = React.useState('');
  const [url, setUrl] = React.useState('');
  const [chosen, setChosen] = React.useState<string[]>([]);
  const [secret, setSecret] = React.useState<string | null>(null);
  const [confirming, setConfirming] = React.useState<string | null>(null);

  const catalogue = useQuery({
    queryKey: ['outbound-events'],
    queryFn: () => get<string[]>('/outbound-webhooks/events'),
    enabled: Boolean(workspaceId),
  });

  const hooks = useQuery({
    queryKey: ['outbound-webhooks', workspaceId],
    queryFn: () => get<WebhookRow[]>('/outbound-webhooks'),
    enabled: Boolean(workspaceId),
  });

  const create = useMutation({
    mutationFn: () =>
      post<{ id: string; secret: string }>('/outbound-webhooks', {
        name: name.trim(),
        url: url.trim(),
        events: chosen,
      }),
    onSuccess: async (result) => {
      setName('');
      setUrl('');
      setChosen([]);
      setSecret(result.secret);
      await client.invalidateQueries({ queryKey: ['outbound-webhooks'] });
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => del(`/outbound-webhooks/${id}`),
    onSuccess: async () => {
      setConfirming(null);
      await client.invalidateQueries({ queryKey: ['outbound-webhooks'] });
    },
  });

  const toggle = (event: string) =>
    setChosen((current) =>
      current.includes(event) ? current.filter((e) => e !== event) : [...current, event],
    );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Webhook className="size-4" />
          {t('dev.hooks.title')}
        </CardTitle>
      </CardHeader>

      <CardBody className="space-y-4">
        <p className="text-[13px] text-muted">{t('dev.hooks.explain')}</p>

        {secret ? (
          <SecretOnce
            label={t('dev.hooks.secret')}
            value={secret}
            warning={t('dev.hooks.secretOnce')}
            onDismiss={() => setSecret(null)}
          />
        ) : null}

        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (name.trim() && url.trim() && chosen.length > 0) create.mutate();
          }}
        >
          <div className="flex flex-wrap gap-3">
            <div className="min-w-40 flex-1">
              <Field label={t('dev.hooks.name')}>
                <Input value={name} onChange={(event) => setName(event.target.value)} />
              </Field>
            </div>
            <div className="min-w-64 flex-[2]">
              <Field label={t('dev.hooks.url')}>
                <Input
                  type="url"
                  placeholder="https://"
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                />
              </Field>
            </div>
          </div>

          <div>
            <p className="mb-1.5 text-xs font-medium text-fg">{t('dev.hooks.events')}</p>
            <div className="flex flex-wrap gap-1.5">
              {(catalogue.data ?? []).map((event) => (
                <button
                  key={event}
                  type="button"
                  onClick={() => toggle(event)}
                  className={
                    chosen.includes(event)
                      ? 'rounded-full border border-accent/30 bg-accent/10 px-2.5 py-1 font-mono text-xs text-accent'
                      : 'rounded-full border border-border px-2.5 py-1 font-mono text-xs text-muted hover:text-fg'
                  }
                >
                  {event}
                </button>
              ))}
            </div>
            {chosen.length === 0 ? (
              <p className="mt-1.5 text-xs text-muted">{t('dev.hooks.selectEvents')}</p>
            ) : null}
          </div>

          <Button
            type="submit"
            loading={create.isPending}
            disabled={!name.trim() || !url.trim() || chosen.length === 0}
          >
            <Plus className="size-3.5" />
            {t('dev.hooks.create')}
          </Button>
        </form>

        {create.isError ? (
          planBlocked(create.error) ? (
            <Banner tone="accent" title={t('dev.planRequired')}>
              <Link href="/settings/billing" className="text-[13px] text-accent hover:underline">
                {t('dev.seePlans')}
              </Link>
            </Banner>
          ) : (
            <p className="text-[13px] text-danger">{errorOf(create.error)}</p>
          )
        ) : null}

        {hooks.isLoading ? (
          <Skeleton className="h-12" />
        ) : (hooks.data ?? []).length === 0 ? (
          <p className="text-[13px] text-muted">{t('dev.hooks.empty')}</p>
        ) : (
          <div className="divide-y divide-border rounded-lg border border-border">
            {(hooks.data ?? []).map((hook) => (
              <div key={hook.id} className="px-4 py-3">
                {confirming === hook.id ? (
                  <div className="space-y-2">
                    <p className="text-[13px] font-medium text-fg">{t('dev.hooks.delete.title')}</p>
                    <p className="text-xs text-muted">{t('dev.hooks.delete.explain')}</p>
                    <div className="flex gap-2">
                      <Button size="sm" variant="secondary" onClick={() => setConfirming(null)}>
                        {t('common.cancel')}
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        loading={remove.isPending}
                        onClick={() => remove.mutate(hook.id)}
                      >
                        {t('dev.hooks.delete')}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-medium text-fg">{hook.name}</p>
                      <p className="truncate font-mono text-xs text-muted">{hook.url}</p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {hook.events.map((event) => (
                          <span key={event} className="font-mono text-[11px] text-subtle">
                            {event}
                          </span>
                        ))}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {hook.enabled ? (
                        <Badge tone="success">{t('dev.hooks.enabled')}</Badge>
                      ) : null}
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setConfirming(hook.id)}
                        aria-label={t('dev.hooks.delete')}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
