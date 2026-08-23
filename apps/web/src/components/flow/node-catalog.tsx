'use client';

import * as React from 'react';
import { Lock, Search } from 'lucide-react';
import { NODE_DEFINITIONS, type NodeType } from '@dmflow/shared/flow';
import { useI18n, type MessageKey } from '@/lib/i18n';
import { Input } from '@/components/ui/primitives';
import { NODE_META } from './node-meta';
import { cn } from '@/lib/utils';
import type { CapabilityEntry } from '@/lib/types';

/**
 * Categories in the order somebody building a flow reaches for them: say
 * something, decide something, do something, then control what happens next.
 */
const CATEGORY_ORDER = ['message', 'logic', 'data', 'inbox', 'integration', 'terminal'] as const;
type Category = (typeof CATEGORY_ORDER)[number];

const CATEGORY_LABEL: Record<Category, MessageKey> = {
  message: 'catalog.content',
  logic: 'catalog.logic',
  data: 'catalog.actions',
  inbox: 'catalog.inbox',
  integration: 'catalog.integrations',
  terminal: 'catalog.flow',
};

/** Capabilities a node cannot work without, mirroring the server's node registry. */
const NODE_CAPABILITIES: Record<string, string[]> = {
  send_message: ['CAP_IG_SEND_TEXT'],
};

const NODE_FEATURES: Record<string, string> = {
  http_request: 'http_request_node',
};

export interface CatalogEntry {
  type: string;
  label: string;
  description: string;
  category: Category;
  blocked: boolean;
  blockedReason?: string;
}

/**
 * What may be added, and what may not.
 *
 * A block whose channel capability has not been validated is listed but refused,
 * rather than hidden: somebody looking for "send a message" needs to find out it
 * exists and why it is unavailable, not conclude the product cannot do it.
 */
export function useCatalog(
  capabilities: CapabilityEntry[],
  features: string[],
  locale: string,
): CatalogEntry[] {
  const { t } = useI18n();

  return React.useMemo(() => {
    const available = new Set(capabilities.filter((c) => c.available).map((c) => c.id));
    const lang = locale === 'en' ? 'en' : 'pt-BR';

    return (Object.keys(NODE_DEFINITIONS) as NodeType[])
      .filter((type) => type !== 'trigger')
      .map((type) => {
        const definition = NODE_DEFINITIONS[type];
        const missingCapability = (NODE_CAPABILITIES[type] ?? []).some((c) => !available.has(c));
        const requiredFeature = NODE_FEATURES[type];
        const missingFeature = requiredFeature ? !features.includes(requiredFeature) : false;

        return {
          type,
          label: definition.label[lang],
          description: definition.description[lang],
          category: definition.category as Category,
          blocked: missingCapability || missingFeature,
          blockedReason: missingCapability
            ? t('builder.unavailableHint')
            : missingFeature
              ? t('catalog.notInPlan')
              : undefined,
        };
      });
  }, [capabilities, features, locale, t]);
}

/**
 * The block picker.
 *
 * One component serves the palette, the double-click on empty canvas and the
 * quick-connect menu, so a block offered in one place is offered in all of them
 * with the same availability rules.
 */
export function NodeCatalog({
  entries,
  onPick,
  autoFocus = true,
  compact = false,
  draggable = false,
  footer,
}: {
  entries: CatalogEntry[];
  onPick: (type: string) => void;
  autoFocus?: boolean;
  compact?: boolean;
  /** Lets an entry be dragged onto the canvas to choose where it lands. */
  draggable?: boolean;
  footer?: React.ReactNode;
}) {
  const { t } = useI18n();
  const [query, setQuery] = React.useState('');

  const filtered = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return entries;
    return entries.filter(
      (entry) =>
        entry.label.toLowerCase().includes(needle) ||
        entry.description.toLowerCase().includes(needle),
    );
  }, [entries, query]);

  const grouped = React.useMemo(
    () =>
      CATEGORY_ORDER.map((category) => ({
        category,
        items: filtered.filter((entry) => entry.category === category),
      })).filter((group) => group.items.length > 0),
    [filtered],
  );

  return (
    <div className="flex min-h-0 flex-col">
      <div className="relative px-2 pb-1.5 pt-2">
        <Search className="pointer-events-none absolute left-4 top-1/2 size-3.5 -translate-y-1/2 text-subtle" />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('catalog.search')}
          autoFocus={autoFocus}
          className="!h-8 !pl-8 text-[12.5px]"
        />
      </div>

      <div className={cn('min-h-0 flex-1 overflow-y-auto px-1.5 pb-2', compact && 'max-h-[340px]')}>
        {grouped.length === 0 ? (
          <p className="px-2 py-6 text-center text-[12.5px] text-subtle">{t('catalog.noResults')}</p>
        ) : (
          grouped.map((group) => (
            <div key={group.category} className="mb-1.5">
              <p className="px-2 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-wider text-subtle">
                {t(CATEGORY_LABEL[group.category])}
              </p>

              {group.items.map((entry) => {
                const meta = NODE_META[entry.type];
                const Icon = meta?.icon;

                return (
                  <button
                    key={entry.type}
                    type="button"
                    data-node-type={entry.type}
                    disabled={entry.blocked}
                    title={entry.blocked ? entry.blockedReason : entry.description}
                    onClick={() => onPick(entry.type)}
                    draggable={draggable && !entry.blocked}
                    onDragStart={(event) => {
                      // The canvas reads this on drop to place the block under the
                      // cursor; clicking still appends, so both gestures work.
                      event.dataTransfer.setData('application/dmflow-node', entry.type);
                      event.dataTransfer.effectAllowed = 'move';
                    }}
                    className={cn(
                      'flex w-full items-start gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors',
                      entry.blocked
                        ? 'cursor-not-allowed opacity-55'
                        : draggable
                          ? 'cursor-grab hover:bg-elevated active:cursor-grabbing'
                          : 'hover:bg-elevated active:bg-elevated/70',
                    )}
                  >
                    {Icon ? (
                      <Icon className={cn('mt-0.5 size-4 shrink-0', entry.blocked ? 'text-subtle' : meta.tone)} />
                    ) : null}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] font-medium leading-tight">
                        {entry.label}
                      </span>
                      <span className="mt-0.5 block truncate text-[11px] leading-snug text-subtle">
                        {entry.blocked ? entry.blockedReason : entry.description}
                      </span>
                    </span>
                    {entry.blocked ? <Lock className="mt-0.5 size-3 shrink-0 text-subtle" /> : null}
                  </button>
                );
              })}
            </div>
          ))
        )}
      </div>

      {footer}
    </div>
  );
}
