'use client';

import { GripVertical, Lock } from 'lucide-react';
import { NODE_META, nodeLabel } from './node-meta';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { CapabilityEntry } from '@/lib/types';

/** Node types offered by the builder, in the order they make sense to reach for. */
const PALETTE_ORDER = [
  'send_message',
  'condition',
  'branch',
  'randomizer',
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
  'start_automation',
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
      <div className="px-3 pb-2 pt-2.5">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-subtle">
          {t('builder.palette')}
        </p>
        <p className="mt-1 text-[11px] leading-snug text-subtle">{t('builder.dragHint')}</p>
      </div>

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
              data-node-type={type}
              disabled={blocked}
              draggable={!blocked}
              onDragStart={(event) => {
                // The canvas reads this on drop to place the block under the cursor.
                event.dataTransfer.setData('application/dmflow-node', type);
                event.dataTransfer.effectAllowed = 'move';
              }}
              onClick={() => onAdd(type)}
              title={blocked ? t('builder.unavailableHint') : t('builder.dragHint')}
              className={cn(
                'group mb-0.5 flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors',
                blocked
                  ? 'cursor-not-allowed text-subtle'
                  : 'cursor-grab text-fg hover:bg-elevated active:cursor-grabbing',
              )}
            >
              <Icon className={cn('size-4 shrink-0', blocked ? 'text-subtle' : meta.tone)} />
              <span className="flex-1 truncate">{nodeLabel(type, locale)}</span>
              {blocked ? (
                <Lock className="size-3 shrink-0 text-subtle" />
              ) : (
                <GripVertical className="size-3.5 shrink-0 text-subtle opacity-0 transition-opacity group-hover:opacity-100" />
              )}
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
