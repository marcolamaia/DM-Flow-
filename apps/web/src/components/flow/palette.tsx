'use client';

import { Lock } from 'lucide-react';
import { NODE_META, nodeLabel } from './node-meta';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { CapabilityEntry } from '@/lib/types';

/** Node types offered by the builder, in the order they make sense to reach for. */
const PALETTE_ORDER = [
  'send_message',
  'condition',
  'branch',
  'delay',
  'add_tag',
  'remove_tag',
  'set_custom_field',
  'clear_custom_field',
  'assign_conversation',
  'set_conversation_status',
  'notify_team',
  'http_request',
  'unsubscribe_contact',
  'end',
];

/** Which capability each node depends on, mirroring the server's node registry. */
const NODE_CAPABILITIES: Record<string, string[]> = {
  send_message: ['CAP_IG_SEND_TEXT'],
};

const NODE_FEATURES: Record<string, string> = {
  http_request: 'http_request_node',
};

export function Palette({
  capabilities,
  features,
  onAdd,
}: {
  capabilities: CapabilityEntry[];
  features: string[];
  onAdd: (type: string) => void;
}) {
  const { t, locale } = useI18n();
  const availableCapabilities = new Set(capabilities.filter((c) => c.available).map((c) => c.id));

  return (
    <div className="flex h-full flex-col">
      <p className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-subtle">
        {t('builder.palette')}
      </p>

      <div className="flex-1 overflow-y-auto px-2 pb-3">
        {PALETTE_ORDER.map((type) => {
          const meta = NODE_META[type];
          if (!meta) return null;

          const required = NODE_CAPABILITIES[type] ?? [];
          const missing = required.filter((c) => !availableCapabilities.has(c));
          const feature = NODE_FEATURES[type];
          const featureMissing = feature ? !features.includes(feature) : false;
          const blocked = missing.length > 0 || featureMissing;

          const Icon = meta.icon;

          return (
            <button
              key={type}
              type="button"
              disabled={blocked}
              onClick={() => onAdd(type)}
              title={blocked ? t('builder.unavailableHint') : undefined}
              className={cn(
                'mb-0.5 flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors',
                blocked
                  ? 'cursor-not-allowed text-subtle'
                  : 'text-fg hover:bg-elevated',
              )}
            >
              <Icon className={cn('size-4 shrink-0', blocked ? 'text-subtle' : meta.tone)} />
              <span className="flex-1 truncate">{nodeLabel(type, locale)}</span>
              {blocked ? <Lock className="size-3 shrink-0 text-subtle" /> : null}
            </button>
          );
        })}
      </div>

      {capabilities.some((c) => !c.available) ? (
        <div className="border-t border-border px-3 py-2.5">
          <p className="text-[11px] leading-snug text-subtle">
            {t('builder.unavailableHint')}
          </p>
        </div>
      ) : null}
    </div>
  );
}
